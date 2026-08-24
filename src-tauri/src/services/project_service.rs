use crate::domain::project::{
    default_dual_relation, CreateNovelInput, DatabaseRepairResult, NovelDto, UpdateNovelInput,
};
use crate::repositories::novel_repository;
use rusqlite::{params, Connection};

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

pub fn delete_novel(conn: &mut Connection, id: &str) -> Result<(), String> {
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    crate::project_backup::purge_project_in_tx(&tx, id)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(())
}

/// Physically removes a project and every owned durable fact in one transaction.
///
/// The existing `delete_novel` command remains a compatibility soft-delete
/// primitive.  The user-facing cascade action uses this path so its promise is
/// true on the SQLite desktop runtime as well as in the browser fallback.
pub fn delete_novel_cascade(conn: &mut Connection, id: &str) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM novels WHERE id = ?1)",
            params![id],
            |row| row.get(0),
        )
        .map_err(|error| format!("检查作品是否存在失败：{error}"))?;
    if !exists {
        return Err(format!("未找到指定作品: {id}"));
    }

    let transaction = conn
        .transaction()
        .map_err(|error| format!("开始作品级联删除事务失败：{error}"))?;
    crate::project_backup::purge_project_in_tx(&transaction, id)?;
    transaction
        .commit()
        .map_err(|error| format!("提交作品级联删除事务失败：{error}"))
}

/// Repairs only deterministic, schema-level novel fields on the SQLite source
/// of truth. The transaction rolls back on any failure; no LocalStorage mirror
/// is touched in desktop mode.
pub fn repair_database(conn: &mut Connection) -> Result<DatabaseRepairResult, String> {
    let before: i64 = conn
        .query_row("SELECT COUNT(*) FROM novels", [], |row| row.get(0))
        .map_err(|error| format!("读取作品数量失败：{error}"))?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction()
        .map_err(|error| format!("开始数据库修复事务失败：{error}"))?;

    let rows = {
        let mut statement = transaction
            .prepare(
                "SELECT id, protagonists_json, dual_protagonist_relation_json,
                        created_at, updated_at
                 FROM novels",
            )
            .map_err(|error| format!("读取作品修复候选失败：{error}"))?;
        let mapped = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|error| format!("扫描作品修复候选失败：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取作品修复候选失败：{error}"))?;
        mapped
    };

    let mut repaired_count = 0_i64;
    for (id, protagonists_json, relation_json, created_at, updated_at) in rows {
        let normalized_protagonists =
            if serde_json::from_str::<serde_json::Value>(&protagonists_json).is_err() {
                "[]".to_string()
            } else {
                protagonists_json.clone()
            };
        let normalized_relation =
            if serde_json::from_str::<serde_json::Value>(&relation_json).is_err() {
                "{}".to_string()
            } else {
                relation_json.clone()
            };
        let normalized_created = if created_at.trim().is_empty() {
            now.clone()
        } else {
            created_at.clone()
        };
        let normalized_updated = if updated_at.trim().is_empty() {
            normalized_created.clone()
        } else {
            updated_at.clone()
        };

        if normalized_protagonists != protagonists_json
            || normalized_relation != relation_json
            || normalized_created != created_at
            || normalized_updated != updated_at
        {
            transaction
                .execute(
                    "UPDATE novels SET protagonists_json = ?1,
                     dual_protagonist_relation_json = ?2,
                     created_at = ?3, updated_at = ?4 WHERE id = ?5",
                    params![
                        normalized_protagonists,
                        normalized_relation,
                        normalized_created,
                        normalized_updated,
                        id
                    ],
                )
                .map_err(|error| format!("修复作品记录失败：{error}"))?;
            repaired_count += 1;
        }
    }

    transaction
        .commit()
        .map_err(|error| format!("提交数据库修复事务失败：{error}"))?;

    let after: i64 = conn
        .query_row("SELECT COUNT(*) FROM novels", [], |row| row.get(0))
        .map_err(|error| format!("读取修复后作品数量失败：{error}"))?;
    let integrity_message: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| format!("执行 SQLite 完整性检查失败：{error}"))?;
    let foreign_key_violations = count_foreign_key_violations(conn)?;
    let integrity_ok = integrity_message == "ok" && foreign_key_violations == 0;

    Ok(DatabaseRepairResult {
        storage: "sqlite".to_string(),
        before,
        after,
        repaired_count,
        skipped_count: foreign_key_violations,
        backup_key: "sqlite-transaction".to_string(),
        integrity_ok,
        integrity_message,
        foreign_key_violations,
    })
}

fn count_foreign_key_violations(conn: &Connection) -> Result<i64, String> {
    let mut statement = conn
        .prepare("PRAGMA foreign_key_check")
        .map_err(|error| format!("读取 SQLite 外键检查失败：{error}"))?;
    let rows = statement
        .query_map([], |_| Ok(()))
        .map_err(|error| format!("执行 SQLite 外键检查失败：{error}"))?;
    let mut count = 0_i64;
    for row in rows {
        row.map_err(|error| format!("读取 SQLite 外键检查结果失败：{error}"))?;
        count += 1;
    }
    Ok(count)
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
        let mut conn = setup_test_db();
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
        delete_novel(&mut conn, &novel.id).unwrap();
        let after_delete = get_novel(&conn, &novel.id).unwrap();
        assert!(after_delete.is_none());
    }

    #[test]
    fn cascade_delete_removes_project_and_owned_rows() {
        let mut conn = setup_test_db();
        let novel = create_novel(
            &conn,
            CreateNovelInput {
                title: "待清理作品".to_string(),
                subtitle: None,
                description: None,
                outline: None,
                genre: None,
                target_word_count: None,
            },
        )
        .unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO volumes (id, novel_id, title, order_index, status, created_at, updated_at) VALUES (?1, ?2, '卷一', 0, 'planned', ?3, ?3)",
            params![uuid::Uuid::new_v4().to_string(), novel.id, now],
        )
        .unwrap();

        delete_novel_cascade(&mut conn, &novel.id).unwrap();
        assert!(get_novel(&conn, &novel.id).unwrap().is_none());
        let volume_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM volumes WHERE novel_id = ?1",
                params![novel.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(volume_count, 0);
    }

    #[test]
    fn repair_database_normalizes_invalid_json_and_reports_sqlite_health() {
        let mut conn = setup_test_db();
        let novel = create_novel(
            &conn,
            CreateNovelInput {
                title: "待修复作品".to_string(),
                subtitle: None,
                description: None,
                outline: None,
                genre: None,
                target_word_count: None,
            },
        )
        .unwrap();
        conn.execute(
            "UPDATE novels SET protagonists_json = 'not-json', dual_protagonist_relation_json = '{', updated_at = '' WHERE id = ?1",
            params![novel.id],
        )
        .unwrap();

        let result = repair_database(&mut conn).unwrap();
        assert_eq!(result.storage, "sqlite");
        assert_eq!(result.repaired_count, 1);
        assert!(result.integrity_ok);
        let (protagonists, relation, updated): (String, String, String) = conn
            .query_row(
                "SELECT protagonists_json, dual_protagonist_relation_json, updated_at FROM novels WHERE id = ?1",
                params![novel.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(protagonists, "[]");
        assert_eq!(relation, "{}");
        assert!(!updated.trim().is_empty());
    }
}
