//! Deterministic replay of the authoritative stage DAG (bounded scan, not a task loop).
//! Every reused unit is re-hashed and must form the exact Scene/Beat prefix.
use super::*;
use crate::repositories::chapter_workflow_stage_repository::{
    self as repository, ChapterWorkflowStageQuery, ChapterWorkflowStageRecord,
};

#[derive(Debug, Clone)]
pub(super) struct StageSpec {
    pub key: String,
    pub kind: String,
    pub scene_id: Option<String>,
    pub beat_id: Option<String>,
    pub payload: Value,
    pub input_hash: String,
    pub plan_hash: String,
    pub local_result: Option<String>,
}

#[derive(Debug)]
pub(super) struct Replay {
    pub next: StageSpec,
    pub complete: bool,
    pub ordered: Vec<ChapterWorkflowStageRecord>,
    pub text: String,
}

fn spec(
    frozen: &source::FrozenPlan,
    kind: &str,
    scene: Option<&Value>,
    beat: Option<&Value>,
    payload: Value,
    plan_hash: &str,
    local_result: Option<String>,
) -> Result<StageSpec, String> {
    let scene_id = scene
        .map(|v| source::text(v, "id", 80).map(str::to_string))
        .transpose()?;
    let beat_id = beat
        .map(|v| source::text(v, "id", 180).map(str::to_string))
        .transpose()?;
    let key = match (scene_id.as_deref(), beat) {
        (Some(scene), Some(beat)) => format!(
            "{kind}:{scene}:{}",
            beat["order"]
                .as_i64()
                .ok_or("CHAPTER_STAGED_BEAT_ORDER_INVALID")?
        ),
        (Some(scene), None) => format!("{kind}:{scene}"),
        _ => kind.to_string(),
    };
    let key = format!(
        "chapter:{}:{key}",
        source::text(&frozen.source, "chapterId", 80)?
    );
    if key.len() > 200 {
        return Err("CHAPTER_STAGED_KEY_TOO_LONG".into());
    }
    let input_hash = source::hash(
        &json!({"schemaVersion":"native_staged_input_v1","key":key,"kind":kind,
        "sourceContextHash":frozen.source_hash,"baseHash":frozen.base_hash,"modelHash":frozen.model_hash,
        "wordRange":frozen.range,"planHash":plan_hash,"input":payload}),
    )?;
    Ok(StageSpec {
        key,
        kind: kind.into(),
        scene_id,
        beat_id,
        payload,
        input_hash,
        plan_hash: plan_hash.into(),
        local_result,
    })
}

pub(super) fn rows(
    connection: &Connection,
    input: &StartTaskTurnInput,
) -> Result<Vec<ChapterWorkflowStageRecord>, String> {
    let novel = input.require_novel_id()?;
    let chapter = input
        .chapter_id
        .as_deref()
        .ok_or("CHAPTER_STAGED_SCOPE_REQUIRED")?;
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapter_workflow_stages WHERE workflow_id=?1 AND chapter_id=?2",
            params![input.turn_id, chapter],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > 200 {
        return Err("CHAPTER_STAGED_CHECKPOINT_LIMIT_EXCEEDED".into());
    }
    let records = repository::list_stages(
        connection,
        &ChapterWorkflowStageQuery {
            novel_id: novel.to_string(),
            chapter_id: chapter.into(),
            conversation_id: Some(input.conversation_id.clone()),
            workflow_id: Some(input.turn_id.clone()),
            limit: 200,
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    if records.len() != count as usize {
        return Err("CHAPTER_STAGED_CHECKPOINT_SCOPE_MISMATCH".into());
    }
    Ok(records)
}

pub(super) fn owned_document(
    connection: &Connection,
    id: &str,
    kind: &str,
    target: &str,
    field: &str,
) -> Result<String, String> {
    let owned:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM large_text_documents WHERE id=?1 AND target_type=?2 AND target_id=?3 AND field_name=?4)",
        params![id,kind,target,field],|r|r.get(0)).map_err(|e|e.to_string())?;
    if !owned {
        return Err("CHAPTER_STAGED_RESULT_OWNER_MISMATCH".into());
    }
    large_text_repository::read_verified_document(connection, id)
        .map(|d| d.content)
        .map_err(|e| e.to_string())
}

pub(super) fn content(
    connection: &Connection,
    row: &ChapterWorkflowStageRecord,
) -> Result<String, String> {
    let body = match (
        &row.result_document_id,
        &row.result_json,
        &row.verified_artifact_id,
    ) {
        (Some(id), None, None) => owned_document(
            connection,
            id,
            "chapter_workflow_stage",
            &row.stage_id,
            "result",
        )?,
        (None, Some(body), None) => body.clone(),
        _ => return Err("CHAPTER_STAGED_RESULT_MISSING".into()),
    };
    if row.result_hash.as_deref() != Some(large_text_repository::sha256(&body).as_str()) {
        return Err("CHAPTER_STAGED_RESULT_HASH_MISMATCH".into());
    }
    Ok(body)
}

fn take(
    connection: &Connection,
    input: &StartTaskTurnInput,
    frozen: &source::FrozenPlan,
    next: &StageSpec,
    remaining: &mut HashMap<String, ChapterWorkflowStageRecord>,
    ordered: &mut Vec<ChapterWorkflowStageRecord>,
) -> Result<Option<String>, String> {
    let Some(row) = remaining.remove(&next.key) else {
        if !remaining.is_empty() {
            return Err("CHAPTER_STAGED_CHECKPOINT_ORDER_INVALID".into());
        }
        return Ok(None);
    };
    if row.workflow_id != input.turn_id
        || row.conversation_id != input.conversation_id
        || row.novel_id.as_str() != input.require_novel_id()?
        || Some(&row.chapter_id) != input.chapter_id.as_ref()
        || row.stage_kind != next.kind
        || row.scene_id != next.scene_id
        || row.beat_id != next.beat_id
        || row.plan_version != 2
        || row.context_hash != frozen.source_hash
        || row.base_hash != frozen.base_hash
        || row.input_hash != next.input_hash
        || row.plan_hash != next.plan_hash
    {
        return Err("CHAPTER_STAGED_CHECKPOINT_BASELINE_CHANGED".into());
    }
    let run = crate::repositories::conversation_repository::get_run(connection, &row.run_id)
        .map_err(|e| e.to_string())?
        .ok_or("CHAPTER_STAGED_SOURCE_RUN_MISSING")?;
    if run.conversation_id != input.conversation_id
        || run.turn_id != input.turn_id
        || run.chapter_id != input.chapter_id
        || source::hash(&run.model_snapshot)? != row.model_snapshot_hash
        || source::hash(&retry::model_identity(&run.model_snapshot))? != frozen.model_hash
    {
        return Err("CHAPTER_STAGED_SOURCE_RUN_MISMATCH".into());
    }
    let body = content(connection, &row)?;
    if next
        .local_result
        .as_ref()
        .is_some_and(|expected| expected != &body)
    {
        return Err("CHAPTER_STAGED_LOCAL_RESULT_MISMATCH".into());
    }
    ordered.push(row);
    Ok(Some(body))
}

fn pending(next: StageSpec, ordered: Vec<ChapterWorkflowStageRecord>, texts: &[String]) -> Replay {
    Replay {
        next,
        complete: false,
        ordered,
        text: texts.join("\n\n"),
    }
}

pub(super) fn replay(
    connection: &Connection,
    input: &StartTaskTurnInput,
    frozen: &source::FrozenPlan,
) -> Result<Replay, String> {
    let mut remaining = HashMap::new();
    for row in rows(connection, input)? {
        if row.status == "succeeded" && remaining.insert(row.stage_key.clone(), row).is_some() {
            return Err("CHAPTER_STAGED_CHECKPOINT_DUPLICATE".into());
        }
    }
    let mut ordered = Vec::new();
    let mut texts: Vec<String> = Vec::new();
    let mut states: Vec<Value> = Vec::new();
    let imported = json!({"schemaVersion":2,"scenes":frozen.scenes,"sourceContextHash":frozen.source_hash,
        "planHash":frozen.plan_hash,"wordRange":frozen.range});
    let first = spec(
        frozen,
        "scene_plan",
        None,
        None,
        json!({"appliedPlan":imported}),
        &frozen.plan_hash,
        Some(imported.to_string()),
    )?;
    if take(
        connection,
        input,
        frozen,
        &first,
        &mut remaining,
        &mut ordered,
    )?
    .is_none()
    {
        return Ok(pending(first, ordered, &texts));
    }
    for (scene_index, scene) in frozen.scenes.iter().enumerate() {
        let entry = json!({"candidateOnly":true,"semanticValidation":"not_checked","priorStates":states,
            "initial":"尚无实际候选状态时只依据冻结正式前文；计划不是既成事实"});
        let previous = texts.join("\n\n");
        let payload = json!({"scene":scene,"sourceContextHash":frozen.source_hash,"previousTextHash":large_text_repository::sha256(&previous),
            "acceptedProse":previous,"actualEntryState":entry,"inputStateHash":source::hash(&entry)?,
            "targetCharacters":source::beat_targets(scene["targetCharacters"].as_i64().ok_or("CHAPTER_STAGED_PLAN_INVALID")?)?});
        let plan_spec = spec(
            frozen,
            "beat_plan",
            Some(scene),
            None,
            payload,
            &frozen.plan_hash,
            None,
        )?;
        let Some(body) = take(
            connection,
            input,
            frozen,
            &plan_spec,
            &mut remaining,
            &mut ordered,
        )?
        else {
            return Ok(pending(plan_spec, ordered, &texts));
        };
        let plan = validation::validate_plan(&body, &plan_spec.payload)?;
        let plan_hash = source::text(&plan, "planHash", 64)?;
        let beats = plan["beats"]
            .as_array()
            .ok_or("CHAPTER_STAGED_BEAT_PLAN_INVALID")?;
        let start = texts.len();
        let mut scene_ids = Vec::new();
        for (beat_index, beat) in beats.iter().enumerate() {
            let previous = texts.join("\n\n");
            let payload = json!({"scene":scene,"beat":beat,"acceptedProse":previous,"previousTextHash":large_text_repository::sha256(&previous),
                "actualStates":states,"laterBeats":&beats[beat_index+1..],
                "laterSceneGoals":frozen.scenes[scene_index+1..].iter().map(|s|s["goal"].clone()).collect::<Vec<_>>()});
            let write_spec = spec(
                frozen,
                "beat_write",
                Some(scene),
                Some(beat),
                payload,
                plan_hash,
                None,
            )?;
            let Some(body) = take(
                connection,
                input,
                frozen,
                &write_spec,
                &mut remaining,
                &mut ordered,
            )?
            else {
                return Ok(pending(write_spec, ordered, &texts));
            };
            validation::normalize("beat_write", &body, &write_spec.payload)?;
            texts.push(body.clone());
            scene_ids.push(beat["id"].clone());
            let payload = json!({"prose":body,"sourceTextHash":large_text_repository::sha256(&body),"previousState":states.last()});
            let state_spec = spec(
                frozen,
                "beat_state",
                Some(scene),
                Some(beat),
                payload,
                plan_hash,
                None,
            )?;
            let Some(state_body) = take(
                connection,
                input,
                frozen,
                &state_spec,
                &mut remaining,
                &mut ordered,
            )?
            else {
                return Ok(pending(state_spec, ordered, &texts));
            };
            let state: Value =
                serde_json::from_str(&state_body).map_err(|_| "CHAPTER_STAGED_STATE_INVALID")?;
            validation::validate_state(&state, &body)?;
            states.push(state);
        }
        let closed = json!({"sceneId":scene["id"],"planHash":plan_hash,"contentHash":large_text_repository::sha256(&texts[start..].join("\n\n")),
            "beatIds":scene_ids,"actualEndState":states.last().and_then(|v|v.get("endState")),
            "unknowns":states[start..].iter().flat_map(|s|s["unknowns"].as_array().into_iter().flatten().cloned()).collect::<Vec<_>>(),
            "stateSourceBeatIds":scene_ids,"semanticValidation":"not_checked"});
        let close_spec = spec(
            frozen,
            "scene_close",
            Some(scene),
            None,
            json!({"actual":closed}),
            plan_hash,
            Some(closed.to_string()),
        )?;
        if take(
            connection,
            input,
            frozen,
            &close_spec,
            &mut remaining,
            &mut ordered,
        )?
        .is_none()
        {
            return Ok(pending(close_spec, ordered, &texts));
        }
    }
    let text = texts.join("\n\n");
    let assembly = spec(
        frozen,
        "chapter_assemble",
        None,
        None,
        json!({"orderedSources":evidence_rows(&ordered),"assemblyHash":large_text_repository::sha256(&text)}),
        &frozen.plan_hash,
        Some(text.clone()),
    )?;
    let complete = take(
        connection,
        input,
        frozen,
        &assembly,
        &mut remaining,
        &mut ordered,
    )?
    .is_some();
    if !remaining.is_empty() {
        return Err("CHAPTER_STAGED_CHECKPOINT_EXTRA_RESULT".into());
    }
    Ok(Replay {
        next: assembly,
        complete,
        ordered,
        text,
    })
}

pub(super) fn evidence_rows(rows: &[ChapterWorkflowStageRecord]) -> Value {
    json!(rows
        .iter()
        .map(
            |r| json!({"stageId":r.stage_id,"stageKey":r.stage_key,"kind":r.stage_kind,
        "runId":r.run_id,"resultHash":r.result_hash,"artifactId":r.verified_artifact_id,
        "inputHash":r.input_hash,"planHash":r.plan_hash})
        )
        .collect::<Vec<_>>())
}
