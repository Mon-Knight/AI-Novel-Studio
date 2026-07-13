use crate::db::get_connection;
use rusqlite::params;
use serde::{Deserialize, Serialize};

// ==================== Data Structures ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MasterOutlineDto {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub content: String,
    pub status: String,
    pub version: i64,
    pub is_active: bool,
    pub source_type: String,
    pub context_snapshot: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VolumeOutlineDto {
    pub id: String,
    pub project_id: String,
    pub master_outline_id: Option<String>,
    pub volume_id: Option<String>,
    pub volume_index: i64,
    pub title: String,
    pub content: String,
    pub status: String,
    pub version: i64,
    pub is_active: bool,
    pub source_type: String,
    pub context_snapshot: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterOutlineDto {
    pub id: String,
    pub project_id: String,
    pub volume_outline_id: Option<String>,
    pub chapter_id: Option<String>,
    pub chapter_index: i64,
    pub title: String,
    pub content: String,
    pub status: String,
    pub version: i64,
    pub is_active: bool,
    pub source_type: String,
    pub context_snapshot: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ==================== Input Structs ====================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMasterOutlineInput {
    pub project_id: String,
    pub title: String,
    pub content: String,
    pub source_type: Option<String>,
    pub context_snapshot: Option<String>,
    pub save_as_new_version: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetActiveMasterOutlineInput {
    pub id: String,
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVolumeOutlineInput {
    pub project_id: String,
    pub master_outline_id: Option<String>,
    pub volume_id: Option<String>,
    pub volume_index: Option<i64>,
    pub title: String,
    pub content: String,
    pub source_type: Option<String>,
    pub context_snapshot: Option<String>,
    pub save_as_new_version: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetActiveVolumeOutlineInput {
    pub id: String,
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveChapterOutlineInput {
    pub project_id: String,
    pub volume_outline_id: Option<String>,
    pub chapter_id: Option<String>,
    pub chapter_index: Option<i64>,
    pub title: String,
    pub content: String,
    pub source_type: Option<String>,
    pub context_snapshot: Option<String>,
    pub save_as_new_version: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetActiveChapterOutlineInput {
    pub id: String,
    pub project_id: String,
}

// ==================== Context Output ====================

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OutlineGenerationContext {
    pub novel_title: String,
    pub novel_genre: Option<String>,
    pub description: Option<String>,
    pub target_word_count: Option<i64>,
    pub world_background: Option<String>,
    pub rule_systems: Option<String>,
    pub protagonist_name: Option<String>,
    pub protagonist_identity: Option<String>,
    pub protagonist_personality: Option<String>,
    pub protagonist_goal: Option<String>,
    pub protagonist_ability: Option<String>,
    pub protagonist_ability_limits: Option<String>,
    pub protagonist_forbidden: Option<String>,
    pub active_master_outline: Option<String>,
    pub existing_volumes: Option<String>,
    pub existing_chapters: Option<String>,
    pub style_summary: Option<String>,
    pub output_config_summary: Option<String>,
}

// ==================== Tauri Commands ====================

// --- Master Outline ---

#[tauri::command]
pub fn save_master_outline(input: SaveMasterOutlineInput) -> Result<MasterOutlineDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let source_type = input.source_type.unwrap_or_else(|| "manual".to_string());
    let save_as_new = input.save_as_new_version.unwrap_or(false);

    if save_as_new {
        // Get current max version
        let max_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM master_outlines WHERE project_id = ?1",
                params![&input.project_id],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO master_outlines (id, project_id, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at) VALUES (?1,?2,?3,?4,'draft',?5,0,?6,?7,?8,?8)",
            params![&id, &input.project_id, &input.title, &input.content, max_version + 1, &source_type, &input.context_snapshot, &now],
        ).map_err(|e| e.to_string())?;
        get_master_outline_by_id_internal(&conn, &id)
    } else {
        // Update current active or latest version
        let existing = get_active_master_outline_internal(&conn, &input.project_id);
        if let Ok(current) = existing {
            conn.execute(
                "UPDATE master_outlines SET title = ?1, content = ?2, source_type = ?3, context_snapshot = ?4, updated_at = ?5 WHERE id = ?6",
                params![&input.title, &input.content, &source_type, &input.context_snapshot, &now, &current.id],
            ).map_err(|e| e.to_string())?;
            get_master_outline_by_id_internal(&conn, &current.id)
        } else {
            // Create new
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO master_outlines (id, project_id, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at) VALUES (?1,?2,?3,?4,'draft',1,0,?5,?6,?7,?7)",
                params![&id, &input.project_id, &input.title, &input.content, &source_type, &input.context_snapshot, &now],
            ).map_err(|e| e.to_string())?;
            get_master_outline_by_id_internal(&conn, &id)
        }
    }
}

#[tauri::command]
pub fn get_master_outline(project_id: String) -> Result<Option<MasterOutlineDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    match get_active_master_outline_internal(&conn, &project_id) {
        Ok(dto) => Ok(Some(dto)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn get_master_outline_versions(project_id: String) -> Result<Vec<MasterOutlineDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at FROM master_outlines WHERE project_id = ?1 ORDER BY version DESC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![&project_id], map_master_outline_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn set_active_master_outline(input: SetActiveMasterOutlineInput) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE master_outlines SET is_active = 0 WHERE project_id = ?1",
        params![&input.project_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE master_outlines SET is_active = 1, status = 'active', updated_at = ?1 WHERE id = ?2 AND project_id = ?3",
        params![&chrono::Utc::now().to_rfc3339(), &input.id, &input.project_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// --- Volume Outline ---

#[tauri::command]
pub fn save_volume_outline(input: SaveVolumeOutlineInput) -> Result<VolumeOutlineDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let source_type = input.source_type.unwrap_or_else(|| "manual".to_string());
    let save_as_new = input.save_as_new_version.unwrap_or(false);
    let volume_index = input.volume_index.unwrap_or(1);

    if save_as_new {
        let max_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM volume_outlines WHERE project_id = ?1 AND volume_id IS ?2",
                params![&input.project_id, &input.volume_id],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO volume_outlines (id, project_id, master_outline_id, volume_id, volume_index, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'draft',?8,0,?9,?10,?11,?11)",
            params![&id, &input.project_id, &input.master_outline_id, &input.volume_id, volume_index, &input.title, &input.content, max_version + 1, &source_type, &input.context_snapshot, &now],
        ).map_err(|e| e.to_string())?;
        get_volume_outline_by_id_internal(&conn, &id)
    } else {
        let existing = get_active_volume_outline_by_volume_internal(
            &conn,
            &input.project_id,
            &input.volume_id,
        );
        if let Ok(current) = existing {
            conn.execute(
                "UPDATE volume_outlines SET title = ?1, content = ?2, source_type = ?3, context_snapshot = ?4, updated_at = ?5 WHERE id = ?6",
                params![&input.title, &input.content, &source_type, &input.context_snapshot, &now, &current.id],
            ).map_err(|e| e.to_string())?;
            get_volume_outline_by_id_internal(&conn, &current.id)
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO volume_outlines (id, project_id, master_outline_id, volume_id, volume_index, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'draft',1,0,?8,?9,?10,?10)",
                params![&id, &input.project_id, &input.master_outline_id, &input.volume_id, volume_index, &input.title, &input.content, &source_type, &input.context_snapshot, &now],
            ).map_err(|e| e.to_string())?;
            get_volume_outline_by_id_internal(&conn, &id)
        }
    }
}

#[tauri::command]
pub fn get_volume_outline(
    project_id: String,
    volume_id: Option<String>,
) -> Result<Option<VolumeOutlineDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    match get_active_volume_outline_by_volume_internal(&conn, &project_id, &volume_id) {
        Ok(dto) => Ok(Some(dto)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn get_volume_outline_versions(
    project_id: String,
    volume_id: Option<String>,
) -> Result<Vec<VolumeOutlineDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, master_outline_id, volume_id, volume_index, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at FROM volume_outlines WHERE project_id = ?1 AND (volume_id = ?2 OR (?2 IS NULL AND volume_id IS NULL)) ORDER BY version DESC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![&project_id, &volume_id], map_volume_outline_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn set_active_volume_outline(input: SetActiveVolumeOutlineInput) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE volume_outlines SET is_active = 0 WHERE project_id = ?1",
        params![&input.project_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE volume_outlines SET is_active = 1, status = 'active', updated_at = ?1 WHERE id = ?2 AND project_id = ?3",
        params![&chrono::Utc::now().to_rfc3339(), &input.id, &input.project_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// --- Chapter Outline ---

#[tauri::command]
pub fn save_chapter_outline(input: SaveChapterOutlineInput) -> Result<ChapterOutlineDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let source_type = input.source_type.unwrap_or_else(|| "manual".to_string());
    let save_as_new = input.save_as_new_version.unwrap_or(false);
    let chapter_index = input.chapter_index.unwrap_or(1);

    if save_as_new {
        let max_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM chapter_outlines WHERE project_id = ?1 AND chapter_id IS ?2",
                params![&input.project_id, &input.chapter_id],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO chapter_outlines (id, project_id, volume_outline_id, chapter_id, chapter_index, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'draft',?8,0,?9,?10,?11,?11)",
            params![&id, &input.project_id, &input.volume_outline_id, &input.chapter_id, chapter_index, &input.title, &input.content, max_version + 1, &source_type, &input.context_snapshot, &now],
        ).map_err(|e| e.to_string())?;
        get_chapter_outline_by_id_internal(&conn, &id)
    } else {
        let existing = get_active_chapter_outline_by_chapter_internal(
            &conn,
            &input.project_id,
            &input.chapter_id,
        );
        if let Ok(current) = existing {
            conn.execute(
                "UPDATE chapter_outlines SET title = ?1, content = ?2, source_type = ?3, context_snapshot = ?4, updated_at = ?5 WHERE id = ?6",
                params![&input.title, &input.content, &source_type, &input.context_snapshot, &now, &current.id],
            ).map_err(|e| e.to_string())?;
            get_chapter_outline_by_id_internal(&conn, &current.id)
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO chapter_outlines (id, project_id, volume_outline_id, chapter_id, chapter_index, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'draft',1,0,?8,?9,?10,?10)",
                params![&id, &input.project_id, &input.volume_outline_id, &input.chapter_id, chapter_index, &input.title, &input.content, &source_type, &input.context_snapshot, &now],
            ).map_err(|e| e.to_string())?;
            get_chapter_outline_by_id_internal(&conn, &id)
        }
    }
}

#[tauri::command]
pub fn get_chapter_outline(
    project_id: String,
    chapter_id: Option<String>,
) -> Result<Option<ChapterOutlineDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    match get_active_chapter_outline_by_chapter_internal(&conn, &project_id, &chapter_id) {
        Ok(dto) => Ok(Some(dto)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn get_chapter_outline_versions(
    project_id: String,
    chapter_id: Option<String>,
) -> Result<Vec<ChapterOutlineDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, volume_outline_id, chapter_id, chapter_index, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at FROM chapter_outlines WHERE project_id = ?1 AND (chapter_id = ?2 OR (?2 IS NULL AND chapter_id IS NULL)) ORDER BY version DESC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![&project_id, &chapter_id], map_chapter_outline_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn set_active_chapter_outline(input: SetActiveChapterOutlineInput) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chapter_outlines SET is_active = 0 WHERE project_id = ?1",
        params![&input.project_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chapter_outlines SET is_active = 1, status = 'active', updated_at = ?1 WHERE id = ?2 AND project_id = ?3",
        params![&chrono::Utc::now().to_rfc3339(), &input.id, &input.project_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== Context Builder Command ====================

#[tauri::command]
pub fn build_outline_context(project_id: String) -> Result<OutlineGenerationContext, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;

    // Read novel
    let novel_title: String = conn
        .query_row(
            "SELECT title FROM novels WHERE id = ?1 AND deleted_at IS NULL",
            params![&project_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "未命名作品".to_string());
    let novel_genre: Option<String> = conn
        .query_row(
            "SELECT genre FROM novels WHERE id = ?1",
            params![&project_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    let description: Option<String> = conn
        .query_row(
            "SELECT description FROM novels WHERE id = ?1",
            params![&project_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    let target_word_count: Option<i64> = conn
        .query_row(
            "SELECT target_word_count FROM novels WHERE id = ?1",
            params![&project_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();

    // Read world settings
    let world_background = conn
        .query_row(
            "SELECT content FROM world_settings WHERE novel_id = ?1 AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
            params![&project_id], |r| r.get::<_, String>(0),
        ).ok().map(|s| s.chars().take(2000).collect::<String>());

    // Read rule systems
    let rule_systems: Option<String> = {
        let mut stmt = conn
            .prepare("SELECT title, content FROM rule_systems WHERE novel_id = ?1 AND is_active = 1 LIMIT 10")
            .ok();
        if let Some(mut s) = stmt {
            let items: Vec<String> = s
                .query_map(params![&project_id], |r| {
                    let t: String = r.get(0)?;
                    let c: String = r.get(1)?;
                    Ok(format!(
                        "《{}》{}",
                        t,
                        c.chars().take(300).collect::<String>()
                    ))
                })
                .ok()
                .map(|iter| iter.filter_map(|i| i.ok()).collect())
                .unwrap_or_default();
            if items.is_empty() {
                None
            } else {
                Some(items.join("\n"))
            }
        } else {
            None
        }
    };

    // Read protagonist
    let (protagonist_name, protagonist_identity, protagonist_personality, protagonist_goal,
         protagonist_ability, protagonist_ability_limits, protagonist_forbidden) = conn
        .query_row(
            "SELECT name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors FROM protagonists WHERE novel_id = ?1 LIMIT 1",
            params![&project_id],
            |r| Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            )),
        ).unwrap_or((None, None, None, None, None, None, None));

    // Read active master outline
    let active_master_outline: Option<String> =
        get_active_master_outline_internal(&conn, &project_id)
            .ok()
            .map(|dto| dto.content);

    // Read existing volumes
    let existing_volumes: Option<String> = {
        let mut stmt = conn
            .prepare("SELECT title, summary, goal FROM volumes WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index ASC")
            .ok();
        if let Some(mut s) = stmt {
            let items: Vec<String> = s
                .query_map(params![&project_id], |r| {
                    let t: String = r.get(0)?;
                    let sum: Option<String> = r.get(1)?;
                    let g: Option<String> = r.get(2)?;
                    Ok(format!(
                        "- {}：{}",
                        t,
                        sum.or(g).unwrap_or_else(|| "暂无摘要".to_string())
                    ))
                })
                .ok()
                .map(|iter| iter.filter_map(|i| i.ok()).collect())
                .unwrap_or_default();
            if items.is_empty() {
                None
            } else {
                Some(items.join("\n"))
            }
        } else {
            None
        }
    };

    // Read existing chapters
    let existing_chapters: Option<String> = {
        let mut stmt = conn
            .prepare("SELECT title, outline, goal FROM chapters WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index ASC LIMIT 50")
            .ok();
        if let Some(mut s) = stmt {
            let items: Vec<String> = s
                .query_map(params![&project_id], |r| {
                    let t: String = r.get(0)?;
                    let o: Option<String> = r.get(1)?;
                    let g: Option<String> = r.get(2)?;
                    let desc = o.or(g).unwrap_or_else(|| "暂无".to_string());
                    Ok(format!(
                        "- {}：{}",
                        t,
                        desc.chars().take(200).collect::<String>()
                    ))
                })
                .ok()
                .map(|iter| iter.filter_map(|i| i.ok()).collect())
                .unwrap_or_default();
            if items.is_empty() {
                None
            } else {
                Some(items.join("\n"))
            }
        } else {
            None
        }
    };

    // Read style/profile summary
    let style_summary: Option<String> = {
        let mut stmt = conn
            .prepare("SELECT style_summary, narrative_perspective, tone, pace, dialogue_ratio, description_ratio, forbidden_styles, battle_intensity, emotion_tendency FROM style_profiles WHERE novel_id = ?1 AND is_active = 1 ORDER BY updated_at DESC LIMIT 1")
            .ok();
        if let Some(mut s) = stmt {
            s.query_row(params![&project_id], |r| {
                let summary: Option<String> = r.get(0)?;
                let np: Option<String> = r.get(1)?;
                let tone: Option<String> = r.get(2)?;
                let pace: Option<String> = r.get(3)?;
                let dr: f64 = r.get(4)?;
                let der: f64 = r.get(5)?;
                let fs: Option<String> = r.get(6)?;
                let bi: Option<String> = r.get(7)?;
                let et: Option<String> = r.get(8)?;
                let parts: Vec<String> = vec![
                    np.map(|v| format!("叙事人称：{}", v)),
                    tone.map(|v| format!("文风：{}", v)),
                    pace.map(|v| format!("节奏：{}", v)),
                    Some(format!(
                        "对话比例：{}%，描写比例：{}%",
                        (dr * 100.0) as i32,
                        (der * 100.0) as i32
                    )),
                    bi.map(|v| format!("战斗强度：{}", v)),
                    et.map(|v| format!("情绪倾向：{}", v)),
                    summary.map(|v| format!("总结：{}", v)),
                    fs.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
                        .filter(|v| !v.is_empty())
                        .map(|v| format!("禁用：{}", v.join("、"))),
                ]
                .into_iter()
                .flatten()
                .collect();
                Ok::<Option<String>, rusqlite::Error>(if parts.is_empty() {
                    None
                } else {
                    Some(parts.join("\n"))
                })
            })
            .ok()
            .flatten()
        } else {
            None
        }
    };

    let output_config_summary: Option<String> = conn
        .query_row(
            "SELECT extra_requirements FROM output_profiles WHERE novel_id = ?1 AND is_default = 1 ORDER BY updated_at DESC LIMIT 1",
            params![&project_id], |r| r.get::<_, Option<String>>(0),
        ).ok().flatten();

    Ok(OutlineGenerationContext {
        novel_title,
        novel_genre,
        description,
        target_word_count,
        world_background,
        rule_systems,
        protagonist_name,
        protagonist_identity,
        protagonist_personality,
        protagonist_goal,
        protagonist_ability,
        protagonist_ability_limits,
        protagonist_forbidden,
        active_master_outline,
        existing_volumes,
        existing_chapters,
        style_summary,
        output_config_summary,
    })
}

// ==================== Database Initialization ====================

pub fn create_outline_tables(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS master_outlines (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            version INTEGER NOT NULL DEFAULT 1,
            is_active INTEGER NOT NULL DEFAULT 0,
            source_type TEXT NOT NULL DEFAULT 'manual',
            context_snapshot TEXT,
            large_text_ref_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS volume_outlines (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            master_outline_id TEXT,
            volume_id TEXT,
            volume_index INTEGER NOT NULL DEFAULT 1,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            version INTEGER NOT NULL DEFAULT 1,
            is_active INTEGER NOT NULL DEFAULT 0,
            source_type TEXT NOT NULL DEFAULT 'manual',
            context_snapshot TEXT,
            large_text_ref_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chapter_outlines (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            volume_outline_id TEXT,
            chapter_id TEXT,
            chapter_index INTEGER NOT NULL DEFAULT 1,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            version INTEGER NOT NULL DEFAULT 1,
            is_active INTEGER NOT NULL DEFAULT 0,
            source_type TEXT NOT NULL DEFAULT 'manual',
            context_snapshot TEXT,
            large_text_ref_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_master_outlines_project
        ON master_outlines(project_id, is_active);

        CREATE INDEX IF NOT EXISTS idx_volume_outlines_project
        ON volume_outlines(project_id, volume_id, volume_index);

        CREATE INDEX IF NOT EXISTS idx_chapter_outlines_project
        ON chapter_outlines(project_id, chapter_id, chapter_index);
        ",
    )?;
    Ok(())
}

// ==================== Row Mappers ====================

fn map_master_outline_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MasterOutlineDto> {
    let is_active: i64 = row.get(6)?;
    Ok(MasterOutlineDto {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        status: row.get(4)?,
        version: row.get(5)?,
        is_active: is_active != 0,
        source_type: row.get(7)?,
        context_snapshot: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn map_volume_outline_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VolumeOutlineDto> {
    let is_active: i64 = row.get(9)?;
    Ok(VolumeOutlineDto {
        id: row.get(0)?,
        project_id: row.get(1)?,
        master_outline_id: row.get(2)?,
        volume_id: row.get(3)?,
        volume_index: row.get(4)?,
        title: row.get(5)?,
        content: row.get(6)?,
        status: row.get(7)?,
        version: row.get(8)?,
        is_active: is_active != 0,
        source_type: row.get(10)?,
        context_snapshot: row.get(11)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn map_chapter_outline_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChapterOutlineDto> {
    let is_active: i64 = row.get(9)?;
    Ok(ChapterOutlineDto {
        id: row.get(0)?,
        project_id: row.get(1)?,
        volume_outline_id: row.get(2)?,
        chapter_id: row.get(3)?,
        chapter_index: row.get(4)?,
        title: row.get(5)?,
        content: row.get(6)?,
        status: row.get(7)?,
        version: row.get(8)?,
        is_active: is_active != 0,
        source_type: row.get(10)?,
        context_snapshot: row.get(11)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

// ==================== Internal Helpers ====================

fn get_master_outline_by_id_internal(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<MasterOutlineDto, String> {
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at FROM master_outlines WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_master_outline_row)
        .map_err(|e| e.to_string())
}

fn get_active_master_outline_internal(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<MasterOutlineDto, String> {
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at FROM master_outlines WHERE project_id = ?1 AND is_active = 1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![project_id], map_master_outline_row)
        .map_err(|e| e.to_string())
}

fn get_volume_outline_by_id_internal(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<VolumeOutlineDto, String> {
    let mut stmt = conn
        .prepare("SELECT id, project_id, master_outline_id, volume_id, volume_index, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at FROM volume_outlines WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_volume_outline_row)
        .map_err(|e| e.to_string())
}

fn get_active_volume_outline_by_volume_internal(
    conn: &rusqlite::Connection,
    project_id: &str,
    volume_id: &Option<String>,
) -> Result<VolumeOutlineDto, String> {
    let mut stmt = conn
        .prepare("SELECT id, project_id, master_outline_id, volume_id, volume_index, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at FROM volume_outlines WHERE project_id = ?1 AND is_active = 1 AND (volume_id = ?2 OR (?2 IS NULL AND volume_id IS NULL)) LIMIT 1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![project_id, volume_id], map_volume_outline_row)
        .map_err(|e| e.to_string())
}

fn get_chapter_outline_by_id_internal(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<ChapterOutlineDto, String> {
    let mut stmt = conn
        .prepare("SELECT id, project_id, volume_outline_id, chapter_id, chapter_index, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at FROM chapter_outlines WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_chapter_outline_row)
        .map_err(|e| e.to_string())
}

fn get_active_chapter_outline_by_chapter_internal(
    conn: &rusqlite::Connection,
    project_id: &str,
    chapter_id: &Option<String>,
) -> Result<ChapterOutlineDto, String> {
    let mut stmt = conn
        .prepare("SELECT id, project_id, volume_outline_id, chapter_id, chapter_index, title, content, status, version, is_active, source_type, context_snapshot, created_at, updated_at FROM chapter_outlines WHERE project_id = ?1 AND is_active = 1 AND (chapter_id = ?2 OR (?2 IS NULL AND chapter_id IS NULL)) LIMIT 1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![project_id, chapter_id], map_chapter_outline_row)
        .map_err(|e| e.to_string())
}
