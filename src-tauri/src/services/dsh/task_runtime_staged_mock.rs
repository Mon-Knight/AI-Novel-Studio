//! Offline model-response fixture for the same structured stage tool protocol.
//! It does not dispatch stages, bypass native validation, or represent literary evidence.
use super::*;

pub(in super::super) fn mock_arguments(input: &StartTaskTurnInput) -> Result<Value, String> {
    let novel=input.require_novel_id()?;
    let chapter=input.chapter_id.as_deref().filter(|id|!id.trim().is_empty()).ok_or("CHAPTER_STAGED_SCOPE_REQUIRED")?;
    let ctx = context(input).ok_or("CHAPTER_STAGED_CONTEXT_MISSING")?;
    let payload = &ctx.stage.payload;
    let body = match ctx.stage.kind.as_str() {
        "beat_plan" => {
            let targets = payload["targetCharacters"]
                .as_array()
                .ok_or("CHAPTER_STAGED_MOCK_INPUT_INVALID")?;
            let scene = source::text(&payload["scene"], "title", 8_000).unwrap_or("当前场景");
            json!({"beats":targets.iter().enumerate().map(|(i,_)|json!({"order":i+1,
                "text":format!("{scene}：完成第{}次连续行动，核对现场取得的线索。",i+1),"required":true,
                "startState":if i==0{"承接输入中已核对的实际入口，不把计划当成事实。".into()}else{format!("承接第{i}个Beat实际正文结尾，不复述前文。")},
                "stateChange":format!("第{}次行动获得可在当前正文中逐字定位的变化。",i+1)})).collect::<Vec<_>>()}).to_string()
        }
        "beat_write" => {
            let target = payload["beat"]["targetCharacters"]
                .as_i64()
                .ok_or("CHAPTER_STAGED_MOCK_INPUT_INVALID")?;
            let scope = large_text_repository::sha256(&format!(
                "{}:{}",
                chapter,
                ctx.stage.key
            ));
            let mut body=format!("他将刻着「{}」的木牌翻过来，借窗边的光辨认新的细痕。袖口沾着雨水，门外的脚步停在台阶下，他没有替尚未核实的事情作出结论。\n\n",&scope[..32]);
            let used = crate::services::draft_service::word_count(&body);
            let letters:Vec<char>="晨光落在长街石阶雨水缓缓流过门前远处传来脚步他收起旧信推开木窗望见山影于是决定沿河寻找那个尚未回答的问题".chars().collect();
            for index in 0..(target - used).max(0) as usize {
                body.push(letters[index % letters.len()]);
                if index % 32 == 31 {
                    body.push('。');
                }
                if index % 128 == 127 {
                    body.push_str("\n\n");
                }
            }
            if !body.ends_with('。') {
                body.push('。');
            }
            body
        }
        "beat_state" => {
            let prose = source::text(payload, "prose", 64 * 1024)?;
            let quote: String = prose.chars().take(24).collect();
            let fact = json!({"text":format!("本Beat原文记录：{quote}"),"epistemic":"explicit",
                "evidence":[{"start":0,"end":quote.encode_utf16().count(),"quote":quote}]});
            json!({"schemaVersion":1,"sourceTextHash":large_text_repository::sha256(prose),"actualStateChange":[fact],
                "endState":fact,"unknowns":[],"semanticValidation":"not_checked"}).to_string()
        }
        _ => return Err("CHAPTER_STAGED_MOCK_LOCAL_STAGE_FORBIDDEN".into()),
    };
    let binding = json!({"schemaVersion":1,"workflowId":input.turn_id,"stageKey":ctx.stage.key,
        "inputHash":ctx.stage.input_hash,"planHash":ctx.stage.plan_hash});
    let content =
        format!("{body}\n[CHAPTER_WORKFLOW_BINDING]\n{binding}\n[/CHAPTER_WORKFLOW_BINDING]");
    Ok(
        json!({"novelId":novel,"chapterId":chapter,"stageKey":ctx.stage.key,"stageKind":ctx.stage.kind,"content":content}),
    )
}
