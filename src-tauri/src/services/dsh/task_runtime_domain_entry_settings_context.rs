//! Preserve setting-suggestion context options while keeping hard rules and exact
//! adopted-source evidence mandatory. No model chooses what was authoritatively read.
use crate::repositories::{chapter_repository,character_asset_repository,draft_repository,novel_repository,world_setting_repository};
use crate::services::draft_service;
use rusqlite::Connection;
use serde_json::{json,Value};
fn clip(text:&str,max:usize)->String{text.chars().take(max).collect()}
pub(super) fn capture(connection:&Connection,novel_id:&str,request:&Value)->Result<Value,String>{
    let novel=novel_repository::find_by_id(connection,novel_id)?.ok_or("SETTING_SUGGESTION_NOVEL_NOT_FOUND")?;
    let rules=world_setting_repository::find_rule_systems_by_novel(connection,novel_id)?.into_iter().filter(|rule|rule.is_active).collect::<Vec<_>>();
    let rules=serde_json::to_value(rules).map_err(|error|error.to_string())?;
    if rules.to_string().chars().count()>60_000{return Err("DOMAIN_RULE_CONTEXT_LIMIT_REACHED: 不会截掉禁止事项后继续生成".to_string());}
    let world=if request["includeWorldSettings"]==true{
        let values=world_setting_repository::find_world_settings_by_novel(connection,novel_id)?;
        let text=values.iter().map(|item|format!("《{}》{}",item.title,item.content)).collect::<Vec<_>>().join("\n");
        json!({"text":clip(&text,2400),"clipped":text.chars().count()>2400})
    }else{Value::Null};
    let assets=if request["includeExistingAssets"]==true{
        let values=character_asset_repository::find_characters_by_novel(connection,novel_id)?;
        let text=values.iter().map(|item|format!("{} / {} / {}",item.name,item.identity.as_deref().unwrap_or_default(),item.faction.as_deref().unwrap_or_default())).collect::<Vec<_>>().join("、");
        json!({"text":clip(&text,1200),"clipped":text.chars().count()>1200})
    }else{Value::Null};
    let chapters=chapter_repository::find_by_novel_id(connection,novel_id)?;
    let adopted=chapters.iter().filter(|chapter|chapter.adopted_draft_id.is_some()).collect::<Vec<_>>();
    let mut evidence=Vec::new();
    for chapter in adopted.iter().skip(adopted.len().saturating_sub(20)){
        let draft_id=chapter.adopted_draft_id.as_deref().unwrap();
        let draft=draft_repository::find_draft(connection,draft_id).map_err(|error|error.to_string())?.ok_or("SETTING_ADOPTED_EVIDENCE_UNAVAILABLE")?;
        if !draft.is_adopted||draft.novel_id!=novel_id||draft.chapter_id!=chapter.id{return Err("SETTING_ADOPTED_EVIDENCE_SCOPE_INVALID".to_string());}
        let verified=draft_service::load_full_content(connection,&draft).map_err(|error|error.to_string())?;
        evidence.push(json!({"chapterId":chapter.id,"chapterTitle":chapter.title,"draftId":draft.id,"version":draft.version_no,"contentHash":verified.content_hash,"excerpt":clip(&verified.content,1200),"clipped":verified.content.chars().count()>1200}));
    }
    Ok(json!({"novel":{"id":novel.id,"title":novel.title,"genre":novel.genre,"description":novel.description},"activeRules":rules,"optionalWorld":world,"optionalAssets":assets,"adoptedEvidence":evidence,"adoptedCount":adopted.len(),"omittedAdoptedChapters":adopted.len().saturating_sub(20),"semanticValidation":"not_checked"}))
}

pub(super) fn validate_sources(connection:&Connection,novel_id:&str,context:&Value)->Result<(),String>{
    let chapters=chapter_repository::find_by_novel_id(connection,novel_id)?;
    let adopted=chapters.iter().filter(|chapter|chapter.adopted_draft_id.is_some()).collect::<Vec<_>>();
    let sources=context["adoptedEvidence"].as_array().ok_or("SETTING_ADOPTED_EVIDENCE_UNAVAILABLE")?;
    if sources.len()!=adopted.len().min(20){return Err("SETTING_ADOPTED_EVIDENCE_BASE_CONFLICT".to_string());}
    if context["adoptedCount"].as_u64()!=Some(adopted.len()as u64){return Err("SETTING_ADOPTED_EVIDENCE_BASE_CONFLICT".to_string());}
    for(source,chapter)in sources.iter().zip(adopted.iter().skip(adopted.len().saturating_sub(20))){
        if source["chapterId"].as_str()!=Some(&chapter.id)||source["draftId"].as_str()!=chapter.adopted_draft_id.as_deref(){return Err("SETTING_ADOPTED_EVIDENCE_BASE_CONFLICT".to_string());}
        let draft=draft_repository::find_draft(connection,chapter.adopted_draft_id.as_deref().unwrap()).map_err(|error|error.to_string())?.ok_or("SETTING_ADOPTED_EVIDENCE_UNAVAILABLE")?;
        let verified=draft_service::load_full_content(connection,&draft).map_err(|error|error.to_string())?;
        if !draft.is_adopted||source["version"].as_i64()!=Some(draft.version_no)||source["contentHash"]!=verified.content_hash{return Err("SETTING_ADOPTED_EVIDENCE_BASE_CONFLICT".to_string());}
    }
    Ok(())
}
