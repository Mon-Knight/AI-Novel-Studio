//! Offline model-response fixture only. No IO, task state, writes or orchestration.
use serde_json::{json, Value};

pub fn mock_payload(stage: &Value) -> Result<Value, String> {
    let kind = stage["entryKind"]
        .as_str()
        .ok_or("DOMAIN_MOCK_CONTEXT_INVALID")?;
    let key = stage["stageKey"]
        .as_str()
        .ok_or("DOMAIN_MOCK_CONTEXT_INVALID")?;
    if kind == "setting_suggestions" {
        let count = stage["request"]["count"]
            .as_u64()
            .filter(|count| (1..=50).contains(count))
            .ok_or("DOMAIN_MOCK_COUNT_INVALID")?;
        return Ok(
            json!({"items":(1..=count).map(|index|json!({"name":format!("离线候选{index}"),"description":"受控离线夹具候选，必须人工审阅后才能采用。","content":"离线材料仅作为候选，不修改既有正式规则。"})).collect::<Vec<_>>()}),
        );
    }
    if kind == "autonomous_chapter" && key.starts_with("review:") {
        return Ok(
            json!({"score":85,"accepted":true,"summary":"受控离线协议评审，不代表文学效果通过。","issues":[],"suggestions":[]}),
        );
    }
    if kind=="style_analyze" {
        let payload=json!({"name":"离线风格候选","styleSummary":"受控离线响应只证明结构化协议，不代表风格或文学效果已验证。","narrativePerspective":"第三人称","tone":"克制","pace":"均衡","dialogueRatio":0.35,"descriptionRatio":0.4,"psychologicalRatio":0.15,"forbiddenStyles":[]});
        super::validate(&super::schema(kind,key)?,&payload)?;return Ok(payload);
    }
    if kind=="outline_generate" {
        let payload=match key {
            "editor_text"=>json!({"title":"离线大纲候选","content":"受控离线夹具大纲，围绕既有上下文推进可观察行动；不代表文学效果验收。"}),
            "volume_candidate"=>json!({"title":"离线分卷候选","summary":"受控离线夹具提供分卷结构候选，等待人工确认。","goal":"推进阶段冲突","mainConflict":"选择与后果"}),
            "chapter_candidates"=>{let count=stage.get("chapterCount").or_else(||stage.pointer("/request/chapterCount")).and_then(Value::as_u64).unwrap_or(6);if !(1..=200).contains(&count){return Err("DOMAIN_MOCK_COUNT_INVALID".to_string());}json!({"chapters":(1..=count).map(|index|json!({"title":format!("离线章节候选{index}"),"outline":"角色读取线索并采取行动，形成可观察的章节结果。","goal":"推进线索","targetWordCount":2400})).collect::<Vec<_>>()})},
            _=>return Err("DOMAIN_MOCK_STAGE_UNSUPPORTED".to_string()),
        };
        super::validate(&super::schema(kind,key)?,&payload)?;return Ok(payload);
    }
    if kind != "autonomous_plan" {
        return Err("DOMAIN_MOCK_KIND_UNSUPPORTED".to_string());
    }
    let plan = &stage["plan"];
    let plan_id = plan["planId"].as_str().ok_or("DOMAIN_MOCK_PLAN_INVALID")?;
    let start = stage["chapterStart"]
        .as_i64()
        .ok_or("DOMAIN_MOCK_RANGE_INVALID")?;
    let end = stage["chapterEnd"]
        .as_i64()
        .ok_or("DOMAIN_MOCK_RANGE_INVALID")?;
    if start < 1 || end < start || end > 500 {
        return Err("DOMAIN_MOCK_RANGE_INVALID".to_string());
    }
    let id = |suffix: &str| format!("{plan_id}-{suffix}");
    let payload = match key {
        "foundation" => {
            let count=end-start+1;
            let arc_count=stage["arcCount"].as_i64().filter(|count|*count>0&&*count<=8).ok_or("DOMAIN_MOCK_SHAPE_INVALID")?;
            let volume_count=stage["volumeCount"].as_i64().filter(|count|*count>0&&*count<=24).ok_or("DOMAIN_MOCK_SHAPE_INVALID")?;
            let ranges=|parts:i64| -> Vec<(i64,i64)> { let mut cursor=start;(0..parts).map(|index|{let size=count/parts+i64::from(index<count%parts);let range=(cursor,cursor+size-1);cursor+=size;range}).collect() };
            let arcs=ranges(arc_count).iter().enumerate().map(|(index,(start,end))|json!({"id":id(&format!("arc-{index}")),"index":index,"title":format!("离线故事弧{index}"),"chapterStart":start,"chapterEnd":end,"goal":"推进核心矛盾","turningPoint":"发现关键线索","climax":"作出重要选择","outcome":"形成阶段结果"})).collect::<Vec<_>>();
            let append=plan["volumeStrategy"]=="append_to_last_volume";
            let previous=plan.pointer("/baseline/existingVolumes").and_then(Value::as_array).and_then(|items|items.iter().max_by_key(|item|item["orderIndex"].as_i64().unwrap_or(0)));
            let next_index=previous.and_then(|item|item["orderIndex"].as_i64()).map(|index|index+1).unwrap_or(0);
            let volumes=ranges(volume_count).iter().enumerate().map(|(index,(start,end))|{
                let existing=append&&index==0&&previous.is_some();
                let volume_id=if existing{previous.unwrap()["id"].as_str().unwrap_or_default().to_string()}else{id(&format!("volume-{index}"))};
                let volume_index=if existing{next_index-1}else{next_index+index as i64-i64::from(append)};
                let arc_ids=arcs.iter().filter(|arc|arc["chapterStart"].as_i64().unwrap_or(0)<=*end&&arc["chapterEnd"].as_i64().unwrap_or(0)>=*start).map(|arc|arc["id"].clone()).collect::<Vec<_>>();
                json!({"id":volume_id,"index":volume_index,"title":format!("离线分卷{index}"),"chapterStart":start,"chapterEnd":end,"summary":"受控离线规划分卷简介，用于验证结构化生命周期。","goal":"完成阶段目标","mainConflict":"信息与选择的矛盾","arcIds":arc_ids,"materialization":if existing{"existing"}else{"create"}})
            }).collect::<Vec<_>>();
            json!({"storyBible":{"title":"离线故事规划","logline":"受控离线夹具构造完整的结构化规划，不代表真实文学效果。","themes":["选择"],"protagonistPromise":"通过选择承担代价","centralQuestion":"如何面对未知后果","endingVision":"完成阶段性成长","narrativeRules":["遵守既有事实与规则"]},"arcs":arcs,"volumes":volumes})
        }
        "characters" => json!({"characters":(0..3).map(|index|{
            let character_id=id(&format!("character-{index}"));
            json!({"id":character_id,"name":format!("离线角色{index}"),"role":if index==0{"protagonist"}else{"supporting"},"identity":"调查者","personality":"谨慎而坚定","coreNeed":"确认事实真相","flaw":"过分依赖记录","initialState":"缺乏完整信息","desiredEndState":"主动承担选择","behaviorLimits":["重大决定需要证据"],"forbiddenBehaviors":["无依据改变规则"],
                "beats":[{"id":id(&format!("beat-{index}-1")),"characterId":character_id,"chapterNumber":start,"stage":"起点","change":"确定行动目标"},{"id":id(&format!("beat-{index}-2")),"characterId":character_id,"chapterNumber":end,"stage":"终点","change":"承担选择后果"}]})
        }).collect::<Vec<_>>()}),
        "world" => {
            json!({"worldElements":(0..3).map(|index|json!({"id":id(&format!("world-{index}")),"type":"location","name":format!("离线地点{index}"),"summary":"只作为待应用的世界候选","firstChapter":start,"dependencies":[],"constraints":["遵守既有正式规则"]})).collect::<Vec<_>>()})
        }
        "conflicts" => {
            json!({"conflicts":(0..2).map(|index|json!({"id":id(&format!("conflict-{index}")),"title":format!("离线冲突{index}"),"type":"mystery","participants":["离线角色0"],"stakes":"失去调查窗口","summary":"通过可验证线索逐步推进","introducedChapter":start,"escalationChapters":[],"climaxChapter":end,"resolutionChapter":end})).collect::<Vec<_>>()})
        }
        "pacing" => {
            json!({"pacingPhases":[{"id":id("phase"),"title":"离线节奏阶段","chapterStart":start,"chapterEnd":end,"mode":"build","tensionStart":30,"tensionEnd":70,"purpose":"逐步推进冲突"}],
            "pacingCurve":(start..=end).map(|number|json!({"chapterNumber":number,"phaseId":id("phase"),"mode":"build","tension":50,"dialogueRatio":35,"descriptionRatio":40,"cliffhanger":true})).collect::<Vec<_>>()})
        }
        key if key.starts_with("chapters:") => {
            let first = stage["batchStart"]
                .as_i64()
                .ok_or("DOMAIN_MOCK_RANGE_INVALID")?;
            let last = stage["batchEnd"]
                .as_i64()
                .ok_or("DOMAIN_MOCK_RANGE_INVALID")?;
            let characters = plan["characters"]
                .as_array()
                .ok_or("DOMAIN_MOCK_PLAN_INVALID")?;
            let volumes = plan["volumes"]
                .as_array()
                .ok_or("DOMAIN_MOCK_PLAN_INVALID")?;
            let arcs = plan["arcs"].as_array().ok_or("DOMAIN_MOCK_PLAN_INVALID")?;
            let chapters = (first..=last).map(|number| -> Result<Value,String> {
                let volume=volumes.iter().find(|item|item["chapterStart"].as_i64().unwrap_or(0)<=number&&item["chapterEnd"].as_i64().unwrap_or(0)>=number).ok_or("DOMAIN_MOCK_PLAN_RANGE_INVALID")?;
                let arc=arcs.iter().find(|item|item["chapterStart"].as_i64().unwrap_or(0)<=number&&item["chapterEnd"].as_i64().unwrap_or(0)>=number).ok_or("DOMAIN_MOCK_PLAN_RANGE_INVALID")?;
                Ok(json!({"id":id(&format!("chapter-{number}")),"chapterNumber":number,"volumeId":volume["id"],"arcId":arc["id"],"title":format!("离线第{number}章"),"outline":"调查者读取记录，遇到新的线索并作出阶段性选择。","goal":"推进可验证的调查行动","targetWordCount":plan["brief"]["targetWordsPerChapter"],"pacingMode":"build","tension":50,"endingHook":"新的记录带来下一步问题。","conflictThreadIds":[],"characterIds":characters.iter().map(|item|item["id"].clone()).collect::<Vec<_>>(),"characterBeatIds":[],"worldElementIds":[],"status":"planned"}))
            }).collect::<Result<Vec<_>,String>>()?;
            json!({"chapters":chapters})
        }
        _ => return Err("DOMAIN_MOCK_STAGE_UNSUPPORTED".to_string()),
    };
    super::validate(&super::schema(kind, key)?, &payload)?;
    Ok(payload)
}
