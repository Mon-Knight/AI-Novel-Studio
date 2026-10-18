//! A dialogue may request one existing governed workflow; this tool never writes assets.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub const ACTIONS: [&str; 8] = [
    "prepare_settings",
    "prepare_characters",
    "generate_outline",
    "generate_chapter",
    "polish_chapter",
    "summarize_chapter",
    "check_quality",
    "suggest_events",
];

pub fn schema() -> Value {
    json!({
        "name": "creative.plan_action",
        "description": "交流并确认意图后，请求一个受治理的创作工作流。先背景/规则/准备模板，再人物，再大纲，最后正文。仅提问/讨论时不要调用。instruction 必须完整转述已确认信息、推演标记与具体要求，不能仅写继续。不会保存或采用候选。",
        "inputSchema": {
            "type": "object", "additionalProperties": false,
            "properties": {
                "novelId": {"type":"string","minLength":1,"maxLength":160},
                "chapterId": {"type":"string","minLength":1,"maxLength":160},
                "action": {"type":"string","enum":ACTIONS},
                "instruction": {"type":"string","minLength":1,"maxLength":24000}
            }, "required": ["novelId", "action", "instruction"]
        }
    })
}

pub fn plan(connection: &Connection, arguments: &Value) -> Result<Value, String> {
    let object = arguments.as_object().ok_or("创作动作参数必须是对象")?;
    if object
        .keys()
        .any(|key| !["novelId", "chapterId", "action", "instruction"].contains(&key.as_str()))
    {
        return Err("创作动作包含未知字段".into());
    }
    let novel = text(arguments, "novelId", 160)?;
    let action = text(arguments, "action", 80)?;
    let instruction = text(arguments, "instruction", 24000)?;
    if !ACTIONS.contains(&action) {
        return Err("未知创作动作；不能请求自动采用或正式写入".into());
    }
    let exists = connection
        .query_row("SELECT 1 FROM novels WHERE id=?1", [novel], |_| Ok(()))
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();
    if !exists {
        return Err("作品不存在".into());
    }
    let chapter_action = matches!(
        action,
        "generate_chapter"
            | "polish_chapter"
            | "summarize_chapter"
            | "check_quality"
            | "suggest_events"
    );
    let chapter = arguments
        .get("chapterId")
        .map(|_| text(arguments, "chapterId", 160))
        .transpose()?;
    if chapter_action && chapter.is_none() {
        return Err("请先与用户确定目标章节，不能猜测章节标识".into());
    }
    if let Some(chapter) = chapter {
        let valid = connection
            .query_row(
                "SELECT 1 FROM chapters WHERE id=?1 AND novel_id=?2",
                params![chapter, novel],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();
        if !valid {
            return Err("目标章节不属于本作品".into());
        }
    }
    if matches!(
        action,
        "prepare_characters" | "generate_outline" | "generate_chapter"
    ) {
        let mut missing = Vec::new();
        for (label, sql) in [
            ("背景", "SELECT COUNT(*) FROM world_settings WHERE novel_id=?1 AND is_active=1 AND length(trim(content))>0"),
            ("规则/前置说明", "SELECT COUNT(*) FROM rule_systems WHERE novel_id=?1 AND is_active=1 AND length(trim(content))>0"),
        ] {
            let count: i64 = connection.query_row(sql, [novel], |r| r.get(0)).map_err(|e| e.to_string())?;
            if count == 0 { missing.push(label); }
        }
        if action != "prepare_characters" {
            let count: i64 = connection.query_row("SELECT COUNT(*) FROM characters WHERE novel_id=?1 AND is_active=1 AND (is_protagonist=1 OR role_type='protagonist')", [novel], |r| r.get(0)).map_err(|e| e.to_string())?;
            let (profiles, main): (String,String) = connection.query_row("SELECT COALESCE(protagonists_json,'[]'),COALESCE(main_character,'') FROM novels WHERE id=?1",[novel],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
            let legacy: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM protagonists WHERE novel_id=?1 AND length(trim(name))>0",
                    [novel],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if count == 0
                && super::project_protagonists_json(&profiles).is_empty()
                && main.trim().is_empty()
                && legacy == 0
            {
                missing.push("主角");
            }
        }
        if !missing.is_empty() {
            return Err(format!("创作准备尚未确认：{}。请先讨论缺项；可推演候选并请用户确认采用，然后再请求人物/大纲/正文工作流。",missing.join("、")));
        }
    }
    let mut data = json!({"action":action,"instruction":instruction});
    if chapter_action || (action == "generate_outline" && chapter.is_some()) {
        data["chapterId"] = json!(chapter);
    }
    Ok(json!({"ok":true,"toolVersion":"v1","workflowRequestOnly":true,"novelId":novel,"data":data}))
}

fn text<'a>(arguments: &'a Value, key: &str, limit: usize) -> Result<&'a str, String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.chars().count() <= limit)
        .ok_or_else(|| format!("创作动作缺少有效的 {}", key))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE novels(id TEXT,protagonists_json TEXT DEFAULT '[]',main_character TEXT DEFAULT ''); INSERT INTO novels(id) VALUES('n'); CREATE TABLE chapters(id TEXT,novel_id TEXT); INSERT INTO chapters VALUES('c','n'); CREATE TABLE world_settings(novel_id TEXT,is_active INTEGER,content TEXT); CREATE TABLE rule_systems(novel_id TEXT,is_active INTEGER,content TEXT); CREATE TABLE characters(novel_id TEXT,is_active INTEGER,is_protagonist INTEGER,role_type TEXT); CREATE TABLE protagonists(novel_id TEXT,name TEXT);").unwrap();
        db
    }
    #[test]
    fn dialogue_request_does_not_write_and_preserves_instruction() {
        let db = fixture();
        let result=plan(&db,&json!({"novelId":"n","action":"prepare_settings","instruction":"悬疑；未定项标为推演，确认后采用"})).unwrap();
        assert_eq!(
            result["data"]["instruction"],
            "悬疑；未定项标为推演，确认后采用"
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM world_settings", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(result["workflowRequestOnly"].as_bool().unwrap());
    }
    #[test]
    fn background_then_characters_then_outline_is_enforced() {
        let db = fixture();
        let args = json!({"novelId":"n","action":"generate_outline","instruction":"写大纲"});
        assert!(plan(&db, &args).unwrap_err().contains("背景"));
        db.execute_batch("INSERT INTO world_settings VALUES('n',1,'港口'); INSERT INTO rule_systems VALUES('n',1,'现实物理');").unwrap();
        assert!(plan(&db, &args).unwrap_err().contains("主角"));
        assert!(plan(
            &db,
            &json!({"novelId":"n","action":"prepare_characters","instruction":"准备人物"})
        )
        .is_ok());
        db.execute_batch("INSERT INTO characters VALUES('n',1,1,'protagonist');")
            .unwrap();
        assert!(plan(&db, &args).is_ok());
    }
    #[test]
    fn rejects_unknown_writes_and_wrong_chapter() {
        let db = fixture();
        for args in [
            json!({"novelId":"n","action":"adopt","instruction":"覆盖"}),
            json!({"novelId":"n","action":"polish_chapter","instruction":"润色","chapterId":"foreign"}),
            json!({"novelId":"n","action":"check_quality","instruction":"检查"}),
        ] {
            assert!(plan(&db, &args).is_err());
        }
    }
    #[test]
    fn dialogue_can_select_another_real_chapter_but_cannot_leave_the_novel() {
        use super::super::{call_tool_with_security_context, TaskScope, TaskSecurityContext};
        let db = fixture();
        db.execute_batch("INSERT INTO chapters VALUES('next','n'),('foreign','other');")
            .unwrap();
        let call = |novel: &str, chapter: &str| {
            call_tool_with_security_context(
                &db,
                "creative.plan_action",
                &json!({"novelId":novel,"chapterId":chapter,"action":"polish_chapter","instruction":"用户要求润色下一章"}),
                Ok(TaskSecurityContext {
                    allowed_tools: Some(std::collections::HashSet::from([
                        "creative.plan_action".to_string()
                    ])),
                    scope: Some(TaskScope {
                        novel_id: "n".into(),
                        chapter_id: Some("c".into()),
                    }),
                    candidate_policy: None,
                }),
            )
        };
        assert_eq!(call("n", "next").unwrap()["data"]["chapterId"], "next");
        assert!(call("n", "foreign").is_err());
        assert!(call("other", "foreign").is_err());
    }
    #[test]
    fn manually_confirmed_and_legacy_protagonists_are_not_reported_missing() {
        let db = fixture();
        db.execute_batch("INSERT INTO world_settings VALUES('n',1,'港口'); INSERT INTO rule_systems VALUES('n',1,'现实物理');").unwrap();
        let args = json!({"novelId":"n","action":"generate_outline","instruction":"写大纲"});
        for (profiles, main) in [
            (r#"[{"name":"沈知微","identity":"修复师"}]"#, ""),
            ("[]", "沈知微"),
        ] {
            db.execute(
                "UPDATE novels SET protagonists_json=?1,main_character=?2",
                params![profiles, main],
            )
            .unwrap();
            assert!(plan(&db, &args).is_ok());
        }
        db.execute_batch("UPDATE novels SET protagonists_json='[]',main_character=''; INSERT INTO protagonists VALUES('n','沈知微');").unwrap();
        assert!(plan(&db, &args).is_ok());
    }
}
