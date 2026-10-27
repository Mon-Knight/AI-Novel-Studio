//! Keep an explicitly active chapter outline and the chapter's source projection in one transaction.
use super::{
    ensure_chapter_in_project, ensure_project_exists, ensure_volume_outline_in_project,
    get_active_chapter_outline_by_chapter_internal, get_chapter_outline_by_id_internal,
    next_version, scope_error, ChapterOutlineDto, SaveChapterOutlineInput,
    SetActiveChapterOutlineInput,
};
use rusqlite::{params, Connection, TransactionBehavior};

pub(super) fn save(
    conn: &mut Connection,
    input: SaveChapterOutlineInput,
) -> Result<ChapterOutlineDto, String> {
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    ensure_project_exists(&transaction, &input.project_id)?;
    ensure_chapter_in_project(&transaction, &input.project_id, &input.chapter_id)?;
    ensure_volume_outline_in_project(&transaction, &input.project_id, &input.volume_outline_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let source_type = input.source_type.unwrap_or_else(|| "manual".to_string());
    let save_as_new = input.save_as_new_version.unwrap_or(false);
    let chapter_index = input.chapter_index.unwrap_or(1);
    let existing = if save_as_new {
        None
    } else {
        get_active_chapter_outline_by_chapter_internal(
            &transaction,
            &input.project_id,
            &input.chapter_id,
        )
        .ok()
    };
    let saved = if let Some(current) = existing {
        transaction.execute(
            "UPDATE chapter_outlines SET title=?1, content=?2, source_type=?3, context_snapshot=?4, updated_at=?5 WHERE id=?6 AND project_id=?7",
            params![&input.title, &input.content, &source_type, &input.context_snapshot, &now, &current.id, &input.project_id],
        ).map_err(|error| error.to_string())?;
        get_chapter_outline_by_id_internal(&transaction, &current.id)?
    } else {
        let version = next_version(
            &transaction,
            "SELECT COALESCE(MAX(version),0) FROM chapter_outlines WHERE project_id=?1 AND chapter_id IS ?2",
            &[&input.project_id, &input.chapter_id],
        )?;
        let id = uuid::Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO chapter_outlines (id,project_id,volume_outline_id,chapter_id,chapter_index,title,content,status,version,is_active,source_type,context_snapshot,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'draft',?8,0,?9,?10,?11,?11)",
            params![&id, &input.project_id, &input.volume_outline_id, &input.chapter_id, chapter_index, &input.title, &input.content, version, &source_type, &input.context_snapshot, &now],
        ).map_err(|error| error.to_string())?;
        get_chapter_outline_by_id_internal(&transaction, &id)?
    };
    sync_active_source(&transaction, &saved, &now)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(saved)
}

pub(super) fn set_active(
    conn: &mut Connection,
    input: SetActiveChapterOutlineInput,
) -> Result<(), String> {
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    ensure_project_exists(&transaction, &input.project_id)?;
    let mut selected = get_chapter_outline_by_id_internal(&transaction, &input.id)?;
    if selected.project_id != input.project_id {
        return Err(scope_error("章节纲要版本不属于当前作品"));
    }
    ensure_chapter_in_project(&transaction, &input.project_id, &selected.chapter_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE chapter_outlines SET is_active=0 WHERE project_id=?1 AND chapter_id IS ?2",
            params![&input.project_id, &selected.chapter_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.execute(
        "UPDATE chapter_outlines SET is_active=1, status='active', updated_at=?1 WHERE id=?2 AND project_id=?3 AND chapter_id IS ?4",
        params![&now, &input.id, &input.project_id, &selected.chapter_id],
    ).map_err(|error| error.to_string())?;
    selected.is_active = true;
    sync_active_source(&transaction, &selected, &now)?;
    transaction.commit().map_err(|error| error.to_string())
}

fn sync_active_source(
    conn: &Connection,
    outline: &ChapterOutlineDto,
    now: &str,
) -> Result<(), String> {
    if !outline.is_active {
        return Ok(());
    }
    let Some(chapter_id) = outline.chapter_id.as_deref() else {
        return Ok(());
    };
    let changed = conn.execute(
        "UPDATE chapters SET outline=?1, updated_at=?2 WHERE id=?3 AND novel_id=?4 AND deleted_at IS NULL",
        params![&outline.content, now, chapter_id, &outline.project_id],
    ).map_err(|error| error.to_string())?;
    if changed != 1 {
        return Err(scope_error("当前章节不可写，章纲与章节材料均未保存"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "chapter_source_tests.rs"]
mod tests;
