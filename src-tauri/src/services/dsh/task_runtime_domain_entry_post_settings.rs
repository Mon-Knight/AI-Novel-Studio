//! Derive pending world candidates from the already validated summary facts.
//! This is deterministic projection, not another model loop or formal rule write.
use crate::commands::setting_suggestions::{save_setting_suggestions_with,SaveSettingSuggestionInput};
use rusqlite::Connection;
use serde_json::{json,Value};
pub(super) fn project(connection:&mut Connection,novel_id:&str,stage:&Value,candidate:&Value,artifact_id:&str)->Result<Vec<String>,String>{
    let mut inputs=Vec::new();
    for(kind,fields)in [("location",vec!["newLocations"]),("rule",vec!["settingChanges","newItemsOrAbilities"]) ]{
        let seeds=fields.iter().filter_map(|field|candidate[*field].as_array()).flatten().filter_map(Value::as_str).filter(|seed|!seed.trim().is_empty()).take(5);
        for(index,seed)in seeds.enumerate(){
            let id=format!("domain-post-{artifact_id}-{kind}-{index}");
            let name=seed.chars().take(80).collect::<String>();
            inputs.push(serde_json::from_value::<SaveSettingSuggestionInput>(json!({"id":id,"novelId":novel_id,"suggestionType":kind,"worldType":"已采用正文","referenceStyle":"仅依据经来源校验的总结事实","prompt":"由统一任务总结事实派生的待确认候选，不扩充未证实正史。","resultJson":json!({"runtimeArtifactId":artifact_id,"sourceFact":seed,"derivation":"validated_summary_fact"}).to_string(),"expectedRuleSetFingerprint":stage.pointer("/nativeRuleSet/fingerprint"),"item":{"name":name,"description":seed,"content":seed},"status":"pending","rawOutput":seed})).map_err(|_|"DOMAIN_POST_SETTING_PROJECTION_INVALID")?);
        }
    }
    if inputs.is_empty(){return Ok(vec![]);}
    save_setting_suggestions_with(connection,inputs).map(|records|records.into_iter().map(|record|record.id).collect())
}
