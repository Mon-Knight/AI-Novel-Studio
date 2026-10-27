use crate::domain::writing::{ChapterDto, CHAPTER_STATUSES};
use crate::repositories::chapter_repository::find_by_id;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;

const CONFLICT: &str = "CHAPTER_DETAILS_CONFLICT: 章节或采用章纲已变化，请刷新后核对。";

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChapterDetailsPatch {
    pub title: Option<String>,
    pub volume_id: Option<String>,
    pub goal: Option<String>,
    pub target_word_count: Option<i64>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveChapterDetailsInput {
    pub baseline: ChapterDto,
    pub patch: ChapterDetailsPatch,
}

fn same_baseline(current: &ChapterDto, expected: &ChapterDto) -> bool {
    current.id == expected.id
        && current.novel_id == expected.novel_id
        && current.volume_id == expected.volume_id
        && current.title == expected.title
        && current.outline.as_deref().unwrap_or_default()
            == expected.outline.as_deref().unwrap_or_default()
        && current.goal.as_deref().unwrap_or_default()
            == expected.goal.as_deref().unwrap_or_default()
        && current.order_index == expected.order_index
        && current.status == expected.status
        && current.adopted_draft_id == expected.adopted_draft_id
        && current.word_count == expected.word_count
        && current.target_word_count == expected.target_word_count
        && current.created_at == expected.created_at
        && current.updated_at == expected.updated_at
}

pub fn save_chapter_details(
    conn: &mut Connection,
    input: SaveChapterDetailsInput,
) -> Result<ChapterDto, String> {
    let baseline = input.baseline;
    let patch = input.patch;
    if baseline.id.trim().is_empty()
        || baseline.novel_id.trim().is_empty()
        || baseline.updated_at.trim().is_empty()
        || patch
            .title
            .as_ref()
            .is_some_and(|title| title.trim().is_empty() || title.trim().chars().count() > 80)
        || patch
            .status
            .as_deref()
            .is_some_and(|status| !CHAPTER_STATUSES.contains(&status))
        || patch
            .target_word_count
            .is_some_and(|count| count != 0 && !(500..=20000).contains(&count))
    {
        return Err("CHAPTER_DETAILS_INVALID: 章节字段或编辑基线无效。".into());
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let before = find_by_id(&tx, &baseline.id)?.ok_or_else(|| CONFLICT.to_string())?;
    let novel_exists = tx
        .query_row(
            "SELECT 1 FROM novels WHERE id=?1 AND deleted_at IS NULL",
            [&baseline.novel_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    if !novel_exists || !same_baseline(&before, &baseline) {
        return Err(CONFLICT.into());
    }
    if let Some(volume_id) = patch.volume_id.as_deref().filter(|value| !value.is_empty()) {
        let exists = tx
            .query_row(
                "SELECT 1 FROM volumes WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
                params![volume_id, baseline.novel_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .is_some();
        if !exists {
            return Err("CHAPTER_DETAILS_INVALID: 分卷不属于当前作品或已删除。".into());
        }
    }
    let title = patch
        .title
        .as_deref()
        .map(str::trim)
        .unwrap_or(&before.title);
    let volume = patch
        .volume_id
        .as_deref()
        .map(|value| if value.is_empty() { None } else { Some(value) })
        .unwrap_or(before.volume_id.as_deref());
    let goal = patch.goal.as_deref().or(before.goal.as_deref());
    let status = patch.status.as_deref().unwrap_or(&before.status);
    let target = patch
        .target_word_count
        .map(|value| if value == 0 { None } else { Some(value) })
        .unwrap_or(before.target_word_count);
    let now = chrono::Utc::now().to_rfc3339();
    let changed = tx.execute("UPDATE chapters SET title=?1,volume_id=?2,goal=?3,status=?4,target_word_count=?5,updated_at=?6 WHERE id=?7 AND novel_id=?8 AND updated_at=?9 AND deleted_at IS NULL", params![title, volume, goal, status, target, now, baseline.id, baseline.novel_id, baseline.updated_at]).map_err(|error| error.to_string())?;
    if changed != 1 {
        return Err(CONFLICT.into());
    }
    let saved = find_by_id(&tx, &baseline.id)?.ok_or_else(|| CONFLICT.to_string())?;
    let mut expected = before.clone();
    expected.title = title.to_string();
    expected.volume_id = volume.map(str::to_string);
    expected.goal = goal.map(str::to_string);
    expected.status = status.to_string();
    expected.target_word_count = target;
    expected.updated_at = now;
    if !same_baseline(&saved, &expected) {
        return Err(CONFLICT.into());
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(saved)
}

#[cfg(test)]
#[path = "chapter_details_service_tests.rs"]
mod tests;
