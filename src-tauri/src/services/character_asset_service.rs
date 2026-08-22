use crate::domain::project::ProtagonistProfileDto;
use crate::domain::world::{
    AddChapterCharacterInput, ChapterCharacterDto, CharacterDto, CreateCharacterInput,
    UpdateCharacterInput,
};
use crate::repositories::character_asset_repository;
use rusqlite::{params, Connection, OptionalExtension};

// ==================== Characters ====================

pub fn list_characters_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<CharacterDto>, String> {
    character_asset_repository::find_characters_by_novel(conn, novel_id)
}

#[allow(dead_code)]
pub fn get_character(conn: &Connection, id: &str) -> Result<Option<CharacterDto>, String> {
    character_asset_repository::find_character_by_id(conn, id)
}

pub fn get_single_protagonist_character(
    conn: &Connection,
    novel_id: &str,
) -> Result<Option<CharacterDto>, String> {
    character_asset_repository::find_single_protagonist_character(conn, novel_id)
}

pub fn get_protagonist_characters(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<CharacterDto>, String> {
    character_asset_repository::find_protagonist_characters(conn, novel_id)
}

pub fn create_character(
    conn: &Connection,
    input: CreateCharacterInput,
) -> Result<CharacterDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let role_type = input.role_type.unwrap_or_else(|| "supporting".to_string());

    character_asset_repository::insert_character(
        conn,
        &id,
        &input.novel_id,
        &input.name,
        &role_type,
        input.identity.as_deref(),
        input.faction.as_deref(),
        input.relation_to_protagonist.as_deref(),
        input.goal.as_deref(),
        input.personality.as_deref(),
        input.behavior_limits.as_deref(),
        input.forbidden_behaviors.as_deref(),
        input.current_state.as_deref(),
        "manual",
        input.is_protagonist,
        &now,
    )?;

    character_asset_repository::find_character_by_id(conn, &id)?
        .ok_or_else(|| "无法读取创建后的角色".to_string())
}

pub fn update_character(
    conn: &Connection,
    id: &str,
    input: UpdateCharacterInput,
) -> Result<CharacterDto, String> {
    let now = chrono::Utc::now().to_rfc3339();

    character_asset_repository::update_character_fields(
        conn,
        id,
        input.name.as_deref(),
        input.role_type.as_deref(),
        input.identity.as_deref(),
        input.faction.as_deref(),
        input.relation_to_protagonist.as_deref(),
        input.goal.as_deref(),
        input.personality.as_deref(),
        input.behavior_limits.as_deref(),
        input.forbidden_behaviors.as_deref(),
        input.current_state.as_deref(),
        input.is_protagonist,
        input.is_active,
        &now,
    )?;

    character_asset_repository::find_character_by_id(conn, id)?
        .ok_or_else(|| "无法读取更新后的角色".to_string())
}

pub fn delete_character(conn: &Connection, id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    character_asset_repository::soft_delete_character(conn, id, &now)
}

// ==================== Protagonist Sync ====================

struct ProtagonistSyncItem {
    key: String,
    label: String,
    order: i64,
    name: String,
    identity: Option<String>,
    personality: Option<String>,
    goal: Option<String>,
    special_ability: Option<String>,
    ability_limits: Option<String>,
    forbidden_behaviors: Option<String>,
    current_state: Option<String>,
}

pub fn sync_protagonists_to_character_library(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<CharacterDto>, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut protagonists: Vec<ProtagonistSyncItem> = Vec::new();

    // 1. 优先从 novels 表的 protagonists_json 读取（支持双主角/多主角）
    let novel_row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT main_character, protagonist_ability, protagonists_json FROM novels WHERE id = ?1 AND deleted_at IS NULL",
            params![novel_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some((main_char, _ability_str, protagonists_json)) = novel_row {
        if !protagonists_json.is_empty() && protagonists_json != "[]" {
            if let Ok(profiles) =
                serde_json::from_str::<Vec<ProtagonistProfileDto>>(&protagonists_json)
            {
                for (i, profile) in profiles.iter().enumerate() {
                    if profile.name.trim().is_empty() {
                        continue;
                    }
                    protagonists.push(ProtagonistSyncItem {
                        key: profile.label.clone(),
                        label: match profile.label.as_str() {
                            "primary" => "主角A".to_string(),
                            "secondary" => "主角B".to_string(),
                            _ => format!("主角{}", i + 1),
                        },
                        order: i as i64,
                        name: profile.name.clone(),
                        identity: if profile.identity.is_empty() {
                            None
                        } else {
                            Some(profile.identity.clone())
                        },
                        personality: if profile.personality.is_empty() {
                            None
                        } else {
                            Some(profile.personality.clone())
                        },
                        goal: if profile.goal.is_empty() {
                            None
                        } else {
                            Some(profile.goal.clone())
                        },
                        special_ability: profile.special_ability.clone(),
                        ability_limits: profile.ability_limits.clone(),
                        forbidden_behaviors: profile.forbidden_behaviors.clone(),
                        current_state: None,
                    });
                }
            }
        }
        // 回退：如果 protagonists_json 为空，用 main_character
        if protagonists.is_empty() && !main_char.is_empty() {
            protagonists.push(ProtagonistSyncItem {
                key: "primary".to_string(),
                label: "主角".to_string(),
                order: 0,
                name: main_char,
                identity: None,
                personality: None,
                goal: None,
                special_ability: None,
                ability_limits: None,
                forbidden_behaviors: None,
                current_state: None,
            });
        }
    }

    // 2. 如果 novels 表也没有，尝试从 protagonists 表读取
    if protagonists.is_empty() {
        let mut stmt = conn
            .prepare(
                "SELECT name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors, current_state FROM protagonists WHERE novel_id = ?1 ORDER BY created_at ASC"
            )
            .map_err(|e| e.to_string())?;
        let protag_rows: Vec<(
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = stmt
            .query_map(params![novel_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        for (
            i,
            (
                name,
                identity,
                personality,
                goal,
                ability,
                ability_limits,
                forbidden_behaviors,
                current_state,
            ),
        ) in protag_rows.into_iter().enumerate()
        {
            if name.trim().is_empty() {
                continue;
            }
            protagonists.push(ProtagonistSyncItem {
                key: if i == 0 {
                    "primary".to_string()
                } else {
                    format!("lead_{}", i + 1)
                },
                label: if i == 0 {
                    "主角".to_string()
                } else {
                    format!("主角{}", i + 1)
                },
                order: i as i64,
                name,
                identity,
                personality,
                goal,
                special_ability: ability,
                ability_limits,
                forbidden_behaviors,
                current_state,
            });
        }
    }

    // 3. 对每个主角执行 upsert（按 novel_id + protagonist_key 去重）
    let mut results: Vec<CharacterDto> = Vec::new();

    for info in &protagonists {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM characters
                 WHERE novel_id = ?1 AND protagonist_key = ?2
                 LIMIT 1",
                params![novel_id, &info.key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(existing_id) = existing {
            conn.execute(
                "UPDATE characters SET name = ?1, role_type = 'protagonist', identity = ?2, personality = ?3, goal = ?4, behavior_limits = ?5, forbidden_behaviors = ?6, current_state = ?7, source = 'protagonist_profile', source_type = 'protagonist_profile', is_protagonist = 1, is_active = 1, protagonist_label = ?8, protagonist_order = ?9, updated_at = ?10 WHERE id = ?11",
                params![
                    &info.name,
                    &info.identity,
                    &info.personality,
                    &info.goal,
                    &info.ability_limits,
                    &info.forbidden_behaviors,
                    &info.current_state,
                    &info.label,
                    &info.order,
                    now,
                    &existing_id,
                ],
            )
            .map_err(|e| e.to_string())?;

            if let Some(ch) = character_asset_repository::find_character_by_id(conn, &existing_id)?
            {
                results.push(ch);
            }
        } else {
            let new_id = uuid::Uuid::new_v4().to_string();
            let special_ability_text = info.special_ability.clone().unwrap_or_default();
            let ability_limits_text = info.ability_limits.clone().unwrap_or_default();
            let personality_notes = info.personality.clone().unwrap_or_default();
            let goal_text = info.goal.clone().unwrap_or_default();
            let current_state_text = info.current_state.clone().unwrap_or_default();

            conn.execute(
                "INSERT INTO characters (id, novel_id, name, role_type, identity, faction, relation_to_protagonist, goal, personality, behavior_limits, forbidden_behaviors, first_appearance_chapter_id, current_state, source, source_type, is_protagonist, protagonist_key, protagonist_label, protagonist_order, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, 'protagonist', ?4, NULL, NULL, ?5, ?6, ?7, ?8, NULL, ?9, 'protagonist_profile', 'protagonist_profile', 1, ?10, ?11, ?12, 1, ?13, ?13)",
                params![
                    &new_id,
                    novel_id,
                    &info.name,
                    &info.identity,
                    &goal_text,
                    &personality_notes,
                    &ability_limits_text,
                    &info.forbidden_behaviors,
                    &current_state_text,
                    &info.key,
                    &info.label,
                    &info.order,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;

            if !special_ability_text.is_empty() {
                let _ = conn.execute(
                    "UPDATE characters SET goal = goal || ?1 WHERE id = ?2",
                    params![format!("\n特殊能力：{}", special_ability_text), &new_id],
                );
            }

            if let Some(ch) = character_asset_repository::find_character_by_id(conn, &new_id)? {
                results.push(ch);
            }
        }
    }

    Ok(results)
}

// ==================== Chapter Characters ====================

pub fn list_chapter_characters(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<ChapterCharacterDto>, String> {
    character_asset_repository::find_chapter_characters_by_chapter(conn, chapter_id)
}

pub fn add_chapter_character(
    conn: &Connection,
    input: AddChapterCharacterInput,
) -> Result<ChapterCharacterDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let existing = character_asset_repository::find_chapter_character_id_by_chapter_and_character(
        conn,
        &input.chapter_id,
        &input.character_id,
    )?;

    if let Some(existing_id) = existing {
        character_asset_repository::update_chapter_character(
            conn,
            &existing_id,
            input.character_name.as_deref(),
            &input.role_in_chapter,
            input.must_appear,
            input.note.as_deref(),
            &now,
        )?;
        character_asset_repository::find_chapter_character_by_id(conn, &existing_id)?
            .ok_or_else(|| "无法读取更新后的章节角色".to_string())
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        character_asset_repository::insert_chapter_character(
            conn,
            &id,
            &input.novel_id,
            &input.chapter_id,
            &input.character_id,
            input.character_name.as_deref(),
            &input.role_in_chapter,
            input.must_appear,
            input.note.as_deref(),
            &now,
        )?;
        character_asset_repository::find_chapter_character_by_id(conn, &id)?
            .ok_or_else(|| "无法读取创建后的章节角色".to_string())
    }
}

pub fn remove_chapter_character(
    conn: &Connection,
    chapter_id: &str,
    character_id: &str,
) -> Result<(), String> {
    character_asset_repository::delete_chapter_character(conn, chapter_id, character_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::create_tables(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO novels (id, title, main_character, protagonist_ability, protagonists_json, created_at, updated_at) VALUES ('novel-1', '测试小说', '罗峰', '精神念力', '[{\"name\":\"罗峰\",\"label\":\"primary\",\"identity\":\"武者\",\"personality\":\"刚毅\",\"goal\":\"保护家人\",\"specialAbility\":\"精神念力\",\"abilityLimits\":\"消耗大\",\"forbiddenBehaviors\":\"妥协\"}]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at) VALUES ('chapter-1', 'novel-1', '第一章 觉醒', 1, 'not_started', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_character_crud() {
        let conn = setup_test_db();
        let character = create_character(
            &conn,
            CreateCharacterInput {
                novel_id: "novel-1".to_string(),
                name: "洪".to_string(),
                role_type: Some("supporting".to_string()),
                identity: Some("第一强者".to_string()),
                faction: Some("极限武馆".to_string()),
                relation_to_protagonist: Some("前辈引路人".to_string()),
                goal: Some("突破行星级".to_string()),
                personality: Some("沉稳冷峻".to_string()),
                behavior_limits: None,
                forbidden_behaviors: None,
                current_state: Some("闭关中".to_string()),
                is_protagonist: false,
            },
        )
        .unwrap();

        assert_eq!(character.name, "洪");
        assert_eq!(character.faction.as_deref(), Some("极限武馆"));
        assert!(!character.is_protagonist);

        let updated = update_character(
            &conn,
            &character.id,
            UpdateCharacterInput {
                name: None,
                role_type: None,
                identity: None,
                faction: None,
                relation_to_protagonist: None,
                goal: None,
                personality: None,
                behavior_limits: None,
                forbidden_behaviors: None,
                current_state: Some("出关入世".to_string()),
                is_protagonist: None,
                is_active: None,
            },
        )
        .unwrap();

        assert_eq!(updated.current_state.as_deref(), Some("出关入世"));

        delete_character(&conn, &character.id).unwrap();
        let characters = list_characters_by_novel(&conn, "novel-1").unwrap();
        assert_eq!(characters.len(), 0);
    }

    #[test]
    fn test_protagonist_sync_to_characters() {
        let conn = setup_test_db();
        let synced = sync_protagonists_to_character_library(&conn, "novel-1").unwrap();
        assert_eq!(synced.len(), 1);
        assert_eq!(synced[0].name, "罗峰");
        assert!(synced[0].is_protagonist);
        assert_eq!(synced[0].protagonist_key.as_deref(), Some("primary"));

        let single = get_single_protagonist_character(&conn, "novel-1")
            .unwrap()
            .unwrap();
        assert_eq!(single.name, "罗峰");

        let multiple = get_protagonist_characters(&conn, "novel-1").unwrap();
        assert_eq!(multiple.len(), 1);
    }

    #[test]
    fn test_chapter_character_lifecycle() {
        let conn = setup_test_db();
        let char1 = create_character(
            &conn,
            CreateCharacterInput {
                novel_id: "novel-1".to_string(),
                name: "雷神".to_string(),
                role_type: Some("supporting".to_string()),
                identity: Some("第二强者".to_string()),
                faction: Some("雷电武馆".to_string()),
                relation_to_protagonist: None,
                goal: None,
                personality: None,
                behavior_limits: None,
                forbidden_behaviors: None,
                current_state: None,
                is_protagonist: false,
            },
        )
        .unwrap();

        let chapter_char = add_chapter_character(
            &conn,
            AddChapterCharacterInput {
                novel_id: "novel-1".to_string(),
                chapter_id: "chapter-1".to_string(),
                character_id: char1.id.clone(),
                character_name: Some("雷神".to_string()),
                role_in_chapter: "mentor".to_string(),
                must_appear: true,
                note: Some("指点刀法".to_string()),
            },
        )
        .unwrap();

        assert_eq!(chapter_char.character_id, char1.id);
        assert!(chapter_char.must_appear);

        let list = list_chapter_characters(&conn, "chapter-1").unwrap();
        assert_eq!(list.len(), 1);

        remove_chapter_character(&conn, "chapter-1", &char1.id).unwrap();
        let list_after = list_chapter_characters(&conn, "chapter-1").unwrap();
        assert_eq!(list_after.len(), 0);
    }
}
