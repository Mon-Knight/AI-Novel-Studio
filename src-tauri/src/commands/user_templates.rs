//! 用户模板：桌面端以 SQLite `user_templates` 为唯一事实源（migration 037，审计 GAP-15）。
use crate::db::get_connection;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

pub const USER_TEMPLATE_INVALID: &str = "USER_TEMPLATE_INVALID";

const TEMPLATE_TYPES: &[&str] = &[
    "novel_setting",
    "novel_outline",
    "volume_outline",
    "chapter_outline",
    "chapter_content",
    "character",
    "event",
    "world_background",
    "style_profile",
    "output_control",
    "polish",
    "quality_check",
    "custom",
];
const TEMPLATE_SOURCES: &[&str] = &["system", "user_imported", "user_created"];
const MAX_NAME_CHARS: usize = 120;
const MAX_DESCRIPTION_CHARS: usize = 2_000;
const MAX_CONTENT_CHARS: usize = 200_000;
const MAX_LIST_ITEMS: usize = 50;
const MAX_LIST_ITEM_CHARS: usize = 60;

fn invalid(detail: &str) -> String {
    format!("{USER_TEMPLATE_INVALID}: {detail}")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserTemplateDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub template_type: String,
    pub description: String,
    pub content: String,
    pub tags: Vec<String>,
    pub variables: Vec<String>,
    pub source: String,
    pub file_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveUserTemplateInput {
    /// 传入既有 id 表示更新（或 LocalStorage → SQLite 迁移时的幂等 upsert）。
    pub id: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub template_type: String,
    pub description: Option<String>,
    pub content: String,
    pub tags: Option<Vec<String>>,
    pub variables: Option<Vec<String>>,
    pub source: Option<String>,
    pub file_name: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

const SELECT_TEMPLATE: &str =
    "SELECT id, name, type, description, content, tags_json, variables_json, source, file_name,
            created_at, updated_at
       FROM user_templates";

fn parse_list(raw: String, index: usize) -> rusqlite::Result<Vec<String>> {
    serde_json::from_str::<Vec<String>>(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<UserTemplateDto> {
    Ok(UserTemplateDto {
        id: row.get(0)?,
        name: row.get(1)?,
        template_type: row.get(2)?,
        description: row.get(3)?,
        content: row.get(4)?,
        tags: parse_list(row.get(5)?, 5)?,
        variables: parse_list(row.get(6)?, 6)?,
        source: row.get(7)?,
        file_name: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn normalize_list(values: Option<Vec<String>>, label: &str) -> Result<Vec<String>, String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut result = Vec::new();
    for value in values.unwrap_or_default() {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.chars().count() > MAX_LIST_ITEM_CHARS {
            return Err(invalid(&format!("{label}过长")));
        }
        if seen.insert(trimmed.to_string()) {
            result.push(trimmed.to_string());
        }
        if result.len() > MAX_LIST_ITEMS {
            return Err(invalid(&format!("{label}数量超过上限")));
        }
    }
    Ok(result)
}

pub fn list_user_templates_with(connection: &Connection) -> Result<Vec<UserTemplateDto>, String> {
    let mut statement = connection
        .prepare(&format!(
            "{SELECT_TEMPLATE} ORDER BY updated_at DESC, id DESC"
        ))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], map_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

pub fn get_user_template_with(
    connection: &Connection,
    id: &str,
) -> Result<Option<UserTemplateDto>, String> {
    connection
        .query_row(
            &format!("{SELECT_TEMPLATE} WHERE id = ?1"),
            params![id],
            map_row,
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn save_user_template_with(
    connection: &Connection,
    input: SaveUserTemplateInput,
) -> Result<UserTemplateDto, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(invalid("模板名称不能为空且不能超过 120 字"));
    }
    if !TEMPLATE_TYPES.contains(&input.template_type.as_str()) {
        return Err(invalid("模板类型非法"));
    }
    if input.content.trim().is_empty() {
        return Err(invalid("模板内容不能为空"));
    }
    if input.content.chars().count() > MAX_CONTENT_CHARS {
        return Err(invalid("模板内容超过单条上限"));
    }
    let description = input.description.unwrap_or_default().trim().to_string();
    if description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(invalid("模板说明过长"));
    }
    let source = input.source.unwrap_or_else(|| "user_created".to_string());
    if !TEMPLATE_SOURCES.contains(&source.as_str()) {
        return Err(invalid("模板来源非法"));
    }
    let tags = normalize_list(input.tags, "标签")?;
    let variables = normalize_list(input.variables, "变量")?;
    let tags_json = serde_json::to_string(&tags).map_err(|error| error.to_string())?;
    let variables_json = serde_json::to_string(&variables).map_err(|error| error.to_string())?;
    let file_name = input
        .file_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let now = chrono::Utc::now().to_rfc3339();
    let id = input
        .id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let existing = get_user_template_with(connection, &id)?;
    let created_at = existing
        .as_ref()
        .map(|template| template.created_at.clone())
        .or_else(|| {
            input
                .created_at
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| now.clone());
    let updated_at = if existing.is_some() {
        now
    } else {
        input
            .updated_at
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or(now)
    };
    connection
        .execute(
            "INSERT INTO user_templates
                (id, name, type, description, content, tags_json, variables_json, source, file_name,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                type = excluded.type,
                description = excluded.description,
                content = excluded.content,
                tags_json = excluded.tags_json,
                variables_json = excluded.variables_json,
                source = excluded.source,
                file_name = excluded.file_name,
                updated_at = excluded.updated_at",
            params![
                id,
                name,
                input.template_type,
                description,
                input.content,
                tags_json,
                variables_json,
                source,
                file_name,
                created_at,
                updated_at,
            ],
        )
        .map_err(|error| format!("模板保存失败: {error}"))?;
    get_user_template_with(connection, &id)?.ok_or_else(|| "模板保存后无法读取".to_string())
}

#[tauri::command]
pub fn list_user_templates() -> Result<Vec<UserTemplateDto>, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    list_user_templates_with(&connection)
}

#[tauri::command]
pub fn save_user_template(input: SaveUserTemplateInput) -> Result<UserTemplateDto, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    save_user_template_with(&connection, input)
}

#[tauri::command]
pub fn delete_user_template(template_id: String) -> Result<(), String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM user_templates WHERE id = ?1",
            params![template_id],
        )
        .map_err(|error| format!("模板删除失败: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("foreign keys");
        crate::db::create_tables(&mut connection).expect("schema");
        connection
    }

    fn input(name: &str) -> SaveUserTemplateInput {
        SaveUserTemplateInput {
            id: None,
            name: name.to_string(),
            template_type: "chapter_outline".to_string(),
            description: Some(" 说明 ".to_string()),
            content: "# 大纲\n{{title}}".to_string(),
            tags: Some(vec![
                " 修仙 ".to_string(),
                "修仙".to_string(),
                "".to_string(),
            ]),
            variables: Some(vec!["title".to_string()]),
            source: None,
            file_name: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn saves_normalizes_and_updates_templates() {
        let connection = connection();
        let saved = save_user_template_with(&connection, input("高潮模板")).unwrap();
        assert_eq!(saved.description, "说明");
        assert_eq!(saved.tags, vec!["修仙".to_string()]);
        assert_eq!(saved.source, "user_created");
        let updated = save_user_template_with(
            &connection,
            SaveUserTemplateInput {
                id: Some(saved.id.clone()),
                name: "改名".to_string(),
                created_at: Some("1999-01-01T00:00:00Z".to_string()),
                ..input("ignored")
            },
        )
        .unwrap();
        assert_eq!(updated.id, saved.id);
        assert_eq!(updated.name, "改名");
        assert_eq!(
            updated.created_at, saved.created_at,
            "created_at is immutable on update"
        );
        assert!(updated.updated_at >= saved.updated_at);
        assert_eq!(list_user_templates_with(&connection).unwrap().len(), 1);

        let migrated = save_user_template_with(
            &connection,
            SaveUserTemplateInput {
                id: Some("legacy-1".to_string()),
                source: Some("user_imported".to_string()),
                created_at: Some("2026-01-01T00:00:00Z".to_string()),
                updated_at: Some("2026-01-02T00:00:00Z".to_string()),
                ..input("旧模板")
            },
        )
        .unwrap();
        assert_eq!(migrated.created_at, "2026-01-01T00:00:00Z");
        assert_eq!(migrated.updated_at, "2026-01-02T00:00:00Z");
        assert_eq!(
            list_user_templates_with(&connection).unwrap()[0].id,
            updated.id
        );
    }

    #[test]
    fn rejects_invalid_templates() {
        let connection = connection();
        let cases: Vec<(&str, SaveUserTemplateInput)> = vec![
            (
                "empty name",
                SaveUserTemplateInput {
                    name: "  ".to_string(),
                    ..input("x")
                },
            ),
            (
                "bad type",
                SaveUserTemplateInput {
                    template_type: "poem".to_string(),
                    ..input("x")
                },
            ),
            (
                "empty content",
                SaveUserTemplateInput {
                    content: " ".to_string(),
                    ..input("x")
                },
            ),
            (
                "bad source",
                SaveUserTemplateInput {
                    source: Some("cloud".to_string()),
                    ..input("x")
                },
            ),
            (
                "too many tags",
                SaveUserTemplateInput {
                    tags: Some((0..60).map(|index| format!("t{index}")).collect()),
                    ..input("x")
                },
            ),
        ];
        for (label, case) in cases {
            let error = save_user_template_with(&connection, case).expect_err(label);
            assert!(error.starts_with(USER_TEMPLATE_INVALID), "{label}: {error}");
        }
        assert!(list_user_templates_with(&connection).unwrap().is_empty());
    }
}
