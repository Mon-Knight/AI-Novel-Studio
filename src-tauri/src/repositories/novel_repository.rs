use crate::domain::project::{
    default_dual_relation, DualProtagonistRelationDto, NovelDto, ProtagonistProfileDto,
    UpdateNovelInput,
};
use rusqlite::{params, Connection, OptionalExtension, Row};

pub fn parse_protagonists_json(value: &str) -> Vec<ProtagonistProfileDto> {
    serde_json::from_str::<Vec<ProtagonistProfileDto>>(value).unwrap_or_default()
}

pub fn parse_dual_relation_json(value: &str) -> DualProtagonistRelationDto {
    serde_json::from_str::<DualProtagonistRelationDto>(value)
        .unwrap_or_else(|_| default_dual_relation())
}

fn protagonist_name_from_json(value: &str) -> String {
    parse_protagonists_json(value)
        .first()
        .map(|item| item.name.clone())
        .unwrap_or_default()
}

fn protagonist_ability_from_json(value: &str) -> String {
    parse_protagonists_json(value)
        .first()
        .map(|item| {
            if !item.ability.is_empty() {
                item.ability.clone()
            } else {
                item.special_ability.clone().unwrap_or_default()
            }
        })
        .unwrap_or_default()
}

pub fn novel_select_sql() -> &'static str {
    "SELECT id, title, subtitle, genre, description, outline, cover_path, status, current_volume_id, current_chapter_id, total_word_count, target_word_count, last_opened_at, protagonist_mode, protagonists_json, dual_protagonist_relation_json, main_character, protagonist_ability, created_at, updated_at FROM novels"
}

pub fn map_novel_row(row: &Row<'_>) -> rusqlite::Result<NovelDto> {
    let protagonists_json: String = row.get(14)?;
    let relation_json: String = row.get(15)?;
    let main_character: String = row.get(16)?;
    let protagonist_ability: String = row.get(17)?;
    let fallback_main_character = if main_character.is_empty() {
        protagonist_name_from_json(&protagonists_json)
    } else {
        main_character
    };
    let fallback_protagonist_ability = if protagonist_ability.is_empty() {
        protagonist_ability_from_json(&protagonists_json)
    } else {
        protagonist_ability
    };

    Ok(NovelDto {
        id: row.get(0)?,
        title: row.get(1)?,
        subtitle: row.get(2)?,
        genre: row.get(3)?,
        description: row.get(4)?,
        outline: row.get(5)?,
        cover_path: row.get(6)?,
        status: row.get(7)?,
        current_volume_id: row.get(8)?,
        current_chapter_id: row.get(9)?,
        total_word_count: row.get(10)?,
        target_word_count: row.get(11)?,
        last_opened_at: row.get(12)?,
        protagonist_mode: row.get(13)?,
        protagonists: parse_protagonists_json(&protagonists_json),
        dual_protagonist_relation: parse_dual_relation_json(&relation_json),
        main_character: fallback_main_character,
        protagonist_ability: fallback_protagonist_ability,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
    })
}

pub fn find_all(conn: &Connection) -> Result<Vec<NovelDto>, String> {
    let sql = format!(
        "{} WHERE deleted_at IS NULL ORDER BY updated_at DESC",
        novel_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let novels = stmt
        .query_map([], map_novel_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(novels)
}

pub fn find_by_id(conn: &Connection, id: &str) -> Result<Option<NovelDto>, String> {
    let sql = format!(
        "{} WHERE id = ?1 AND deleted_at IS NULL",
        novel_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    stmt.query_row(params![id], map_novel_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn insert(
    conn: &Connection,
    id: &str,
    title: &str,
    subtitle: Option<&str>,
    genre: Option<&str>,
    description: Option<&str>,
    outline: &str,
    target_word_count: Option<i64>,
    relation_json: &str,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO novels (id, title, subtitle, genre, description, outline, status, total_word_count, target_word_count, protagonist_mode, protagonists_json, dual_protagonist_relation_json, main_character, protagonist_ability, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', 0, ?7, 'single', '[]', ?8, '', '', ?9, ?9)",
        params![id, title, subtitle, genre, description, outline, target_word_count, relation_json, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update(
    conn: &Connection,
    id: &str,
    existing: &NovelDto,
    input: &UpdateNovelInput,
    protagonists_json: Option<String>,
    relation_json: Option<String>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE novels SET title = COALESCE(?1, title), subtitle = COALESCE(?2, subtitle), description = COALESCE(?3, description), outline = COALESCE(?4, outline), genre = COALESCE(?5, genre), status = COALESCE(?6, status), target_word_count = COALESCE(?7, target_word_count), current_volume_id = COALESCE(?8, current_volume_id), current_chapter_id = COALESCE(?9, current_chapter_id), total_word_count = COALESCE(?10, total_word_count), protagonist_mode = COALESCE(?11, protagonist_mode), protagonists_json = COALESCE(?12, protagonists_json), dual_protagonist_relation_json = COALESCE(?13, dual_protagonist_relation_json), main_character = COALESCE(?14, main_character), protagonist_ability = COALESCE(?15, protagonist_ability), updated_at = ?16 WHERE id = ?17",
        params![
            input.title.as_deref(),
            input.subtitle.as_deref().or(existing.subtitle.as_deref()),
            input.description.as_deref().or(existing.description.as_deref()),
            input.outline.as_deref(),
            input.genre.as_deref().or(existing.genre.as_deref()),
            input.status.as_deref(),
            input.target_word_count.or(existing.target_word_count),
            input.current_volume_id.as_deref().or(existing.current_volume_id.as_deref()),
            input.current_chapter_id.as_deref().or(existing.current_chapter_id.as_deref()),
            input.total_word_count.or(Some(existing.total_word_count)),
            input.protagonist_mode.as_deref(),
            protagonists_json,
            relation_json,
            input.main_character.as_deref().or(Some(&existing.main_character)),
            input.protagonist_ability.as_deref().or(Some(&existing.protagonist_ability)),
            now,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn soft_delete(conn: &Connection, id: &str, now: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE novels SET deleted_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
