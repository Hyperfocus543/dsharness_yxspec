// =============================================================================
// vite.task-writer.ts — 任务状态写回（浏览器模式）
// Rust `write_task_status`（src-tauri/src/parser/task.rs:161）的 TS 移植。
// 在标准 Markdown 表格（## 任务表 / ## 任务列表）里定位任务行，改写
// status / started_at / finished_at / done / duration。
// =============================================================================

/** 格式化状态值为字符串（对齐 Rust task_status_to_str）*/
function statusToStr(s: string): string {
  switch (s) {
    case 'pending':
    case 'ready':
    case 'in_progress':
    case 'blocked':
    case 'done':
    case 'skipped':
    case 'stale':
      return s;
    default:
      return 'pending';
  }
}

/** 计算时长：YYYY-MM-DD HH:MM:SS → "Xh Ym Zs"（省略高位零）*/
function calcDuration(start: string, end: string): string {
  const parse = (s: string): number | null => {
    const parts = s.split(' ');
    if (parts.length !== 2) return null;
    const date = parts[0].split('-').map((x) => parseInt(x, 10));
    const time = parts[1].split(':').map((x) => parseInt(x, 10));
    if (date.length !== 3 || time.length !== 3 || date.some(Number.isNaN) || time.some(Number.isNaN)) {
      return null;
    }
    const [y, m, d] = date;
    const [h, mn, sec] = time;
    // 儒略日转秒
    const jdn =
      Math.floor((1461 * (y + 4800 + Math.floor((m - 14) / 12))) / 4) +
      Math.floor((367 * (m - 2 - 12 * Math.floor((m - 14) / 12))) / 12) -
      Math.floor((3 * Math.floor((y + 4900 + Math.floor((m - 14) / 12)) / 100)) / 4) +
      d -
      32075;
    return jdn * 86400 + h * 3600 + mn * 60 + sec;
  };

  const s = parse(start);
  const e = parse(end);
  if (s === null || e === null || e < s) return '—';
  const dur = e - s;
  const h = Math.floor(dur / 3600);
  const m = Math.floor((dur % 3600) / 60);
  const sec = dur % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

/** 表头归一化（对齐 Rust normalize_header）*/
function normalizeHeader(s: string): string {
  const t = s.trim();
  if (t === 'ID' || t === 'id') return 'id';
  if (t === '名称') return 'name';
  if (t === '类型') return 'type';
  if (t === '模块') return 'module';
  if (t === '动作') return 'action';
  if (t === '验证') return 'verify';
  if (t === '完成') return 'done';
  if (t === 'started_at' || t === '开始时间') return 'started_at';
  if (t === 'finished_at' || t === '结束时间') return 'finished_at';
  if (t === 'duration' || t === '时长') return 'duration';
  if (t === '状态' || t === 'status') return 'status';
  return t;
}

/**
 * 重写任务状态。返回更新后的全文。
 * @returns 更新后的 markdown 全文
 */
export function rewriteTaskStatus(
  content: string,
  taskId: string,
  newStatus: string,
  timestamp: string,
): string {
  const statusStr = statusToStr(newStatus);
  const newLines: string[] = [];
  let headers: string[] = [];
  let inTaskSection = false;
  // 表头行 / 分隔行在 newLines 中的下标——插入 status 列时需同步改写，否则列漂移
  let headerLineIdx = -1;
  let sepLineIdx = -1;

  /** 由单元格数组重建 `| a | b |` 行 */
  const row = (cells: string[]): string => `| ${cells.join(' | ')} |`;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('## 任务表') || trimmed.startsWith('## 任务列表')) {
      inTaskSection = true;
      newLines.push(line);
      continue;
    }
    if (inTaskSection && trimmed.startsWith('## ') && !trimmed.includes('任务')) {
      inTaskSection = false;
    }
    if (!inTaskSection) {
      newLines.push(line);
      continue;
    }
    if (!trimmed.startsWith('|')) {
      newLines.push(line);
      continue;
    }

    // 保留空单元格（如空的 verify 列）——filter 掉会导致列数不足、目标行被跳过
    const rawCells = trimmed.split('|');
    if (rawCells.length > 0 && rawCells[0].trim() === '') rawCells.shift();
    if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
    const cells = rawCells.map((s) => s.trim());

    // 分隔行（| --- |）
    if (cells.every((c) => c.split('').every((ch) => ch === '-' || ch === ' '))) {
      sepLineIdx = newLines.length;
      newLines.push(line);
      continue;
    }

    if (headers.length === 0) {
      headers = cells.map(normalizeHeader);
      headerLineIdx = newLines.length;
      newLines.push(line);
      continue;
    }

    if (cells.length < headers.length) {
      newLines.push(line);
      continue;
    }

    // 目标行？
    const idIdx = headers.indexOf('id');
    const isTarget = idIdx >= 0 && cells[idIdx] === taskId;

    if (!isTarget) {
      newLines.push(line);
      continue;
    }

    // 重写该行
    const newCells = [...cells];
    // 若表格无 status 列：插入一列，并同步改写表头行/分隔行（headers 同步位移保证列对齐）
    let statusCol = headers.indexOf('status');
    if (statusCol < 0) {
      const doneIdx = headers.indexOf('done');
      const insertAt = (doneIdx >= 0 ? doneIdx : 0) + 1;
      headers.splice(insertAt, 0, 'status');
      newCells.splice(insertAt, 0, statusStr);
      if (headerLineIdx >= 0) {
        const h = newLines[headerLineIdx];
        const raw = h.split('|');
        if (raw.length > 0 && raw[0].trim() === '') raw.shift();
        if (raw.length > 0 && raw[raw.length - 1].trim() === '') raw.pop();
        raw.splice(insertAt, 0, 'status');
        newLines[headerLineIdx] = row(raw.map((s) => s.trim()));
      }
      if (sepLineIdx >= 0) {
        const s = newLines[sepLineIdx];
        const raw = s.split('|');
        if (raw.length > 0 && raw[0].trim() === '') raw.shift();
        if (raw.length > 0 && raw[raw.length - 1].trim() === '') raw.pop();
        raw.splice(insertAt, 0, '---');
        newLines[sepLineIdx] = row(raw.map((x) => x.trim()));
      }
      statusCol = insertAt;
    } else {
      if (statusCol < newCells.length) newCells[statusCol] = statusStr;
    }

    // started_at（变 in_progress 时）
    if (newStatus === 'in_progress') {
      const startedCol = headers.indexOf('started_at');
      if (startedCol >= 0 && startedCol < newCells.length) newCells[startedCol] = timestamp;
    }

    // finished_at / done / duration（变 done 时）
    if (newStatus === 'done') {
      const startedCol = headers.indexOf('started_at');
      const finishedCol = headers.indexOf('finished_at');
      const durCol = headers.indexOf('duration');
      const doneCol = headers.indexOf('done');
      if (finishedCol >= 0 && finishedCol < newCells.length) newCells[finishedCol] = timestamp;
      if (doneCol >= 0 && doneCol < newCells.length) newCells[doneCol] = 'true';
      if (startedCol >= 0) {
        const startedVal = newCells[startedCol];
        if (startedVal && startedVal !== '—' && startedVal !== '-') {
          const dur = calcDuration(startedVal, timestamp);
          if (durCol >= 0 && durCol < newCells.length) newCells[durCol] = dur;
        }
      }
    }

    newLines.push(row(newCells));
  }

  return newLines.join('\n');
}
