//! One deterministic DAG step per root-runtime dispatch; no model and no loop.
use super::StartTaskTurnInput;
use crate::repositories::{
    agent_plan_repository::AgentPlanBundle, chapter_repository, novel_repository,
    world_setting_repository,
};
use crate::services::{agent_plan_service as plans, style_profile_service};
use rusqlite::Connection;
use serde_json::{json, Value};

fn bundle(connection: &Connection, plan_id: &str) -> Result<AgentPlanBundle, String> {
    plans::get_plan_bundle(connection, plan_id).map_err(|error| error.to_string())
}

pub(super) fn completed(connection: &Connection, plan_id: &str) -> Result<bool, String> {
    Ok(bundle(connection, plan_id)?.plan.status == "completed")
}

pub(super) fn prepare(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    plan_id: &str,
    retry_step_id: Option<&str>,
) -> Result<Value, String> {
    let mut current = bundle(connection, plan_id)?;
    if current.plan.novel_id != input.require_novel_id()?
        || input.chapter_id.as_deref() != Some(&current.plan.chapter_id)
        || current.plan.registry_hash != plans::PRODUCTION_TOOL_REGISTRY_HASH
    {
        return Err("DOMAIN_READINESS_SCOPE_OR_REGISTRY_MISMATCH".to_string());
    }
    if let Some(attached) = current.checkpoints.iter().find(|checkpoint| {
        checkpoint.event_type == "lease_acquired"
            && checkpoint.payload_json["ownerId"]
                .as_str()
                .is_some_and(|owner| owner.starts_with("domain-task:"))
    }) {
        if attached.payload_json["ownerId"].as_str()
            != Some(format!("domain-task:{}", input.conversation_id).as_str())
        {
            return Err("DOMAIN_PLAN_TASK_CONFLICT".to_string());
        }
    }
    if let Some(step_id) = retry_step_id {
        current = plans::authorize_retry(
            connection,
            plans::AuthorizeAgentPlanRetryInput {
                plan_id: plan_id.to_string(),
                step_id: step_id.to_string(),
                operation_id: format!("domain-retry:{}", input.turn_id),
            },
        )
        .map_err(|error| error.to_string())?;
    }
    if !matches!(
        current.plan.status.as_str(),
        "ready" | "running" | "completed"
    ) {
        return Err("AGENT_PLAN_EXPLICIT_RETRY_REQUIRED".to_string());
    }
    let next = current.steps.iter().find(|step| {
        step.status == "pending"
            && current
                .dependencies
                .iter()
                .filter(|dependency| dependency.step_id == step.step_id)
                .all(|dependency| {
                    current.steps.iter().any(|parent| {
                        parent.step_id == dependency.depends_on_step_id
                            && parent.status == "completed"
                    })
                })
    });
    if next.is_none() && current.plan.status != "completed" {
        return Err("AGENT_PLAN_DEPENDENCY_CONFLICT".to_string());
    }
    Ok(
        json!({"entryKind":"chapter_readiness","stageKey":next.map(|step|step.step_id.as_str()).unwrap_or("completed"),"planId":plan_id}),
    )
}

pub(super) fn execute(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    plan_id: &str,
    _run_id: &str,
) -> Result<Value, String> {
    let current = bundle(connection, plan_id)?;
    if current.plan.status == "completed" {
        return serde_json::to_value(current).map_err(|error| error.to_string());
    }
    let step_id = super::context(input)?["stageKey"]
        .as_str()
        .ok_or("DOMAIN_STAGE_CONTEXT_REQUIRED")?;
    let grant = plans::acquire_lease(
        connection,
        plans::AcquireAgentPlanLeaseInput {
            plan_id: plan_id.to_string(),
            owner_id: format!("domain-task:{}", input.conversation_id),
            ttl_seconds: Some(30),
        },
    )
    .map_err(|error| error.to_string())?;
    let lease = plans::AgentPlanLeaseProof {
        lease_id: grant.lease.lease_id,
        epoch: grant.lease.epoch,
        owner_id: grant.lease.owner_id,
        token: grant.token,
    };
    let claim = match plans::claim_step(
        connection,
        plans::ClaimAgentPlanStepInput {
            plan_id: plan_id.to_string(),
            step_id: step_id.to_string(),
            lease: lease.clone(),
        },
    ) {
        Ok(claim) => claim,
        Err(error) => {
            let _ = plans::release_lease(connection, plan_id, lease);
            return Err(error.to_string());
        }
    };
    let output = match read(
        connection,
        &claim.step.tool_name,
        input.require_novel_id()?,
        current.plan.chapter_id.as_str(),
    ) {
        Ok(output) => output,
        Err(error) => {
            plans::fail_step(
                connection,
                plans::FailAgentPlanStepInput {
                    plan_id: plan_id.to_string(),
                    step_id: step_id.to_string(),
                    attempt_id: claim.attempt.attempt_id,
                    error: crate::errors::AppError::new(
                        "AGENT_PLAN_TOOL_FAILED",
                        error.clone(),
                        true,
                    ),
                    lease,
                },
            )
            .map_err(|error| error.to_string())?;
            return Err(error);
        }
    };
    // Unknown persistence outcomes are reconciled from Plan/Attempt, never
    // converted to a failed tool result and never replayed automatically.
    let completed = plans::complete_step(
        connection,
        plans::CompleteAgentPlanStepInput {
            plan_id: plan_id.to_string(),
            step_id: step_id.to_string(),
            attempt_id: claim.attempt.attempt_id,
            output_json: output,
            lease: lease.clone(),
        },
    )
    .map_err(|error| error.to_string())?;
    if completed.plan.status != "completed" {
        plans::release_lease(connection, plan_id, lease).map_err(|error| error.to_string())?;
    }
    serde_json::to_value(completed).map_err(|error| error.to_string())
}

fn read(
    connection: &Connection,
    tool: &str,
    novel_id: &str,
    chapter_id: &str,
) -> Result<Value, String> {
    let chapter = chapter_repository::find_by_id(connection, chapter_id)?
        .ok_or("AGENT_PLAN_CHAPTER_NOT_FOUND")?;
    if chapter.novel_id != novel_id {
        return Err("DOMAIN_ENTRY_SCOPE_MISMATCH".to_string());
    }
    let data = match tool {
        "novel.read_context" => {
            let novel = novel_repository::find_by_id(connection, novel_id)?
                .ok_or("AGENT_PLAN_NOVEL_NOT_FOUND")?;
            let mut protagonists =
                serde_json::to_value(&novel.protagonists).map_err(|error| error.to_string())?;
            let authored = protagonists.as_array().is_some_and(|items| {
                items.iter().any(|item| {
                    [
                        "name",
                        "identity",
                        "goal",
                        "ability",
                        "specialAbility",
                        "background",
                    ]
                    .iter()
                    .any(|key| {
                        item.get(key)
                            .and_then(Value::as_str)
                            .is_some_and(|value| !value.trim().is_empty())
                    })
                })
            });
            if !authored {
                protagonists =
                    world_setting_repository::find_protagonist_by_novel(connection, novel_id)?
                        .map(|item| json!([item]))
                        .unwrap_or(json!([]));
            }
            json!({"novel":novel,"worldSettings":world_setting_repository::find_world_settings_by_novel(connection,novel_id)?,"protagonists":protagonists})
        }
        "chapter.read_outline" => json!({"chapter":chapter}),
        "chapter.read_context" => json!({"chapter":chapter,"novelId":novel_id}),
        "style.read_profile" => {
            let profiles = style_profile_service::list_style_profiles(connection, Some(novel_id))?;
            let active = profiles
                .iter()
                .find(|profile| profile.is_active)
                .or_else(|| profiles.first());
            json!({"activeStyle":active,"styleCount":profiles.len(),"hasActiveStyle":active.is_some()})
        }
        "style.read_output_control" => {
            let profiles = crate::commands::output_profiles::list_with(connection, Some(novel_id))?;
            json!({"profiles":profiles,"count":profiles.len()})
        }
        "verification.check_readiness" => return readiness(connection, novel_id, chapter_id),
        _ => return Err("AGENT_PLAN_TOOL_NOT_ALLOWED".to_string()),
    };
    Ok(json!({"ok":true,"source":"sqlite","data":data}))
}

fn readiness(connection: &Connection, novel_id: &str, chapter_id: &str) -> Result<Value, String> {
    let project = read(connection, "novel.read_context", novel_id, chapter_id)?;
    let outline = read(connection, "chapter.read_outline", novel_id, chapter_id)?;
    let style = read(connection, "style.read_profile", novel_id, chapter_id)?;
    let output = read(
        connection,
        "style.read_output_control",
        novel_id,
        chapter_id,
    )?;
    let mut missing = Vec::new();
    for (present, code, label, blocking) in [
        (
            project["data"]["novel"].is_object(),
            "core_context",
            "作品或章节上下文",
            true,
        ),
        (
            outline["data"]["chapter"]["outline"]
                .as_str()
                .is_some_and(|text| !text.trim().is_empty()),
            "chapter_outline",
            "章节大纲",
            true,
        ),
        (
            project["data"]["worldSettings"]
                .as_array()
                .is_some_and(|items| !items.is_empty()),
            "world_setting",
            "世界设定",
            true,
        ),
        (
            project["data"]["protagonists"]
                .as_array()
                .is_some_and(|items| !items.is_empty()),
            "protagonist",
            "主角设定",
            true,
        ),
        (
            style["data"]["hasActiveStyle"] == true,
            "style_profile",
            "风格方案",
            false,
        ),
        (
            output["data"]["count"].as_u64().unwrap_or(0) > 0,
            "output_profile",
            "输出控制方案",
            false,
        ),
    ] {
        if !present {
            missing.push(json!({"code":code,"label":label,"blocking":blocking}));
        }
    }
    let blocking = missing
        .iter()
        .filter(|item| item["blocking"] == true)
        .count();
    let optional = missing.len() - blocking;
    let score = (100_i64 - blocking as i64 * 25 - optional as i64 * 10).max(0);
    let summary = if blocking > 0 {
        format!("尚缺少 {blocking} 项生成前必需信息，请先补齐后再生成正文。")
    } else if optional > 0 {
        format!("核心上下文已准备，仍有 {optional} 项可选配置建议补充。")
    } else {
        "章节生成所需的核心上下文、风格和输出控制均已准备。".to_string()
    };
    Ok(
        json!({"ok":true,"source":"sqlite","data":{"ready":blocking==0,"score":score,"missing":missing,"warnings":[],"summary":summary}}),
    )
}
