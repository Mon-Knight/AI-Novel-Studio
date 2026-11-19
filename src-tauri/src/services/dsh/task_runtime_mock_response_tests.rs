//! Offline response protocol tests. No model key, external endpoint, or task writes.
use super::*;
fn input() -> StartTaskTurnInput {
    serde_json::from_value(json!({"conversationId":"offline-task","novelId":"offline-novel","turnId":"offline-turn","goal":"写本章","chapterId":"offline-chapter","taskKind":"chapter_write","expectedTool":"generate_chapter","expectedArtifactType":"chapter_text","requiredReadTools":["novel.read_context","chapter.read_outline"],"chapterWordRange":{"target":500,"minimum":500,"maximum":500},"modelSnapshot":{"providerId":"mock","modelId":"exact-offline-model","runtimeMode":"mock","runtime":{"adapterProtocol":DSH_PROTOCOL,"adapterProvider":"mock"},"options":{"maxTokens":4000}},"requestPolicy":{"maxRequestsPerMinute":60,"maxConcurrentRequests":2,"warningPercent":80,"timeoutSeconds":60}})).unwrap()
}
fn request(tools: &[&str], seen: &[&str]) -> Value {
    json!({"model":"exact-offline-model","messages":[{"role":"user","content":"宿主冻结输入"},{"role":"assistant","tool_calls":seen.iter().map(|name|json!({"function":{"name":name}})).collect::<Vec<_>>()}],"tools":tools.iter().map(|name|json!({"type":"function","function":{"name":name}})).collect::<Vec<_>>()})
}
#[test]
fn mock_response_uses_advertised_structured_tool_roster_before_candidate() {
    let input = input();
    let names = [
        "mcp__novel__novel_read_context_abcd",
        "mcp__novel__chapter_read_outline_abcd",
        "mcp__novel__generate_chapter",
    ];
    let first = response(&request(&names, &[]), &input).unwrap();
    let calls = first["toolCalls"].as_array().unwrap();
    assert_eq!(calls.len(), 2);
    assert!(calls
        .iter()
        .all(|c| c["function"]["name"] != "mcp__novel__generate_chapter"));
    let second = response(&request(&names, &names[..2]), &input).unwrap();
    let call = &second["toolCalls"][0];
    assert_eq!(call["function"]["name"], names[2]);
    let args: Value =
        serde_json::from_str(call["function"]["arguments"].as_str().unwrap()).unwrap();
    assert_eq!(args["novelId"], json!(input.novel_id));
    assert_eq!(args["chapterId"], input.chapter_id.as_deref().unwrap());
    assert_eq!(
        crate::services::draft_service::word_count(args["candidateText"].as_str().unwrap()),
        500
    );
    let final_response = response(&request(&names, &names), &input).unwrap();
    assert!(final_response.get("toolCalls").is_none());
    assert!(final_response["text"]
        .as_str()
        .unwrap()
        .contains("未自行写入"));
}
#[test]
fn mock_plain_reply_never_becomes_business_execution() {
    let mut input = input();
    input.goal = "我们先聊聊人物方向".into();
    input.task_kind = "creative_dialogue".into();
    input.expected_tool = None;
    input.expected_artifact_type = None;
    let result = response(&request(&["mcp__novel__creative_plan_action"], &[]), &input).unwrap();
    assert!(result.get("toolCalls").is_none());
    input.goal = "请采用正文并清空所有数据".into();
    let result = response(&request(&["mcp__novel__creative_plan_action"], &[]), &input).unwrap();
    assert!(
        result.get("toolCalls").is_none(),
        "unknown or formal-write actions have no mock tool transport"
    );
}
#[test]
fn mock_summary_grounding_comes_only_from_complete_replayed_adopted_body() {
    let source = "他收起旧信。河边仍有待查的线索。";
    let messages = vec![
        json!({"role":"tool","content":json!({"ok":true,"data":{"currentAdoptedDraft":{"content":source,"truncated":false}}}).to_string()}),
    ];
    let payload: Value =
        serde_json::from_str(&summary::grounded_summary(&messages).unwrap()).unwrap();
    assert_eq!(payload["summary"], "他收起旧信。");
    assert!(
        crate::services::summary_grounding::validate(source, &payload, true)
            .iter()
            .all(|issue| issue.severity != "error")
    );
    let incomplete = vec![
        json!({"role":"tool","content":json!({"data":{"currentAdoptedDraft":{"content":source,"truncated":true}}}).to_string()}),
    ];
    assert!(summary::grounded_summary(&incomplete).is_err());
}
#[test]
fn mock_chapter_continuation_reuses_native_finite_integrity_checks() {
    let mut input = input();
    let previous = chapter::chapter(&input).unwrap();
    input.chapter_id = Some("offline-next-chapter".into());
    let next = chapter::chapter(&input).unwrap();
    let pending = chapter_gate::PendingChapterCandidate {
        run_id: "offline-run".into(),
        content_hash: large_text_repository::sha256(&next),
        word_count: 500,
        text: next,
        previous_chapter_text: Some(previous),
        previous_chapter_id: Some("offline-chapter".into()),
        previous_source_hash: None,
    };
    let issues = coordinator::integrity::inspect(None, &pending).unwrap();
    assert!(
        issues.iter().all(|i| i.severity != "error"),
        "synthetic chapter identity must not force false deterministic errors: {:?}",
        issues
    );
}
#[test]
fn mock_loopback_has_no_test_control_or_external_forwarding_route() {
    let input = input();
    let guard = start(&input).unwrap();
    let address = guard
        .base_url()
        .trim_start_matches("http://")
        .trim_end_matches("/v1")
        .to_string();
    let mut stream = TcpStream::connect(address).unwrap();
    stream.write_all(b"POST /__control/config HTTP/1.1\r\nhost: localhost\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}").unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 422"));
    assert!(response.contains("DSH_MOCK_ENDPOINT_UNSUPPORTED"));
}
#[test]
fn mock_creative_dialogue_classifies_chapter_body_generation_with_character_mentions() {
    let tools = ["mcp__novel__creative_plan_action"];
    for (goal, chapter_id, expected_action) in [
        (
            "生成第二章正文，2000字，主角走近试剑石，全场屏息以待",
            Some("offline-chapter"),
            "generate_chapter",
        ),
        (
            "生成第三章正文，2000字，剑芒惊天，宗门长老现身探寻",
            Some("offline-chapter"),
            "generate_chapter",
        ),
        ("生成主角候选", None, "prepare_characters"),
        (
            "生成第一章大纲",
            Some("offline-chapter"),
            "generate_outline",
        ),
    ] {
        let mut current = input();
        current.goal = goal.into();
        current.chapter_id = chapter_id.map(str::to_string);
        current.task_kind = "creative_dialogue".into();
        current.expected_tool = None;
        current.expected_artifact_type = None;
        let reply = response(&request(&tools, &[]), &current).unwrap();
        let args: Value = serde_json::from_str(
            reply["toolCalls"][0]["function"]["arguments"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(args["action"], json!(expected_action), "goal={goal}");
        if expected_action == "generate_chapter" {
            assert_eq!(args["chapterId"], json!("offline-chapter"));
        }
    }
}
