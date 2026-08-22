use crate::domain::world::{ChapterEventDto, CreateChapterEventInput, UpdateChapterEventInput};
use crate::repositories::chapter_event_repository;
use rusqlite::Connection;

pub fn chapter_event_status(value: Option<&str>, fallback: &str) -> Result<String, String> {
    let status = value.unwrap_or(fallback).trim();
    match status {
        "candidate" | "selected" | "required" | "forbidden" | "adopted" | "discarded" => {
            Ok(status.to_string())
        }
        _ => Err("章节事件状态无效".to_string()),
    }
}

pub fn encode_character_ids(ids: Option<&[String]>) -> Option<String> {
    ids.filter(|values| !values.is_empty())
        .and_then(|values| serde_json::to_string(values).ok())
}

pub fn list_chapter_events(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<ChapterEventDto>, String> {
    chapter_event_repository::find_chapter_events_by_chapter(conn, chapter_id)
}

pub fn get_chapter_event(conn: &Connection, id: &str) -> Result<Option<ChapterEventDto>, String> {
    chapter_event_repository::find_chapter_event_by_id(conn, id)
}

pub fn create_chapter_event(
    conn: &Connection,
    input: CreateChapterEventInput,
) -> Result<ChapterEventDto, String> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 240 {
        return Err("事件标题无效".to_string());
    }
    let status = chapter_event_status(input.status.as_deref(), "candidate")?;
    let source = match input.source.as_deref().unwrap_or("manual") {
        "manual" | "ai_suggested" => input.source.unwrap_or_else(|| "manual".to_string()),
        _ => return Err("事件来源无效".to_string()),
    };
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let involved = encode_character_ids(input.involved_character_ids.as_deref());

    chapter_event_repository::insert_chapter_event(
        conn,
        &id,
        &input.novel_id,
        &input.chapter_id,
        title,
        &input.description,
        involved.as_deref(),
        input.impact.as_deref(),
        input.risk.as_deref(),
        &status,
        &source,
        input.ai_task_id.as_deref(),
        &now,
    )?;

    chapter_event_repository::find_chapter_event_by_id(conn, &id)?
        .ok_or_else(|| "无法读取创建后的章节事件".to_string())
}

pub fn update_chapter_event(
    conn: &Connection,
    id: &str,
    input: UpdateChapterEventInput,
) -> Result<ChapterEventDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let status = match &input.status {
        Some(value) => Some(chapter_event_status(Some(value), "candidate")?),
        None => None,
    };
    let involved = encode_character_ids(input.involved_character_ids.as_deref());

    chapter_event_repository::update_chapter_event_fields(
        conn,
        id,
        input.title.as_deref(),
        input.description.as_deref(),
        involved.as_deref(),
        input.impact.as_deref(),
        input.risk.as_deref(),
        status.as_deref(),
        &now,
    )?;

    chapter_event_repository::find_chapter_event_by_id(conn, id)?
        .ok_or_else(|| "无法读取更新后的章节事件".to_string())
}

pub fn set_chapter_event_status(conn: &Connection, id: &str, status: &str) -> Result<(), String> {
    let valid_status = chapter_event_status(Some(status), "candidate")?;
    let now = chrono::Utc::now().to_rfc3339();
    chapter_event_repository::update_chapter_event_status(conn, id, &valid_status, &now)
}

pub fn delete_chapter_event(conn: &Connection, id: &str) -> Result<(), String> {
    chapter_event_repository::delete_chapter_event(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::create_tables(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO novels (id, title, created_at, updated_at) VALUES ('novel-1', '测试小说', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at) VALUES ('chapter-1', 'novel-1', '第一章 觉醒', 1, 'not_started', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_chapter_event_lifecycle() {
        let conn = setup_test_db();
        let event = create_chapter_event(
            &conn,
            CreateChapterEventInput {
                novel_id: "novel-1".to_string(),
                chapter_id: "chapter-1".to_string(),
                title: "遭遇怪兽袭击".to_string(),
                description: "在荒野区遭遇铁毛猪攻击，惊险脱困。".to_string(),
                involved_character_ids: Some(vec!["char-1".to_string()]),
                impact: Some("获得怪兽材料".to_string()),
                risk: Some("受轻伤".to_string()),
                status: Some("candidate".to_string()),
                source: Some("manual".to_string()),
                ai_task_id: None,
            },
        )
        .unwrap();

        assert_eq!(event.title, "遭遇怪兽袭击");
        assert_eq!(event.status, "candidate");

        set_chapter_event_status(&conn, &event.id, "adopted").unwrap();
        let fetched = get_chapter_event(&conn, &event.id).unwrap().unwrap();
        assert_eq!(fetched.status, "adopted");

        let list = list_chapter_events(&conn, "chapter-1").unwrap();
        assert_eq!(list.len(), 1);

        delete_chapter_event(&conn, &event.id).unwrap();
        let list_after = list_chapter_events(&conn, "chapter-1").unwrap();
        assert_eq!(list_after.len(), 0);
    }
}
