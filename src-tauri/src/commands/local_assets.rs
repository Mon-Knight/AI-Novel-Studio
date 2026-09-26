//! 导入资产与润色记录：桌面端以 SQLite 为唯一事实源（审计 GAP-15）。
//!
//! 两张表早已存在于 schema 中，但此前没有任何命令写入，前端一直把 LocalStorage 当事实源，
//! 导致备份里这两张表在桌面端永远为空。这里补齐 list / save / delete 命令，
//! 并在保存时复验作品、章节、草稿、任务的归属，避免跨书引用。
use crate::db::get_connection;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

pub const LOCAL_ASSET_INVALID: &str = "LOCAL_ASSET_INVALID";

fn invalid(detail: &str) -> String {
    format!("{LOCAL_ASSET_INVALID}: {detail}")
}

fn exists(
    connection: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<bool, String> {
    connection
        .query_row(sql, params, |row| row.get::<_, i64>(0))
        .map(|count| count > 0)
        .map_err(|error| error.to_string())
}

fn ensure_novel(connection: &Connection, novel_id: &str) -> Result<(), String> {
    if !exists(
        connection,
        "SELECT COUNT(*) FROM novels WHERE id = ?1 AND deleted_at IS NULL",
        &[&novel_id],
    )? {
        return Err(invalid("作品不存在或已删除"));
    }
    Ok(())
}

// ==================== Imported assets ====================

const IMPORTED_ASSET_FILE_TYPES: &[&str] = &["txt", "json", "markdown", "other"];
const IMPORTED_ASSET_TYPES: &[&str] = &[
    "style_reference",
    "novel_text",
    "config",
    "outline",
    "other",
];
const MAX_PREVIEW_CHARS: usize = 4_000;
const MAX_PARSED_JSON_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAssetDto {
    pub id: String,
    pub novel_id: Option<String>,
    pub file_name: String,
    pub file_path: Option<String>,
    pub file_type: String,
    pub asset_type: String,
    pub content_preview: Option<String>,
    pub parsed_json: Option<String>,
    pub related_style_profile_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImportedAssetInput {
    /// 传入既有 id 表示幂等 upsert（用于 LocalStorage → SQLite 迁移）。
    pub id: Option<String>,
    pub novel_id: Option<String>,
    pub file_name: String,
    pub file_path: Option<String>,
    pub file_type: String,
    pub asset_type: String,
    pub content_preview: Option<String>,
    pub parsed_json: Option<String>,
    pub related_style_profile_id: Option<String>,
    pub created_at: Option<String>,
}

const SELECT_IMPORTED_ASSET: &str =
    "SELECT id, novel_id, file_name, file_path, file_type, asset_type, content_preview,
            parsed_json, related_style_profile_id, created_at
       FROM imported_assets";

fn map_imported_asset(row: &Row<'_>) -> rusqlite::Result<ImportedAssetDto> {
    Ok(ImportedAssetDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        file_name: row.get(2)?,
        file_path: row.get(3)?,
        file_type: row.get(4)?,
        asset_type: row.get(5)?,
        content_preview: row.get(6)?,
        parsed_json: row.get(7)?,
        related_style_profile_id: row.get(8)?,
        created_at: row.get(9)?,
    })
}

fn optional_trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

pub fn list_imported_assets_with(
    connection: &Connection,
    novel_id: Option<&str>,
) -> Result<Vec<ImportedAssetDto>, String> {
    // `novel_id IS ?1` with NULL matches nothing, so use an explicit branch for "all novels".
    let mut statement = connection
        .prepare(&format!(
            "{SELECT_IMPORTED_ASSET}
             WHERE (?1 IS NULL OR novel_id = ?1)
             ORDER BY created_at DESC, id DESC"
        ))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![novel_id], map_imported_asset)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

pub fn save_imported_asset_with(
    connection: &Connection,
    input: SaveImportedAssetInput,
) -> Result<ImportedAssetDto, String> {
    let file_name = input.file_name.trim();
    if file_name.is_empty() || file_name.chars().count() > 260 {
        return Err(invalid("文件名不能为空且不能超过 260 字"));
    }
    if !IMPORTED_ASSET_FILE_TYPES.contains(&input.file_type.as_str()) {
        return Err(invalid("文件类型非法"));
    }
    if !IMPORTED_ASSET_TYPES.contains(&input.asset_type.as_str()) {
        return Err(invalid("资产类型非法"));
    }
    if input
        .content_preview
        .as_deref()
        .is_some_and(|preview| preview.chars().count() > MAX_PREVIEW_CHARS)
    {
        return Err(invalid("内容预览过长"));
    }
    if input
        .parsed_json
        .as_deref()
        .is_some_and(|json| json.len() > MAX_PARSED_JSON_BYTES)
    {
        return Err(invalid("解析结果过大"));
    }
    let novel_id = optional_trimmed(input.novel_id);
    if let Some(novel_id) = novel_id.as_deref() {
        ensure_novel(connection, novel_id)?;
    }
    let related_style_profile_id = optional_trimmed(input.related_style_profile_id);
    if let Some(profile_id) = related_style_profile_id.as_deref() {
        if !exists(
            connection,
            "SELECT COUNT(*) FROM style_profiles WHERE id = ?1",
            &[&profile_id],
        )? {
            return Err(invalid("关联的风格方案不存在"));
        }
    }
    let id = optional_trimmed(input.id).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let created_at =
        optional_trimmed(input.created_at).unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    connection
        .execute(
            "INSERT INTO imported_assets
                (id, novel_id, file_name, file_path, file_type, asset_type, content_preview,
                 parsed_json, related_style_profile_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                novel_id = excluded.novel_id,
                file_name = excluded.file_name,
                file_path = excluded.file_path,
                file_type = excluded.file_type,
                asset_type = excluded.asset_type,
                content_preview = excluded.content_preview,
                parsed_json = excluded.parsed_json,
                related_style_profile_id = excluded.related_style_profile_id",
            params![
                id,
                novel_id,
                file_name,
                optional_trimmed(input.file_path),
                input.file_type,
                input.asset_type,
                input.content_preview,
                input.parsed_json,
                related_style_profile_id,
                created_at,
            ],
        )
        .map_err(|error| format!("导入资产保存失败: {error}"))?;
    connection
        .query_row(
            &format!("{SELECT_IMPORTED_ASSET} WHERE id = ?1"),
            params![id],
            map_imported_asset,
        )
        .map_err(|error| format!("导入资产保存结果读取失败: {error}"))
}

#[tauri::command]
pub fn list_imported_assets(novel_id: Option<String>) -> Result<Vec<ImportedAssetDto>, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    list_imported_assets_with(&connection, novel_id.as_deref())
}

#[tauri::command]
pub fn save_imported_asset(input: SaveImportedAssetInput) -> Result<ImportedAssetDto, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    save_imported_asset_with(&connection, input)
}

#[tauri::command]
pub fn delete_imported_asset(asset_id: String) -> Result<(), String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM imported_assets WHERE id = ?1",
            params![asset_id],
        )
        .map_err(|error| format!("导入资产删除失败: {error}"))?;
    Ok(())
}

// ==================== Polish records ====================

const POLISH_MODES: &[&str] = &[
    "keep_plot",
    "enhance_description",
    "reduce_redundancy",
    "strengthen_conflict",
    "adjust_pacing",
    "unify_style",
    "fix_language",
    "custom",
];
const POLISH_STATUSES: &[&str] = &["pending", "running", "succeeded", "failed", "cancelled"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PolishRecordDto {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub source_draft_id: String,
    pub result_draft_id: Option<String>,
    pub mode: String,
    pub instruction: Option<String>,
    pub ai_task_id: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePolishRecordInput {
    /// 传入既有 id 表示幂等 upsert（用于 LocalStorage → SQLite 迁移）。
    pub id: Option<String>,
    pub novel_id: String,
    pub chapter_id: String,
    pub source_draft_id: String,
    pub result_draft_id: Option<String>,
    pub mode: String,
    pub instruction: Option<String>,
    pub ai_task_id: Option<String>,
    pub status: Option<String>,
    pub error_message: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePolishRecordInput {
    pub id: String,
    pub result_draft_id: Option<String>,
    pub ai_task_id: Option<String>,
    pub status: Option<String>,
    pub error_message: Option<String>,
}

const SELECT_POLISH_RECORD: &str =
    "SELECT id, novel_id, chapter_id, source_draft_id, result_draft_id, mode, instruction,
            ai_task_id, status, error_message, created_at, updated_at
       FROM polish_records";

fn map_polish_record(row: &Row<'_>) -> rusqlite::Result<PolishRecordDto> {
    Ok(PolishRecordDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        source_draft_id: row.get(3)?,
        result_draft_id: row.get(4)?,
        mode: row.get(5)?,
        instruction: row.get(6)?,
        ai_task_id: row.get(7)?,
        status: row.get(8)?,
        error_message: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn ensure_draft_in_chapter(
    connection: &Connection,
    draft_id: &str,
    novel_id: &str,
    chapter_id: &str,
    label: &str,
) -> Result<(), String> {
    if !exists(
        connection,
        "SELECT COUNT(*) FROM chapter_drafts WHERE id = ?1 AND novel_id = ?2 AND chapter_id = ?3",
        &[&draft_id, &novel_id, &chapter_id],
    )? {
        return Err(invalid(&format!("{label}不存在或不属于当前章节")));
    }
    Ok(())
}

fn ensure_ai_task(connection: &Connection, ai_task_id: &str) -> Result<(), String> {
    if !exists(
        connection,
        "SELECT COUNT(*) FROM ai_task_records WHERE id = ?1",
        &[&ai_task_id],
    )? {
        return Err(invalid("关联的 AI 任务记录不存在"));
    }
    Ok(())
}

fn ensure_status(status: &str) -> Result<(), String> {
    if !POLISH_STATUSES.contains(&status) {
        return Err(invalid("润色状态非法"));
    }
    Ok(())
}

pub fn list_polish_records_with(
    connection: &Connection,
    chapter_id: &str,
) -> Result<Vec<PolishRecordDto>, String> {
    let mut statement = connection
        .prepare(&format!(
            "{SELECT_POLISH_RECORD} WHERE chapter_id = ?1 ORDER BY created_at ASC, id ASC"
        ))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![chapter_id], map_polish_record)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

pub fn get_polish_record_with(
    connection: &Connection,
    id: &str,
) -> Result<Option<PolishRecordDto>, String> {
    connection
        .query_row(
            &format!("{SELECT_POLISH_RECORD} WHERE id = ?1"),
            params![id],
            map_polish_record,
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn create_polish_record_with(
    connection: &Connection,
    input: CreatePolishRecordInput,
) -> Result<PolishRecordDto, String> {
    if !POLISH_MODES.contains(&input.mode.as_str()) {
        return Err(invalid("润色模式非法"));
    }
    let status = input.status.unwrap_or_else(|| "pending".to_string());
    ensure_status(&status)?;
    ensure_novel(connection, &input.novel_id)?;
    if !exists(
        connection,
        "SELECT COUNT(*) FROM chapters WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL",
        &[&input.chapter_id, &input.novel_id],
    )? {
        return Err(invalid("章节不存在或不属于当前作品"));
    }
    ensure_draft_in_chapter(
        connection,
        &input.source_draft_id,
        &input.novel_id,
        &input.chapter_id,
        "来源草稿",
    )?;
    let result_draft_id = optional_trimmed(input.result_draft_id);
    if let Some(result_draft_id) = result_draft_id.as_deref() {
        ensure_draft_in_chapter(
            connection,
            result_draft_id,
            &input.novel_id,
            &input.chapter_id,
            "结果草稿",
        )?;
    }
    let ai_task_id = optional_trimmed(input.ai_task_id);
    if let Some(ai_task_id) = ai_task_id.as_deref() {
        ensure_ai_task(connection, ai_task_id)?;
    }
    let id = optional_trimmed(input.id).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = chrono::Utc::now().to_rfc3339();
    let created_at = optional_trimmed(input.created_at).unwrap_or_else(|| now.clone());
    let updated_at = optional_trimmed(input.updated_at).unwrap_or_else(|| created_at.clone());
    connection
        .execute(
            "INSERT INTO polish_records
                (id, novel_id, chapter_id, source_draft_id, result_draft_id, mode, instruction,
                 ai_task_id, status, error_message, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                result_draft_id = excluded.result_draft_id,
                mode = excluded.mode,
                instruction = excluded.instruction,
                ai_task_id = excluded.ai_task_id,
                status = excluded.status,
                error_message = excluded.error_message,
                updated_at = excluded.updated_at",
            params![
                id,
                input.novel_id,
                input.chapter_id,
                input.source_draft_id,
                result_draft_id,
                input.mode,
                optional_trimmed(input.instruction),
                ai_task_id,
                status,
                optional_trimmed(input.error_message),
                created_at,
                updated_at,
            ],
        )
        .map_err(|error| format!("润色记录保存失败: {error}"))?;
    get_polish_record_with(connection, &id)?.ok_or_else(|| "润色记录保存后无法读取".to_string())
}

pub fn update_polish_record_with(
    connection: &Connection,
    input: UpdatePolishRecordInput,
) -> Result<Option<PolishRecordDto>, String> {
    let Some(existing) = get_polish_record_with(connection, &input.id)? else {
        return Ok(None);
    };
    let status = input.status.unwrap_or(existing.status.clone());
    ensure_status(&status)?;
    let result_draft_id = match input.result_draft_id {
        Some(value) => optional_trimmed(Some(value)),
        None => existing.result_draft_id.clone(),
    };
    if let Some(result_draft_id) = result_draft_id.as_deref() {
        ensure_draft_in_chapter(
            connection,
            result_draft_id,
            &existing.novel_id,
            &existing.chapter_id,
            "结果草稿",
        )?;
    }
    let ai_task_id = match input.ai_task_id {
        Some(value) => optional_trimmed(Some(value)),
        None => existing.ai_task_id.clone(),
    };
    if let Some(ai_task_id) = ai_task_id.as_deref() {
        ensure_ai_task(connection, ai_task_id)?;
    }
    let error_message = match input.error_message {
        Some(value) => optional_trimmed(Some(value)),
        None => existing.error_message.clone(),
    };
    connection
        .execute(
            "UPDATE polish_records
             SET result_draft_id = ?1, ai_task_id = ?2, status = ?3, error_message = ?4, updated_at = ?5
             WHERE id = ?6",
            params![
                result_draft_id,
                ai_task_id,
                status,
                error_message,
                chrono::Utc::now().to_rfc3339(),
                input.id,
            ],
        )
        .map_err(|error| format!("润色记录更新失败: {error}"))?;
    get_polish_record_with(connection, &input.id)
}

#[tauri::command]
pub fn list_polish_records(chapter_id: String) -> Result<Vec<PolishRecordDto>, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    list_polish_records_with(&connection, &chapter_id)
}

#[tauri::command]
pub fn get_polish_record(record_id: String) -> Result<Option<PolishRecordDto>, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    get_polish_record_with(&connection, &record_id)
}

#[tauri::command]
pub fn create_polish_record(input: CreatePolishRecordInput) -> Result<PolishRecordDto, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    create_polish_record_with(&connection, input)
}

#[tauri::command]
pub fn update_polish_record(
    input: UpdatePolishRecordInput,
) -> Result<Option<PolishRecordDto>, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    update_polish_record_with(&connection, input)
}

#[tauri::command]
pub fn delete_polish_record(record_id: String) -> Result<(), String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM polish_records WHERE id = ?1",
            params![record_id],
        )
        .map_err(|error| format!("润色记录删除失败: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOVEL: &str = "10000000-0000-4000-8000-000000000001";
    const OTHER_NOVEL: &str = "10000000-0000-4000-8000-000000000002";
    const CHAPTER: &str = "10000000-0000-4000-8000-000000000011";
    const DRAFT: &str = "10000000-0000-4000-8000-000000000021";
    const NOW: &str = "2026-09-08T00:00:00Z";

    fn connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("foreign keys");
        crate::db::create_tables(&mut connection).expect("schema");
        for novel in [NOVEL, OTHER_NOVEL] {
            connection
                .execute(
                    "INSERT INTO novels (id, title, outline, created_at, updated_at) VALUES (?1, 'n', '', ?2, ?2)",
                    params![novel, NOW],
                )
                .expect("novel");
        }
        connection
            .execute(
                "INSERT INTO chapters (id, novel_id, title, order_index, status, created_at, updated_at) VALUES (?1, ?2, 'c', 1, 'draft', ?3, ?3)",
                params![CHAPTER, NOVEL, NOW],
            )
            .expect("chapter");
        connection
            .execute(
                "INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'c', 'text', 'manual', 1, 2, 0, ?4, ?4)",
                params![DRAFT, NOVEL, CHAPTER, NOW],
            )
            .expect("draft");
        connection
    }

    fn asset(novel_id: Option<&str>) -> SaveImportedAssetInput {
        SaveImportedAssetInput {
            id: None,
            novel_id: novel_id.map(str::to_string),
            file_name: " style.txt ".to_string(),
            file_path: None,
            file_type: "txt".to_string(),
            asset_type: "style_reference".to_string(),
            content_preview: Some("preview".to_string()),
            parsed_json: None,
            related_style_profile_id: None,
            created_at: None,
        }
    }

    #[test]
    fn imported_assets_upsert_by_id_and_filter_by_novel() {
        let connection = connection();
        let saved = save_imported_asset_with(&connection, asset(Some(NOVEL))).unwrap();
        assert_eq!(saved.file_name, "style.txt");
        let global = save_imported_asset_with(&connection, asset(None)).unwrap();
        assert!(global.novel_id.is_none());
        let replayed = save_imported_asset_with(
            &connection,
            SaveImportedAssetInput {
                id: Some(saved.id.clone()),
                created_at: Some(saved.created_at.clone()),
                content_preview: Some("changed".to_string()),
                ..asset(Some(NOVEL))
            },
        )
        .unwrap();
        assert_eq!(replayed.id, saved.id);
        assert_eq!(replayed.content_preview.as_deref(), Some("changed"));
        assert_eq!(
            list_imported_assets_with(&connection, None).unwrap().len(),
            2
        );
        assert_eq!(
            list_imported_assets_with(&connection, Some(NOVEL))
                .unwrap()
                .len(),
            1
        );
        assert!(save_imported_asset_with(
            &connection,
            SaveImportedAssetInput {
                file_type: "pdf".to_string(),
                ..asset(None)
            }
        )
        .unwrap_err()
        .starts_with(LOCAL_ASSET_INVALID));
        assert!(
            save_imported_asset_with(&connection, asset(Some("missing-novel")))
                .unwrap_err()
                .starts_with(LOCAL_ASSET_INVALID)
        );
    }

    fn polish() -> CreatePolishRecordInput {
        CreatePolishRecordInput {
            id: None,
            novel_id: NOVEL.to_string(),
            chapter_id: CHAPTER.to_string(),
            source_draft_id: DRAFT.to_string(),
            result_draft_id: None,
            mode: "keep_plot".to_string(),
            instruction: None,
            ai_task_id: None,
            status: None,
            error_message: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn polish_records_validate_ownership_and_update_lifecycle() {
        let connection = connection();
        let created = create_polish_record_with(&connection, polish()).unwrap();
        assert_eq!(created.status, "pending");
        let updated = update_polish_record_with(
            &connection,
            UpdatePolishRecordInput {
                id: created.id.clone(),
                result_draft_id: Some(DRAFT.to_string()),
                ai_task_id: None,
                status: Some("succeeded".to_string()),
                error_message: None,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.status, "succeeded");
        assert_eq!(updated.result_draft_id.as_deref(), Some(DRAFT));
        assert_eq!(
            list_polish_records_with(&connection, CHAPTER)
                .unwrap()
                .len(),
            1
        );
        assert!(get_polish_record_with(&connection, "missing")
            .unwrap()
            .is_none());

        for (label, input) in [
            (
                "foreign novel",
                CreatePolishRecordInput {
                    novel_id: OTHER_NOVEL.to_string(),
                    ..polish()
                },
            ),
            (
                "unknown draft",
                CreatePolishRecordInput {
                    source_draft_id: "missing".to_string(),
                    ..polish()
                },
            ),
            (
                "bad mode",
                CreatePolishRecordInput {
                    mode: "shout".to_string(),
                    ..polish()
                },
            ),
            (
                "bad status",
                CreatePolishRecordInput {
                    status: Some("done".to_string()),
                    ..polish()
                },
            ),
            (
                "unknown task",
                CreatePolishRecordInput {
                    ai_task_id: Some("missing-task".to_string()),
                    ..polish()
                },
            ),
        ] {
            let error = create_polish_record_with(&connection, input).expect_err(label);
            assert!(error.starts_with(LOCAL_ASSET_INVALID), "{label}: {error}");
        }
        assert!(update_polish_record_with(
            &connection,
            UpdatePolishRecordInput {
                id: created.id,
                result_draft_id: Some("missing-draft".to_string()),
                ai_task_id: None,
                status: None,
                error_message: None,
            },
        )
        .unwrap_err()
        .starts_with(LOCAL_ASSET_INVALID));
    }
}
