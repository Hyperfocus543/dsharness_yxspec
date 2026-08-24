// pipeline_state.json 解析器
// 真实格式（trainees-2026/pipeline_state.json）：
//   {
//     "schema": "pipeline-state/v1",
//     "generated_at": "2026-07-30 17:15:14",
//     "spec_id": "trainees-2026",
//     "modules": {
//       "MOD-004": {
//         "status": "verified",
//         "last_success_sha": "096cf69deb",
//         "last_success_at": "2026-07-29 13:31:55",
//         "verified_at": "2026-07-30 07:14:41",
//         "evidence": { "plan_file": "exists", ... }
//       }
//     }
//   }

use super::super::models::PipelineState;
use std::path::Path;

pub fn parse_pipeline_state(pipeline_file: &Path) -> Result<Option<PipelineState>, String> {
    if !pipeline_file.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(pipeline_file)
        .map_err(|e| format!("读取 pipeline_state.json 失败: {}", e))?;
    let state: PipelineState = serde_json::from_str(&content)
        .map_err(|e| format!("解析 pipeline_state.json 失败: {}", e))?;
    Ok(Some(state))
}
