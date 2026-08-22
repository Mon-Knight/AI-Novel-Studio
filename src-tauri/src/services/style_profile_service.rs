use crate::domain::ai::{SaveStyleProfileInput, SetActiveStyleProfileInput, StyleProfileDto};
use crate::repositories::style_profile_repository;
use rusqlite::{params, Connection};

pub fn list_style_profiles(
    conn: &Connection,
    project_id: Option<&str>,
) -> Result<Vec<StyleProfileDto>, String> {
    style_profile_repository::list_style_profiles(conn, project_id)
}

pub fn get_active_style_profile(
    conn: &Connection,
    project_id: &str,
) -> Result<Option<StyleProfileDto>, String> {
    style_profile_repository::find_active_style_profile(conn, project_id)
}

pub fn save_style_profile(
    conn: &Connection,
    id: Option<String>,
    input: SaveStyleProfileInput,
) -> Result<StyleProfileDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let forbidden_json = serde_json::to_string(&input.forbidden_styles.unwrap_or_default())
        .unwrap_or_else(|_| "[]".to_string());
    let source_type = input.source_type.unwrap_or_else(|| "manual".to_string());
    let source_state = input.source_state.clone().unwrap_or_else(|| {
        if input.source_reference_import_id.is_some() {
            "available".to_string()
        } else {
            "none".to_string()
        }
    });
    if !matches!(
        source_state.as_str(),
        "none" | "available" | "outdated" | "missing" | "legacy_unverified"
    ) {
        return Err("REFERENCE_INPUT_INVALID: invalid style source state".to_string());
    }
    if let Some(metadata) = input.analysis_metadata_json.as_deref() {
        let parsed = serde_json::from_str::<serde_json::Value>(metadata)
            .map_err(|_| "REFERENCE_INPUT_INVALID: invalid analysis metadata".to_string())?;
        if !parsed.is_object() || metadata.len() > 500_000 {
            return Err("REFERENCE_INPUT_INVALID: invalid analysis metadata".to_string());
        }
    }
    let reference_fields = [
        input.source_reference_work_id.as_deref(),
        input.source_reference_import_id.as_deref(),
        input.source_content_sha256.as_deref(),
    ];
    let populated_reference_fields = reference_fields
        .iter()
        .filter(|value| value.is_some())
        .count();
    if populated_reference_fields != 0 && populated_reference_fields != reference_fields.len() {
        return Err("REFERENCE_INPUT_INVALID: incomplete style reference identity".to_string());
    }
    if populated_reference_fields == reference_fields.len() {
        let source_hash = input.source_content_sha256.as_deref().unwrap_or_default();
        if source_hash.len() != 64
            || !source_hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("REFERENCE_INPUT_INVALID: invalid style source hash".to_string());
        }
        let valid_scope: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM reference_imports i
                 INNER JOIN reference_works w
                   ON w.id = i.reference_work_id AND w.novel_id = i.novel_id
                 WHERE w.novel_id = ?1 AND w.id = ?2 AND i.id = ?3 AND i.source_sha256 = ?4
                   AND (?5 <> 'available' OR i.is_current = 1)",
                params![
                    input.project_id,
                    input.source_reference_work_id,
                    input.source_reference_import_id,
                    input.source_content_sha256,
                    source_state,
                ],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if valid_scope != 1 {
            return Err(
                "REFERENCE_SCOPE_MISMATCH: style reference does not belong to project".to_string(),
            );
        }
    }
    let source_state_update = if populated_reference_fields == reference_fields.len() {
        Some(source_state.clone())
    } else {
        input.source_state.clone()
    };

    if let Some(existing_id) = id {
        conn.execute(
            "UPDATE style_profiles SET name = ?1, description = ?2, narrative_perspective = ?3, tone = ?4, pace = ?5, sentence_style = ?6, dialogue_ratio = ?7, description_ratio = ?8, psychological_ratio = ?9, battle_style = ?10, battle_intensity = ?11, emotion_tendency = ?12, chapter_ending = ?13, forbidden_styles = ?14, style_summary = ?15, raw_config_json = ?16, source_type = ?17, updated_at = ?18, source_asset_id = COALESCE(?21, source_asset_id), source_reference_work_id = COALESCE(?22, source_reference_work_id), source_reference_import_id = COALESCE(?23, source_reference_import_id), source_content_sha256 = COALESCE(?24, source_content_sha256), source_state = COALESCE(?25, source_state), analysis_metadata_json = COALESCE(?26, analysis_metadata_json) WHERE id = ?19 AND novel_id = ?20",
            params![
                &input.name, &input.description,
                &input.narrative_perspective, &input.tone, &input.pace, &input.sentence_style,
                input.dialogue_ratio.unwrap_or(0.35), input.description_ratio.unwrap_or(0.4),
                input.psychological_ratio, &input.battle_style, &input.battle_intensity,
                &input.emotion_tendency, &input.chapter_ending,
                &forbidden_json, &input.style_summary, &input.raw_config_json,
                &source_type, &now, &existing_id, &input.project_id,
                &input.source_asset_id, &input.source_reference_work_id,
                &input.source_reference_import_id, &input.source_content_sha256,
                &source_state_update, &input.analysis_metadata_json,
            ],
        ).map_err(|e| e.to_string())?;
        style_profile_repository::find_style_profile_by_id(conn, &existing_id)
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO style_profiles (id, novel_id, name, description, narrative_perspective, tone, pace, sentence_style, dialogue_ratio, description_ratio, psychological_ratio, battle_style, battle_intensity, emotion_tendency, chapter_ending, forbidden_styles, style_summary, is_active, raw_config_json, source_type, created_at, updated_at, source_asset_id, source_reference_work_id, source_reference_import_id, source_content_sha256, source_state, analysis_metadata_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,0,?18,?19,?20,?20,?21,?22,?23,?24,?25,?26)",
            params![
                &new_id, &input.project_id, &input.name, &input.description,
                &input.narrative_perspective, &input.tone, &input.pace, &input.sentence_style,
                input.dialogue_ratio.unwrap_or(0.35), input.description_ratio.unwrap_or(0.4),
                input.psychological_ratio, &input.battle_style, &input.battle_intensity,
                &input.emotion_tendency, &input.chapter_ending,
                &forbidden_json, &input.style_summary, &input.raw_config_json,
                &source_type, &now,
                &input.source_asset_id, &input.source_reference_work_id,
                &input.source_reference_import_id, &input.source_content_sha256,
                &source_state, &input.analysis_metadata_json,
            ],
        ).map_err(|e| e.to_string())?;
        style_profile_repository::find_style_profile_by_id(conn, &new_id)
    }
}

pub fn set_active_style_profile(
    conn: &Connection,
    input: SetActiveStyleProfileInput,
) -> Result<(), String> {
    style_profile_repository::deactivate_all_style_profiles_for_novel(conn, &input.project_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    style_profile_repository::activate_style_profile_row(
        conn,
        &input.style_profile_id,
        &input.project_id,
        &now,
    )
}

pub fn delete_style_profile(
    conn: &Connection,
    project_id: &str,
    style_profile_id: &str,
) -> Result<(), String> {
    let was_active =
        style_profile_repository::delete_style_profile_row(conn, style_profile_id, project_id)?;
    if was_active {
        if let Some(new_active_id) =
            style_profile_repository::find_latest_remaining_style_profile_id(conn, project_id)?
        {
            let now = chrono::Utc::now().to_rfc3339();
            let _ = style_profile_repository::activate_style_profile_row(
                conn,
                &new_active_id,
                project_id,
                &now,
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::create_tables(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO novels (id, title, created_at, updated_at) VALUES ('11111111-1111-1111-1111-111111111111', '测试小说', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_style_profile_crud_and_activation() {
        let conn = setup_test_db();
        let input = SaveStyleProfileInput {
            project_id: "11111111-1111-1111-1111-111111111111".to_string(),
            name: "热血玄幻风".to_string(),
            description: Some("快节奏爽文风格".to_string()),
            narrative_perspective: Some("third".to_string()),
            tone: Some("passionate".to_string()),
            pace: Some("fast".to_string()),
            sentence_style: Some("concise".to_string()),
            dialogue_ratio: Some(0.4),
            description_ratio: Some(0.4),
            psychological_ratio: Some(0.2),
            battle_style: Some("detailed".to_string()),
            battle_intensity: Some("high".to_string()),
            emotion_tendency: Some("positive".to_string()),
            chapter_ending: Some("cliffhanger".to_string()),
            forbidden_styles: Some(vec!["水文".to_string()]),
            style_summary: Some("简洁明快，战斗刺激".to_string()),
            raw_config_json: None,
            source_type: Some("manual".to_string()),
            source_asset_id: None,
            source_reference_work_id: None,
            source_reference_import_id: None,
            source_content_sha256: None,
            source_state: None,
            analysis_metadata_json: None,
        };

        let profile = save_style_profile(&conn, None, input).unwrap();
        assert_eq!(profile.name, "热血玄幻风");
        assert_eq!(profile.is_active, false);

        set_active_style_profile(
            &conn,
            SetActiveStyleProfileInput {
                project_id: "11111111-1111-1111-1111-111111111111".to_string(),
                style_profile_id: profile.id.clone(),
            },
        )
        .unwrap();

        let active = get_active_style_profile(&conn, "11111111-1111-1111-1111-111111111111")
            .unwrap()
            .unwrap();
        assert_eq!(active.id, profile.id);

        delete_style_profile(&conn, "11111111-1111-1111-1111-111111111111", &profile.id).unwrap();
        let remaining =
            list_style_profiles(&conn, Some("11111111-1111-1111-1111-111111111111")).unwrap();
        assert_eq!(remaining.len(), 0);
    }
}
