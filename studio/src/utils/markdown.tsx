// =============================================================================
// 轻量 Markdown 渲染（零依赖）
// 支持：标题 #~#### / 无序·有序列表 / 表格 / 引用 / 代码围栏 / 段落与空行。
// 不做 HTML 转义以外的深度处理；识别不出原样输出。
// 通用工具：供产物详情抽屉（ArtifactDrawer）与执行终端（LLMConsole）等复用。
// =============================================================================

import React from 'react';

type MdInlineNode = React.ReactNode;

/** HTML 转义：防注入。renderMarkdown 用 React 文本节点天然转义；
 *  但 renderInline 导出的节点会被拼进 JSX，非标记文本/代码内容需手动转义，
 *  再经 dangerouslySetInnerHTML 输出，避免 React 二次转义成 &amp;lt;。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 渲染内联级 markdown（粗体 **...** + 代码 `...`），返回 React 节点数组。
 * 供紧凑提示条（门控 message、进度横幅等）复用：不产生 p/表格/列表等块级结构。
 * 注意：纯文本已转义，勿用于需要逐字显示原文的场合（原样文本请直接 <span>）。
 */
export function renderInline(text: string): MdInlineNode[] {
  const nodes: MdInlineNode[] = [];
  const push = (t: string) =>
    nodes.push(
      // 已手动转义，用 dangerouslySetInnerHTML 防 React 二次转义
      <span key={nodes.length} dangerouslySetInnerHTML={{ __html: escapeHtml(t) }} />,
    );
  // 内联粗体 `**...**` + 代码 `...` 一次分割，支持"句中粗体"（如 `**产物**已存在`）。
  // 用非贪婪 [^*]+ 防止跨段误配；代码优先判（避免 `**` 出现在代码里被误判成粗体）。
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      nodes.push(
        <code
          key={nodes.length}
          className="bg-zinc-100 border border-zinc-200 rounded px-1 py-0.5 font-mono text-xs"
          dangerouslySetInnerHTML={{ __html: escapeHtml(part.slice(1, -1)) }}
        />,
      );
    } else if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      nodes.push(
        <strong key={nodes.length} className="font-semibold">
          {renderInline(part.slice(2, -2))}
        </strong>,
      );
    } else {
      push(part);
    }
  }
  return nodes;
}

interface MdBlockNode {
  type: 'h' | 'table' | 'list' | 'quote' | 'code' | 'p' | 'hr' | 'empty';
  level: number; // h 用
  items?: React.ReactNode[]; // list 用
  ordered?: boolean; // list 用
  rows?: React.ReactNode[][]; // table 用
  quote?: React.ReactNode; // quote 用
  text?: string; // code / p / empty 用
}

/** 判断一行是否为表格行（含 | 且至少两列；表头分隔行也在其内）*/
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  const body = trimmed.slice(1, -1);
  if (body.includes('|')) return true;
  // 无内嵌 |：仅当按 | 拆分得到 ≥4 段（首尾空段 + 至少 2 列）才算表格
  return trimmed.split('|').length >= 4;
}

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((s) => s.trim());
}

function renderMarkdownBlocks(text: string): MdBlockNode[] {
  const blocks: MdBlockNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();

    // 代码围栏
    if (line.trim().startsWith('```')) {
      const fence = line.trim().match(/^`{3,}/)?.[0] || '```';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过闭合围栏
      blocks.push({ type: 'code', level: 0, text: buf.join('\n') });
      continue;
    }

    // 标题 #~####
    const heading = line.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (heading) {
      blocks.push({
        type: 'h',
        level: heading[1].length,
        items: renderInline(heading[2]),
      });
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ type: 'hr', level: 0 });
      i++;
      continue;
    }

    // 引用块：合并连续以 > 开头的行
    if (line.trimStart().startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        quoteLines.push(lines[i].trimStart().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', level: 0, quote: renderInline(quoteLines.join(' ')) });
      continue;
    }

    // 表格：检测连续表格行（跳过表头分隔行）
    if (isTableRow(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const rows: React.ReactNode[][] = [];
      let isFirst = true;
      for (const tl of tableLines) {
        const cells = splitTableCells(tl);
        // 表头分隔行（如 |---|---|）跳过
        if (
          isFirst === false &&
          cells.length > 0 &&
          cells.every((c) => c.replace(/\s/g, '').split('').every((ch) => ch === '-' || ch === ':' || ch === ' '))
        ) {
          continue;
        }
        rows.push(cells.map((c) => renderInline(c)));
        isFirst = false;
      }
      blocks.push({ type: 'table', level: 0, rows });
      continue;
    }

    // 无序列表 / 有序列表：合并连续列表行（同型）
    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[2]);
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const lm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
        if (!lm) break;
        const itemOrdered = /^\d/.test(lm[2]);
        if (itemOrdered !== ordered) break;
        items.push(renderInline(lm[3]));
        i++;
      }
      blocks.push({ type: 'list', level: 0, items, ordered });
      continue;
    }

    // 空行
    if (line.trim() === '') {
      blocks.push({ type: 'empty', level: 0 });
      i++;
      continue;
    }

    // 普通段落（合并相邻非空非特殊行，保持换行）
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('#') &&
      !lines[i].trimStart().startsWith('```') &&
      !lines[i].trimStart().startsWith('>') &&
      !isTableRow(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', level: 0, text: paraLines.join('\n') });
  }
  return blocks;
}

/** 渲染 markdown 文本为 React 节点（含表格/列表/引用/代码块/标题）。 */
export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const blocks = renderMarkdownBlocks(text);
  const out: React.ReactNode[] = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const key = `b${bi}`;
    switch (b.type) {
      case 'h': {
        const content = b.items;
        if (b.level === 1)
          out.push(
            <h1 key={key} className="text-2xl font-bold mt-4 mb-2 border-b pb-1">
              {content}
            </h1>,
          );
        else if (b.level === 2)
          out.push(
            <h2 key={key} className="text-xl font-bold mt-4 mb-2">
              {content}
            </h2>,
          );
        else if (b.level === 3)
          out.push(
            <h3 key={key} className="text-lg font-semibold mt-3 mb-1.5">
              {content}
            </h3>,
          );
        else
          out.push(
            <h4 key={key} className="text-base font-semibold mt-2 mb-1">
              {content}
            </h4>,
          );
        break;
      }
      case 'table': {
        const rows = b.rows || [];
        out.push(
          <div key={key} className="overflow-x-auto my-2">
            <table className="w-full border-collapse text-xs">
              {rows.length > 0 && (
                <thead>
                  <tr>
                    {rows[0].map((cell, ci) => (
                      <th
                        key={ci}
                        className="border border-zinc-300 bg-zinc-100 px-2 py-1.5 text-left font-semibold text-zinc-700"
                      >
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.slice(1).map((cells, ri) => (
                  <tr key={ri}>
                    {cells.map((cell, ci) => (
                      <td key={ci} className="border border-zinc-200 px-2 py-1.5 align-top">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        break;
      }
      case 'list': {
        const items = b.items || [];
        if (b.ordered) {
          out.push(
            <ol key={key} className="list-decimal list-inside my-1.5 space-y-1">
              {items.map((it, li) => (
                <li key={li} className="pl-1">
                  {it}
                </li>
              ))}
            </ol>,
          );
        } else {
          out.push(
            <ul key={key} className="list-disc list-inside my-1.5 space-y-1">
              {items.map((it, li) => (
                <li key={li} className="pl-1">
                  {it}
                </li>
              ))}
            </ul>,
          );
        }
        break;
      }
      case 'quote':
        out.push(
          <blockquote
            key={key}
            className="border-l-4 border-zinc-300 bg-zinc-50 italic text-zinc-600 pl-3 pr-2 py-1 my-2 rounded-r"
          >
            {b.quote}
          </blockquote>,
        );
        break;
      case 'code':
        out.push(
          <pre
            key={key}
            className="bg-zinc-100 border border-zinc-200 rounded p-2 my-2 overflow-x-auto font-mono text-xs leading-relaxed"
          >
            {b.text}
          </pre>,
        );
        break;
      case 'hr':
        out.push(<hr key={key} className="border-t border-zinc-200 my-3" />);
        break;
      case 'p':
        out.push(
          <p key={key} className="my-1.5 whitespace-pre-wrap">
            {renderInline(b.text || '')}
          </p>,
        );
        break;
      case 'empty':
        out.push(<div key={key} className="h-2" />);
        break;
    }
  }
  return <>{out}</>;
}
