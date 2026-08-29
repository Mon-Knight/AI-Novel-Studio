use crate::domain::ai::StyleProfileDto;
use rusqlite::{params, Connection, Row};

pub const STYLE_PROFILE_SELECT: &str = "SELECT id, novel_id, name, description, narrative_perspective, tone, pace, sentence_style, dialogue_ratio, description_ratio, psychological_ratio, battle_style, battle_intensity, emotion_tendency, chapter_ending, forbidden_styles, style_summary, is_active, raw_config_json, source_type, created_at, updated_at, source_asset_id, source_reference_work_id, source_reference_import_id, source_content_sha256, source_state, analysis_metadata_json FROM style_profiles";

pub fn style_select_sql() -> &'static str {
    STYLE_PROFILE_SELECT
}

pub fn map_style_profile_row(row: &Row<'_>) -> rusqlite::Result<StyleProfileDto> {
    let is_active: i64 = row.get(17)?;
    Ok(StyleProfileDto {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        narrative_perspective: row.get(4)?,
        tone: row.get(5)?,
        pace: row.get(6)?,
        sentence_style: row.get(7)?,
        dialogue_ratio: row.get::<_, f64>(8)?,
        description_ratio: row.get::<_, f64>(9)?,
        psychological_ratio: row.get(10)?,
        battle_style: row.get(11)?,
        battle_intensity: row.get(12)?,
        emotion_tendency: row.get(13)?,
        chapter_ending: row.get(14)?,
        forbidden_styles_json: row.get(15)?,
        style_summary: row.get(16)?,
        raw_config_json: row.get::<_, Option<String>>(18).unwrap_or(None),
        is_active: is_active != 0,
        source_type: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
        source_asset_id: row.get(22)?,
        source_reference_work_id: row.get(23)?,
        source_reference_import_id: row.get(24)?,
        source_content_sha256: row.get(25)?,
        source_state: row.get(26)?,
        analysis_metadata_json: row.get(27)?,
    })
}

pub fn find_style_profile_by_id(conn: &Connection, id: &str) -> Result<StyleProfileDto, String> {
    let sql = format!("{STYLE_PROFILE_SELECT} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_style_profile_row)
        .map_err(|e| e.to_string())
}

pub fn list_style_profiles(
    conn: &Connection,
    project_id: Option<&str>,
) -> Result<Vec<StyleProfileDto>, String> {
    let sql = match project_id {
        Some(_) => format!(
            "{STYLE_PROFILE_SELECT} WHERE novel_id IS NULL OR novel_id = ?1 ORDER BY CASE WHEN novel_id = ?1 THEN 0 ELSE 1 END, is_active DESC, updated_at DESC"
        ),
        None => format!("{STYLE_PROFILE_SELECT} ORDER BY is_active DESC, updated_at DESC"),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = if let Some(project_id) = project_id {
        stmt.query_map(params![project_id], map_style_profile_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        stmt.query_map([], map_style_profile_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    Ok(items)
}

pub fn find_active_style_profile(
    conn: &Connection,
    project_id: &str,
) -> Result<Option<StyleProfileDto>, String> {
    let sql = format!(
        "{STYLE_PROFILE_SELECT} WHERE (novel_id = ?1 OR novel_id IS NULL) AND is_active = 1 ORDER BY CASE WHEN novel_id = ?1 THEN 0 ELSE 1 END, updated_at DESC LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    match stmt.query_row(params![project_id], map_style_profile_row) {
        Ok(dto) => Ok(Some(dto)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn select_active_style_profile_for_scope(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    now: &str,
) -> Result<(), String> {
    let updated = if novel_id.trim().is_empty() {
        conn.execute(
            "UPDATE style_profiles SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END, updated_at = CASE WHEN id = ?1 THEN ?2 ELSE updated_at END WHERE novel_id IS NULL",
            params![id, now],
        )
    } else {
        conn.execute(
            "UPDATE style_profiles SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END, updated_at = CASE WHEN id = ?1 THEN ?2 ELSE updated_at END WHERE novel_id = ?3",
            params![id, now, novel_id.trim()],
        )
    }
    .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err("风格方案不存在或不属于当前作品".to_string());
    }
    Ok(())
}

pub fn activate_style_profile_row(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    now: &str,
) -> Result<(), String> {
    let updated = if novel_id.trim().is_empty() {
        conn.execute(
            "UPDATE style_profiles SET is_active = 1, updated_at = ?1 WHERE id = ?2 AND novel_id IS NULL",
            params![now, id],
        )
    } else {
        conn.execute(
            "UPDATE style_profiles SET is_active = 1, updated_at = ?1 WHERE id = ?2 AND novel_id = ?3",
            params![now, id, novel_id.trim()],
        )
    }
    .map_err(|e| e.to_string())?;
    if updated != 1 {
        return Err("风格方案不存在或不属于当前作品".to_string());
    }
    Ok(())
}

pub fn delete_style_profile_row(
    conn: &Connection,
    id: &str,
    novel_id: &str,
) -> Result<bool, String> {
    let global_scope = novel_id.trim().is_empty();
    let is_active: i64 = if global_scope {
        conn.query_row(
            "SELECT is_active FROM style_profiles WHERE id = ?1 AND novel_id IS NULL",
            params![id],
            |r| r.get(0),
        )
    } else {
        conn.query_row(
            "SELECT is_active FROM style_profiles WHERE id = ?1 AND novel_id = ?2",
            params![id, novel_id.trim()],
            |r| r.get(0),
        )
    }
    .map_err(|e| e.to_string())?;

    if global_scope {
        conn.execute(
            "DELETE FROM style_profiles WHERE id = ?1 AND novel_id IS NULL",
            params![id],
        )
    } else {
        conn.execute(
            "DELETE FROM style_profiles WHERE id = ?1 AND novel_id = ?2",
            params![id, novel_id.trim()],
        )
    }
    .map_err(|e| e.to_string())?;

    Ok(is_active != 0)
}

pub fn find_latest_remaining_style_profile_id(
    conn: &Connection,
    novel_id: &str,
) -> Result<Option<String>, String> {
    let latest: Option<String> = if novel_id.trim().is_empty() {
        conn.query_row(
            "SELECT id FROM style_profiles WHERE novel_id IS NULL ORDER BY updated_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
    } else {
        conn.query_row(
            "SELECT id FROM style_profiles WHERE novel_id = ?1 ORDER BY updated_at DESC LIMIT 1",
            params![novel_id.trim()],
            |r| r.get(0),
        )
    }
    .ok();
    Ok(latest)
}
