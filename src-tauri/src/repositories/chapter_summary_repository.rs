use crate::domain::context::ChapterSummaryDto;
use rusqlite::{params, Connection, OptionalExtension};

pub fn map_chapter_summary_row(row: &rusqlite::Row) -> rusqlite::Result<ChapterSummaryDto> {
    Ok(ChapterSummaryDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        volume_id: row.get(3)?,
        adopted_draft_id: row.get(4)?,
        summary: row.get(5)?,
        key_events: row.get(6)?,
        character_changes: row.get(7)?,
        relationship_changes: row.get(8)?,
        new_foreshadows: row.get(9)?,
        resolved_foreshadows: row.get(10)?,
        next_chapter_hints: row.get(11)?,
        core_events: row.get(12)?,
        protagonist_state_change: row.get(13)?,
        important_character_changes: row.get(14)?,
        setting_changes: row.get(15)?,
        new_locations: row.get(16)?,
        new_items_or_abilities: row.get(17)?,
        foreshadowing: row.get(18)?,
        unresolved_questions: row.get(19)?,
        facts_must_remember: row.get(20)?,
        next_chapter_hook: row.get(21)?,
        validation_status: row.get(22)?,
        validation_result: row.get(23)?,
        enabled: row.get::<_, i64>(24)? != 0,
        content_hash: row.get(25)?,
        draft_version: row.get(26)?,
        is_expired: row.get::<_, i64>(27)? != 0,
        ai_task_id: row.get(28)?,
        created_at: row.get(29)?,
        updated_at: row.get(30)?,
    })
}

pub const CHAPTER_SUMMARY_SELECT: &str = "SELECT id, novel_id, chapter_id, volume_id, adopted_draft_id, summary, key_events, character_changes, relationship_changes, new_foreshadows, resolved_foreshadows, next_chapter_hints, core_events, protagonist_state_change, important_character_changes, setting_changes, new_locations, new_items_or_abilities, foreshadowing, unresolved_questions, facts_must_remember, next_chapter_hook, validation_status, validation_result, enabled, content_hash, draft_version, is_expired, ai_task_id, created_at, updated_at FROM chapter_summaries";

pub fn chapter_summary_select_sql() -> &'static str {
    CHAPTER_SUMMARY_SELECT
}

pub fn find_chapter_summary_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<ChapterSummaryDto>, String> {
    let sql = format!("{CHAPTER_SUMMARY_SELECT} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_chapter_summary_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn find_chapter_summary_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterSummaryDto>, String> {
    let sql = format!(
        "{CHAPTER_SUMMARY_SELECT} WHERE chapter_id = ?1 ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![chapter_id], map_chapter_summary_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn find_chapter_summaries_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<ChapterSummaryDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT summary.id, summary.novel_id, summary.chapter_id, summary.volume_id,
                    summary.adopted_draft_id, summary.summary, summary.key_events,
                    summary.character_changes, summary.relationship_changes,
                    summary.new_foreshadows, summary.resolved_foreshadows,
                    summary.next_chapter_hints, summary.core_events,
                    summary.protagonist_state_change, summary.important_character_changes,
                    summary.setting_changes, summary.new_locations,
                    summary.new_items_or_abilities, summary.foreshadowing,
                    summary.unresolved_questions, summary.facts_must_remember,
                    summary.next_chapter_hook, summary.validation_status,
                    summary.validation_result, summary.enabled, summary.content_hash,
                    summary.draft_version, summary.is_expired, summary.ai_task_id,
                    summary.created_at, summary.updated_at
             FROM chapter_summaries AS summary
             LEFT JOIN chapters AS chapter ON chapter.id = summary.chapter_id
             WHERE summary.novel_id = ?1
             ORDER BY CASE WHEN chapter.order_index IS NULL THEN 1 ELSE 0 END ASC,
                      chapter.order_index ASC, summary.chapter_id ASC,
                      summary.updated_at DESC, summary.created_at DESC, summary.id DESC",
        )
        .map_err(|e| format!("chapter_summary_list_prepare_failed: {e}"))?;

    let summaries = stmt
        .query_map(params![novel_id], map_chapter_summary_row)
        .map_err(|e| format!("chapter_summary_list_query_failed: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("chapter_summary_list_read_failed: {e}"))?;
    Ok(summaries)
}

pub fn find_existing_summary_id_by_novel_and_chapter(
    conn: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM chapter_summaries WHERE novel_id = ?1 AND chapter_id = ?2 ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1",
        params![novel_id, chapter_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| format!("chapter_summary_existing_read_failed: {e}"))
}

pub fn find_summary_ownership(
    conn: &Connection,
    id: &str,
) -> Result<Option<(String, String)>, String> {
    conn.query_row(
        "SELECT novel_id, chapter_id FROM chapter_summaries WHERE id = ?1",
        params![id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .optional()
    .map_err(|e| format!("chapter_summary_existing_read_failed: {e}"))
}

pub fn summary_exists(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM chapter_summaries WHERE id = ?1)",
        params![id],
        |row| row.get::<_, bool>(0),
    )
    .map_err(|e| format!("chapter_summary_exists_read_failed: {e}"))
}

#[allow(clippy::too_many_arguments)]
pub fn insert_chapter_summary(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    chapter_id: &str,
    volume_id: Option<&str>,
    adopted_draft_id: &str,
    summary: &str,
    key_events: Option<&str>,
    character_changes: Option<&str>,
    relationship_changes: Option<&str>,
    new_foreshadows: Option<&str>,
    resolved_foreshadows: Option<&str>,
    next_chapter_hints: Option<&str>,
    core_events: Option<&str>,
    protagonist_state_change: Option<&str>,
    important_character_changes: Option<&str>,
    setting_changes: Option<&str>,
    new_locations: Option<&str>,
    new_items_or_abilities: Option<&str>,
    foreshadowing: Option<&str>,
    unresolved_questions: Option<&str>,
    facts_must_remember: Option<&str>,
    next_chapter_hook: Option<&str>,
    validation_status: Option<&str>,
    validation_result: Option<&str>,
    enabled: bool,
    content_hash: Option<&str>,
    draft_version: Option<i64>,
    ai_task_id: Option<&str>,
    created_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chapter_summaries
         (id, novel_id, chapter_id, volume_id, adopted_draft_id, summary,
          key_events, character_changes, relationship_changes, new_foreshadows,
          resolved_foreshadows, next_chapter_hints, core_events,
          protagonist_state_change, important_character_changes, setting_changes,
          new_locations, new_items_or_abilities, foreshadowing, unresolved_questions,
          facts_must_remember, next_chapter_hook, validation_status, validation_result,
          enabled, content_hash, draft_version, is_expired, ai_task_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                 ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23,
                 ?24, ?25, ?26, ?27, 0, ?28, ?29, ?29)",
        params![
            id,
            novel_id,
            chapter_id,
            volume_id,
            adopted_draft_id,
            summary,
            key_events,
            character_changes,
            relationship_changes,
            new_foreshadows,
            resolved_foreshadows,
            next_chapter_hints,
            core_events,
            protagonist_state_change,
            important_character_changes,
            setting_changes,
            new_locations,
            new_items_or_abilities,
            foreshadowing,
            unresolved_questions,
            facts_must_remember,
            next_chapter_hook,
            validation_status,
            validation_result,
            enabled as i64,
            content_hash,
            draft_version,
            ai_task_id,
            created_at,
        ],
    )
    .map_err(|e| format!("chapter_summary_insert_failed: {e}"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn update_chapter_summary(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    chapter_id: &str,
    volume_id: Option<&str>,
    adopted_draft_id: &str,
    summary: &str,
    key_events: Option<&str>,
    character_changes: Option<&str>,
    relationship_changes: Option<&str>,
    new_foreshadows: Option<&str>,
    resolved_foreshadows: Option<&str>,
    next_chapter_hints: Option<&str>,
    core_events: Option<&str>,
    protagonist_state_change: Option<&str>,
    important_character_changes: Option<&str>,
    setting_changes: Option<&str>,
    new_locations: Option<&str>,
    new_items_or_abilities: Option<&str>,
    foreshadowing: Option<&str>,
    unresolved_questions: Option<&str>,
    facts_must_remember: Option<&str>,
    next_chapter_hook: Option<&str>,
    validation_status: Option<&str>,
    validation_result: Option<&str>,
    enabled: bool,
    content_hash: Option<&str>,
    draft_version: Option<i64>,
    ai_task_id: Option<&str>,
    updated_at: &str,
) -> Result<(), String> {
    let affected = conn
        .execute(
            "UPDATE chapter_summaries SET
                volume_id = ?1, summary = ?2, key_events = ?3,
                character_changes = ?4, relationship_changes = ?5,
                new_foreshadows = ?6, resolved_foreshadows = ?7,
                next_chapter_hints = ?8, core_events = ?9,
                protagonist_state_change = ?10, important_character_changes = ?11,
                setting_changes = ?12, new_locations = ?13,
                new_items_or_abilities = ?14, foreshadowing = ?15,
                unresolved_questions = ?16, facts_must_remember = ?17,
                next_chapter_hook = ?18, validation_status = ?19,
                validation_result = ?20, enabled = ?21, content_hash = ?22,
                draft_version = ?23, is_expired = 0, ai_task_id = ?24,
                updated_at = ?25, adopted_draft_id = ?26
             WHERE id = ?27 AND novel_id = ?28 AND chapter_id = ?29",
            params![
                volume_id,
                summary,
                key_events,
                character_changes,
                relationship_changes,
                new_foreshadows,
                resolved_foreshadows,
                next_chapter_hints,
                core_events,
                protagonist_state_change,
                important_character_changes,
                setting_changes,
                new_locations,
                new_items_or_abilities,
                foreshadowing,
                unresolved_questions,
                facts_must_remember,
                next_chapter_hook,
                validation_status,
                validation_result,
                enabled as i64,
                content_hash,
                draft_version,
                ai_task_id,
                updated_at,
                adopted_draft_id,
                id,
                novel_id,
                chapter_id,
            ],
        )
        .map_err(|e| format!("chapter_summary_update_failed: {e}"))?;

    if affected != 1 {
        return Err("chapter_summary_update_conflict".to_string());
    }
    Ok(())
}

pub fn update_chapter_summary_enabled(
    conn: &Connection,
    id: &str,
    enabled: bool,
    updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE chapter_summaries SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
        params![enabled as i64, updated_at, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn expire_chapter_summaries_by_chapter(
    conn: &Connection,
    chapter_id: &str,
    updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE chapter_summaries SET is_expired = 1, updated_at = ?1 WHERE chapter_id = ?2",
        params![updated_at, chapter_id],
    )
    .map_err(|e| format!("chapter_summary_expire_failed: {e}"))?;
    Ok(())
}

pub fn delete_chapter_summary(conn: &Connection, id: &str) -> Result<(), String> {
    let affected = conn
        .execute("DELETE FROM chapter_summaries WHERE id = ?1", params![id])
        .map_err(|e| format!("chapter_summary_delete_failed: {e}"))?;
    if affected != 1 {
        return Err("chapter_summary_not_found".to_string());
    }
    Ok(())
}

pub fn upsert_chapter_summary(
    conn: &Connection,
    id: &str,
    input: &crate::domain::context::SaveChapterSummaryInput,
    is_expired: bool,
    created_at: &str,
    updated_at: &str,
) -> Result<(), String> {
    if summary_exists(conn, id)? {
        update_chapter_summary(
            conn,
            id,
            &input.novel_id,
            &input.chapter_id,
            input.volume_id.as_deref(),
            &input.adopted_draft_id,
            &input.summary,
            input.key_events.as_deref(),
            input.character_changes.as_deref(),
            input.relationship_changes.as_deref(),
            input.new_foreshadows.as_deref(),
            input.resolved_foreshadows.as_deref(),
            input.next_chapter_hints.as_deref(),
            input.core_events.as_deref(),
            input.protagonist_state_change.as_deref(),
            input.important_character_changes.as_deref(),
            input.setting_changes.as_deref(),
            input.new_locations.as_deref(),
            input.new_items_or_abilities.as_deref(),
            input.foreshadowing.as_deref(),
            input.unresolved_questions.as_deref(),
            input.facts_must_remember.as_deref(),
            input.next_chapter_hook.as_deref(),
            input.validation_status.as_deref(),
            input.validation_result.as_deref(),
            input.enabled.unwrap_or(true),
            input.content_hash.as_deref(),
            input.draft_version,
            input.ai_task_id.as_deref(),
            updated_at,
        )?;
        if is_expired {
            conn.execute(
                "UPDATE chapter_summaries SET is_expired = 1 WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("chapter_summary_expire_failed: {e}"))?;
        }
    } else {
        insert_chapter_summary(
            conn,
            id,
            &input.novel_id,
            &input.chapter_id,
            input.volume_id.as_deref(),
            &input.adopted_draft_id,
            &input.summary,
            input.key_events.as_deref(),
            input.character_changes.as_deref(),
            input.relationship_changes.as_deref(),
            input.new_foreshadows.as_deref(),
            input.resolved_foreshadows.as_deref(),
            input.next_chapter_hints.as_deref(),
            input.core_events.as_deref(),
            input.protagonist_state_change.as_deref(),
            input.important_character_changes.as_deref(),
            input.setting_changes.as_deref(),
            input.new_locations.as_deref(),
            input.new_items_or_abilities.as_deref(),
            input.foreshadowing.as_deref(),
            input.unresolved_questions.as_deref(),
            input.facts_must_remember.as_deref(),
            input.next_chapter_hook.as_deref(),
            input.validation_status.as_deref(),
            input.validation_result.as_deref(),
            input.enabled.unwrap_or(true),
            input.content_hash.as_deref(),
            input.draft_version,
            input.ai_task_id.as_deref(),
            created_at,
        )?;
        if is_expired {
            conn.execute(
                "UPDATE chapter_summaries SET is_expired = 1 WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("chapter_summary_expire_failed: {e}"))?;
        }
    }
    Ok(())
}
