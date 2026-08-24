// =============================================================================
// chatStore — 对话管理系统（多会话 + 持久化）
// 在原有单对话流上升级：
//   - 多会话：currentSessionId + sessions[]，可新建/切换/重命名/删除
//   - 持久化：localStorage 按项目隔离存会话（刷新不丢，可恢复续聊）
//   - 兼容：pushUser/pushAssistant 等 API 签名不变 → 终端对话框/一键派活
//     无需改动，自动写入当前会话。
//
// 持久化策略（单一真相，无冗余）：
//   所有会话存 localStorage["yxspec-studio.chat.<projectKey>"]；
//   store 内存态 = 当前项目会话的镜像；每次 mutation 后写回项目 key。
// =============================================================================

import { create } from 'zustand';

export interface ChatItem {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatSession {
  id: string;
  /** 会话标题（首条用户消息截断）*/
  title: string;
  /** 创建时间 ISO */
  createdAt: string;
  /** 最后更新时间 ISO */
  updatedAt: string;
  messages: ChatItem[];
}

/** 生成会话 id（毫秒时间戳 + 随机后缀，避免冲突）*/
function genId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 从用户消息截取标题（≤20字）*/
function titleFrom(content: string): string {
  const clean = content.trim().replace(/\s+/g, ' ');
  return clean.length > 20 ? `${clean.slice(0, 20)}…` : clean || '新会话';
}

/** 按项目隔离的 localStorage key */
function storageKey(projectKey: string): string {
  return `yxspec-studio.chat.${projectKey}`;
}

/** 从 localStorage 读会话列表（容错）*/
function loadSessions(projectKey: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(storageKey(projectKey));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ChatSession[]) : [];
  } catch {
    return [];
  }
}

/** 写会话列表到项目 key（容错）*/
function saveSessions(projectKey: string, sessions: ChatSession[]) {
  try {
    localStorage.setItem(storageKey(projectKey), JSON.stringify(sessions));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/** 新建空会话 */
function freshSession(): ChatSession {
  const now = new Date().toISOString();
  return { id: genId(), title: '新会话', createdAt: now, updatedAt: now, messages: [] };
}

interface ChatStore {
  /** 会话列表（按 updatedAt 倒序）*/
  sessions: ChatSession[];
  /** 当前会话 id */
  currentSessionId: string | null;
  /** 当前项目 key（会话隔离维度；'' = 未打开项目）*/
  projectKey: string;

  /** 当前会话的消息（只读订阅用）*/
  chat: ChatItem[];

  // ---- 会话操作 ----
  /** 打开/切换项目：从该项目 storage 加载会话（无则新建一个）*/
  setProject: (projectPath: string | null) => void;
  /** 新建会话并切换过去 */
  newSession: () => void;
  /** 切换到某会话 */
  switchTo: (id: string) => void;
  /** 重命名会话 */
  rename: (id: string, title: string) => void;
  /** 删除会话 */
  remove: (id: string) => void;
  /** 清空当前会话 */
  clear: () => void;

  // ---- 消息写入（写入当前会话并持久化）----
  pushUser: (content: string) => void;
  pushAssistant: (content: string) => void;
  pushSystem: (content: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => {
  /** 用当前 state 写回项目 key（每个 mutation 后调用）*/
  const persistNow = () => {
    const { sessions, projectKey } = get();
    if (projectKey) saveSessions(projectKey, sessions);
  };

  return {
    sessions: [],
    currentSessionId: null,
    projectKey: '',
    chat: [],

    setProject: (projectPath) => {
      const key = projectPath || 'default';
      let sessions = loadSessions(key);
      if (sessions.length === 0) sessions = [freshSession()];
      sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      set({
        projectKey: key,
        sessions,
        currentSessionId: sessions[0].id,
        chat: sessions[0].messages,
      });
    },

    newSession: () => {
      const s = freshSession();
      set((st) => ({
        sessions: [s, ...st.sessions],
        currentSessionId: s.id,
        chat: [],
      }));
      persistNow();
    },

    switchTo: (id) => {
      const s = get().sessions.find((x) => x.id === id);
      if (!s) return;
      set({ currentSessionId: id, chat: s.messages });
    },

    rename: (id, title) => {
      set((st) => ({
        sessions: st.sessions.map((s) =>
          s.id === id ? { ...s, title: title || '新会话', updatedAt: new Date().toISOString() } : s,
        ),
      }));
      persistNow();
    },

    remove: (id) => {
      set((st) => {
        const rest = st.sessions.filter((s) => s.id !== id);
        let currentId = st.currentSessionId;
        let chat = st.chat;
        if (st.currentSessionId === id) {
          if (rest.length > 0) {
            currentId = rest[0].id;
            chat = rest[0].messages;
          } else {
            const fresh = freshSession();
            rest.push(fresh);
            currentId = fresh.id;
            chat = [];
          }
        }
        return { sessions: rest, currentSessionId: currentId, chat };
      });
      persistNow();
    },

    clear: () => {
      set((st) => ({
        sessions: st.sessions.map((s) =>
          s.id === st.currentSessionId
            ? { ...s, messages: [], updatedAt: new Date().toISOString() }
            : s,
        ),
        chat: [],
      }));
      persistNow();
    },

    // 写入消息：若当前会话不存在（未 setProject），先自动建一个
    pushUser: (content) => {
      if (!get().currentSessionId) get().newSession();
      set((st) => {
        const updated = st.sessions.map((s) => {
          if (s.id !== st.currentSessionId) return s;
          const messages = [...s.messages, { role: 'user' as const, content }];
          const title = s.title === '新会话' ? titleFrom(content) : s.title;
          return { ...s, messages, title, updatedAt: new Date().toISOString() };
        });
        const cur = updated.find((s) => s.id === st.currentSessionId);
        return { sessions: updated, chat: cur?.messages ?? [] };
      });
      persistNow();
    },

    pushAssistant: (content) => {
      if (!get().currentSessionId) get().newSession();
      set((st) => {
        const updated = st.sessions.map((s) => {
          if (s.id !== st.currentSessionId) return s;
          const messages = [...s.messages, { role: 'assistant' as const, content }];
          return { ...s, messages, updatedAt: new Date().toISOString() };
        });
        const cur = updated.find((s) => s.id === st.currentSessionId);
        return { sessions: updated, chat: cur?.messages ?? [] };
      });
      persistNow();
    },

    pushSystem: (content) => {
      if (!get().currentSessionId) get().newSession();
      set((st) => {
        const updated = st.sessions.map((s) => {
          if (s.id !== st.currentSessionId) return s;
          const messages = [...s.messages, { role: 'system' as const, content }];
          return { ...s, messages, updatedAt: new Date().toISOString() };
        });
        const cur = updated.find((s) => s.id === st.currentSessionId);
        return { sessions: updated, chat: cur?.messages ?? [] };
      });
      persistNow();
    },
  };
});
