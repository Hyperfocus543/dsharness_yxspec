// =============================================================================
// modelBadge.test — 模型徽标纯逻辑单测（node 环境，无 DOM）
// =============================================================================

import { describe, expect, it } from 'vitest';
import { shortModelName, modelDisplayName } from './modelBadge';

describe('shortModelName', () => {
  it('取 / 后最后一段（provider/name → name）', () => {
    expect(shortModelName('deepseek/deepseek-chat')).toBe('deepseek-chat');
  });

  it('无 / 的原样返回', () => {
    expect(shortModelName('MiniMax-M3')).toBe('MiniMax-M3');
  });

  it('空/缺失 → —', () => {
    expect(shortModelName('')).toBe('—');
    expect(shortModelName(null)).toBe('—');
    expect(shortModelName(undefined)).toBe('—');
  });

  it('多余 / 的只取末段', () => {
    expect(shortModelName('a/b/c')).toBe('c');
  });
});

describe('modelDisplayName', () => {
  it('name 已含 provider 子串（如 deepseek-chat 含 deepseek）→ 不重复前缀', () => {
    expect(modelDisplayName({ provider: 'deepseek', name: 'deepseek-chat' })).toBe(
      'deepseek-chat',
    );
  });

  it('name 不含 provider → provider/name 前缀', () => {
    expect(modelDisplayName({ provider: 'anthropic', name: 'claude-opus-4-8' })).toBe(
      'anthropic/claude-opus-4-8',
    );
  });

  it('name 已含 provider/ 完整前缀 → 原样返回', () => {
    expect(modelDisplayName({ provider: 'deepseek', name: 'deepseek/deepseek-chat' })).toBe(
      'deepseek/deepseek-chat',
    );
  });

  it('无 provider → 原样 name', () => {
    expect(modelDisplayName({ provider: '', name: 'MiniMax-M3' })).toBe('MiniMax-M3');
  });

  it('空/缺失 → —', () => {
    expect(modelDisplayName(null)).toBe('—');
    expect(modelDisplayName(undefined)).toBe('—');
    expect(modelDisplayName({ provider: 'x', name: '' })).toBe('—');
  });
});
