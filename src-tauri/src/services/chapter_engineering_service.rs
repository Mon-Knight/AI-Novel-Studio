use crate::domain::ai::{
    ChapterEngineeringStateDto, ChapterGenerationSnapshotDto, SaveChapterEngineeringDraftInput,
    SaveChapterGenerationSnapshotInput,
};
use crate::repositories::chapter_engineering_repository::{
    self, map_chapter_engineering_state_row,
};
use rusqlite::Connection;

pub fn save_chapter_engineering_draft(
    conn: &Connection,
    input: SaveChapterEngineeringDraftInput,
) -> Result<ChapterEngineeringStateDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let max_version =
        chapter_engineering_repository::get_max_engineering_draft_version(conn, &input.chapter_id)?;
    let active_version =
        chapter_engineering_repository::get_active_engineering_version(conn, &input.chapter_id)?;

    chapter_engineering_repository::insert_chapter_engineering_state(
        conn,
        &id,
        &input,
        max_version + 1,
        active_version,
        &now,
    )?;

    chapter_engineering_repository::find_engineering_state_by_id(conn, &id)
}

pub fn get_chapter_engineering_state(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterEngineeringStateDto>, String> {
    let sql = format!(
        "{} WHERE chapter_id = ?1 ORDER BY draft_version DESC LIMIT 1",
        chapter_engineering_repository::CHAPTER_ENGINEERING_SELECT
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    match stmt.query_row(
        rusqlite::params![chapter_id],
        map_chapter_engineering_state_row,
    ) {
        Ok(state) => Ok(Some(state)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn get_chapter_engineering_states(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<ChapterEngineeringStateDto>, String> {
    chapter_engineering_repository::find_engineering_states_by_chapter(conn, chapter_id)
}

pub fn get_active_chapter_engineering_state(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterEngineeringStateDto>, String> {
    chapter_engineering_repository::find_engineering_state_by_chapter_and_status(
        conn, chapter_id, "active",
    )
}

pub fn activate_chapter_engineering_state(
    conn: &Connection,
    id: &str,
    chapter_id: &str,
) -> Result<ChapterEngineeringStateDto, String> {
    let draft_version =
        chapter_engineering_repository::get_draft_version_by_id_and_chapter(conn, id, chapter_id)?;
    let now = chrono::Utc::now().to_rfc3339();

    chapter_engineering_repository::archive_active_engineering_states(conn, chapter_id, &now)?;
    let affected = chapter_engineering_repository::activate_chapter_engineering_state_row(
        conn,
        id,
        chapter_id,
        draft_version,
        &now,
    )?;
    if affected == 0 {
        return Err("chapter engineering state not found".to_string());
    }

    chapter_engineering_repository::find_engineering_state_by_id(conn, id)
}

pub fn save_chapter_generation_snapshot(
    conn: &Connection,
    input: SaveChapterGenerationSnapshotInput,
) -> Result<ChapterGenerationSnapshotDto, String> {
    let id = input.id.clone();
    chapter_engineering_repository::upsert_chapter_generation_snapshot(conn, &input)?;
    chapter_engineering_repository::find_chapter_generation_snapshot_by_id(conn, &id)
}

pub fn get_chapter_generation_snapshots(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<ChapterGenerationSnapshotDto>, String> {
    chapter_engineering_repository::find_chapter_generation_snapshots_by_chapter(conn, chapter_id)
}

pub fn get_latest_chapter_generation_snapshot(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterGenerationSnapshotDto>, String> {
    chapter_engineering_repository::find_latest_chapter_generation_snapshot(conn, chapter_id)
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
        conn.execute(
            "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '第一章', 1, 'drafted', 1000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_chapter_engineering_state_lifecycle() {
        let conn = setup_test_db();
        let input = SaveChapterEngineeringDraftInput {
            novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
            volume_id: None,
            chapter_id: "22222222-2222-2222-2222-222222222222".to_string(),
            chapter_card_json: "{\"goal\":\"突破\"}".to_string(),
            scene_plan_json: "[]".to_string(),
            generation_constraints_json: "{}".to_string(),
            quality_rules_json: "{}".to_string(),
        };

        let state = save_chapter_engineering_draft(&conn, input).unwrap();
        assert_eq!(state.draft_version, 1);
        assert_eq!(state.status, "draft");

        let active = activate_chapter_engineering_state(
            &conn,
            &state.id,
            "22222222-2222-2222-2222-222222222222",
        )
        .unwrap();
        assert_eq!(active.status, "active");
        assert_eq!(active.active_version, 1);

        let fetched_active =
            get_active_chapter_engineering_state(&conn, "22222222-2222-2222-2222-222222222222")
                .unwrap()
                .unwrap();
        assert_eq!(fetched_active.id, state.id);
    }
}
