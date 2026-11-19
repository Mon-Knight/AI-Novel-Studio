//! Verified multi-provider provenance for deterministic chapter assembly.
use super::*;
use crate::repositories::chapter_workflow_stage_repository;

pub(super) struct AssemblySources {
    pub context_run_id: String,
    pub manifest: Value,
}

pub(super) fn verify(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    text: &str,
    evidence: &Value,
) -> Result<AssemblySources, String> {
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    let novel_id = input.require_novel_id()?;
    if evidence["schemaVersion"] != "native_staged_assembly_v1"
        || evidence["workflowId"] != input.turn_id
        || evidence["novelId"] != novel_id
        || evidence["chapterId"] != json!(input.chapter_id)
        || evidence["assemblyHash"] != large_text_repository::sha256(text)
        || evidence["candidateOnly"] != true
    {
        return Err("DSH_ASSEMBLY_EVIDENCE_INVALID".into());
    }
    let sources = evidence["orderedSourceStages"]
        .as_array()
        .filter(|s| !s.is_empty() && s.len() <= 200)
        .ok_or("DSH_ASSEMBLY_SOURCE_MANIFEST_INVALID")?;
    let mut ids = HashSet::new();
    let mut model_runs = Vec::new();
    let mut prose = Vec::new();
    for source in sources {
        let id = source
            .get("stageId")
            .and_then(Value::as_str)
            .ok_or("DSH_ASSEMBLY_SOURCE_MANIFEST_INVALID")?;
        if !ids.insert(id) {
            return Err("DSH_ASSEMBLY_SOURCE_DUPLICATE".into());
        }
        let row = chapter_workflow_stage_repository::find_stage(connection, id)
            .map_err(|e| e.to_string())?
            .ok_or("DSH_ASSEMBLY_SOURCE_MISSING")?;
        if row.status != "succeeded"
            || row.workflow_id != input.turn_id
            || row.conversation_id != input.conversation_id
            || row.novel_id != novel_id
            || Some(row.chapter_id.as_str()) != input.chapter_id.as_deref()
            || source["stageKey"] != row.stage_key
            || source["kind"] != row.stage_kind
            || source["runId"] != row.run_id
            || source["resultHash"] != json!(row.result_hash)
            || source["artifactId"] != json!(row.verified_artifact_id)
            || source["inputHash"] != row.input_hash
            || source["planHash"] != row.plan_hash
            || row.context_hash != evidence["sourceContextHash"]
        {
            return Err("DSH_ASSEMBLY_SOURCE_MISMATCH".into());
        }
        let body = if let Some(document) = row.result_document_id.as_deref() {
            let owned:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM large_text_documents WHERE id=?1 AND target_type='chapter_workflow_stage' AND target_id=?2 AND field_name='result')",rusqlite::params![document,id],|r|r.get(0)).map_err(|e|e.to_string())?;
            if !owned {
                return Err("DSH_ASSEMBLY_SOURCE_OWNER_MISMATCH".into());
            }
            large_text_repository::read_verified_document(connection, document)
                .map_err(|e| e.to_string())?
                .content
        } else {
            row.result_json
                .clone()
                .ok_or("DSH_ASSEMBLY_SOURCE_CONTENT_MISSING")?
        };
        if Some(large_text_repository::sha256(&body).as_str()) != row.result_hash.as_deref() {
            return Err("DSH_ASSEMBLY_SOURCE_HASH_MISMATCH".into());
        }
        if row.stage_kind == "beat_write" {
            prose.push(body);
        }
        let run = crate::repositories::conversation_repository::get_run(connection, &row.run_id)
            .map_err(|e| e.to_string())?
            .ok_or("DSH_ASSEMBLY_SOURCE_RUN_MISSING")?;
        if run.conversation_id != input.conversation_id
            || run.turn_id != input.turn_id
            || run.chapter_id != input.chapter_id
            || run.status != "completed"
            || retry::model_identity(&run.model_snapshot) != root.model_identity
        {
            return Err("DSH_ASSEMBLY_SOURCE_RUN_INVALID".into());
        }
        let contract:String=connection.query_row("SELECT arguments_summary_json FROM tool_call_events WHERE run_id=?1 AND tool_name='dsh.execution_contract' AND status='succeeded'",[&run.run_id],|r|r.get(0)).map_err(|e|e.to_string())?;
        let contract: Value =
            serde_json::from_str(&contract).map_err(|_| "DSH_ASSEMBLY_SOURCE_CONTRACT_INVALID")?;
        if contract
            .pointer("/execution/rootRunId")
            .and_then(Value::as_str)
            != Some(root.root_run_id.as_str())
            || contract
                .pointer("/execution/rootTurnId")
                .and_then(Value::as_str)
                != Some(root.root_turn_id.as_str())
        {
            return Err("DSH_ASSEMBLY_SOURCE_ROOT_MISMATCH".into());
        }
        if matches!(
            row.stage_kind.as_str(),
            "beat_plan" | "beat_write" | "beat_state"
        ) && !model_runs.contains(&run.run_id)
        {
            model_runs.push(run.run_id);
        }
    }
    if prose.join("\n\n") != text || model_runs.is_empty() {
        return Err("DSH_ASSEMBLY_EXACT_JOIN_MISMATCH".into());
    }
    let mut requests = Vec::new();
    let mut context_run = None;
    for run in &model_runs {
        let mut source_input = input.clone();
        source_input.expected_tool = None;
        source_input.expected_artifact_type = None;
        source_input.task_kind = "chapter_stage_write".into();
        source_input.required_read_tools =
            CONTEXT_READ_TOOLS.split(',').map(str::to_string).collect();
        validate_turn_execution_contract(connection, &source_input, run)
            .map_err(|e| e.to_string())?;
        let mut statement=connection.prepare("SELECT r.provider_request_id,r.accounted_input_tokens,r.accounted_output_tokens,r.accounted_cost_units,r.status,r.accounted_cost_status,e.arguments_summary_json FROM ai_request_reservations r JOIN tool_call_events e ON e.event_id=r.reservation_id||'-root-usage' WHERE e.run_id=?1 AND e.tool_name='dsh.request_usage' AND r.owner_id=?2 ORDER BY r.started_at_ms,r.reservation_id").map_err(|e|e.to_string())?;
        let rows = statement
            .query_map(rusqlite::params![run, root.owner_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if rows.is_empty() {
            return Err("DSH_ASSEMBLY_SOURCE_USAGE_MISSING".into());
        }
        let mut settled_known = false;
        for (request, input_tokens, output_tokens, cost, status, cost_status, args) in rows {
            let args: Value =
                serde_json::from_str(&args).map_err(|_| "DSH_ASSEMBLY_SOURCE_USAGE_UNKNOWN")?;
            if cost_status.as_deref() != Some("complete")
                || input_tokens.is_none()
                || output_tokens.is_none()
                || cost.is_none()
            {
                return Err("DSH_ASSEMBLY_SOURCE_USAGE_UNKNOWN".into());
            }
            match status.as_str() {
                "settled" if args["usageKnown"] == true => settled_known = true,
                "failed" => {}
                _ => return Err("DSH_ASSEMBLY_SOURCE_USAGE_UNKNOWN".into()),
            }
            requests.push(json!({"runId":run,"providerRequestId":request,"tokenInput":input_tokens,"tokenOutput":output_tokens,"costUsd":cost.map(|v|v as f64/100_000_000.0)}));
        }
        if !settled_known {
            return Err("DSH_ASSEMBLY_SOURCE_USAGE_UNKNOWN".into());
        }
        context_run = Some(run.clone());
    }
    Ok(AssemblySources {
        context_run_id: context_run.ok_or("DSH_ASSEMBLY_CONTEXT_SOURCE_MISSING")?,
        manifest: json!({"kind":"native_staged_assembly","sourceManifest":evidence,"sourceModelRequests":requests,"assemblyPerformsModelCall":false,"rootBudget":usage::usage_for_root(connection,&input.conversation_id,&root.root_turn_id).map_err(|e|e.to_string())?}),
    })
}
