use crate::domain::writing::{UpdateVolumeInput, VolumeDto};
use rusqlite::{params, Connection, Row};

pub fn map_volume_row(row: &Row<'_>) -> rusqlite::Result<VolumeDto> {
    Ok(VolumeDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        title: row.get(2)?,
        summary: row.get(3)?,
        goal: row.get(4)?,
        main_conflict: row.get(5)?,
        order_index: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub fn find_by_novel_id(conn: &Connection, novel_id: &str) -> Result<Vec<VolumeDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, title, summary, goal, main_conflict, order_index, status, created_at, updated_at FROM volumes WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index ASC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![novel_id], map_volume_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_by_id(conn: &Connection, id: &str) -> Result<Option<VolumeDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, title, summary, goal, main_conflict, order_index, status, created_at, updated_at FROM volumes WHERE id = ?1 AND deleted_at IS NULL")
        .map_err(|e| e.to_string())?;
    match stmt.query_row(params![id], map_volume_row) {
        Ok(volume) => Ok(Some(volume)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn insert(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    title: &str,
    summary: Option<&str>,
    goal: Option<&str>,
    main_conflict: Option<&str>,
    order_index: i64,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO volumes (id, novel_id, title, summary, goal, main_conflict, order_index, status, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'planned',?8,?8)",
        params![id, novel_id, title, summary, goal, main_conflict, order_index, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update(
    conn: &Connection,
    id: &str,
    input: &UpdateVolumeInput,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE volumes
         SET title = COALESCE(?1, title),
             summary = COALESCE(?2, summary),
             goal = COALESCE(?3, goal),
             main_conflict = COALESCE(?4, main_conflict),
             order_index = COALESCE(?5, order_index),
             status = COALESCE(?6, status),
             updated_at = ?7
         WHERE id = ?8",
        params![
            input.title.as_deref(),
            input.summary.as_deref(),
            input.goal.as_deref(),
            input.main_conflict.as_deref(),
            input.order_index,
            input.status.as_deref(),
            now,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn count_active_chapters(conn: &Connection, volume_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM chapters WHERE volume_id = ?1 AND deleted_at IS NULL",
        params![volume_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn soft_delete(conn: &Connection, id: &str, now: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE volumes SET deleted_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
