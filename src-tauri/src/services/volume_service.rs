use crate::domain::writing::{CreateVolumeInput, UpdateVolumeInput, VolumeDto, VOLUME_STATUSES};
use crate::repositories::volume_repository;
use rusqlite::Connection;

pub fn validate_volume_update_input(input: &UpdateVolumeInput) -> Result<(), String> {
    if let Some(status) = input.status.as_deref() {
        if !VOLUME_STATUSES.contains(&status) {
            return Err("volume_status_invalid".to_string());
        }
    }
    Ok(())
}

pub fn list_volumes_by_novel(conn: &Connection, novel_id: &str) -> Result<Vec<VolumeDto>, String> {
    volume_repository::find_by_novel_id(conn, novel_id)
}

pub fn get_volume(conn: &Connection, id: &str) -> Result<Option<VolumeDto>, String> {
    volume_repository::find_by_id(conn, id)
}

pub fn create_volume(conn: &Connection, input: CreateVolumeInput) -> Result<VolumeDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let order = input.order_index.unwrap_or(0);

    volume_repository::insert(
        conn,
        &id,
        &input.novel_id,
        &input.title,
        input.summary.as_deref(),
        input.goal.as_deref(),
        input.main_conflict.as_deref(),
        order,
        &now,
    )?;

    volume_repository::find_by_id(conn, &id)?.ok_or_else(|| "分卷创建后无法读取".to_string())
}

pub fn update_volume(
    conn: &Connection,
    id: &str,
    input: UpdateVolumeInput,
) -> Result<VolumeDto, String> {
    validate_volume_update_input(&input)?;
    let now = chrono::Utc::now().to_rfc3339();
    volume_repository::update(conn, id, &input, &now)?;
    volume_repository::find_by_id(conn, id)?.ok_or_else(|| format!("未找到指定分卷: {}", id))
}

pub fn delete_volume(conn: &Connection, id: &str) -> Result<(), String> {
    let count = volume_repository::count_active_chapters(conn, id)?;
    if count > 0 {
        return Err("该分卷下仍有章节，请先移动或删除章节".into());
    }
    let now = chrono::Utc::now().to_rfc3339();
    volume_repository::soft_delete(conn, id, &now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::create_tables(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO novels (id, title, created_at, updated_at) VALUES ('novel-1', '测试小说', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_volume_crud_flow() {
        let conn = setup_test_db();
        let vol = create_volume(
            &conn,
            CreateVolumeInput {
                novel_id: "novel-1".to_string(),
                title: "第一卷 崛起".to_string(),
                summary: Some("卷简介".to_string()),
                goal: Some("突破筑基".to_string()),
                main_conflict: Some("家族内争".to_string()),
                order_index: Some(1),
            },
        )
        .unwrap();

        assert_eq!(vol.title, "第一卷 崛起");
        assert_eq!(vol.status, "planned");

        let updated = update_volume(
            &conn,
            &vol.id,
            UpdateVolumeInput {
                title: Some("第一卷 问鼎".to_string()),
                summary: None,
                goal: None,
                main_conflict: None,
                order_index: None,
                status: Some("writing".to_string()),
            },
        )
        .unwrap();

        assert_eq!(updated.title, "第一卷 问鼎");
        assert_eq!(updated.status, "writing");

        delete_volume(&conn, &vol.id).unwrap();
        assert!(get_volume(&conn, &vol.id).unwrap().is_none());
    }
}
