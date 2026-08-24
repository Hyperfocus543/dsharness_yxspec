// pipeline 命令：读 pipeline_state.json

use crate::models::PipelineState;
use crate::parser::pipeline as pipeline_parser;
use std::path::PathBuf;

#[tauri::command]
pub async fn read_pipeline_state(project_path: String) -> Result<Option<PipelineState>, String> {
    let path = PathBuf::from(project_path).join("project/tasks/pipeline_state.json");
    pipeline_parser::parse_pipeline_state(&path)
}