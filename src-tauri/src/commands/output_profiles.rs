use crate::db::get_connection;
use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutputProfileDto {
    pub id: String,
    pub novel_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub target_word_count: Option<i64>,
    pub min_word_count: Option<i64>,
    pub max_word_count: Option<i64>,
    pub paragraph_length: Option<String>,
    pub pov_type: Option<String>,
    pub tense_type: Option<String>,
    pub pace_level: Option<String>,
    pub dialogue_ratio: Option<f64>,
    pub description_ratio: Option<f64>,
    pub battle_intensity: Option<String>,
    pub emotion_tendency: Option<String>,
    pub ending_hook_required: bool,
    pub extra_requirements: Option<String>,
    pub forbidden_items: Vec<String>,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutputProfileInput {
    pub id: Option<String>,
    pub novel_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub target_word_count: Option<i64>,
    pub min_word_count: Option<i64>,
    pub max_word_count: Option<i64>,
    pub paragraph_length: Option<String>,
    pub pov_type: Option<String>,
    pub tense_type: Option<String>,
    pub pace_level: Option<String>,
    pub dialogue_ratio: Option<f64>,
    pub description_ratio: Option<f64>,
    pub battle_intensity: Option<String>,
    pub emotion_tendency: Option<String>,
    pub ending_hook_required: Option<bool>,
    pub extra_requirements: Option<String>,
    pub forbidden_items: Option<Vec<String>>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDefaultOutputProfileInput {
    pub novel_id: String,
    pub output_profile_id: String,
}

const SELECT_OUTPUT_PROFILE: &str =
    "SELECT id, novel_id, name, description, target_word_count, min_word_count,
            max_word_count, paragraph_length, pov_type, tense_type, pace_level,
            dialogue_ratio, description_ratio, battle_intensity, emotion_tendency,
            ending_hook_required, extra_requirements, forbidden_items, is_default,
            created_at, updated_at
       FROM output_profiles";

fn map_row(row: &Row<'_>) -> rusqlite::Result<OutputProfileDto> {
    let forbidden_json: Option<String> = row.get(17)?;
    let forbidden_items = match forbidden_json {
        Some(value) => serde_json::from_str::<Vec<String>>(&value).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(17, Type::Text, Box::new(error))
        })?,
        None => Vec::new(),
    };
    Ok(OutputProfileDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        target_word_count: row.get(4)?,
        min_word_count: row.get(5)?,
        max_word_count: row.get(6)?,
        paragraph_length: row.get(7)?,
        pov_type: row.get(8)?,
        tense_type: row.get(9)?,
        pace_level: row.get(10)?,
        dialogue_ratio: row.get(11)?,
        description_ratio: row.get(12)?,
        battle_intensity: row.get(13)?,
        emotion_tendency: row.get(14)?,
        ending_hook_required: row.get::<_, i64>(15)? != 0,
        extra_requirements: row.get(16)?,
        forbidden_items,
        is_default: row.get::<_, i64>(18)? != 0,
        created_at: row.get(19)?,
        updated_at: row.get(20)?,
    })
}

fn validate_choice(value: Option<&str>, allowed: &[&str], field: &str) -> Result<(), String> {
    if let Some(value) = value {
        if !allowed.contains(&value) {
            return Err(format!("输出控制方案 {} 非法", field));
        }
    }
    Ok(())
}

fn validate_input(input: &SaveOutputProfileInput) -> Result<(), String> {
    if input.name.trim().is_empty() || input.name.chars().count() > 120 {
        return Err("输出控制方案名称不能为空且不能超过 120 字".to_string());
    }
    for (field, value) in [
        ("targetWordCount", input.target_word_count),
        ("minWordCount", input.min_word_count),
        ("maxWordCount", input.max_word_count),
    ] {
        if value.map_or(false, |count| count < 0) {
            return Err(format!("输出控制方案 {} 不能为负数", field));
        }
    }
    if let (Some(minimum), Some(maximum)) = (input.min_word_count, input.max_word_count) {
        if minimum > maximum {
            return Err("输出控制方案最小字数不能大于最大字数".to_string());
        }
    }
    if let Some(target) = input.target_word_count {
        if input
            .min_word_count
            .map_or(false, |minimum| target < minimum)
            || input
                .max_word_count
                .map_or(false, |maximum| target > maximum)
        {
            return Err("输出控制方案目标字数必须位于最小值和最大值之间".to_string());
        }
    }
    for (field, value) in [
        ("dialogueRatio", input.dialogue_ratio),
        ("descriptionRatio", input.description_ratio),
    ] {
        if value.map_or(false, |ratio| {
            !ratio.is_finite() || !(0.0..=1.0).contains(&ratio)
        }) {
            return Err(format!("输出控制方案 {} 必须位于 0 到 1", field));
        }
    }
    validate_choice(
        input.paragraph_length.as_deref(),
        &["short", "medium", "long"],
        "paragraphLength",
    )?;
    validate_choice(
        input.pov_type.as_deref(),
        &[
            "first_person",
            "third_person_limited",
            "third_person_omniscient",
        ],
        "povType",
    )?;
    validate_choice(
        input.tense_type.as_deref(),
        &["past", "present"],
        "tenseType",
    )?;
    validate_choice(
        input.pace_level.as_deref(),
        &["slow", "medium", "fast"],
        "paceLevel",
    )?;
    validate_choice(
        input.battle_intensity.as_deref(),
        &["low", "medium", "high"],
        "battleIntensity",
    )
}

fn list_with(
    connection: &Connection,
    project_id: Option<&str>,
) -> Result<Vec<OutputProfileDto>, String> {
    let sql = match project_id {
        Some(_) => format!(
            "{} WHERE novel_id IS NULL OR novel_id = ?1 ORDER BY is_default DESC, updated_at DESC, id ASC",
            SELECT_OUTPUT_PROFILE
        ),
        None => format!(
            "{} ORDER BY is_default DESC, updated_at DESC, id ASC",
            SELECT_OUTPUT_PROFILE
        ),
    };
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = match project_id {
        Some(project_id) => statement
            .query_map(params![project_id], map_row)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>(),
        None => statement
            .query_map([], map_row)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>(),
    };
    rows.map_err(|error| format!("输出控制方案读取失败: {}", error))
}

fn save_with(
    connection: &mut Connection,
    mut input: SaveOutputProfileInput,
) -> Result<OutputProfileDto, String> {
    input.name = input.name.trim().to_string();
    input.novel_id = input.novel_id.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    validate_input(&input)?;

    let id = input
        .id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let existing_owner = transaction
        .query_row(
            "SELECT novel_id FROM output_profiles WHERE id = ?1",
            params![id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if existing_owner.is_some() && existing_owner != Some(input.novel_id.clone()) {
        return Err("输出控制方案归属不可修改".to_string());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let forbidden_json = serde_json::to_string(&input.forbidden_items.clone().unwrap_or_default())
        .map_err(|error| error.to_string())?;
    if input.is_default.unwrap_or(false) {
        match input.novel_id.as_deref() {
            Some(novel_id) => transaction
                .execute(
                    "UPDATE output_profiles SET is_default = 0, updated_at = ?2 WHERE novel_id = ?1",
                    params![novel_id, now],
                )
                .map_err(|error| error.to_string())?,
            None => transaction
                .execute(
                    "UPDATE output_profiles SET is_default = 0, updated_at = ?1 WHERE novel_id IS NULL",
                    params![now],
                )
                .map_err(|error| error.to_string())?,
        };
    }
    transaction
        .execute(
            "INSERT INTO output_profiles (
                id, novel_id, name, description, target_word_count, min_word_count,
                max_word_count, paragraph_length, pov_type, tense_type, pace_level,
                dialogue_ratio, description_ratio, battle_intensity, emotion_tendency,
                ending_hook_required, extra_requirements, forbidden_items, is_default,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                       ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                target_word_count = excluded.target_word_count,
                min_word_count = excluded.min_word_count,
                max_word_count = excluded.max_word_count,
                paragraph_length = excluded.paragraph_length,
                pov_type = excluded.pov_type,
                tense_type = excluded.tense_type,
                pace_level = excluded.pace_level,
                dialogue_ratio = excluded.dialogue_ratio,
                description_ratio = excluded.description_ratio,
                battle_intensity = excluded.battle_intensity,
                emotion_tendency = excluded.emotion_tendency,
                ending_hook_required = excluded.ending_hook_required,
                extra_requirements = excluded.extra_requirements,
                forbidden_items = excluded.forbidden_items,
                is_default = excluded.is_default,
                updated_at = excluded.updated_at",
            params![
                id,
                input.novel_id,
                input.name,
                input.description,
                input.target_word_count,
                input.min_word_count,
                input.max_word_count,
                input.paragraph_length,
                input.pov_type,
                input.tense_type,
                input.pace_level,
                input.dialogue_ratio,
                input.description_ratio,
                input.battle_intensity,
                input.emotion_tendency,
                input.ending_hook_required.unwrap_or(false) as i64,
                input.extra_requirements,
                forbidden_json,
                input.is_default.unwrap_or(false) as i64,
                now,
                now,
            ],
        )
        .map_err(|error| format!("输出控制方案保存失败: {}", error))?;
    let result = transaction
        .query_row(
            &format!("{} WHERE id = ?1", SELECT_OUTPUT_PROFILE),
            params![id],
            map_row,
        )
        .map_err(|error| format!("输出控制方案保存结果读取失败: {}", error))?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn list_output_profiles(project_id: Option<String>) -> Result<Vec<OutputProfileDto>, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    list_with(&connection, project_id.as_deref())
}

#[tauri::command]
pub fn save_output_profile(input: SaveOutputProfileInput) -> Result<OutputProfileDto, String> {
    let mut connection = get_connection().lock().map_err(|error| error.to_string())?;
    save_with(&mut connection, input)
}

#[tauri::command]
pub fn delete_output_profile(output_profile_id: String) -> Result<(), String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM output_profiles WHERE id = ?1",
            params![output_profile_id],
        )
        .map_err(|error| format!("输出控制方案删除失败: {}", error))?;
    Ok(())
}

#[tauri::command]
pub fn set_default_output_profile(input: SetDefaultOutputProfileInput) -> Result<(), String> {
    let mut connection = get_connection().lock().map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let owner = transaction
        .query_row(
            "SELECT novel_id FROM output_profiles WHERE id = ?1",
            params![input.output_profile_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if !matches!(owner, Some(Some(ref novel_id)) if novel_id == &input.novel_id) {
        return Err("输出控制方案不存在或不属于当前作品".to_string());
    }
    let now = chrono::Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE output_profiles
                SET is_default = CASE WHEN id = ?2 THEN 1 ELSE 0 END,
                    updated_at = ?3
              WHERE novel_id = ?1",
            params![input.novel_id, input.output_profile_id, now],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE output_profiles (
                    id TEXT PRIMARY KEY, novel_id TEXT, name TEXT NOT NULL,
                    description TEXT, target_word_count INTEGER, min_word_count INTEGER,
                    max_word_count INTEGER, paragraph_length TEXT, pov_type TEXT,
                    tense_type TEXT, pace_level TEXT, dialogue_ratio REAL,
                    description_ratio REAL, battle_intensity TEXT, emotion_tendency TEXT,
                    ending_hook_required INTEGER NOT NULL DEFAULT 0, extra_requirements TEXT,
                    forbidden_items TEXT, is_default INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );",
            )
            .unwrap();
        connection
    }

    fn input(id: &str, novel_id: Option<&str>, name: &str) -> SaveOutputProfileInput {
        SaveOutputProfileInput {
            id: Some(id.to_string()),
            novel_id: novel_id.map(str::to_string),
            name: name.to_string(),
            description: None,
            target_word_count: Some(4_000),
            min_word_count: Some(3_000),
            max_word_count: Some(6_000),
            paragraph_length: Some("medium".to_string()),
            pov_type: Some("third_person_limited".to_string()),
            tense_type: Some("past".to_string()),
            pace_level: Some("medium".to_string()),
            dialogue_ratio: Some(0.35),
            description_ratio: Some(0.4),
            battle_intensity: Some("medium".to_string()),
            emotion_tendency: None,
            ending_hook_required: Some(true),
            extra_requirements: None,
            forbidden_items: Some(vec!["禁项".to_string()]),
            is_default: Some(false),
        }
    }

    #[test]
    fn sqlite_round_trip_includes_shared_and_project_profiles() {
        let mut connection = connection();
        save_with(&mut connection, input("shared", None, "共享")).unwrap();
        save_with(&mut connection, input("project", Some("novel-1"), "作品")).unwrap();
        save_with(&mut connection, input("other", Some("novel-2"), "其他")).unwrap();
        let visible = list_with(&connection, Some("novel-1")).unwrap();
        assert_eq!(visible.len(), 2);
        assert!(visible.iter().any(|profile| profile.id == "shared"));
        assert!(visible.iter().any(|profile| profile.id == "project"));
        assert_eq!(visible[0].forbidden_items, vec!["禁项"]);
    }

    #[test]
    fn save_rejects_owner_drift_and_invalid_numbers() {
        let mut connection = connection();
        save_with(&mut connection, input("profile", Some("novel-1"), "作品")).unwrap();
        assert!(
            save_with(&mut connection, input("profile", Some("novel-2"), "越权"))
                .expect_err("owner drift")
                .contains("归属不可修改")
        );
        let mut invalid = input("invalid", None, "非法");
        invalid.dialogue_ratio = Some(1.5);
        assert!(save_with(&mut connection, invalid).is_err());
    }

    #[test]
    fn saving_a_default_clears_the_previous_default_atomically() {
        let mut connection = connection();
        let mut first = input("first", Some("novel-1"), "一");
        first.is_default = Some(true);
        save_with(&mut connection, first).unwrap();
        let mut second = input("second", Some("novel-1"), "二");
        second.is_default = Some(true);
        save_with(&mut connection, second).unwrap();
        let visible = list_with(&connection, Some("novel-1")).unwrap();
        assert_eq!(
            visible.iter().filter(|profile| profile.is_default).count(),
            1
        );
        assert!(
            visible
                .iter()
                .find(|profile| profile.id == "second")
                .unwrap()
                .is_default
        );
    }
}
