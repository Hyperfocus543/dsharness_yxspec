// task_*.md 解析器
// 适配真实 Markdown 表格格式（来自 trainees-2026/task_sqt_case_design.md）：
//
//   ## 任务表
//   | ID | 名称 | 类型 | 模块 | 动作 | 验证 | 完成 | started_at | finished_at | duration |
//   |----|------|------|------|------|------|------|------------|-------------|----------|
//   | CASE-GATE | 门控检查 | review | - | Gate0~6 | 门控通过 | true | 2026-07-29 11:50:20 | 2026-07-29 11:50:20 | 0s |
//
// 注意：build-spec v1 描述的是 YAML Front Matter 格式，但真实项目用 Markdown 表格；
// 这里实现的是真实格式的解析器，build-spec 描述的格式作为未来扩展保留。

use super::super::models::{Task, TaskStatusType};
use std::path::Path;

pub fn parse_task_file(task_file: &Path) -> Result<Vec<Task>, String> {
    let content = std::fs::read_to_string(task_file)
        .map_err(|e| format!("读取任务文件失败 {:?}: {}", task_file, e))?;

    let mut tasks = Vec::new();

    let mut in_task_section = false;
    let mut headers: Vec<String> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## 任务表") || trimmed.starts_with("## 任务列表") {
            in_task_section = true;
            continue;
        }
        if in_task_section && trimmed.starts_with("## ") && !trimmed.contains("任务") {
            break;
        }
        if !in_task_section || !trimmed.starts_with('|') {
            continue;
        }

        let cells: Vec<String> = trimmed
            .split('|')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        // 跳过表头分隔行（如 |----|------|）
        if cells.iter().all(|c| c.chars().all(|ch| ch == '-' || ch == ' ')) {
            continue;
        }

        // 表头行
        if headers.is_empty() {
            headers = cells.iter().map(|c| normalize_header(c)).collect();
            continue;
        }

        // 数据行
        if cells.len() < headers.len() {
            continue;
        }
        let task = build_task(&headers, &cells);
        tasks.push(task);
    }

    Ok(tasks)
}

fn normalize_header(s: &str) -> String {
    // 表头归一化：去除空格、统一大小写、支持部分别名
    let s = s.trim();
    match s {
        "ID" | "id" => "id".to_string(),
        "名称" | "name" => "name".to_string(),
        "类型" | "type" => "type".to_string(),
        "模块" | "module" => "module".to_string(),
        "动作" | "action" => "action".to_string(),
        "验证" | "verify" => "verify".to_string(),
        "完成" | "done" => "done".to_string(),
        "started_at" | "开始时间" => "started_at".to_string(),
        "finished_at" | "结束时间" => "finished_at".to_string(),
        "duration" | "时长" => "duration".to_string(),
        "状态" | "status" => "status".to_string(),
        _ => s.to_string(),
    }
}

fn build_task(headers: &[String], cells: &[String]) -> Task {
    let mut task = Task {
        id: String::new(),
        name: String::new(),
        task_type: String::new(),
        module: String::new(),
        action: String::new(),
        verify: String::new(),
        status: TaskStatusType::Pending,
        done: false,
        started_at: None,
        finished_at: None,
        duration: None,
    };

    for (i, h) in headers.iter().enumerate() {
        if i >= cells.len() {
            break;
        }
        let val = cells[i].trim();
        let val_opt = if val == "—" || val == "-" || val.is_empty() {
            None
        } else {
            Some(val.to_string())
        };

        match h.as_str() {
            "id" => task.id = val_opt.clone().unwrap_or_default(),
            "name" => task.name = val_opt.clone().unwrap_or_default(),
            "type" => task.task_type = val_opt.clone().unwrap_or_default(),
            "module" => task.module = val_opt.clone().unwrap_or_default(),
            "action" => task.action = val_opt.clone().unwrap_or_default(),
            "verify" => task.verify = val_opt.clone().unwrap_or_default(),
            "done" => task.done = val_opt.as_deref() == Some("true"),
            "started_at" => task.started_at = val_opt,
            "finished_at" => task.finished_at = val_opt,
            "duration" => task.duration = val_opt,
            "status" => {
                task.status = parse_task_status(val);
            }
            _ => {}
        }
    }

    // 如果没有显式 status 列，从 done 字段推断
    if !headers.iter().any(|h| h == "status") {
        task.status = infer_status(&task);
    }

    task
}

fn parse_task_status(s: &str) -> TaskStatusType {
    match s {
        "pending" => TaskStatusType::Pending,
        "ready" => TaskStatusType::Ready,
        "in_progress" => TaskStatusType::InProgress,
        "blocked" => TaskStatusType::Blocked,
        "done" => TaskStatusType::Done,
        "skipped" => TaskStatusType::Skipped,
        "stale" => TaskStatusType::Stale,
        _ => TaskStatusType::Pending,
    }
}

fn infer_status(task: &Task) -> TaskStatusType {
    if task.done {
        TaskStatusType::Done
    } else if task.started_at.is_some() && task.finished_at.is_none() {
        TaskStatusType::InProgress
    } else if task.started_at.is_none() && task.finished_at.is_none() {
        TaskStatusType::Pending
    } else {
        TaskStatusType::Ready
    }
}

pub fn write_task_status(
    task_file: &Path,
    task_id: &str,
    new_status: TaskStatusType,
    timestamp: &str,
) -> Result<(), String> {
    let content = std::fs::read_to_string(task_file)
        .map_err(|e| format!("读取任务文件失败: {}", e))?;

    let mut new_lines: Vec<String> = Vec::new();
    let mut headers: Vec<String> = Vec::new();
    let mut in_task_section = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## 任务表") || trimmed.starts_with("## 任务列表") {
            in_task_section = true;
            new_lines.push(line.to_string());
            continue;
        }
        if in_task_section && trimmed.starts_with("## ") && !trimmed.contains("任务") {
            in_task_section = false;
        }
        if !in_task_section {
            new_lines.push(line.to_string());
            continue;
        }
        if !trimmed.starts_with('|') {
            new_lines.push(line.to_string());
            continue;
        }

        let cells: Vec<String> = trimmed
            .split('|')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        if cells.iter().all(|c| c.chars().all(|ch| ch == '-' || ch == ' ')) {
            new_lines.push(line.to_string());
            continue;
        }

        if headers.is_empty() {
            headers = cells.iter().map(|c| normalize_header(c)).collect();
            new_lines.push(line.to_string());
            continue;
        }

        if cells.len() < headers.len() {
            new_lines.push(line.to_string());
            continue;
        }

        // 检查是否目标行
        let id_idx = headers.iter().position(|h| h == "id");
        let is_target = id_idx
            .and_then(|i| cells.get(i))
            .map(|c| c == task_id)
            .unwrap_or(false);

        if is_target {
            // 重写该行，更新状态 / started_at / finished_at / duration / done
            let mut new_cells = cells.clone();
            let status_str = task_status_to_str(&new_status);

            // 找到 status 列（如果存在），否则插入到 done 后面
            let mut status_col = headers.iter().position(|h| h == "status");
            if status_col.is_none() {
                // 插入新列
                headers.push("status".to_string());
                let done_idx = headers.iter().position(|h| h == "done").unwrap_or(0);
                new_cells.insert(done_idx + 1, status_str.clone());
            } else {
                if let Some(col) = status_col {
                    if col < new_cells.len() {
                        new_cells[col] = status_str.clone();
                    }
                }
            }

            // 更新 started_at（仅在变 in_progress 时）
            if matches!(new_status, TaskStatusType::InProgress) {
                let started_col = headers.iter().position(|h| h == "started_at");
                if let Some(col) = started_col {
                    if col < new_cells.len() {
                        new_cells[col] = timestamp.to_string();
                    }
                }
            }

            // 更新 finished_at / duration / done（变 done 时）
            if matches!(new_status, TaskStatusType::Done) {
                let finished_col = headers.iter().position(|h| h == "finished_at");
                if let Some(col) = finished_col {
                    if col < new_cells.len() {
                        new_cells[col] = timestamp.to_string();
                    }
                }
                let done_col = headers.iter().position(|h| h == "done");
                if let Some(col) = done_col {
                    if col < new_cells.len() {
                        new_cells[col] = "true".to_string();
                    }
                }
                // duration 自动计算（如果原值有 started_at）
                let started_col = headers.iter().position(|h| h == "started_at");
                if let Some(sc) = started_col {
                    if let Some(started_val) = new_cells.get(sc) {
                        if !started_val.is_empty() && started_val != "—" && started_val != "-" {
                            let dur = calc_duration(started_val, timestamp);
                            let dur_col = headers.iter().position(|h| h == "duration");
                            if let Some(dc) = dur_col {
                                if dc < new_cells.len() {
                                    new_cells[dc] = dur;
                                }
                            }
                        }
                    }
                }
            }

            // 重建行
            let line_str = format!("| {} |", new_cells.join(" | "));
            new_lines.push(line_str);
        } else {
            new_lines.push(line.to_string());
        }
    }

    let updated = new_lines.join("\n");
    std::fs::write(task_file, updated)
        .map_err(|e| format!("写回任务文件失败: {}", e))?;
    Ok(())
}

fn task_status_to_str(s: &TaskStatusType) -> String {
    match s {
        TaskStatusType::Pending => "pending".to_string(),
        TaskStatusType::Ready => "ready".to_string(),
        TaskStatusType::InProgress => "in_progress".to_string(),
        TaskStatusType::Blocked => "blocked".to_string(),
        TaskStatusType::Done => "done".to_string(),
        TaskStatusType::Skipped => "skipped".to_string(),
        TaskStatusType::Stale => "stale".to_string(),
    }
}

fn calc_duration(start: &str, end: &str) -> String {
    // 简化版：YYYY-MM-DD HH:MM:SS 格式时间差
    let parse = |s: &str| -> Option<i64> {
        let parts: Vec<&str> = s.split(' ').collect();
        if parts.len() != 2 {
            return None;
        }
        let date: Vec<i32> = parts[0].split('-').filter_map(|x| x.parse().ok()).collect();
        let time: Vec<i32> = parts[1].split(':').filter_map(|x| x.parse().ok()).collect();
        if date.len() != 3 || time.len() != 3 {
            return None;
        }
        // 简化：用儒略日计算
        let (y, m, d) = (date[0], date[1], date[2]);
        let (h, mn, sec) = (time[0], time[1], time[2]);
        let jdn = ((1461 * (y + 4800 + (m - 14) / 12)) / 4)
            + ((367 * (m - 2 - 12 * ((m - 14) / 12))) / 12)
            - ((3 * ((y + 4900 + (m - 14) / 12) / 100)) / 4)
            + d
            - 32075;
        Some((jdn as i64) * 86400 + (h as i64) * 3600 + (mn as i64) * 60 + (sec as i64))
    };

    match (parse(start), parse(end)) {
        (Some(s), Some(e)) if e >= s => {
            let dur = e - s;
            let h = dur / 3600;
            let m = (dur % 3600) / 60;
            let sec = dur % 60;
            // 按 build-spec §1.3 规则：省略高位零
            let mut parts = Vec::new();
            if h > 0 {
                parts.push(format!("{}h", h));
            }
            if h > 0 || m > 0 {
                parts.push(format!("{}m", m));
            }
            parts.push(format!("{}s", sec));
            parts.join(" ")
        }
        _ => "—".to_string(),
    }
}
