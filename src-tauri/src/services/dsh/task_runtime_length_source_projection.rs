//! Unclipped semantic projections for deciding whether a failed draft is still reusable.
//! These are source comparisons, not a second Gateway response or narrative validation.
use super::*;
use rusqlite::{types::ValueRef, Connection, ToSql};

pub(super) fn rows(
    connection: &Connection,
    sql: &str,
    args: &[&dyn ToSql],
) -> Result<Value, String> {
    let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();
    let values = statement
        .query_map(args, |row| {
            let mut value = serde_json::Map::new();
            for (index, name) in names.iter().enumerate() {
                let field =
                    match row.get_ref(index)? {
                        ValueRef::Null => Value::Null,
                        ValueRef::Integer(value) => json!(value),
                        ValueRef::Real(value) => json!(value),
                        ValueRef::Text(value) => json!(std::str::from_utf8(value)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?),
                        ValueRef::Blob(_) => return Err(rusqlite::Error::InvalidQuery),
                    };
                value.insert(name.clone(), field);
            }
            Ok(Value::Object(value))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Value::Array(values))
}

fn one(connection: &Connection, sql: &str, args: &[&dyn ToSql]) -> Result<Value, String> {
    Ok(rows(connection, sql, args)?
        .as_array()
        .and_then(|rows| rows.first())
        .cloned()
        .unwrap_or(Value::Null))
}

const ORDERED_CHAPTERS: &str = "WITH ordered_chapters AS (
    SELECT c.id,c.title,c.order_index,
      ROW_NUMBER() OVER (ORDER BY CASE WHEN c.volume_id IS NULL THEN -1 ELSE COALESCE(v.order_index,2147483647) END,
        COALESCE(v.id,''),c.order_index,c.created_at,c.id)-1 AS sequence_index
    FROM chapters c LEFT JOIN volumes v ON v.id=c.volume_id AND v.novel_id=c.novel_id AND v.deleted_at IS NULL
    WHERE c.novel_id=?1 AND c.deleted_at IS NULL) ";

pub(in super::super) fn current(
    connection: &Connection,
    input: &StartTaskTurnInput,
) -> Result<Value, String> {
    let chapter_id = input.chapter_id.as_deref().ok_or("章节身份缺失")?;
    let args: &[&dyn ToSql] = &[&input.novel_id, &chapter_id];
    let chapter = crate::services::chapter_service::get_chapter(connection, chapter_id)?
        .filter(|chapter| chapter.novel_id == input.novel_id)
        .ok_or("章节作用域已变化")?;
    let chapter_source = json!({"id":chapter.id,"volumeId":chapter.volume_id,"title":chapter.title,
        "outline":chapter.outline.unwrap_or_default(),"goal":chapter.goal.unwrap_or_default(),
        "orderIndex":chapter.order_index,"targetWordCount":chapter.target_word_count,"adoptedDraftId":chapter.adopted_draft_id});
    let engineering =
        crate::services::chapter_engineering_service::get_active_chapter_engineering_state(
            connection, chapter_id,
        )?;
    if engineering
        .as_ref()
        .is_some_and(|state| state.novel_id != input.novel_id)
    {
        return Err("章节工程作用域已变化".into());
    }
    let engineering = engineering.map(|state| json!({"activeVersion":state.active_version,"status":state.status,
        "chapterCard":state.chapter_card_json,"scenePlan":state.scene_plan_json,"generationConstraints":state.generation_constraints_json}));
    let adopted = if chapter.adopted_draft_id.is_some() {
        let body = chapter_continuity::load_adopted(connection, &input.novel_id, chapter_id)?;
        Some(json!({"draftId":body.draft_id,"contentHash":body.source_hash}))
    } else {
        None
    };
    let summaries = rows(connection, &format!("{ORDERED_CHAPTERS}
        SELECT c.id AS chapterId,c.title,c.order_index AS orderIndex,s.summary,
          COALESCE(s.key_events,'') AS keyEvents,COALESCE(s.character_changes,'') AS characterChanges,
          COALESCE(s.next_chapter_hints,'') AS nextChapterHints
        FROM ordered_chapters c JOIN chapter_summaries s ON s.chapter_id=c.id AND s.novel_id=?1
        WHERE c.sequence_index<(SELECT sequence_index FROM ordered_chapters WHERE id=?2)
        ORDER BY c.sequence_index DESC,s.created_at DESC,s.id DESC LIMIT 3"), args)?;
    let states = rows(connection, &format!("{ORDERED_CHAPTERS}
        SELECT cs.character_id AS characterId,cs.chapter_id AS chapterId,cs.state_summary AS stateSummary,
          COALESCE(cs.relationship_changes,'') AS relationshipChanges,COALESCE(cs.goal_changes,'') AS goalChanges,
          cs.location,cs.health_state AS healthState,cs.knowledge_state AS knowledgeState,cs.created_at AS createdAt
        FROM character_states cs LEFT JOIN ordered_chapters c ON c.id=cs.chapter_id
        WHERE cs.novel_id=?1 AND (cs.chapter_id IS NULL OR c.sequence_index<(SELECT sequence_index FROM ordered_chapters WHERE id=?2))
        ORDER BY COALESCE(c.sequence_index,-1) DESC,cs.created_at DESC,cs.id DESC LIMIT 48"), args)?;
    let mut characters = rows(connection, "SELECT id,name,role_type AS roleType,is_protagonist AS isProtagonist,
        COALESCE(personality,'') AS personality,COALESCE(constraints,'') AS constraints,COALESCE(ability,'') AS ability,
        COALESCE(goals,'') AS goals,COALESCE(relation_to_protagonist,'') AS relationToProtagonist,faction
        FROM characters WHERE novel_id=?1 AND is_active=1 ORDER BY protagonist_order,name,id", &[&input.novel_id])?;
    for character in characters.as_array_mut().ok_or("人物材料无效")? {
        let state = states.as_array().and_then(|states| {
            states
                .iter()
                .find(|state| state["characterId"] == character["id"])
        });
        character["currentState"] = state
            .map(|state| state["stateSummary"].clone())
            .unwrap_or(json!(""));
        character["currentStateChapterId"] = state
            .map(|state| state["chapterId"].clone())
            .unwrap_or(Value::Null);
    }
    let roles = rows(connection, "SELECT cc.character_id AS characterId,COALESCE(cc.character_name,c.name) AS characterName,
        cc.role_in_chapter AS roleInChapter,cc.must_appear AS mustAppear,COALESCE(cc.note,'') AS note,
        COALESCE(c.current_state,'') AS currentState,COALESCE(c.personality,'') AS personality,COALESCE(c.constraints,'') AS constraints
        FROM chapter_characters cc LEFT JOIN characters c ON c.id=cc.character_id AND c.novel_id=cc.novel_id
        WHERE cc.novel_id=?1 AND cc.chapter_id=?2 ORDER BY cc.character_id", args)?;
    Ok(json!({
        "novel": one(connection,"SELECT id,title,subtitle,genre,COALESCE(description,'') AS description,outline,
            main_character AS mainCharacter,protagonist_ability AS protagonistAbility,protagonist_mode AS protagonistMode,
            target_word_count AS targetWordCount FROM novels WHERE id=?1 AND deleted_at IS NULL", &[&input.novel_id])?,
        "chapters": rows(connection,"SELECT id,volume_id AS volumeId,title,COALESCE(goal,'') AS goal,order_index AS orderIndex,
            adopted_draft_id AS adoptedDraftId FROM chapters WHERE novel_id=?1 AND deleted_at IS NULL ORDER BY id", &[&input.novel_id])?,
        "volumes": rows(connection,"SELECT id,title,order_index AS orderIndex FROM volumes
            WHERE novel_id=?1 AND deleted_at IS NULL ORDER BY id", &[&input.novel_id])?,
        "chapter": chapter_source,
        "masterOutline": one(connection,"SELECT id,title,content,status,version,source_type AS sourceType FROM master_outlines
            WHERE project_id=?1 AND is_active=1 ORDER BY version DESC LIMIT 1", &[&input.novel_id])?,
        "volumeOutline": one(connection,"SELECT id,master_outline_id AS masterOutlineId,volume_id AS volumeId,volume_index AS volumeIndex,
            title,content,status,version,source_type AS sourceType FROM volume_outlines WHERE project_id=?1
            AND volume_id=(SELECT volume_id FROM chapters WHERE id=?2) AND is_active=1 ORDER BY version DESC LIMIT 1",args)?,
        "outline": one(connection,"SELECT id,version,title,content,status,source_type AS sourceType FROM chapter_outlines
            WHERE project_id=?1 AND chapter_id=?2 AND is_active=1 ORDER BY version DESC LIMIT 1",args)?,
        "engineeringState":engineering,
        "currentAdoptedDraft":adopted,
        "chapterRoles":roles,
        "chapterEvents":rows(connection,"SELECT id,title,description,COALESCE(impact,'') AS impact,COALESCE(risk,'') AS risk,status
            FROM chapter_events WHERE novel_id=?1 AND chapter_id=?2 ORDER BY created_at,id",args)?,
        "previousChapterSummaries":summaries,
        "targetChapterSummary":one(connection,"SELECT summary,COALESCE(key_events,'') AS keyEvents,COALESCE(character_changes,'') AS characterChanges
            FROM chapter_summaries WHERE novel_id=?1 AND chapter_id=?2 ORDER BY created_at DESC LIMIT 1",args)?,
        "characters":characters,"stateTrack":states
    }))
}

/// Source fields not fully exposed by old clipped tool projections are hashed by the host.
/// No timestamps, task status, counters, prose or credentials are persisted in this metadata.
pub(in super::super) fn host_baseline(
    connection: &Connection,
    input: &StartTaskTurnInput,
) -> Result<Value, String> {
    if !is_chapter_writing_turn(input) {
        return Ok(Value::Null);
    }
    let chapter_id = input.chapter_id.as_deref().ok_or("章节身份缺失")?;
    let previous = chapter_continuity::load_previous(connection, &input.novel_id, chapter_id)?;
    let profiles = json!({
        "novel": rows(connection,"SELECT protagonist_mode,protagonists_json,dual_protagonist_relation_json,main_character,protagonist_ability
            FROM novels WHERE id=?1 AND deleted_at IS NULL", &[&input.novel_id])?,
        "characters": rows(connection,"SELECT id,name,role_type,identity,faction,relation_to_protagonist,goal,background,ability,personality,
            constraints,behavior_limits,forbidden_behaviors,goals,is_protagonist,protagonist_key,protagonist_label,protagonist_order
            FROM characters WHERE novel_id=?1 AND is_active=1 ORDER BY id", &[&input.novel_id])?,
        "legacy": rows(connection,"SELECT id,name,identity,personality,goal,special_ability,ability_limits,forbidden_behaviors
            FROM protagonists WHERE novel_id=?1 ORDER BY id", &[&input.novel_id])?
    });
    let empty_profiles = profiles["legacy"]
        .as_array()
        .is_some_and(|rows| rows.is_empty())
        && profiles["characters"]
            .as_array()
            .is_some_and(|rows| rows.iter().all(|row| row["is_protagonist"] == json!(0)))
        && profiles["novel"].as_array().is_some_and(|rows| {
            rows.len() == 1
                && rows.iter().all(|row| {
                    row["main_character"]
                        .as_str()
                        .is_some_and(|text| text.trim().is_empty())
                        && row["protagonists_json"]
                            .as_str()
                            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                            .is_some_and(|value| {
                                value.as_array().is_some_and(|items| items.is_empty())
                            })
                })
        });
    Ok(
        json!({"schemaVersion":"length_source_baseline_v1","profilesHash":large_text_repository::sha256(&profiles.to_string()),"legacyProfilesEmpty":empty_profiles,
        "previous":previous.map(|body|json!({"chapterId":body.chapter_id,"draftId":body.draft_id,"sourceHash":body.source_hash}))}),
    )
}
