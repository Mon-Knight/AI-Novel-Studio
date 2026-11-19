//! Failure projection updates existing domain checkpoints, never execution or
//! formal data. Already committed candidates remain visible and are not undone.
use super::{context,entry,DomainEntryRequest,StartTaskTurnInput};
use crate::services::{agent_plan_service,autonomous_story_service};
use rusqlite::Connection;
use serde_json::json;

pub(crate) fn cleanup(connection:&mut Connection,input:&StartTaskTurnInput,reason:&str)->Result<(),String>{
    let Some(entry)=entry(input)else{return Ok(());};
    let cancelled=reason.to_ascii_lowercase().contains("cancel");
    let status=if cancelled{"cancelled"}else{"failed"};
    match &entry.request {
        DomainEntryRequest::AutonomousScheduler{..}=>super::scheduler::cleanup(connection,input,reason),
        DomainEntryRequest::AutonomousPlan{operation_id,..}=>{
            let Some(mut plan)=autonomous_story_service::get_plan_by_operation(connection,operation_id).map_err(|error|error.to_string())?else{return Ok(());};
            if plan["status"]!="running"{return Ok(());}
            plan["status"]=json!(status);plan["errorMessage"]=json!(reason.chars().take(100).collect::<String>());
            if let Some(runs)=plan["agentRuns"].as_array_mut(){for run in runs{if run["status"]=="running"{run["status"]=json!(status);}}}
            super::chapter::save(connection,plan).map(|_|())
        },
        DomainEntryRequest::AutonomousChapter{plan_id,..}|DomainEntryRequest::AutonomousPostChapter{plan_id,..}=>{
            let mut plan=super::scoped_plan(connection,input.require_novel_id()?,plan_id)?;
            let chapter=input.chapter_id.as_deref().or_else(||context(input).ok().and_then(|stage|stage["chapterId"].as_str()));
            let Some(run)=plan["chapterRuns"].as_array_mut().and_then(|runs|runs.iter_mut().rev().find(|run|run["chapterId"].as_str()==chapter))else{return Ok(());};
            let mut changed=false;
            if matches!(run["status"].as_str(),Some("generating"|"reviewing")){run["status"]=json!(status);run["errorMessage"]=json!(reason.chars().take(100).collect::<String>());changed=true;}
            if run["analysis"]["status"]=="running"{run["analysis"]["status"]=json!(status);run["analysis"]["errorMessage"]=json!(reason.chars().take(100).collect::<String>());changed=true;}
            if changed{super::chapter::save(connection,plan).map(|_|())}else{Ok(())}
        },
        DomainEntryRequest::ChapterReadiness{plan_id,..}=>{
            let plan=agent_plan_service::get_plan_bundle(connection,plan_id).map_err(|error|error.to_string())?;
            if cancelled&&matches!(plan.plan.status.as_str(),"ready"|"running"){agent_plan_service::cancel_plan(connection,plan_id).map_err(|error|error.to_string())?;}
            Ok(())
        },
        DomainEntryRequest::StyleAnalyze{..}|DomainEntryRequest::SettingSuggestions{..}|DomainEntryRequest::OutlineGenerate{..}=>Ok(()),
    }
}
