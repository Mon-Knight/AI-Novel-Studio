use crate::domain::project::{default_dual_relation, CreateNovelInput, NovelDto, UpdateNovelInput};
use crate::repositories::novel_repository;
use rusqlite::Connection;

pub fn list_novels(conn: &Connection) -> Result<Vec<NovelDto>, String> {
    novel_repository::find_all(conn)
}

pub fn get_novel(conn: &Connection, id: &str) -> Result<Option<NovelDto>, String> {
    novel_repository::find_by_id(conn, id)
}

pub fn create_novel(conn: &Connection, input: CreateNovelInput) -> Result<NovelDto, String> {
    if input.title.trim().is_empty() {
        return Err("作品标题不能为空".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let relation_json =
        serde_json::to_string(&default_dual_relation()).unwrap_or_else(|_| "{}".to_string());

    novel_repository::insert(
        conn,
        &id,
        &input.title,
        input.subtitle.as_deref(),
        input.genre.as_deref(),
        input.description.as_deref(),
        input.outline.as_deref().unwrap_or_default(),
        input.target_word_count,
        &relation_json,
        &now,
    )?;

    novel_repository::find_by_id(conn, &id)?.ok_or_else(|| "作品创建后无法读取".to_string())
}

pub fn update_novel(
    conn: &Connection,
    id: &str,
    input: UpdateNovelInput,
) -> Result<NovelDto, String> {
    let existing =
        novel_repository::find_by_id(conn, id)?.ok_or_else(|| format!("未找到指定作品: {}", id))?;

    let now = chrono::Utc::now().to_rfc3339();

    let protagonists_json = match &input.protagonists {
        Some(list) => Some(serde_json::to_string(list).unwrap_or_else(|_| "[]".to_string())),
        None => None,
    };

    let relation_json = match &input.dual_protagonist_relation {
        Some(rel) => Some(serde_json::to_string(rel).unwrap_or_else(|_| "{}".to_string())),
        None => None,
    };

    novel_repository::update(
        conn,
        id,
        &existing,
        &input,
        protagonists_json,
        relation_json,
        &now,
    )?;

    novel_repository::find_by_id(conn, id)?.ok_or_else(|| "作品保存后无法读取".to_string())
}

pub fn delete_novel(conn: &Connection, id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    novel_repository::soft_delete(conn, id, &now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::create_tables(&mut conn).unwrap();
        conn
    }

    #[test]
    fn test_create_novel_requires_non_empty_title() {
        let conn = setup_test_db();
        let err = create_novel(
            &conn,
            CreateNovelInput {
                title: "   ".to_string(),
                subtitle: None,
                description: None,
                outline: None,
                genre: None,
                target_word_count: None,
            },
        )
        .unwrap_err();
        assert_eq!(err, "作品标题不能为空");
    }

    #[test]
    fn test_create_and_read_novel() {
        let conn = setup_test_db();
        let novel = create_novel(
            &conn,
            CreateNovelInput {
                title: "测试作品".to_string(),
                subtitle: Some("副标题".to_string()),
                description: Some("简介内容".to_string()),
                outline: Some("总纲大纲".to_string()),
                genre: Some("玄幻".to_string()),
                target_word_count: Some(100000),
            },
        )
        .unwrap();

        assert_eq!(novel.title, "测试作品");
        assert_eq!(novel.subtitle.as_deref(), Some("副标题"));
        assert_eq!(novel.status, "draft");

        let fetched = get_novel(&conn, &novel.id).unwrap().unwrap();
        assert_eq!(fetched.id, novel.id);
        assert_eq!(fetched.title, "测试作品");
    }

    #[test]
    fn test_update_and_delete_novel() {
        let conn = setup_test_db();
        let novel = create_novel(
            &conn,
            CreateNovelInput {
                title: "原标题".to_string(),
                subtitle: None,
                description: None,
                outline: None,
                genre: None,
                target_word_count: None,
            },
        )
        .unwrap();

        let updated = update_novel(
            &conn,
            &novel.id,
            UpdateNovelInput {
                title: Some("新标题".to_string()),
                subtitle: None,
                description: Some("新简介".to_string()),
                outline: None,
                genre: None,
                status: Some("in_progress".to_string()),
                target_word_count: None,
                current_volume_id: None,
                current_chapter_id: None,
                total_word_count: None,
                protagonist_mode: None,
                protagonists: None,
                dual_protagonist_relation: None,
                main_character: None,
                protagonist_ability: None,
            },
        )
        .unwrap();

        assert_eq!(updated.title, "新标题");
        assert_eq!(updated.description.as_deref(), Some("新简介"));
        assert_eq!(updated.status, "in_progress");

        // Delete novel
        delete_novel(&conn, &novel.id).unwrap();
        let after_delete = get_novel(&conn, &novel.id).unwrap();
        assert!(after_delete.is_none());
    }
}
