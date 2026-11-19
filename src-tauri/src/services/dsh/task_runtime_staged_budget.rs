//! Initial root budget sizing from an authoritative applied plan, never from child flags.
use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in super::super) struct StagedBudgetBounds {
    pub stages: i64,
    pub requests: i64,
    pub tools: i64,
}

/// The caller intersects these finite bounds with grants, global limits and persisted
/// root limits. This function must not be used to increase an already-started root.
pub(in super::super) fn budget_bounds(
    connection: &Connection,
    input: &StartTaskTurnInput,
) -> Result<Option<StagedBudgetBounds>, String> {
    let novel = input.require_novel_id()?;
    let Some(chapter) = input.chapter_id.as_deref() else {
        return Ok(None);
    };
    let Some(state) =
        crate::services::chapter_engineering_service::get_active_chapter_engineering_state(
            connection, chapter,
        )?
    else {
        return Ok(None);
    };
    if state.novel_id != novel || state.chapter_id != chapter || state.status != "active" {
        return Err("CHAPTER_STAGED_PLAN_SCOPE_MISMATCH".into());
    }
    let value: Value =
        serde_json::from_str(&state.scene_plan_json).map_err(|_| "CHAPTER_STAGED_PLAN_INVALID")?;
    let scenes = value.as_array().ok_or("CHAPTER_STAGED_PLAN_INVALID")?;
    if scenes.is_empty() || !scenes.iter().any(|s| s["planVersion"] == json!(2)) {
        return Ok(None);
    }
    source::validate_scenes(scenes)?;
    let beats = scenes
        .iter()
        .map(|s| {
            source::beat_targets(
                s["targetCharacters"]
                    .as_i64()
                    .ok_or("CHAPTER_STAGED_PLAN_INVALID")?,
            )
            .map(|t| t.len() as i64)
        })
        .collect::<Result<Vec<_>, String>>()?
        .into_iter()
        .sum::<i64>();
    let models = scenes.len() as i64 + 2 * beats;
    let required_stages = 2 + 2 * scenes.len() as i64 + 2 * beats;
    if required_stages > 64 {
        return Err("CHAPTER_STAGED_STAGE_BUDGET_INSUFFICIENT".into());
    }
    // Limited reserve covers the root's dialogue/admission follow-ups and protocol retries;
    // neither explicit resume nor splitting a Scene can reset these persisted ceilings.
    Ok(Some(StagedBudgetBounds {
        stages: (required_stages + 8).min(64),
        requests: (models * 3 + 24).min(192),
        tools: (models * 5 + 32).min(512),
    }))
}
