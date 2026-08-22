use crate::domain::ai::{
    ChapterEngineeringStateDto, ChapterGenerationSnapshotDto, SaveChapterEngineeringDraftInput,
    SaveChapterGenerationSnapshotInput,
};
use rusqlite::{params, Connection, Row};

pub const CHAPTER_ENGINEERING_SELECT: &str = "SELECT id, novel_id, volume_id, chapter_id, chapter_card_json, scene_plan_json, generation_constraints_json, quality_rules_json, draft_version, active_version, status, created_at, updated_at, activated_at FROM chapter_engineering_states";

pub const CHAPTER_GENERATION_SNAPSHOT_SELECT: &str = "SELECT id, novel_id, volume_id, chapter_id, engineering_state_id, style_profile_id, output_profile_id, compiled_context_json, compiled_prompt_text, prompt_summary, context_hash, sources_json, created_at FROM chapter_generation_snapshots";

pub fn map_chapter_engineering_state_row(
    row: &Row<'_>,
) -> rusqlite::Result<ChapterEngineeringStateDto> {
    Ok(ChapterEngineeringStateDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        volume_id: row.get(2)?,
        chapter_id: row.get(3)?,
        chapter_card_json: row.get(4)?,
        scene_plan_json: row.get(5)?,
        generation_constraints_json: row.get(6)?,
        quality_rules_json: row.get(7)?,
        draft_version: row.get(8)?,
        active_version: row.get(9)?,
        status: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        activated_at: row.get(13)?,
    })
}

pub fn map_chapter_generation_snapshot_row(
    row: &Row<'_>,
) -> rusqlite::Result<ChapterGenerationSnapshotDto> {
    Ok(ChapterGenerationSnapshotDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        volume_id: row.get(2)?,
        chapter_id: row.get(3)?,
        engineering_state_id: row.get(4)?,
        style_profile_id: row.get(5)?,
        output_profile_id: row.get(6)?,
        compiled_context_json: row.get(7)?,
        compiled_prompt_text: row.get(8)?,
        prompt_summary: row.get(9)?,
        context_hash: row.get(10)?,
        sources_json: row.get(11)?,
        created_at: row.get(12)?,
    })
}

pub fn find_engineering_state_by_id(
    conn: &Connection,
    id: &str,
) -> Result<ChapterEngineeringStateDto, String> {
    let sql = format!("{CHAPTER_ENGINEERING_SELECT} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_chapter_engineering_state_row)
        .map_err(|e| e.to_string())
}

pub fn find_engineering_states_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<ChapterEngineeringStateDto>, String> {
    let sql =
        format!("{CHAPTER_ENGINEERING_SELECT} WHERE chapter_id = ?1 ORDER BY draft_version DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_chapter_engineering_state_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_engineering_state_by_chapter_and_status(
    conn: &Connection,
    chapter_id: &str,
    status: &str,
) -> Result<Option<ChapterEngineeringStateDto>, String> {
    let sql = format!("{CHAPTER_ENGINEERING_SELECT} WHERE chapter_id = ?1 AND status = ?2 ORDER BY updated_at DESC LIMIT 1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    match stmt.query_row(
        params![chapter_id, status],
        map_chapter_engineering_state_row,
    ) {
        Ok(state) => Ok(Some(state)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn get_max_engineering_draft_version(
    conn: &Connection,
    chapter_id: &str,
) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(draft_version), 0) FROM chapter_engineering_states WHERE chapter_id = ?1",
        params![chapter_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn get_active_engineering_version(conn: &Connection, chapter_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(active_version), 0) FROM chapter_engineering_states WHERE chapter_id = ?1 AND status = 'active'",
        params![chapter_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn archive_active_engineering_states(
    conn: &Connection,
    chapter_id: &str,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE chapter_engineering_states SET status = 'archived', updated_at = ?1 WHERE chapter_id = ?2 AND status = 'active'",
        params![now, chapter_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn insert_chapter_engineering_state(
    conn: &Connection,
    id: &str,
    input: &SaveChapterEngineeringDraftInput,
    draft_version: i64,
    active_version: i64,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chapter_engineering_states (id, novel_id, volume_id, chapter_id, chapter_card_json, scene_plan_json, generation_constraints_json, quality_rules_json, draft_version, active_version, status, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'draft',?11,?11)",
        params![
            id,
            &input.novel_id,
            &input.volume_id,
            &input.chapter_id,
            &input.chapter_card_json,
            &input.scene_plan_json,
            &input.generation_constraints_json,
            &input.quality_rules_json,
            draft_version,
            active_version,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn activate_chapter_engineering_state_row(
    conn: &Connection,
    id: &str,
    chapter_id: &str,
    draft_version: i64,
    now: &str,
) -> Result<usize, String> {
    conn.execute(
        "UPDATE chapter_engineering_states SET status = 'active', active_version = ?1, updated_at = ?2, activated_at = ?2 WHERE id = ?3 AND chapter_id = ?4",
        params![draft_version, now, id, chapter_id],
    )
    .map_err(|e| e.to_string())
}

pub fn get_draft_version_by_id_and_chapter(
    conn: &Connection,
    id: &str,
    chapter_id: &str,
) -> Result<i64, String> {
    match conn.query_row(
        "SELECT draft_version FROM chapter_engineering_states WHERE id = ?1 AND chapter_id = ?2",
        params![id, chapter_id],
        |row| row.get(0),
    ) {
        Ok(version) => Ok(version),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err("chapter engineering state not found".to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn find_chapter_generation_snapshot_by_id(
    conn: &Connection,
    id: &str,
) -> Result<ChapterGenerationSnapshotDto, String> {
    let sql = format!("{CHAPTER_GENERATION_SNAPSHOT_SELECT} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_chapter_generation_snapshot_row)
        .map_err(|e| e.to_string())
}

pub fn upsert_chapter_generation_snapshot(
    conn: &Connection,
    input: &SaveChapterGenerationSnapshotInput,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO chapter_generation_snapshots (id, novel_id, volume_id, chapter_id, engineering_state_id, style_profile_id, output_profile_id, compiled_context_json, compiled_prompt_text, prompt_summary, context_hash, sources_json, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![
            &input.id,
            &input.novel_id,
            &input.volume_id,
            &input.chapter_id,
            &input.engineering_state_id,
            &input.style_profile_id,
            &input.output_profile_id,
            &input.compiled_context_json,
            &input.compiled_prompt_text,
            &input.prompt_summary,
            &input.context_hash,
            &input.sources_json,
            &input.created_at,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn find_chapter_generation_snapshots_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<ChapterGenerationSnapshotDto>, String> {
    let sql = format!(
        "{CHAPTER_GENERATION_SNAPSHOT_SELECT} WHERE chapter_id = ?1 ORDER BY created_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_chapter_generation_snapshot_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_latest_chapter_generation_snapshot(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterGenerationSnapshotDto>, String> {
    let sql = format!(
        "{CHAPTER_GENERATION_SNAPSHOT_SELECT} WHERE chapter_id = ?1 ORDER BY created_at DESC LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    match stmt.query_row(params![chapter_id], map_chapter_generation_snapshot_row) {
        Ok(snapshot) => Ok(Some(snapshot)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
