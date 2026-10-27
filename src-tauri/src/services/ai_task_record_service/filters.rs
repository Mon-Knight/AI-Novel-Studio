const AI_TASK_TYPE_FILTERS: &[&str] = &[
    "connection_test",
    "setting_expand",
    "setting_suggestion_generate",
    "outline_generate",
    "volume_outline_generate",
    "context_summarize",
    "setting_structure",
    "rule_structure",
    "protagonist_structure",
    "volume_outline_expand",
    "chapter_outline_generate",
    "style_analyze",
    "character_generate",
    "event_suggest",
    "chapter_generate",
    "chapter_beat_repair",
    "chapter_scene_generate",
    "chapter_scene_plan_generate",
    "chapter_scene_plan_v2_generate",
    "chapter_beat_plan_generate",
    "chapter_beat_state_extract",
    "chapter_rewrite",
    "chapter_polish",
    "quality_check",
    "quality_fix",
    "multi_agent_review",
    "multi_agent_revision",
    "autonomous_plot_plan",
    "autonomous_character_evolution",
    "autonomous_world_build",
    "autonomous_conflict_generate",
    "autonomous_pacing_control",
    "autonomous_chapter_batch",
    "chapter_summarize",
    "context_update",
];
const AI_TASK_STATUS_FILTERS: &[&str] = &["pending", "running", "succeeded", "failed", "cancelled"];

pub fn normalize_ai_task_filter(
    value: Option<String>,
    allowed: &[&str],
    label: &str,
) -> Result<Option<String>, String> {
    let value = value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    if let Some(candidate) = value.as_deref() {
        if !allowed.contains(&candidate) {
            return Err(format!("invalid AI task {} filter", label));
        }
    }
    Ok(value)
}

pub fn normalize_ai_task_type_filter(value: Option<String>) -> Result<Option<String>, String> {
    normalize_ai_task_filter(value, AI_TASK_TYPE_FILTERS, "type")
}

pub fn normalize_ai_task_status_filter(value: Option<String>) -> Result<Option<String>, String> {
    normalize_ai_task_filter(value, AI_TASK_STATUS_FILTERS, "status")
}
