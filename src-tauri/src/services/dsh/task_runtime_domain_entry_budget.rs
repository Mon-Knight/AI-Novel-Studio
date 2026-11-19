//! Initial ceilings derive from native domain facts, never a child-supplied
//! remaining budget. The root intersects them with grants and persisted limits.
use super::{entry,scoped_plan,DomainEntryRequest,StartTaskTurnInput};
use crate::services::{autonomous_story_service,autonomous_scheduler_service};
use rusqlite::Connection;
use serde_json::Value;
#[derive(Debug,Clone,Copy,PartialEq,Eq)]
pub(crate) struct DomainBudgetBounds{pub stages:i64,pub requests:i64,pub tools:i64}
fn limits(models:i64,local_stages:i64)->DomainBudgetBounds{
    DomainBudgetBounds{stages:(models+local_stages+8).clamp(1,64),requests:(models*3+24).clamp(1,192),tools:(models*5+32).clamp(1,512)}
}
pub(crate) fn budget_bounds(connection:&Connection,input:&StartTaskTurnInput)->Result<Option<DomainBudgetBounds>,String>{
    let Some(entry)=entry(input)else{return Ok(None);};
    if input.execution.is_some(){return Err("DOMAIN_ROOT_BUDGET_ALREADY_FROZEN".to_string());}
    let bounds=match &entry.request{
        DomainEntryRequest::StyleAnalyze{source}=>{let samples=crate::services::task_style_source::validate_source(connection,input.novel_id.as_deref(),source).map_err(|error|error.to_string())?;limits(samples.len() as i64,0)},
        DomainEntryRequest::ChapterReadiness{plan_id,..}=>{
            let bundle=crate::services::agent_plan_service::get_plan_bundle(connection,plan_id).map_err(|error|error.to_string())?;
            if bundle.plan.novel_id!=input.require_novel_id()?||input.chapter_id.as_deref()!=Some(&bundle.plan.chapter_id)||bundle.steps.len()!=6{return Err("DOMAIN_BUDGET_SCOPE_MISMATCH".to_string());}
            limits(0,6)
        },
        DomainEntryRequest::SettingSuggestions{..}|DomainEntryRequest::OutlineGenerate{..}|DomainEntryRequest::AutonomousPostChapter{..}=>limits(1,0),
        DomainEntryRequest::AutonomousPlan{operation_id,..}=>{
            let plan=autonomous_story_service::get_plan_by_operation(connection,operation_id).map_err(|error|error.to_string())?.ok_or("AUTONOMOUS_PLAN_NOT_FOUND")?;
            if plan["novelId"].as_str()!=Some(input.require_novel_id()?)||plan["runtimeConversationId"].as_str()!=Some(&input.conversation_id){return Err("DOMAIN_BUDGET_SCOPE_MISMATCH".to_string());}
            let target=plan["brief"]["targetChapterCount"].as_i64().filter(|count|(12..=500).contains(count)).ok_or("DOMAIN_PLAN_BRIEF_INVALID")?;
            let first=plan.pointer("/baseline/existingChapters").and_then(Value::as_array).and_then(|chapters|chapters.iter().filter_map(|chapter|chapter["chapterNumber"].as_i64()).max()).unwrap_or(0)+1;
            let total=target-first+1;if !(1..=500).contains(&total){return Err("DOMAIN_PLAN_RANGE_INVALID".to_string());}
            let chapters=plan["chapters"].as_array().ok_or("DOMAIN_PLAN_CHAPTERS_INVALID")?;
            if chapters.len()as i64>total||chapters.iter().enumerate().any(|(index,chapter)|chapter["chapterNumber"].as_i64()!=Some(first+index as i64)){return Err("DOMAIN_PLAN_CHECKPOINT_NONCONTIGUOUS".to_string());}
            let missing=["storyBible","characters","worldElements","conflicts","pacingCurve"].iter().filter(|field|plan.get(**field).is_none_or(|value|value.is_null()||value.as_array().is_some_and(Vec::is_empty))).count()as i64;
            let models=missing+(total-chapters.len()as i64+9)/10;
            limits(models,0)
        },
        DomainEntryRequest::AutonomousChapter{plan_id,..}=>{
            let plan=scoped_plan(connection,input.require_novel_id()?,plan_id)?;
            if plan["status"]!="applied"||!plan["chapters"].as_array().is_some_and(|chapters|chapters.iter().any(|chapter|chapter["id"].as_str()==input.chapter_id.as_deref())){return Err("DOMAIN_BUDGET_SCOPE_MISMATCH".to_string());}
            // Three finite writer/expert rounds, one summary, two integrity repairs,
            // and three native admission stages. Explicit grants can only lower it.
            limits(3*7+1+2,3)
        },
        DomainEntryRequest::AutonomousScheduler{run_id,..}=>{
            let run=autonomous_scheduler_service::get_run(connection,run_id).map_err(|error|error.to_string())?.ok_or("AUTONOMOUS_RUN_NOT_FOUND")?;
            if run.novel_id!=input.require_novel_id()?{return Err("DOMAIN_BUDGET_SCOPE_MISMATCH".to_string());}
            run.policy.validate(run.total_chapters).map_err(|error|error.to_string())?;
            let remaining=(run.total_chapters.min(run.policy.max_chapters)-run.completed_chapters).max(0);
            limits(remaining.saturating_mul(24),remaining.saturating_mul(3))
        },
    };
    Ok(Some(bounds))
}
