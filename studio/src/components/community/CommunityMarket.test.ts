// @vitest-environment node
// =============================================================================
// CommunityMarket 纯逻辑单测
// 只测无 DOM 的导出函数：classifyPlugin（启发式分类）与 isUiDependent（headless 兼容标记）。
// 不渲染组件（vitest 默认 node 环境，无 jsdom）。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { classifyPlugin, isUiDependent } from './CommunityMarket';
import type { CommunityPlugin } from '../../utils/ipc';

function mk(partial: Partial<CommunityPlugin>): CommunityPlugin {
  return {
    fullName: 'owner/demo',
    name: 'demo',
    owner: 'owner',
    description: '',
    stars: 0,
    pushedAt: null,
    url: 'https://github.com/owner/demo',
    ...partial,
  };
}

describe('classifyPlugin（启发式分类）', () => {
  it('MCP 相关归入 集成与连接', () => {
    expect(classifyPlugin(mk({ description: 'MCP tool server for DSH' }))).toBe('集成与连接');
  });

  it('记忆/上下文相关归入 记忆与上下文', () => {
    expect(classifyPlugin(mk({ description: 'graph memory cross-session recall' }))).toBe('记忆与上下文');
  });

  it('agent/技能相关归入 技能与智能体', () => {
    expect(classifyPlugin(mk({ description: 'multi-agent team orchestration' }))).toBe('技能与智能体');
  });

  it('vision/模型相关归入 模型与推理', () => {
    expect(classifyPlugin(mk({ description: 'vision plugin OCR image understanding' }))).toBe('模型与推理');
  });

  it('工具/文件相关归入 工具与能力', () => {
    expect(classifyPlugin(mk({ description: 'file search tool for workspace' }))).toBe('工具与能力');
  });

  it('无匹配关键词归入 其他', () => {
    expect(classifyPlugin(mk({ description: 'a random fun thing' }))).toBe('其他');
  });
});

describe('isUiDependent（headless 兼容标记）', () => {
  it('description 含 dashboard/widget → 界面类（不适用 headless）', () => {
    expect(isUiDependent(mk({ description: 'whale widget dashboard in the corner' }))).toBe(true);
  });

  it('description 含 sidebar → 界面类', () => {
    expect(isUiDependent(mk({ description: 'plugin sidebar workspace' }))).toBe(true);
  });

  it('MCP/记忆类工具 → 候选可验证（非界面类）', () => {
    expect(isUiDependent(mk({ description: 'MCP tool server for DSH' }))).toBe(false);
    expect(isUiDependent(mk({ description: 'graph memory cross-session recall' }))).toBe(false);
  });

  it('空描述 → 非界面类', () => {
    expect(isUiDependent(mk({}))).toBe(false);
  });
});
