// =============================================================================
// 自实现 Hash 路由（零依赖）
// 8 功能卡支持 `#/cockpit` 等 hash 直达，刷新保留当前卡。
// 语义：hash 为空 = 面板收起；首次加载无 hash 时默认打开 fallback 卡（'cockpit'）。
//   · useHashRoute(): 读取/写入当前 hash 路径（'cockpit' 等，去掉前导 '#/'）
// =============================================================================

import React from 'react';
import { FUNCTION_CARDS, type FunctionCard } from '../navigation';

/** 读取当前 hash 路径：'#/cockpit' → 'cockpit'；无/非法 → null */
export function readHashPath(): string | null {
  const raw = window.location.hash;
  if (!raw) return null;
  const seg = raw.replace(/^#\/?/, '').trim();
  return seg || null;
}

/** 写入 hash 路径（不触发额外 hashchange 事件之外的副作用） */
export function writeHashPath(path: string | null): void {
  if (path) {
    const next = `#/${path}`;
    if (window.location.hash !== next) window.location.hash = next;
  } else {
    // 清空：用 history.replaceState 避免留下空 '#'
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

/** 订阅 hash 变化（返回取消订阅函数） */
export function onHashChange(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

/** 功能卡 id 白名单：hash 路径 → 卡片（未在导航配置中 → null） */
export function cardFromPath(path: string | null): FunctionCard | null {
  if (!path) return null;
  return FUNCTION_CARDS.some((c) => c.id === path) ? (path as FunctionCard) : null;
}

/**
 * React hook：hash 路径 ↔ 功能卡 id（与外部同步，改写当前值时同步写回 hash）。
 * 返回 null 表示面板收起；首次加载无 hash 时默认打开 fallback 卡。
 * 用法：
 *   const [card, setCard] = useCardFromHash('cockpit');
 *   setCard('settings')   // 同时写 #/settings
 *   setCard(null)         // 收起面板（清 hash）
 */
export function useCardFromHash(
  fallback: FunctionCard = 'cockpit',
): [FunctionCard | null, (c: FunctionCard | null) => void] {
  const [card, setCardState] = React.useState<FunctionCard | null>(() => {
    // 无 hash → 默认打开 fallback 卡（保持原有「首屏默认驾驶舱」行为）；
    // 有 hash（含刷新）→ 按 hash 直达，未知 hash 同样落回 fallback。
    const p = cardFromPath(readHashPath());
    return p ?? fallback;
  });

  // 外部 hash 变化（浏览器前进后退 / 手改 URL）→ 同步卡片
  React.useEffect(() => onHashChange(() => setCardState(cardFromPath(readHashPath()))), []);

  const setCard = React.useCallback((c: FunctionCard | null) => {
    setCardState(c);
    writeHashPath(c);
  }, []);

  return [card, setCard];
}
