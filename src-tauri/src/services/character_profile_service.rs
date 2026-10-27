use crate::domain::world::{CharacterDto, SaveCharacterProfileInput};
use crate::repositories::character_asset_repository::find_character_by_id;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

const CONFLICT: &str = "CHARACTER_PROFILE_CONFLICT: 人物档案已变化、停用或删除，请刷新后核对。";

fn edited_text<'a>(value: &'a str, previous: &'a Option<String>) -> Option<&'a str> {
    if value == previous.as_deref().unwrap_or_default() {
        previous.as_deref()
    } else {
        Some(value)
    }
}

pub fn save_character_profile(
    conn: &mut Connection,
    input: SaveCharacterProfileInput,
) -> Result<CharacterDto, String> {
    if input.novel_id.trim().is_empty()
        || input.character_id.trim().is_empty()
        || input.expected_updated_at.trim().is_empty()
        || input.expected_source.trim().is_empty()
        || input.name.trim().is_empty()
        || !matches!(
            input.role_type.as_str(),
            "" | "protagonist" | "supporting" | "antagonist" | "neutral"
        )
    {
        return Err("CHARACTER_PROFILE_INVALID: 人物名称、类型或编辑基线无效。".into());
    }
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let novel_exists = transaction
        .query_row(
            "SELECT 1 FROM novels WHERE id=?1 AND deleted_at IS NULL",
            [&input.novel_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    let before = find_character_by_id(&transaction, &input.character_id)?
        .ok_or_else(|| CONFLICT.to_string())?;
    if !novel_exists
        || before.novel_id != input.novel_id
        || !before.is_active
        || before.updated_at != input.expected_updated_at
        || before.source != input.expected_source
    {
        return Err(CONFLICT.into());
    }
    let bound = before
        .protagonist_key
        .as_deref()
        .is_some_and(|key| !key.trim().is_empty())
        || before
            .protagonist_label
            .as_deref()
            .is_some_and(|label| !label.trim().is_empty())
        || before.source == "protagonist_profile";
    if bound && input.role_type != "protagonist" {
        return Err("CHARACTER_PROFILE_BOUND_ROLE: 已绑定主角设定的角色须保持主角类型。".into());
    }
    let is_protagonist = input.role_type == "protagonist";
    let now = chrono::Utc::now().to_rfc3339();
    // Only fields present in the explicit editor are updated. State, bindings,
    // provenance and chapter relations retain their authoritative values.
    let changed = transaction
        .execute(
            "UPDATE characters SET name=?1,role_type=?2,identity=?3,faction=?4,
             relation_to_protagonist=?5,goal=?6,personality=?7,behavior_limits=?8,
             forbidden_behaviors=?9,updated_at=?10,is_protagonist=?15
             WHERE id=?11 AND novel_id=?12 AND updated_at=?13 AND source=?14 AND is_active=1",
            params![
                input.name.trim(),
                input.role_type,
                edited_text(&input.identity, &before.identity),
                edited_text(&input.faction, &before.faction),
                edited_text(
                    &input.relation_to_protagonist,
                    &before.relation_to_protagonist
                ),
                edited_text(&input.goal, &before.goal),
                edited_text(&input.personality, &before.personality),
                edited_text(&input.behavior_limits, &before.behavior_limits),
                edited_text(&input.forbidden_behaviors, &before.forbidden_behaviors),
                now,
                input.character_id,
                input.novel_id,
                input.expected_updated_at,
                input.expected_source,
                is_protagonist,
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed != 1 {
        return Err(CONFLICT.into());
    }
    let saved = find_character_by_id(&transaction, &input.character_id)?
        .ok_or_else(|| CONFLICT.to_string())?;
    if saved.novel_id != input.novel_id
        || !saved.is_active
        || saved.source != before.source
        || saved.name != input.name.trim()
        || saved.role_type.as_deref() != Some(input.role_type.as_str())
        || saved.identity.as_deref() != edited_text(&input.identity, &before.identity)
        || saved.faction.as_deref() != edited_text(&input.faction, &before.faction)
        || saved.relation_to_protagonist.as_deref()
            != edited_text(
                &input.relation_to_protagonist,
                &before.relation_to_protagonist,
            )
        || saved.goal.as_deref() != edited_text(&input.goal, &before.goal)
        || saved.personality.as_deref() != edited_text(&input.personality, &before.personality)
        || saved.behavior_limits.as_deref()
            != edited_text(&input.behavior_limits, &before.behavior_limits)
        || saved.forbidden_behaviors.as_deref()
            != edited_text(&input.forbidden_behaviors, &before.forbidden_behaviors)
        || saved.current_state != before.current_state
        || saved.first_appearance_chapter_id != before.first_appearance_chapter_id
        || saved.protagonist_key != before.protagonist_key
        || saved.protagonist_label != before.protagonist_label
        || saved.protagonist_order != before.protagonist_order
        || saved.is_protagonist != is_protagonist
        || saved.created_at != before.created_at
        || saved.updated_at != now
    {
        return Err(CONFLICT.into());
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(saved)
}

#[cfg(test)]
#[path = "character_profile_service_tests.rs"]
mod tests;
