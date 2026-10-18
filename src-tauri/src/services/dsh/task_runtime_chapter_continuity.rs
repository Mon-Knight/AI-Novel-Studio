//! Previous-chapter order and adopted-body evidence for a chapter-writing turn.
//! The client hash is checked when present; the body always comes from SQLite.
use super::{is_chapter_writing_turn, StartTaskTurnInput};
use crate::repositories::large_text_repository;
use rusqlite::{params, OptionalExtension};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VerifiedContinuity {
    pub chapter_id: String,
    pub draft_id: String,
    pub source_hash: String,
    pub content: String,
}

pub(crate) fn freeze_continuity(
    connection: &rusqlite::Connection,
    input: &mut StartTaskTurnInput,
) -> Result<(), String> {
    if !is_chapter_writing_turn(input) {
        return Ok(());
    }
    let chapter_id = input
        .chapter_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "DSH_CHAPTER_TARGET_REQUIRED".to_string())?;
    let verified = load_previous(connection, &input.novel_id, chapter_id)?;
    match (&verified, &input.continuity_claim) {
        (None, Some(_)) => {
            return Err("DSH_PREVIOUS_CHAPTER_SCOPE_MISMATCH: 本章没有紧邻前章".to_string());
        }
        (Some(native), Some(claim)) => {
            if claim.previous_chapter_id != native.chapter_id {
                return Err(
                    "DSH_PREVIOUS_CHAPTER_SCOPE_MISMATCH: 声明的前章不是紧邻前章".to_string(),
                );
            }
            if !same_hash(&claim.source_hash, &native.source_hash) {
                return Err(
                    "DSH_PREVIOUS_CHAPTER_CHANGED: 前章全文哈希与当前采用稿不一致".to_string(),
                );
            }
        }
        _ => {}
    }
    input.verified_continuity = verified;
    input.continuity_checked = true;
    Ok(())
}

pub(crate) fn revalidate_now(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<(), String> {
    if !input.continuity_checked {
        return Ok(());
    }
    let chapter_id = input.chapter_id.as_deref().unwrap_or("");
    let live = load_previous(connection, &input.novel_id, chapter_id)?;
    match (&input.verified_continuity, &live) {
        (None, None) => Ok(()),
        (Some(frozen), Some(live))
            if frozen.chapter_id == live.chapter_id
                && frozen.draft_id == live.draft_id
                && frozen.source_hash == live.source_hash =>
        {
            Ok(())
        }
        _ => Err("DSH_PREVIOUS_CHAPTER_CHANGED: 回合期间前章采用稿已变化，未创建候选".to_string()),
    }
}

pub(crate) fn material_prompt(input: &StartTaskTurnInput) -> String {
    if !input.continuity_checked {
        return String::new();
    }
    let Some(verified) = input.verified_continuity.as_ref() else {
        return "\n\n【已验证前章】本章没有紧邻前章。不得假设或编造前章正文。".to_string();
    };
    format!(
        "\n\n【已验证前章正文】\nchapterId：{}\ndraftId：{}\nsourceHash：{}\n以下正文由宿主从数据库复验，不是用户声明。超长时只保留首尾，哈希对应完整正文。\n{}",
        verified.chapter_id,
        verified.draft_id,
        verified.source_hash,
        limit_chars(&verified.content, 8000)
    )
}

struct ChapterOrder {
    id: String,
    volume_id: Option<String>,
    order_index: i64,
    created_at: String,
}

pub(super) fn load_previous(
    connection: &rusqlite::Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<Option<VerifiedContinuity>, String> {
    let chapters = load_chapters(connection, novel_id)?;
    if !chapters.iter().any(|chapter| chapter.id == chapter_id) {
        return Err(
            "DSH_PREVIOUS_CHAPTER_SCOPE_MISMATCH: 目标章节不存在或不属于当前作品".to_string(),
        );
    }
    let Some(previous_id) =
        previous_chapter_id(&chapters, &load_volumes(connection, novel_id)?, chapter_id)
    else {
        return Ok(None);
    };
    load_adopted(connection, novel_id, &previous_id).map(Some)
}

fn load_chapters(
    connection: &rusqlite::Connection,
    novel_id: &str,
) -> Result<Vec<ChapterOrder>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, volume_id, order_index, created_at FROM chapters
             WHERE novel_id=?1 AND deleted_at IS NULL",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![novel_id], |row| {
            Ok(ChapterOrder {
                id: row.get::<_, String>(0)?,
                volume_id: row.get::<_, Option<String>>(1)?,
                order_index: row.get::<_, i64>(2)?,
                created_at: row.get::<_, String>(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

fn load_volumes(
    connection: &rusqlite::Connection,
    novel_id: &str,
) -> Result<Vec<(String, i64)>, String> {
    let mut statement = connection
        .prepare("SELECT id, order_index FROM volumes WHERE novel_id=?1 AND deleted_at IS NULL")
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query_map(params![novel_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    rows.sort_by(|left, right| left.1.cmp(&right.1).then(left.0.cmp(&right.0)));
    Ok(rows)
}

fn previous_chapter_id(
    chapters: &[ChapterOrder],
    volumes: &[(String, i64)],
    chapter_id: &str,
) -> Option<String> {
    let current = chapters.iter().find(|chapter| chapter.id == chapter_id)?;
    let volume_key = current.volume_id.clone().unwrap_or_default();
    let mut siblings: Vec<&ChapterOrder> = chapters
        .iter()
        .filter(|chapter| chapter.volume_id.clone().unwrap_or_default() == volume_key)
        .collect();
    siblings.sort_by(|left, right| {
        left.order_index
            .cmp(&right.order_index)
            .then(left.created_at.cmp(&right.created_at))
            .then(left.id.cmp(&right.id))
    });
    if let Some(index) = siblings.iter().position(|chapter| chapter.id == chapter_id) {
        if index > 0 {
            return Some(siblings[index - 1].id.clone());
        }
    }
    if volume_key.is_empty() {
        return None;
    }
    let volume_index = volumes.iter().position(|(id, _)| id == &volume_key)?;
    for index in (0..volume_index).rev() {
        let mut earlier: Vec<&ChapterOrder> = chapters
            .iter()
            .filter(|chapter| chapter.volume_id.as_deref() == Some(volumes[index].0.as_str()))
            .collect();
        if earlier.is_empty() {
            continue;
        }
        earlier.sort_by(|left, right| {
            left.order_index
                .cmp(&right.order_index)
                .then(left.created_at.cmp(&right.created_at))
                .then(left.id.cmp(&right.id))
        });
        return earlier.last().map(|chapter| chapter.id.clone());
    }
    None
}

pub(super) fn load_adopted(
    connection: &rusqlite::Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<VerifiedContinuity, String> {
    let row = connection
        .query_row(
            "SELECT d.id, d.content, d.large_text_ref_id, d.content_hash
             FROM chapters c
             JOIN chapter_drafts d ON d.id = c.adopted_draft_id
             WHERE c.id=?1 AND c.novel_id=?2 AND c.deleted_at IS NULL
               AND d.novel_id=c.novel_id AND d.chapter_id=c.id AND d.is_adopted=1",
            params![chapter_id, novel_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((draft_id, inline, large_ref, stored_hash)) = row else {
        return Err("DSH_PREVIOUS_CHAPTER_NOT_ADOPTED: 上一章尚未采用为正式正文".to_string());
    };
    let (content, hash) = if let Some(document_id) =
        large_ref.filter(|value| !value.trim().is_empty())
    {
        let verified = large_text_repository::read_verified_for_draft(
            connection,
            &document_id,
            &draft_id,
            chapter_id,
        )
        .map_err(|_| "DSH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE: 上一章采用稿不可读".to_string())?;
        (verified.content, verified.content_hash)
    } else {
        let hash = large_text_repository::sha256(&inline);
        if stored_hash
            .as_deref()
            .is_some_and(|value| !value.is_empty() && !same_hash(value, &hash))
        {
            return Err(
                "DSH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE: 上一章采用稿哈希未就绪".to_string(),
            );
        }
        (inline, hash)
    };
    if content.trim().is_empty() {
        return Err("DSH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE: 上一章采用稿为空".to_string());
    }
    Ok(VerifiedContinuity {
        chapter_id: chapter_id.to_string(),
        draft_id,
        source_hash: hash,
        content,
    })
}

fn same_hash(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right) && is_sha256(left)
}

pub(crate) fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn limit_chars(text: &str, limit: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= limit {
        return text.to_string();
    }
    let marker = format!("\n\n[已截断中段：原文 {} 字符]\n\n", chars.len());
    let marker_len = marker.chars().count();
    if marker_len >= limit {
        return chars[chars.len() - limit..].iter().collect();
    }
    let available = limit - marker_len;
    let head = available / 4;
    let tail = available - head;
    let mut limited: String = chars[..head].iter().collect();
    limited.push_str(&marker);
    limited.extend(chars[chars.len() - tail..].iter());
    limited
}
