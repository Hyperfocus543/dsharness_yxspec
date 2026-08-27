// =============================================================================
// markdown 渲染单测 — 重点验证"句中粗体"（**xxx** 内嵌在普通文本中）
// 回归：此前 renderInline 只认"整段恰好是 **xxx**"，句中粗体原样输出。
// =============================================================================

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderInline, renderMarkdown } from './markdown';

function html(text: string): string {
  return renderToString(<>{renderMarkdown(text)}</>);
}

describe('renderMarkdown 粗体渲染', () => {
  // 注意：React 渲染 strong 内部会再包一层 <span>（renderInline 递归的产物），
  // 因此断言只验证三件事：strong 标签存在 / 文本内容保留 / 无 ** 残留，
  // 不做"文本紧贴 </strong>"这种依赖实现细节的精确匹配。
  it('句首粗体', () => {
    const out = html('**SOR 解析产物已存在**，可进入 review');
    expect(out).toContain('<strong');
    expect(out).toContain('SOR 解析产物已存在');
    expect(out).not.toContain('**SOR');
  });

  it('句中粗体（前置未完成）', () => {
    const out = html('前置 **swe_coding_do** 未完成，无法生成静态验证');
    expect(out).toContain('<strong');
    expect(out).toContain('swe_coding_do');
    expect(out).not.toContain('**swe_coding_do**');
  });

  it('整段都是粗体', () => {
    const out = html('**init 完成**');
    expect(out).toContain('<strong');
    expect(out).toContain('init 完成');
  });

  it('无标记的普通文本原样输出', () => {
    const out = html('普通文本无标记');
    expect(out).toContain('普通文本无标记');
    expect(out).not.toContain('<strong');
  });

  it('代码与粗体混排互不干扰', () => {
    const out = html('代码 `npm run build` 和 **粗体** 混排');
    expect(out).toContain('<strong');
    expect(out).toContain('粗体');
    expect(out).toContain('<code');
    expect(out).toContain('npm run build');
    expect(out).not.toContain('**粗体**');
  });

  it('含中括号/星号的实际门控消息', () => {
    const out = html('**SOR 解析产物已存在**，可进入 review');
    expect(out).not.toContain('**');
  });

  it('renderInline 对非标记文本做 HTML 转义（独立使用防注入）', () => {
    const out = renderToString(<>{renderInline('`<script>` 危险 <b>标签</b>')}</>);
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<b>');
  });
});
