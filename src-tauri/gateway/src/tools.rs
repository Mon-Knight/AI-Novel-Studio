//! Four read-only novel domain tools for the v3.1.0 gateway.
//!
//! SQL and column semantics mirror the app's Rust schema (`src-tauri/src/db.rs`,
//! `src/outline_commands.rs`, `src/migrations.rs`) and the read semantics of
//! the production tool registry (`novel.read_context@1`, `chapter.read_*@1`,
//! memory `retrieve`). The gateway opens the database READ-ONLY and never runs
//! migrations or recovery. v3.2 should extract a shared read-only crate to
//! remove the SQL drift risk versus the app repositories.

use rusqlite::{params, Connection};
use serde_json::{json, Value};

pub const TOOL_VERSION: &str = "v1";

const ID_MAX: usize = 160;
const QUERY_MAX: usize = 2000;
const TOP_K_MIN: i64 = 1;
const TOP_K_MAX: i64 = 20;
const FIELD_CLIP: usize = 12_000;
const CHUNK_CLIP: usize = 2_000;

/// The `tools/list` payload.
pub fn tool_list() -> Vec<Value> {
    vec![
        json!({
            "name": "get_metadata",
            "description": "读取小说元信息、分卷与章节结构、目标章节位置，以及风格/输出方案列表。只读。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX}
                },
                "required": ["novelId", "chapterId"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "get_chapter_context",
            "description": "读取目标章节的当前大纲、工程状态（章节卡/场景计划/生成约束）、章节事件，以及已采用的前序章节总结。只读。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX}
                },
                "required": ["novelId", "chapterId"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "search_memory",
            "description": "在已采用正文的记忆库中检索与查询相关的片段（FTS5，回退 LIKE），支持按章节、来源类型与最低重要性过滤。只读。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "query": {"type": "string", "minLength": 1, "maxLength": QUERY_MAX},
                    "topK": {"type": "integer", "minimum": TOP_K_MIN, "maximum": TOP_K_MAX},
                    "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "sourceTypes": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["adopted_draft", "chapter_summary", "context_record"]}
                    },
                    "minImportance": {"type": "number", "minimum": 0.0, "maximum": 1.0}
                },
                "required": ["novelId", "query"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "get_character_states",
            "description": "读取角色库、主角设定、截至目标章节的角色状态轨迹，以及目标章节的角色出场安排。只读。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX}
                },
                "required": ["novelId", "chapterId"],
                "additionalProperties": false
            }
        }),
    ]
}

/// Dispatches one `tools/call`.
pub fn call_tool(connection: &Connection, name: &str, arguments: &Value) -> Result<Value, String> {
    if crate::secret_guard::contains_secret_value(arguments) {
        return Err("suspicious credential-like input rejected".to_string());
    }
    match name {
        "get_metadata" => get_metadata(connection, arguments),
        "get_chapter_context" => get_chapter_context(connection, arguments),
        "search_memory" => search_memory(connection, arguments),
        "get_character_states" => get_character_states(connection, arguments),
        other => Err(format!("unknown tool: {}", other)),
    }
}

fn arg_id(arguments: &Value, key: &str) -> Result<String, String> {
    // Accept both camelCase (declared schema) and snake_case (some models emit it).
    let snake = key
        .chars()
        .flat_map(|ch| {
            if ch.is_ascii_uppercase() {
                vec!['_', ch.to_ascii_lowercase()]
            } else {
                vec![ch]
            }
        })
        .collect::<String>();
    let value = arguments
        .get(key)
        .or_else(|| arguments.get(&snake))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing string argument: {}", key))?;
    if value.is_empty() || value.len() > ID_MAX {
        return Err(format!("argument {} must be 1..={} chars", key, ID_MAX));
    }
    Ok(value.to_string())
}

fn clip(value: String) -> String {
    if value.chars().count() > FIELD_CLIP {
        let mut truncated: String = value.chars().take(FIELD_CLIP).collect();
        truncated.push_str("…[truncated]");
        truncated
    } else {
        value
    }
}

fn max_updated_at(connection: &Connection, table: &str, column: &str, param: &str) -> Option<String> {
    // table/column come from hardcoded call sites, never user input.
    let sql = format!("SELECT MAX(updated_at) FROM {} WHERE {} = ?1", table, column);
    connection
        .query_row(&sql, params![param], |row| row.get::<_, Option<String>>(0))
        .ok()
        .flatten()
}

fn chapter_order(connection: &Connection, chapter_id: &str) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT order_index FROM chapters WHERE id = ?1 AND deleted_at IS NULL",
            params![chapter_id],
            |row| row.get(0),
        )
        .map_err(|_| format!("chapter not found: {}", chapter_id))
}

// ---------------------------------------------------------------------------
// get_metadata
// ---------------------------------------------------------------------------

fn get_metadata(connection: &Connection, arguments: &Value) -> Result<Value, String> {
    let novel_id = arg_id(arguments, "novelId")?;
    let chapter_id = arg_id(arguments, "chapterId")?;

    let novel = connection
        .query_row(
            "SELECT id, title, subtitle, genre, description, status, total_word_count, target_word_count
             FROM novels WHERE id = ?1 AND deleted_at IS NULL",
            params![novel_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "subtitle": row.get::<_, Option<String>>(2)?,
                    "genre": row.get::<_, Option<String>>(3)?,
                    "description": row.get::<_, Option<String>>(4)?,
                    "status": row.get::<_, String>(5)?,
                    "totalWordCount": row.get::<_, i64>(6)?,
                    "targetWordCount": row.get::<_, Option<i64>>(7)?
                }))
            },
        )
        .map_err(|_| format!("novel not found: {}", novel_id))?;

    let mut volumes = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, title, summary, goal, main_conflict, order_index, status
                 FROM volumes WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "summary": row.get::<_, Option<String>>(2)?,
                    "goal": row.get::<_, Option<String>>(3)?,
                    "mainConflict": row.get::<_, Option<String>>(4)?,
                    "orderIndex": row.get::<_, i64>(5)?,
                    "status": row.get::<_, String>(6)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(200) {
            volumes.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut chapters = Vec::new();
    let mut target_position = Value::Null;
    {
        let mut statement = connection
            .prepare(
                "SELECT id, volume_id, title, goal, order_index, status, adopted_draft_id, word_count
                 FROM chapters WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "volumeId": row.get::<_, Option<String>>(1)?,
                    "title": row.get::<_, String>(2)?,
                    "goal": row.get::<_, Option<String>>(3)?,
                    "orderIndex": row.get::<_, i64>(4)?,
                    "status": row.get::<_, String>(5)?,
                    "adoptedDraftId": row.get::<_, Option<String>>(6)?,
                    "wordCount": row.get::<_, i64>(7)?
                }))
            })
            .map_err(|error| error.to_string())?;
        let mut index = 0i64;
        for row in rows.take(1000) {
            let chapter = row.map_err(|error| error.to_string())?;
            index += 1;
            if chapter["id"] == chapter_id {
                target_position = json!({
                    "orderIndex": index,
                    "volumeId": chapter["volumeId"],
                    "title": chapter["title"],
                    "status": chapter["status"]
                });
            }
            chapters.push(chapter);
        }
    }
    if target_position.is_null() {
        return Err(format!("chapter not found in novel: {}", chapter_id));
    }

    let mut style_profiles = Vec::new();
    {
        let mut statement = connection
            .prepare("SELECT id, name, is_active FROM style_profiles WHERE novel_id = ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "isActive": row.get::<_, i64>(2)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(50) {
            style_profiles.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut output_profiles = Vec::new();
    {
        let mut statement = connection
            .prepare("SELECT id, name, is_default FROM output_profiles WHERE novel_id = ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "isDefault": row.get::<_, i64>(2)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(50) {
            output_profiles.push(row.map_err(|error| error.to_string())?);
        }
    }

    Ok(json!({
        "ok": true,
        "toolVersion": TOOL_VERSION,
        "revisions": {
            "novel": max_updated_at(connection, "novels", "id", &novel_id),
            "volumes": max_updated_at(connection, "volumes", "novel_id", &novel_id),
            "chapters": max_updated_at(connection, "chapters", "novel_id", &novel_id),
            "style_profile": max_updated_at(connection, "style_profiles", "novel_id", &novel_id),
            "output_profile": max_updated_at(connection, "output_profiles", "novel_id", &novel_id)
        },
        "data": {
            "novel": novel,
            "volumes": volumes,
            "chapters": chapters,
            "targetChapter": {
                "chapterId": chapter_id,
                "position": target_position
            },
            "styleProfiles": style_profiles,
            "outputProfiles": output_profiles
        }
    }))
}

// ---------------------------------------------------------------------------
// get_chapter_context
// ---------------------------------------------------------------------------

fn get_chapter_context(connection: &Connection, arguments: &Value) -> Result<Value, String> {
    let novel_id = arg_id(arguments, "novelId")?;
    let chapter_id = arg_id(arguments, "chapterId")?;

    let outline = connection
        .query_row(
            "SELECT id, version, title, content, status, source_type
             FROM chapter_outlines WHERE chapter_id = ?1 AND is_active = 1
             ORDER BY version DESC LIMIT 1",
            params![chapter_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "version": row.get::<_, i64>(1)?,
                    "title": row.get::<_, String>(2)?,
                    "content": clip(row.get::<_, String>(3)?),
                    "status": row.get::<_, String>(4)?,
                    "sourceType": row.get::<_, String>(5)?
                }))
            },
        )
        .ok();

    let engineering_state = connection
        .query_row(
            "SELECT active_version, status, chapter_card_json, scene_plan_json, generation_constraints_json
             FROM chapter_engineering_states WHERE chapter_id = ?1 AND active_version = 1 LIMIT 1",
            params![chapter_id],
            |row| {
                Ok(json!({
                    "activeVersion": row.get::<_, i64>(0)?,
                    "status": row.get::<_, String>(1)?,
                    "chapterCard": clip(row.get::<_, String>(2)?),
                    "scenePlan": clip(row.get::<_, String>(3)?),
                    "generationConstraints": clip(row.get::<_, String>(4)?)
                }))
            },
        )
        .ok();

    let mut events = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, title, description, impact, risk, status
                 FROM chapter_events WHERE novel_id = ?1 AND chapter_id = ?2 ORDER BY created_at",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, chapter_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "description": clip(row.get::<_, String>(2)?),
                    "impact": row.get::<_, Option<String>>(3)?,
                    "risk": row.get::<_, Option<String>>(4)?,
                    "status": row.get::<_, String>(5)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(50) {
            events.push(row.map_err(|error| error.to_string())?);
        }
    }

    let order = chapter_order(connection, &chapter_id)?;
    let mut previous_summaries = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT c.id, c.title, c.order_index, s.summary, s.key_events, s.character_changes, s.next_chapter_hints
                 FROM chapters c
                 JOIN chapter_summaries s ON s.chapter_id = c.id AND s.novel_id = ?1
                 WHERE c.novel_id = ?1 AND c.order_index < ?2 AND c.deleted_at IS NULL
                 ORDER BY c.order_index DESC LIMIT 3",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, order], |row| {
                Ok(json!({
                    "chapterId": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "orderIndex": row.get::<_, i64>(2)?,
                    "summary": clip(row.get::<_, String>(3)?),
                    "keyEvents": clip(row.get::<_, Option<String>>(4)?.unwrap_or_default()),
                    "characterChanges": clip(row.get::<_, Option<String>>(5)?.unwrap_or_default()),
                    "nextChapterHints": clip(row.get::<_, Option<String>>(6)?.unwrap_or_default())
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(3) {
            previous_summaries.push(row.map_err(|error| error.to_string())?);
        }
    }

    let target_summary = connection
        .query_row(
            "SELECT summary, key_events, character_changes FROM chapter_summaries
             WHERE novel_id = ?1 AND chapter_id = ?2 ORDER BY created_at DESC LIMIT 1",
            params![novel_id, chapter_id],
            |row| {
                Ok(json!({
                    "summary": clip(row.get::<_, String>(0)?),
                    "keyEvents": clip(row.get::<_, Option<String>>(1)?.unwrap_or_default()),
                    "characterChanges": clip(row.get::<_, Option<String>>(2)?.unwrap_or_default())
                }))
            },
        )
        .ok();

    Ok(json!({
        "ok": true,
        "toolVersion": TOOL_VERSION,
        "revisions": {
            "outline": max_updated_at(connection, "chapter_outlines", "chapter_id", &chapter_id),
            "engineering_state": max_updated_at(connection, "chapter_engineering_states", "chapter_id", &chapter_id),
            "events": max_updated_at(connection, "chapter_events", "chapter_id", &chapter_id),
            "summaries": max_updated_at(connection, "chapter_summaries", "novel_id", &novel_id)
        },
        "data": {
            "outline": outline,
            "engineeringState": engineering_state,
            "chapterEvents": events,
            "previousChapterSummaries": previous_summaries,
            "targetChapterSummary": target_summary
        }
    }))
}

// ---------------------------------------------------------------------------
// search_memory
// ---------------------------------------------------------------------------

fn search_memory(connection: &Connection, arguments: &Value) -> Result<Value, String> {
    let novel_id = arg_id(arguments, "novelId")?;
    let query = arguments
        .get("query")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.len() <= QUERY_MAX)
        .ok_or_else(|| "query must be 1..=2000 chars".to_string())?;
    let top_k = arguments
        .get("topK")
        .or_else(|| arguments.get("top_k"))
        .and_then(Value::as_i64)
        .unwrap_or(8)
        .clamp(TOP_K_MIN, TOP_K_MAX);
    let chapter_filter = arguments
        .get("chapterId")
        .or_else(|| arguments.get("chapter_id"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= ID_MAX);
    let source_types: Vec<String> = arguments
        .get("sourceTypes")
        .or_else(|| arguments.get("source_types"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|value| {
                    matches!(*value, "adopted_draft" | "chapter_summary" | "context_record")
                })
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let min_importance = arguments
        .get("minImportance")
        .or_else(|| arguments.get("min_importance"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    let has_fts: bool = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'memory_chunks_fts'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    let mut rows = Vec::new();
    if has_fts && query.chars().count() >= 3 {
        let mut conditions = vec![
            "f.novel_id = ?1".to_string(),
            "d.status = 'active'".to_string(),
            "memory_chunks_fts MATCH ?2".to_string(),
        ];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(novel_id.clone()), Box::new(query.to_string())];
        if let Some(chapter) = chapter_filter {
            conditions.push(format!("m.chapter_id = ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(chapter.to_string()));
        }
        if !source_types.is_empty() {
            let rebuilt: Vec<String> = source_types
                .iter()
                .enumerate()
                .map(|(index, _)| format!("?{}", params_vec.len() + 1 + index))
                .collect();
            conditions.push(format!("d.source_type IN ({})", rebuilt.join(",")));
            for value in source_types.iter() {
                params_vec.push(Box::new(value.clone()));
            }
        }
        if min_importance > 0.0 {
            conditions.push(format!("m.importance >= ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(min_importance));
        }
        let sql = format!(
            "SELECT m.id, m.chapter_id, m.ordinal, m.text, m.importance, m.entity_keys_json, m.metadata_json, d.source_type, d.source_id, d.source_version
             FROM memory_chunks_fts f
             JOIN memory_chunks m ON m.id = f.chunk_id AND m.novel_id = f.novel_id
             JOIN memory_documents d ON d.id = m.document_id AND d.novel_id = m.novel_id
             WHERE {}
             ORDER BY m.importance DESC LIMIT ?{}",
            conditions.join(" AND "),
            params_vec.len() + 1
        );
        params_vec.push(Box::new(top_k));
        let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
        let mapped = statement
            .query_map(rusqlite::params_from_iter(params_vec.iter().map(|value| value.as_ref())), |row| {
                Ok(json!({
                    "chunkId": row.get::<_, String>(0)?,
                    "chapterId": row.get::<_, String>(1)?,
                    "ordinal": row.get::<_, i64>(2)?,
                    "text": clip_chunk(row.get::<_, String>(3)?),
                    "importance": row.get::<_, f64>(4)?,
                    "entityKeys": row.get::<_, String>(5)?,
                    "metadata": row.get::<_, String>(6)?,
                    "sourceType": row.get::<_, String>(7)?,
                    "sourceId": row.get::<_, String>(8)?,
                    "sourceVersion": row.get::<_, i64>(9)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in mapped {
            rows.push(row.map_err(|error| error.to_string())?);
        }
    } else {
        // LIKE fallback
        let mut conditions = vec!["m.novel_id = ?1".to_string(), "d.status = 'active'".to_string(), "m.text LIKE ?2".to_string()];
        let pattern = format!("%{}%", query);
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(novel_id.clone()), Box::new(pattern)];
        if let Some(chapter) = chapter_filter {
            conditions.push(format!("m.chapter_id = ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(chapter.to_string()));
        }
        if !source_types.is_empty() {
            let placeholders: Vec<String> = source_types
                .iter()
                .enumerate()
                .map(|(index, _)| format!("?{}", params_vec.len() + 1 + index))
                .collect();
            conditions.push(format!("d.source_type IN ({})", placeholders.join(",")));
            for value in source_types.iter() {
                params_vec.push(Box::new(value.clone()));
            }
        }
        if min_importance > 0.0 {
            conditions.push(format!("m.importance >= ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(min_importance));
        }
        let sql = format!(
            "SELECT m.id, m.chapter_id, m.ordinal, m.text, m.importance, m.entity_keys_json, m.metadata_json, d.source_type, d.source_id, d.source_version
             FROM memory_chunks m
             JOIN memory_documents d ON d.id = m.document_id AND d.novel_id = m.novel_id
             WHERE {}
             ORDER BY m.importance DESC LIMIT ?{}",
            conditions.join(" AND "),
            params_vec.len() + 1
        );
        params_vec.push(Box::new(top_k));
        let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
        let mapped = statement
            .query_map(rusqlite::params_from_iter(params_vec.iter().map(|value| value.as_ref())), |row| {
                Ok(json!({
                    "chunkId": row.get::<_, String>(0)?,
                    "chapterId": row.get::<_, String>(1)?,
                    "ordinal": row.get::<_, i64>(2)?,
                    "text": clip_chunk(row.get::<_, String>(3)?),
                    "importance": row.get::<_, f64>(4)?,
                    "entityKeys": row.get::<_, String>(5)?,
                    "metadata": row.get::<_, String>(6)?,
                    "sourceType": row.get::<_, String>(7)?,
                    "sourceId": row.get::<_, String>(8)?,
                    "sourceVersion": row.get::<_, i64>(9)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in mapped {
            rows.push(row.map_err(|error| error.to_string())?);
        }
    }

    Ok(json!({
        "ok": true,
        "toolVersion": TOOL_VERSION,
        "revisions": {
            "memory": max_updated_at(connection, "memory_documents", "novel_id", &novel_id)
        },
        "data": {
            "query": query,
            "matchedChunks": rows.len(),
            "chunks": rows,
            "searchMode": if has_fts { "fts5" } else { "like" }
        }
    }))
}

fn clip_chunk(value: String) -> String {
    if value.chars().count() > CHUNK_CLIP {
        let mut truncated: String = value.chars().take(CHUNK_CLIP).collect();
        truncated.push_str("…[truncated]");
        truncated
    } else {
        value
    }
}

// ---------------------------------------------------------------------------
// get_character_states
// ---------------------------------------------------------------------------

fn get_character_states(connection: &Connection, arguments: &Value) -> Result<Value, String> {
    let novel_id = arg_id(arguments, "novelId")?;
    let chapter_id = arg_id(arguments, "chapterId")?;
    let order = chapter_order(connection, &chapter_id)?;

    let mut characters = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, name, role_type, is_protagonist, current_state, personality, constraints, ability, goals, relation_to_protagonist, faction
                 FROM characters WHERE novel_id = ?1 AND is_active = 1 ORDER BY protagonist_order, name",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "roleType": row.get::<_, String>(2)?,
                    "isProtagonist": row.get::<_, i64>(3)?,
                    "currentState": clip(row.get::<_, Option<String>>(4)?.unwrap_or_default()),
                    "personality": clip(row.get::<_, Option<String>>(5)?.unwrap_or_default()),
                    "constraints": clip(row.get::<_, Option<String>>(6)?.unwrap_or_default()),
                    "ability": clip(row.get::<_, Option<String>>(7)?.unwrap_or_default()),
                    "goals": clip(row.get::<_, Option<String>>(8)?.unwrap_or_default()),
                    "relationToProtagonist": clip(row.get::<_, Option<String>>(9)?.unwrap_or_default()),
                    "faction": row.get::<_, Option<String>>(10)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(200) {
            characters.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut protagonists = Vec::new();
    {
        let mut statement = connection
            .prepare("SELECT id, name, current_state, goal, special_ability FROM protagonists WHERE novel_id = ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "currentState": clip(row.get::<_, Option<String>>(2)?.unwrap_or_default()),
                    "goal": clip(row.get::<_, Option<String>>(3)?.unwrap_or_default()),
                    "specialAbility": clip(row.get::<_, Option<String>>(4)?.unwrap_or_default())
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(20) {
            protagonists.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut state_track = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT cs.character_id, cs.chapter_id, cs.state_summary, cs.relationship_changes, cs.goal_changes, cs.location, cs.health_state, cs.knowledge_state, cs.created_at
                 FROM character_states cs
                 LEFT JOIN chapters c ON c.id = cs.chapter_id
                 WHERE cs.novel_id = ?1 AND (cs.chapter_id IS NULL OR c.order_index <= ?2)
                 ORDER BY cs.created_at DESC LIMIT 100",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, order], |row| {
                Ok(json!({
                    "characterId": row.get::<_, String>(0)?,
                    "chapterId": row.get::<_, Option<String>>(1)?,
                    "stateSummary": clip(row.get::<_, String>(2)?),
                    "relationshipChanges": clip(row.get::<_, Option<String>>(3)?.unwrap_or_default()),
                    "goalChanges": clip(row.get::<_, Option<String>>(4)?.unwrap_or_default()),
                    "location": row.get::<_, Option<String>>(5)?,
                    "healthState": row.get::<_, Option<String>>(6)?,
                    "knowledgeState": row.get::<_, Option<String>>(7)?,
                    "createdAt": row.get::<_, String>(8)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(100) {
            state_track.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut chapter_roles = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT character_id, character_name, role_in_chapter, must_appear, note
                 FROM chapter_characters WHERE novel_id = ?1 AND chapter_id = ?2",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, chapter_id], |row| {
                Ok(json!({
                    "characterId": row.get::<_, String>(0)?,
                    "characterName": row.get::<_, Option<String>>(1)?,
                    "roleInChapter": row.get::<_, String>(2)?,
                    "mustAppear": row.get::<_, i64>(3)?,
                    "note": row.get::<_, Option<String>>(4)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(100) {
            chapter_roles.push(row.map_err(|error| error.to_string())?);
        }
    }

    Ok(json!({
        "ok": true,
        "toolVersion": TOOL_VERSION,
        "revisions": {
            "characters": max_updated_at(connection, "characters", "novel_id", &novel_id),
            "character_states": max_updated_at(connection, "character_states", "novel_id", &novel_id),
            "chapter_characters": max_updated_at(connection, "chapter_characters", "chapter_id", &chapter_id)
        },
        "data": {
            "characters": characters,
            "protagonists": protagonists,
            "stateTrack": state_track,
            "chapterRoles": chapter_roles
        }
    }))
}

// ---------------------------------------------------------------------------
// Smoke mode: exercises every tool against the read-only database.
// ---------------------------------------------------------------------------

pub fn run_smoke(connection: &Connection) {
    let novel_id: Option<String> = connection
        .query_row(
            "SELECT id FROM novels WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();
    let chapter_id: Option<String> = novel_id.as_ref().and_then(|novel| {
        connection
            .query_row(
                "SELECT id FROM chapters WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index LIMIT 1",
                params![novel],
                |row| row.get(0),
            )
            .ok()
    });

    println!(
        "smoke: novel={} chapter={}",
        novel_id.as_deref().unwrap_or("none"),
        chapter_id.as_deref().unwrap_or("none")
    );
    println!("tool count: {}", tool_list().len());

    // Negative checks: unknown tool, missing args, and unknown ids must all reject.
    assert!(call_tool(connection, "not_a_tool", &json!({})).is_err());
    assert!(call_tool(connection, "get_metadata", &json!({})).is_err());
    assert!(call_tool(
        connection,
        "get_metadata",
        &json!({"novelId": "does-not-exist", "chapterId": "does-not-exist"})
    )
    .is_err());
    println!("smoke negative checks: ok (unknown tool / missing args / unknown ids rejected)");

    match (novel_id.as_deref(), chapter_id.as_deref()) {
        (Some(novel), Some(chapter)) => {
            let arguments = json!({"novelId": novel, "chapterId": chapter});
            for name in ["get_metadata", "get_chapter_context", "get_character_states"] {
                match call_tool(connection, name, &arguments) {
                    Ok(payload) => {
                        let size = serde_json::to_string(&payload).map(|value| value.len()).unwrap_or(0);
                        println!("smoke {}: ok, {} bytes", name, size);
                    }
                    Err(error) => println!("smoke {}: ERROR {}", name, error),
                }
            }
            let search = json!({"novelId": novel, "query": "主角", "topK": 5});
            match call_tool(connection, "search_memory", &search) {
                Ok(payload) => println!("smoke search_memory: ok, matched={}", payload["data"]["matchedChunks"]),
                Err(error) => println!("smoke search_memory: ERROR {}", error),
            }
        }
        _ => println!("smoke: database has no novels/chapters; only tool listing verified"),
    }
}
