// =============================================================================
// YXSpec Studio - Tauri 主入口
// =============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod engine;
mod models;
mod parser;

use commands::{pipeline, project, review, stage, task};

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // project
            project::open_project,
            project::read_progress,
            // stage
            stage::compute_all_status,
            stage::compute_stage_status,
            stage::suggest_next_command,
            stage::gate_check_cmd,
            stage::list_stages,
            // task
            task::list_tasks,
            task::read_task,
            task::update_task,
            // pipeline
            pipeline::read_pipeline_state,
            // review
            review::list_reviews,
            review::read_review,
        ])
        .run(tauri::generate_context!())
        .expect("error while running yxspec-studio application");
}