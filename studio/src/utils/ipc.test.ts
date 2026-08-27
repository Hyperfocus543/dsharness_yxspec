// @vitest-environment node
// =============================================================================
// ipc.ts 长任务轮询单测
//
// 覆盖两个核心语义：
//   1. fetchTask 三态返回：
//      - TaskStatus（200 正常）
//      - 'missing'（HTTP 404 = 任务真丢失，网关重启内存清空）
//      - null（fetch 抛错 = 网络抖动）
//   2. pollTask 轮询状态机：
//      - running 一直轮询，直到 done/error 终态
//      - 遇到 'missing'(404) 立即退出返回 null
//      - 遇到 null（网络错）退避重试不中断，之后拿到 done 就返回 TaskStatus
//      - shouldStop() 返回 true 立即退出返回 null
//      - timeoutMs 超时返回 null
//
// 只 mock 全局 fetch（vi.stubGlobal），不 mock ipc 模块本身。
// 模块顶层 isTauri 用 `typeof window !== 'undefined'` 守卫，node 环境下自动为
// false，无需额外 stub window；GATEWAY_BASE 走 import.meta.env，vitest 提供
// import.meta，缺 VITE_EXEC_GATEWAY 时回退默认值。
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GATEWAY_BASE, fetchTask, pollTask, fetchResumeInfo, type TaskStatus } from './ipc';

/** 构造简化 Response（fetchTask 只用 status/ok/json，不需要真 Response） */
function okResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const runningTask: TaskStatus = {
  task_id: 'task-123',
  status: 'running',
  session_id: 'sess-1',
  result: null,
  error: null,
  created_at: '2026-08-24T00:00:00Z',
};

const doneTask: TaskStatus = {
  ...runningTask,
  status: 'done',
  result: { finish_reason: 'completed', final_response: 'ok' },
};

const errorTask: TaskStatus = {
  ...runningTask,
  status: 'error',
  result: null,
  error: 'gateway boom',
};

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  // 只 mock 全局 fetch；localStorage 仅在函数体内 try/catch 访问，简单 stub 兜底
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTask', () => {
  it('200 正常返回 TaskStatus', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(doneTask));

    const res = await fetchTask('task-123');

    expect(res).toEqual(doneTask);
    expect(mockFetch).toHaveBeenCalledWith(
      `${GATEWAY_BASE}/api/tasks/${encodeURIComponent('task-123')}`,
      { headers: { Accept: 'application/json' } },
    );
  });

  it('HTTP 404 → 返回 missing（任务真丢失）', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(null, 404));

    const res = await fetchTask('task-123');

    expect(res).toBe('missing');
  });

  it('非 404 非 2xx（如 500）→ 返回 null', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ error: 'internal' }, 500));

    const res = await fetchTask('task-123');

    expect(res).toBeNull();
  });

  it('fetch 抛错（网络抖动）→ 返回 null', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const res = await fetchTask('task-123');

    expect(res).toBeNull();
  });
});

describe('pollTask', () => {
  it('running 一直轮询，直到 done 返回 TaskStatus', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse(runningTask))
      .mockResolvedValueOnce(okResponse(runningTask))
      .mockResolvedValueOnce(okResponse(doneTask));

    const res = await pollTask('task-123', { timeoutMs: 5000, intervalMs: 1 });

    expect(res).toEqual(doneTask);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('error 终态同样返回 TaskStatus', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse(runningTask))
      .mockResolvedValueOnce(okResponse(errorTask));

    const res = await pollTask('task-123', { timeoutMs: 5000, intervalMs: 1 });

    expect(res).toEqual(errorTask);
  });

  it('遇到 missing(404) → 立即退出返回 null，且不再轮询', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(null, 404));

    const res = await pollTask('task-123', { timeoutMs: 5000, intervalMs: 1 });

    expect(res).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('网络错误（fetch 抛错）→ 退避重试不中断，之后拿到 done 返回 TaskStatus', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse(runningTask))
      .mockResolvedValueOnce(okResponse(doneTask));

    const res = await pollTask('task-123', { timeoutMs: 5000, intervalMs: 1 });

    expect(res).toEqual(doneTask);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // 网络抖动被当作可恢复，而不是 404 那种真丢失
  }, 10000);

  it('shouldStop 返回 true → 立即退出返回 null，且不发请求', async () => {
    const shouldStop = vi.fn().mockReturnValueOnce(true);
    mockFetch.mockResolvedValueOnce(okResponse(runningTask));

    const res = await pollTask('task-123', { timeoutMs: 5000, intervalMs: 1, shouldStop });

    expect(res).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(shouldStop).toHaveBeenCalled();
  });

  it('超时（timeoutMs 到，任务一直 running）→ 返回 null', async () => {
    mockFetch.mockResolvedValue(okResponse(runningTask));

    const res = await pollTask('task-123', { timeoutMs: 30, intervalMs: 10 });

    expect(res).toBeNull();
    // 超时前持续轮询过多次（而非一次就退）
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  }, 10000);

  it('onPoll 每轮回调：running 时回传状态，missing 时回传 null（不外泄 missing）', async () => {
    const onPoll = vi.fn();
    mockFetch
      .mockResolvedValueOnce(okResponse(runningTask))
      .mockResolvedValueOnce(okResponse(null, 404));

    const res = await pollTask('task-123', { timeoutMs: 5000, intervalMs: 1, onPoll });

    expect(res).toBeNull();
    expect(onPoll).toHaveBeenNthCalledWith(1, runningTask);
    expect(onPoll).toHaveBeenNthCalledWith(2, null);
  });
});

describe('fetchResumeInfo', () => {
  it('200 正常返回断点恢复信息（resumable=true）', async () => {
    const body = {
      projectPath: 'D:/Work/01_Projects/Aima_X1_BCM',
      current: 'swe_coding_verify_pc',
      currentIndex: 13,
      pendingCount: 13,
      blockedStages: ['sqt_strategy', 'sqt_tr'],
      suggestedNext: {
        token: 'swe_coding_verify_pc',
        command: '/yxspec:swe-coding-verify-pc-v2',
        command_name: 'swe-coding-verify-pc-v2',
        aspice: 'SWE.4',
        label: 'PC 端编码验证',
      },
      resumable: true,
    };
    mockFetch.mockResolvedValueOnce(okResponse(body));

    const res = await fetchResumeInfo('D:/Work/01_Projects/Aima_X1_BCM');

    expect(res).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(`${GATEWAY_BASE}/api/resume`);
  });

  it('resumable=false（全部完成）仍返回对象，不置 null', async () => {
    const body = {
      projectPath: 'D:/Work/01_Projects/Aima_X1_BCM',
      current: null,
      currentIndex: -1,
      pendingCount: 0,
      blockedStages: [],
      suggestedNext: null,
      resumable: false,
    };
    mockFetch.mockResolvedValueOnce(okResponse(body));

    const res = await fetchResumeInfo('p');

    expect(res).toEqual(body);
    expect(res?.resumable).toBe(false);
  });

  it('后端漏传 resumable 时，按 current/currentIndex 兜底推导布尔值', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ current: 'swe_coding_do', currentIndex: 10, suggestedNext: null }),
    );

    const res = await fetchResumeInfo('p');

    expect(res?.resumable).toBe(true);
  });

  it('HTTP 非 200 → 返回 null（静默降级）', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ error: 'internal' }, 500));

    const res = await fetchResumeInfo('p');

    expect(res).toBeNull();
  });

  it('fetch 抛错（网关未起）→ 返回 null（静默降级）', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const res = await fetchResumeInfo('p');

    expect(res).toBeNull();
  });
});
