//! Persisted autonomous planning is input/checkpoint state of the root runtime.
//! This module prepares or accepts exactly one bounded stage; it never dispatches.
use super::{context, value_string, DomainEntryRequest, StartTaskTurnInput, TaskRuntimeResult};
use crate::repositories::large_text_repository::sha256;
use crate::services::{ai_fact_security, artifact_service, autonomous_story_service as plans};
use rusqlite::Connection;
use serde_json::{json, Value};

const AGENTS: [&str; 6] = [
    "plot_planner",
    "character_evolution",
    "world_builder",
    "conflict_generator",
    "pacing_controller",
    "chapter_batch_planner",
];

fn save(connection: &mut Connection, mut plan: Value) -> Result<Value, String> {
    let revision = plan["revision"]
        .as_i64()
        .ok_or("DOMAIN_PLAN_REVISION_REQUIRED")?;
    plan["updatedAt"] = json!(chrono::Utc::now().to_rfc3339());
    plans::save_plan(connection, plan, revision).map_err(|error| error.to_string())
}

pub(super) fn completed(connection: &Connection, operation_id: &str) -> Result<bool, String> {
    Ok(plans::get_plan_by_operation(connection, operation_id)
        .map_err(|error| error.to_string())?
        .is_some_and(|plan| matches!(plan["status"].as_str(), Some("ready" | "applied"))))
}

pub(super) fn prepare(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    request: &DomainEntryRequest,
) -> Result<Value, String> {
    let DomainEntryRequest::AutonomousPlan {
        operation_id,
        brief,
        planning_mode,
        volume_strategy,
        baseline,
        resume_plan_id,
    } = request
    else {
        return Err("DOMAIN_ENTRY_KIND_INVALID".to_string());
    };
    if input.chapter_id.is_some() || operation_id.trim().is_empty() || operation_id.len() > 200 {
        return Err("DOMAIN_ENTRY_SCOPE_MISMATCH".to_string());
    }
    let inferred=if baseline.as_ref().is_some_and(|baseline|["existingVolumes","existingChapters"].iter().any(|key|baseline[*key].as_array().is_some_and(|items|!items.is_empty()))){"continuation"}else{"greenfield"};
    let mode = planning_mode.as_deref().unwrap_or(inferred);
    if !["greenfield", "continuation"].contains(&mode) {
        return Err("DOMAIN_PLANNING_MODE_INVALID".to_string());
    }
    let strategy = volume_strategy.as_deref().unwrap_or("create_new_volume");
    if !["create_new_volume", "append_to_last_volume"].contains(&strategy) {
        return Err("DOMAIN_VOLUME_STRATEGY_INVALID".to_string());
    }
    let object=brief.as_object().ok_or("DOMAIN_PLAN_BRIEF_INVALID")?;
    if object.keys().any(|key|!["premise","genre","targetChapterCount","targetWordsPerChapter","readerPromise","endingPreference","constraints"].contains(&key.as_str())){return Err("DOMAIN_PLAN_BRIEF_INVALID".to_string());}
    for (key,min,max) in [("premise",20,5000),("genre",1,80),("readerPromise",4,1000),("endingPreference",2,1000)]{
        let count=brief[key].as_str().ok_or("DOMAIN_PLAN_BRIEF_INVALID")?.trim().chars().count();if count<min||count>max{return Err("DOMAIN_PLAN_BRIEF_INVALID".to_string());}
    }
    let constraints=brief["constraints"].as_array().filter(|items|items.len()<=30).ok_or("DOMAIN_PLAN_BRIEF_INVALID")?;
    if constraints.iter().any(|item|item.as_str().is_none_or(|text|text.trim().is_empty()||text.chars().count()>300)){return Err("DOMAIN_PLAN_BRIEF_INVALID".to_string());}
    let target = brief["targetChapterCount"]
        .as_i64()
        .filter(|value| (12..=500).contains(value))
        .ok_or("DOMAIN_PLAN_BRIEF_INVALID")?;
    if !brief["targetWordsPerChapter"]
        .as_i64()
        .is_some_and(|value| (500..=10_000).contains(&value))
    {
        return Err("DOMAIN_PLAN_BRIEF_INVALID".to_string());
    }
    for key in ["premise", "genre", "readerPromise", "endingPreference"] {
        value_string(brief, key)?;
    }
    let mut hash_input = json!({"schemaVersion":1,"novelId":input.novel_id,"brief":brief});
    if mode == "continuation" {
        let mut frozen = baseline.clone().ok_or("DOMAIN_PLAN_BASELINE_REQUIRED")?;
        if frozen["novelId"].as_str() != Some(input.require_novel_id()?) {
            return Err("DOMAIN_ENTRY_SCOPE_MISMATCH".to_string());
        }
        frozen
            .as_object_mut()
            .ok_or("DOMAIN_PLAN_BASELINE_INVALID")?
            .remove("capturedAt");
        hash_input["planningMode"] = json!(mode);
        hash_input["volumeStrategy"] = json!(strategy);
        hash_input["baseline"] = frozen;
    }
    let request_hash =
        sha256(&ai_fact_security::canonical_json(&hash_input).map_err(|error| error.to_string())?);
    let existing = plans::get_plan_by_operation(connection, operation_id)
        .map_err(|error| error.to_string())?;
    let mut plan = if let Some(plan) = existing {
        if plan["requestHash"].as_str() != Some(&request_hash)
            || plan["novelId"].as_str() != Some(input.require_novel_id()?)
            || resume_plan_id
                .as_deref()
                .is_some_and(|id| plan["planId"].as_str() != Some(id))
        {
            return Err("OPERATION_PAYLOAD_CONFLICT".to_string());
        }
        plan
    } else {
        if resume_plan_id.is_some() {
            return Err("AUTONOMOUS_PLAN_NOT_FOUND".to_string());
        }
        if mode == "continuation" {
            let current = plans::get_planning_baseline(connection, input.require_novel_id()?)
                .map_err(|error| error.to_string())?;
            if current["structureHash"] != baseline.as_ref().unwrap()["structureHash"] {
                return Err("AUTONOMOUS_PLAN_BASE_CONFLICT".to_string());
            }
        }
        let now = chrono::Utc::now().to_rfc3339();
        let mut plan = json!({"schemaVersion":1,"planId":uuid::Uuid::new_v4().to_string(),"operationId":operation_id,"requestHash":request_hash,"novelId":input.novel_id,
            "status":"running","stage":"foundation","revision":0,"brief":brief,"arcs":[],"volumes":[],"characters":[],"worldElements":[],"conflicts":[],"pacingPhases":[],"pacingCurve":[],"chapters":[],"chapterRuns":[],
            "agentRuns":AGENTS.iter().map(|agent|json!({"agent":agent,"status":"pending","aiTaskIds":[],"tokensInput":0,"tokensOutput":0,"tokensUsed":0,"durationMs":0,"updatedAt":now})).collect::<Vec<_>>(),
            "progress":{"completedVolumeIds":[],"currentVolumeIndex":0,"adoptedChapterNumbers":[],"lastCheckpoint":"统一任务计划已创建"},"createdAt":now,"updatedAt":now,
            "runtimeConversationId":input.conversation_id,"runtimeModelSnapshot":input.model_snapshot});
        if mode == "continuation" {
            plan["planningMode"] = json!(mode);
            plan["volumeStrategy"] = json!(strategy);
            plan["baseline"] = baseline.clone().unwrap();
        }
        save(connection, plan)?
    };
    if let Some(owner) = plan["runtimeConversationId"].as_str() {
        if owner != input.conversation_id {
            return Err("DOMAIN_PLAN_TASK_CONFLICT".to_string());
        }
    }
    if let Some(model) = plan.get("runtimeModelSnapshot") {
        if model != &input.model_snapshot {
            return Err("DOMAIN_PLAN_MODEL_CONFLICT".to_string());
        }
    }
    if matches!(plan["status"].as_str(), Some("ready" | "applied")) {
        return Ok(json!({"completed":true,"projection":plan}));
    }
    if matches!(plan["status"].as_str(), Some("failed" | "cancelled")) {
        plan["status"] = json!("running");
        plan.as_object_mut().unwrap().remove("errorMessage");
        plan = save(connection, plan)?;
    }
    let (start, end) = range(&plan)?;
    let key = if plan.get("storyBible").is_none() {
        "foundation".to_string()
    } else if empty(&plan, "characters") {
        "characters".to_string()
    } else if empty(&plan, "worldElements") {
        "world".to_string()
    } else if empty(&plan, "conflicts") {
        "conflicts".to_string()
    } else if empty(&plan, "pacingCurve") {
        "pacing".to_string()
    } else {
        format!("chapters:{start}-{end}")
    };
    let schema = super::candidate_schema::schema("autonomous_plan", &key)?;
    let count=target-first_chapter(&plan)+1;
    let arc_count=((count+59)/60).clamp(3,8).min(count);
    let volume_count=((count+29)/30).clamp(1,24);
    Ok(
        json!({"entryKind":"autonomous_plan","stageKey":key,"planId":plan["planId"],"expectedRevision":plan["revision"],"schema":schema,
        "chapterStart":first_chapter(&plan),"chapterEnd":target,"arcCount":arc_count,"volumeCount":volume_count,"batchStart":start,"batchEnd":end,
        "plan":plan,"instructions":"只生成schema指定的当前一阶段。模型创建候选内稳定id并保持所有引用精确；既有卷/章/角色不得覆盖。foundation的故事弧和卷范围必须连续覆盖新增章节范围；characters成长节点覆盖开端和结尾；pacingCurve逐章连续。chapters阶段仅返回batchStart到batchEnd，不重做已完成计划。续写坐标为全书绝对章节号；append_to_last_volume仅首卷可引用baseline末卷，其他卷materialization=create。所有候选均待人工应用，不声明授权。"}),
    )
}

fn empty(plan: &Value, key: &str) -> bool {
    plan[key].as_array().is_none_or(|items| items.is_empty())
}
fn first_chapter(plan: &Value) -> i64 {
    plan.pointer("/baseline/existingChapters")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item["chapterNumber"].as_i64())
                .max()
                .unwrap_or(0)
                + 1
        })
        .unwrap_or(1)
}
fn range(plan: &Value) -> Result<(i64, i64), String> {
    let first = first_chapter(plan);
    let target = plan["brief"]["targetChapterCount"]
        .as_i64()
        .ok_or("DOMAIN_PLAN_BRIEF_INVALID")?;
    let chapters = plan["chapters"]
        .as_array()
        .ok_or("DOMAIN_PLAN_CHAPTERS_INVALID")?;
    if chapters
        .iter()
        .enumerate()
        .any(|(index, item)| item["chapterNumber"].as_i64() != Some(first + index as i64))
    {
        return Err("DOMAIN_PLAN_CHECKPOINT_NONCONTIGUOUS".to_string());
    }
    let next = first + chapters.len() as i64;
    Ok((next, (next + 9).min(target)))
}

pub(super) fn accept(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    result: &TaskRuntimeResult,
    payload: &Value,
) -> Result<(), String> {
    let stage = context(input)?;
    let key = value_string(stage, "stageKey")?;
    super::candidate_schema::validate(&stage["schema"], payload)?;
    let plan_id = value_string(stage, "planId")?;
    let mut plan = super::scoped_plan(connection, input.require_novel_id()?, plan_id)?;
    if plan["revision"] != stage["expectedRevision"] {
        return Err("AUTONOMOUS_PLAN_STATE_CONFLICT".to_string());
    }
    let agent_index = match key {
        "foundation" => 0,
        "characters" => 1,
        "world" => 2,
        "conflicts" => 3,
        "pacing" => 4,
        _ if key.starts_with("chapters:") => 5,
        _ => return Err("DOMAIN_PLAN_STAGE_INVALID".to_string()),
    };
    if agent_index == 5 {
        let (start, end) = range(&plan)?;
        let chapters = payload["chapters"]
            .as_array()
            .ok_or("DOMAIN_PLAN_CHAPTERS_INVALID")?;
        if chapters.len() as i64 != end - start + 1
            || chapters
                .iter()
                .enumerate()
                .any(|(index, item)| item["chapterNumber"].as_i64() != Some(start + index as i64))
        {
            return Err("DOMAIN_PLAN_BATCH_RANGE_INVALID".to_string());
        }
        plan["chapters"]
            .as_array_mut()
            .unwrap()
            .extend(chapters.iter().cloned());
    } else {
        for (field, value) in payload.as_object().unwrap() {
            plan[field] = value.clone();
        }
    }
    if agent_index == 0 {
        validate_foundation(&plan)?;
    }
    let artifact = artifact_service::get_artifact_bundle(
        connection,
        result
            .artifact_id
            .as_deref()
            .ok_or("DOMAIN_CANDIDATE_REQUIRED")?,
    )
    .map_err(|error| error.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let run = &mut plan["agentRuns"][agent_index];
    run["status"] = json!("succeeded");
    run["updatedAt"] = json!(now);
    run["aiTaskIds"]
        .as_array_mut()
        .ok_or("DOMAIN_PLAN_AGENT_RUN_INVALID")?
        .push(json!(artifact.artifact.task_id));
    plan["progress"]["lastCheckpoint"] = json!(format!("统一运行时阶段 {key} 已验证保存"));
    plan["stage"] = json!(if agent_index < 1 {
        "creative_dimensions"
    } else {
        "chapter_batches"
    });
    let target = plan["brief"]["targetChapterCount"].as_i64().unwrap();
    if agent_index == 5 && range(&plan)?.0 > target {
        plan["status"] = json!("ready");
        plan["stage"] = json!("ready");
        plan["completedAt"] = json!(now);
        plan["progress"]["completedVolumeIds"] = json!(plan["volumes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].clone())
            .collect::<Vec<_>>());
        plan["progress"]["lastCheckpoint"] = json!("全书计划已完成，等待用户确认应用");
    }
    save(connection, plan).map(|_| ())
}

fn validate_foundation(plan: &Value) -> Result<(), String> {
    let first = first_chapter(plan);
    let target = plan["brief"]["targetChapterCount"].as_i64().unwrap();
    let count=target-first+1;
    if plan["arcs"].as_array().map(Vec::len)!=Some(((count+59)/60).clamp(3,8).min(count) as usize)
        || plan["volumes"].as_array().map(Vec::len)!=Some(((count+29)/30).clamp(1,24) as usize) {return Err("DOMAIN_PLAN_SHAPE_INVALID".to_string());}
    for field in ["arcs", "volumes"] {
        let mut cursor = first;
        for item in plan[field]
            .as_array()
            .ok_or("DOMAIN_PLAN_FOUNDATION_INVALID")?
        {
            if item["chapterStart"].as_i64() != Some(cursor) {
                return Err("DOMAIN_PLAN_FOUNDATION_RANGE_INVALID".to_string());
            }
            let end = item["chapterEnd"]
                .as_i64()
                .filter(|end| *end >= cursor && *end <= target)
                .ok_or("DOMAIN_PLAN_FOUNDATION_RANGE_INVALID")?;
            cursor = end + 1;
        }
        if cursor != target + 1 {
            return Err("DOMAIN_PLAN_FOUNDATION_RANGE_INVALID".to_string());
        }
    }
    Ok(())
}
