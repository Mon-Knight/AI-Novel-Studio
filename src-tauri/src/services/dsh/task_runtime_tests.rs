use super::*;

fn api_input(provider: &str, model: &str, base_url: &str) -> StartTaskTurnInput {
    StartTaskTurnInput {
        conversation_id: "c1".to_string(),
        novel_id: "n1".to_string(),
        turn_id: "t1".to_string(),
        goal: "test".to_string(),
        chapter_id: Some("ch-1".to_string()),
        task_kind: default_task_kind(),
        expected_tool: None,
        expected_artifact_type: None,
        required_read_tools: Vec::new(),
        book_word_goal: None,
        chapter_word_range: None,
        model_snapshot: json!({
            "providerId": provider,
            "modelId": model,
            "runtimeMode": "api",
            "baseUrl": base_url,
            "options": { "maxTokens": 1024 },
            "runtime": {
                "adapterProtocol": DSH_PROTOCOL,
                "adapterProvider": provider
            }
        }),
        request_policy: TaskRequestPolicyInput {
            max_requests_per_minute: 1,
            max_concurrent_requests: 1,
            daily_token_budget: None,
            daily_cost_budget_usd: None,
            warning_percent: 80,
            timeout_seconds: 30,
        },
        api_key: "fixture-key".to_string(),
    }
}

#[test]
fn startup_recovery_protects_only_process_owned_active_runtime_states() {
    for status in ["attesting", "queued", "running", "cancel_requested"] {
        assert!(
            runtime_status_owns_active_run(status),
            "{status} must protect its persisted run during a renderer reload"
        );
    }
    for status in ["idle", "completed", "failed", "cancelled", ""] {
        assert!(
            !runtime_status_owns_active_run(status),
            "{status} must not survive full-process startup recovery"
        );
    }
}

fn sparse_sixty_thousand_word_goal(source_hash: char) -> ai_task_service::BookWordGoal {
    ai_task_service::BookWordGoal {
        contract_version: "ans_book_word_goal_v1".to_string(),
        parser_version: "zh_book_words_v1".to_string(),
        source_turn_id: "turn-sparse-idea".to_string(),
        source_turn_sequence: 1,
        source_content_sha256: source_hash.to_string().repeat(64),
        target_words: 60_000,
        comparison: "approximate".to_string(),
        tolerance_bps: 1_000,
        minimum_words: 54_000,
        maximum_words: 66_000,
    }
}

#[test]
fn client_payload_cannot_inject_the_host_owned_book_word_goal() {
    let input: StartTaskTurnInput = serde_json::from_value(json!({
        "conversationId": "conversation-client",
        "novelId": "novel-client",
        "turnId": "turn-client",
        "goal": "写个六万字左右的悬疑故事。",
        "chapterId": null,
        "taskKind": "story_plan_generate",
        "expectedTool": "generate_outline",
        "expectedArtifactType": "outline",
        "requiredReadTools": ["novel.read_context"],
        "bookWordGoal": {
            "targetWords": 1,
            "minimumWords": 1,
            "maximumWords": 1,
            "sourceContentSha256": "malicious-client-value"
        },
        "modelSnapshot": {
            "providerId": OPENAI_COMPATIBLE_PROVIDER,
            "modelId": "gpt-5.6-luna",
            "runtimeMode": "api",
            "baseUrl": "http://127.0.0.1:12074/v1/"
        },
        "requestPolicy": {
            "maxRequestsPerMinute": 1,
            "maxConcurrentRequests": 1,
            "warningPercent": 80,
            "timeoutSeconds": 30
        },
        "apiKey": "fixture-key"
    }))
    .expect("valid client payload");

    assert_eq!(input.book_word_goal, None);
    assert_eq!(candidate_validation_policy(&input), None);
}

fn chapter_summary_input() -> StartTaskTurnInput {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.conversation_id = "conversation-summary".to_string();
    input.novel_id = "novel-summary".to_string();
    input.turn_id = "summary-generation-authorization-summary".to_string();
    input.chapter_id = Some("chapter-summary".to_string());
    input.goal = "总结本章".to_string();
    input.task_kind = "chapter_summary".to_string();
    input.expected_tool = Some("summarize_chapter".to_string());
    input.expected_artifact_type = Some("chapter_summary".to_string());
    input.required_read_tools = vec![
        "novel.read_context".to_string(),
        "chapter.read_outline".to_string(),
        "get_character_states".to_string(),
        "search_memory".to_string(),
    ];
    input
}

fn chapter_summary_recovery_connection() -> rusqlite::Connection {
    let connection = rusqlite::Connection::open_in_memory().expect("recovery database");
    connection
            .execute_batch(
                r#"CREATE TABLE task_runs (
                    run_id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    turn_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    error TEXT,
                    model_snapshot_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE review_authorizations (
                    authorization_id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    consumed_by_draft_id TEXT
                );
                CREATE TABLE chapters (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    adopted_draft_id TEXT,
                    deleted_at TEXT
                );
                CREATE TABLE result_artifacts (
                    artifact_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    artifact_type TEXT NOT NULL,
                    processing_status TEXT NOT NULL,
                    source_novel_id TEXT NOT NULL,
                    source_chapter_id TEXT,
                    source_draft_id TEXT
                );
                CREATE TABLE conversation_artifact_cards (
                    card_id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    turn_id TEXT,
                    artifact_id TEXT,
                    artifact_type TEXT NOT NULL
                );
                CREATE TABLE ai_tasks (
                    task_id TEXT PRIMARY KEY,
                    operation_id TEXT NOT NULL
                );
                CREATE TABLE chapter_summaries (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL,
                    adopted_draft_id TEXT NOT NULL,
                    enabled INTEGER NOT NULL,
                    is_expired INTEGER NOT NULL
                );
                INSERT INTO review_authorizations VALUES
                    ('authorization-summary','novel-summary','chapter-summary','consumed','draft-summary');
                INSERT INTO chapters VALUES
                    ('chapter-summary','novel-summary','draft-summary',NULL);"#,
            )
            .expect("seed recovery scope");
    connection
}

#[test]
fn automatic_summary_sessions_rotate_without_changing_ordinary_task_sessions() {
    let input = chapter_summary_input();
    let connection = chapter_summary_recovery_connection();
    let scope = chapter_summary_recovery_scope(&connection, &input)
        .expect("authoritative adopted summary scope");
    let first = task_session_id(&input, "run-summary-1", Some(&scope));
    let same = task_session_id(&input, "run-summary-1", Some(&scope));
    let retry = task_session_id(&input, "run-summary-2", Some(&scope));

    assert_eq!(first, same);
    assert_ne!(first, retry, "a recovery Run must start with clean history");
    assert!(first.starts_with("session-summary-"));
    assert!(first
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'));

    let mut changed_scope = ChapterSummaryRecoveryScope {
        novel_id: scope.novel_id.clone(),
        chapter_id: scope.chapter_id.clone(),
        adopted_draft_id: "different-adopted-draft".to_string(),
    };
    assert_ne!(
        first,
        task_session_id(&input, "run-summary-1", Some(&changed_scope))
    );
    changed_scope.adopted_draft_id = scope.adopted_draft_id.clone();
    changed_scope.chapter_id = "different-chapter".to_string();
    assert_ne!(
        first,
        task_session_id(&input, "run-summary-1", Some(&changed_scope))
    );

    let mut ordinary = input.clone();
    ordinary.task_kind = "read".to_string();
    ordinary.expected_tool = None;
    ordinary.expected_artifact_type = None;
    assert_eq!(
        task_session_id(&ordinary, "run-ordinary-1", None),
        task_session_id(&ordinary, "run-ordinary-2", None),
        "ordinary task dialogue remains conversation-persistent"
    );
}

fn insert_recoverable_summary_failure(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    attempt: usize,
) {
    connection
        .execute(
            "INSERT INTO task_runs
                 (run_id,conversation_id,turn_id,status,error,model_snapshot_json,created_at)
                 VALUES (?1,?2,?3,'failed',?4,?5,?6)",
            rusqlite::params![
                format!("run-{attempt}"),
                &input.conversation_id,
                &input.turn_id,
                "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states must be earlier",
                serde_json::to_string(&input.model_snapshot).expect("model snapshot"),
                format!("2026-08-29T00:00:0{attempt}Z"),
            ],
        )
        .expect("insert failed summary run");
}

fn verified_attestation_stream_closed_error() -> String {
    concat!(
        "DSH 回合以错误结束: STREAM_CLOSED | ",
        "[model-proxy] request model=gpt-5.6-luna stream=true promptChars=808 ",
        "messages=2 tools=1 invalidToolNames=0 thinking=disabled effort=unspecified | ",
        "[model-proxy] responseStats status=200 payloads=24 choices=24 contentChars=0 ",
        "reasoningChars=0 alternateReasoningChars=0 toolCallParts=23 ",
        "legacyFunctionCallParts=0 toolNames=ans_runtime_attest_tool_call_v1 ",
        "messageKeys=role,tool_calls finish=tool_calls done=true | ",
        "[model-proxy] done model=gpt-5.6-luna status=200 ms=1812 ",
        "usage={\"tokenInput\":42} | ",
        "dsh.turn.end: STREAM_CLOSED"
    )
    .to_string()
}

#[test]
fn workbench_turn_defaults_reasoning_off_and_keeps_an_explicit_effort() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1",
    );
    assert_eq!(workbench_reasoning_effort(&input), "off");

    input.model_snapshot["options"]["reasoningEffort"] = json!("high");
    assert_eq!(workbench_reasoning_effort(&input), "high");
}

#[test]
fn sparse_setting_bundle_requires_world_and_rule_entries() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.task_kind = "setting_expand".to_string();
    input.goal = format!(
        "{}。创意依据：近未来悬疑。",
        WORLD_AND_RULE_SETTINGS_DIRECTIVE
    );
    assert!(workbench_task_instruction(&input).contains("targetType=rule_system"));
    assert!(!WORKBENCH_SYSTEM_PROMPT.contains(WORLD_AND_RULE_SETTINGS_DIRECTIVE));
    let valid = json!({
        "settings": [
            {"name":"雾港背景","description":"潮雾会吞没旧城区的声音。","category":"location"},
            {"name":"退潮钟规则","description":"钟响后记忆不可篡改。","targetType":"rule_system"}
        ]
    })
    .to_string();
    validate_world_and_rule_settings_candidate(&valid).expect("complete setting bundle");

    let world_only = json!({
        "settings": [
            {"name":"雾港背景","description":"潮雾会吞没旧城区的声音。","category":"location"}
        ]
    })
    .to_string();
    assert!(validate_world_and_rule_settings_candidate(&world_only).is_err());

    let rules_only = json!({
        "settings": [
            {"name":"退潮钟规则","description":"钟响后记忆不可篡改。","category":"world_rules"}
        ]
    })
    .to_string();
    assert!(validate_world_and_rule_settings_candidate(&rules_only).is_err());

    let empty_descriptions = json!({
        "settings": [
            {"name":"雾港背景","description":"  ","category":"location"},
            {"name":"退潮钟规则","description":"","targetType":"rule_system"}
        ]
    })
    .to_string();
    assert!(validate_world_and_rule_settings_candidate(&empty_descriptions).is_err());
}

#[test]
fn rule_only_asset_preparation_rejects_world_candidates() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.task_kind = "setting_expand".to_string();
    input.goal = format!("{}。创意依据：近未来悬疑。", RULE_SYSTEM_SETTINGS_DIRECTIVE);
    let instruction = workbench_task_instruction(&input);
    assert!(instruction.contains("只能包含 targetType=rule_system"));

    let rules_only = json!({
        "settings": [
            {
                "name":"退潮钟规则",
                "description":"钟响后记忆不可篡改。",
                "targetType":"rule_system"
            }
        ]
    })
    .to_string();
    validate_rule_system_settings_candidate(&rules_only).expect("rule-only candidate");

    let world_candidate = json!({
        "settings": [
            {"name":"雾港背景","description":"潮雾会吞没旧城区的声音。"}
        ]
    })
    .to_string();
    assert!(validate_rule_system_settings_candidate(&world_candidate).is_err());
}

#[test]
fn automatic_protagonist_candidate_requires_exactly_one_primary_role() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.task_kind = "character_generate".to_string();
    input.goal = format!(
        "{}。创意依据：近未来悬疑。",
        PROTAGONIST_CANDIDATE_DIRECTIVE
    );
    let instruction = workbench_task_instruction(&input);
    assert!(instruction.contains("roleType=protagonist"));
    for formal_field in [
        "motivation",
        "specialAbility",
        "abilityLimits",
        "background",
        "arc",
    ] {
        assert!(instruction.contains(formal_field));
    }
    assert!(instruction.contains("behaviorLimits 只表示行为边界"));
    assert!(!WORKBENCH_SYSTEM_PROMPT.contains(PROTAGONIST_CANDIDATE_DIRECTIVE));
    let valid = json!({
        "characters": [
            {
                "name":"林默",
                "roleType":"protagonist",
                "identity":"钟楼修复师",
                "goal":"找回失窃的时间",
                "personality":"审慎而执着",
                "behaviorLimits":"不会用他人的记忆交换线索"
            },
            {"name":"季衡","roleType":"supporting","goal":"守住钟楼"}
        ]
    })
    .to_string();
    validate_primary_protagonist_candidate(&valid).expect("one primary protagonist");

    let shallow = json!({
        "characters": [
            {"name":"林默","roleType":"protagonist","goal":"找回失窃的时间"}
        ]
    })
    .to_string();
    assert!(validate_primary_protagonist_candidate(&shallow).is_err());

    let supporting_only = json!({
        "characters": [{"name":"季衡","roleType":"supporting"}]
    })
    .to_string();
    assert!(validate_primary_protagonist_candidate(&supporting_only).is_err());

    let multiple = json!({
        "characters": [
            {"name":"林默","roleType":"protagonist"},
            {"name":"沈夜","isProtagonist":true}
        ]
    })
    .to_string();
    assert!(validate_primary_protagonist_candidate(&multiple).is_err());
}

#[test]
fn greeting_turn_prompt_forbids_empty_generate_chapter() {
    let input = StartTaskTurnInput {
        conversation_id: "c1".to_string(),
        novel_id: "n1".to_string(),
        turn_id: "t1".to_string(),
        goal: "你好".to_string(),
        chapter_id: Some("ch-1".to_string()),
        task_kind: default_task_kind(),
        expected_tool: None,
        expected_artifact_type: None,
        required_read_tools: Vec::new(),
        book_word_goal: None,
        chapter_word_range: None,
        model_snapshot: json!({}),
        request_policy: TaskRequestPolicyInput {
            max_requests_per_minute: 1,
            max_concurrent_requests: 1,
            daily_token_budget: None,
            daily_cost_budget_usd: None,
            warning_percent: 80,
            timeout_seconds: 30,
        },
        api_key: String::new(),
    };
    let prompt = workbench_turn_prompt(&input);
    assert!(prompt.contains("用户意图：你好"));
    assert!(prompt.contains("本轮禁止候选工具"));
    assert!(prompt.contains("本轮不得调用候选工具"));
    assert!(!prompt.contains("generate_chapter"));
    assert!(!prompt.contains("请按需使用工具并形成候选"));
    assert!(WORKBENCH_SYSTEM_PROMPT.contains("简短创作意图"));
    assert!(WORKBENCH_SYSTEM_PROMPT.contains("每轮宿主契约"));
    assert!(WORKBENCH_SYSTEM_PROMPT.chars().count() < 260);
    for tool in CANDIDATE_TOOLS.split(',') {
        assert!(!WORKBENCH_SYSTEM_PROMPT.contains(tool));
    }
}

fn chapter_write_input() -> StartTaskTurnInput {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.goal = "写第一章".to_string();
    input.task_kind = "chapter_write".to_string();
    input.expected_tool = Some("generate_chapter".to_string());
    input.expected_artifact_type = Some("chapter_text".to_string());
    input.required_read_tools = vec![
        "novel.read_context".to_string(),
        "chapter.read_outline".to_string(),
        "get_character_states".to_string(),
        "search_memory".to_string(),
    ];
    input.chapter_word_range = Some(ChapterWordRangeInput {
        target: 3000,
        minimum: 2400,
        maximum: 3450,
    });
    input
}

#[test]
fn chapter_write_turn_binds_one_candidate_tool_and_narrows_the_allowlist() {
    let input = chapter_write_input();
    validate_turn_contract(&input).expect("valid chapter_write contract");
    assert_eq!(turn_allowed_tools(&input), CHAPTER_WRITE_ALLOWED_TOOLS);
    for tool in CANDIDATE_TOOLS
        .split(',')
        .filter(|tool| *tool != "generate_chapter")
    {
        assert!(
            !CHAPTER_WRITE_ALLOWED_TOOLS
                .split(',')
                .any(|allowed| allowed == tool),
            "{tool} must not leak into the writing allowlist"
        );
    }
    assert!(!is_canonical_only_turn(&input));
    let prompt = workbench_turn_prompt(&input);
    assert!(prompt.contains("唯一候选工具：generate_chapter"));
    assert!(prompt.contains("预期产物：chapter_text"));
    assert!(prompt.contains("完整写出本章正文"));
    assert!(prompt.contains("目标 3000 字"));
    assert!(prompt.contains("2400～3450 字"));

    let mut polish = chapter_write_input();
    polish.task_kind = "chapter_polish".to_string();
    polish.expected_tool = Some("polish_chapter".to_string());
    validate_turn_contract(&polish).expect("valid chapter_polish contract");
    assert_eq!(turn_allowed_tools(&polish), CHAPTER_POLISH_ALLOWED_TOOLS);
    assert!(workbench_turn_prompt(&polish).contains("整体润色"));
}

#[test]
fn chapter_write_contract_rejects_missing_chapter_wrong_tool_and_bad_range() {
    let mut no_chapter = chapter_write_input();
    no_chapter.chapter_id = None;
    assert!(validate_turn_contract(&no_chapter)
        .unwrap_err()
        .contains("必须绑定章节"));

    let mut wrong_tool = chapter_write_input();
    wrong_tool.expected_tool = Some("generate_outline".to_string());
    assert!(validate_turn_contract(&wrong_tool)
        .unwrap_err()
        .contains("chapter_write 必须绑定 generate_chapter -> chapter_text"));

    let mut inverted = chapter_write_input();
    inverted.chapter_word_range = Some(ChapterWordRangeInput {
        target: 3000,
        minimum: 3500,
        maximum: 3450,
    });
    assert!(validate_turn_contract(&inverted)
        .unwrap_err()
        .contains("章节字数区间非法"));

    let mut range_on_read = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    range_on_read.chapter_word_range = Some(ChapterWordRangeInput {
        target: 10,
        minimum: 5,
        maximum: 20,
    });
    assert!(validate_turn_contract(&range_on_read)
        .unwrap_err()
        .contains("只有章节写作任务可以携带字数区间"));
}

#[test]
fn chapter_candidate_length_is_enforced_only_for_writing_turns_with_a_range() {
    let input = chapter_write_input();
    let short = "短".repeat(2399);
    let error = validate_chapter_candidate_length(&input, &short).unwrap_err();
    assert_eq!(error.code, "DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED");
    let within = "字".repeat(2400);
    validate_chapter_candidate_length(&input, &within).expect("lower bound is inclusive");
    let long = "字".repeat(3451);
    assert!(validate_chapter_candidate_length(&input, &long).is_err());

    let mut unbounded = chapter_write_input();
    unbounded.chapter_word_range = None;
    validate_chapter_candidate_length(&unbounded, &short).expect("no range, no rejection");

    let mut summary = chapter_write_input();
    summary.task_kind = "chapter_summary".to_string();
    validate_chapter_candidate_length(&summary, &short).expect("other kinds ignore the range");
}

#[test]
fn short_structured_turn_requires_persisted_context_before_candidate() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.goal = "完善大纲".to_string();
    input.task_kind = "outline_generate".to_string();
    input.expected_tool = Some("generate_outline".to_string());
    input.expected_artifact_type = Some("outline".to_string());
    input.required_read_tools = vec![
        "novel.read_context".to_string(),
        "chapter.read_outline".to_string(),
    ];
    validate_turn_contract(&input).expect("valid outline contract");

    let prompt = workbench_turn_prompt(&input);
    assert!(prompt.contains("用户意图：完善大纲"));
    assert!(prompt.contains("必需读取：novel.read_context -> chapter.read_outline"));
    assert!(prompt.contains("全部必需读取成功后"));
    assert!(prompt.contains("成功后用一句话确认完成并结束"));
    assert!(prompt.contains("禁止返回空消息"));
    assert!(prompt.contains("唯一候选工具：generate_outline"));
    assert!(prompt.contains("至少包含非空 title 与 content"));
    assert!(!prompt.contains("search_memory"));
    assert!(!prompt.contains("planKind=story_plan"));
    assert!(WORKBENCH_SYSTEM_PROMPT.contains("用指定的只读工具补足已有资产"));
    assert!(WORKBENCH_SYSTEM_PROMPT.contains("不要求用户重复提供内容或填写 JSON"));
}

#[test]
fn short_story_plan_goal_gets_only_its_turn_schema() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.chapter_id = None;
    input.goal = "生成全书规划候选。创意依据：写一部约6万字的近未来悬疑小说。".to_string();
    input.task_kind = "story_plan_generate".to_string();
    input.expected_tool = Some("generate_outline".to_string());
    input.expected_artifact_type = Some("outline".to_string());
    input.required_read_tools = vec!["novel.read_context".to_string()];
    input.book_word_goal = Some(sparse_sixty_thousand_word_goal('a'));
    validate_turn_contract(&input).expect("valid story plan contract");

    let prompt = workbench_turn_prompt(&input);
    assert!(prompt.contains(&format!("用户意图：{}", input.goal)));
    assert!(prompt.contains("planKind=story_plan"));
    assert!(prompt.contains("targetWordCount"));
    assert!(prompt.contains("mainConflict"));
    assert!(prompt.contains("characterNames"));
    assert!(prompt.contains("没有角色线索时省略"));
    assert!(prompt.contains("未给章节数时"));
    assert!(prompt.contains("冻结全书目标 60000 字"));
    assert!(prompt.contains("根 targetWordCount=60000"));
    assert!(prompt.contains("校正末章"));
    assert!(prompt.contains("章节合计=60000"));
    assert!(prompt.contains("均须在 54000 至 66000 字"));
    assert!(prompt.contains("不加说明或 Markdown"));
    assert!(prompt.contains("不传 chapterId"));
    assert!(!prompt.contains("settings:["));
    assert!(!prompt.contains("characters:["));
    assert!(!WORKBENCH_SYSTEM_PROMPT.contains("planKind"));
    assert!(!WORKBENCH_SYSTEM_PROMPT.contains("targetWordCount"));
    assert!(!WORKBENCH_SYSTEM_PROMPT.contains("61500"));
    assert!(!WORKBENCH_SYSTEM_PROMPT.contains("4100"));
    assert!(prompt.chars().count() < 700);
}

#[test]
fn task_prompts_expose_only_the_current_candidate_tool_and_schema() {
    let cases = [
        (
            "outline_generate",
            Some("generate_outline"),
            Some("outline"),
            "完善本章大纲",
            Some("ch-1"),
            vec!["novel.read_context", "chapter.read_outline"],
            "至少包含非空 title 与 content",
        ),
        (
            "setting_expand",
            Some("expand_settings"),
            Some("setting_candidates"),
            "扩展城市设定",
            Some("ch-1"),
            vec!["novel.read_context", "chapter.read_outline"],
            "{settings:[...]}",
        ),
        (
            "character_generate",
            Some("generate_characters"),
            Some("character_candidates"),
            "补充角色",
            Some("ch-1"),
            vec!["novel.read_context", "chapter.read_outline"],
            "{characters:[...]}",
        ),
        (
            "event_suggest",
            Some("suggest_events"),
            Some("event_candidates"),
            "建议本章事件",
            Some("ch-1"),
            vec![
                "novel.read_context",
                "chapter.read_outline",
                "get_character_states",
                "search_memory",
            ],
            "events 数组",
        ),
        (
            "quality_check",
            Some("check_quality"),
            Some("quality_report"),
            "检查本章质量",
            Some("ch-1"),
            vec![
                "novel.read_context",
                "chapter.read_outline",
                "get_character_states",
                "search_memory",
            ],
            "summary 或 issues 数组",
        ),
        (
            "chapter_summary",
            Some("summarize_chapter"),
            Some("chapter_summary"),
            "总结本章",
            Some("ch-1"),
            vec![
                "novel.read_context",
                "chapter.read_outline",
                "get_character_states",
                "search_memory",
            ],
            "factsMustRemember",
        ),
        (
            "read",
            None,
            None,
            "你好",
            Some("ch-1"),
            vec![],
            "本轮禁止候选工具",
        ),
    ];
    let schema_markers = [
        "至少包含非空 title 与 content",
        "{settings:[...]}",
        "{characters:[...]}",
        "events 数组",
        "summary 或 issues 数组",
        "factsMustRemember",
    ];

    for (task_kind, expected_tool, artifact_type, goal, chapter_id, reads, marker) in cases {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.task_kind = task_kind.to_string();
        input.expected_tool = expected_tool.map(str::to_string);
        input.expected_artifact_type = artifact_type.map(str::to_string);
        input.goal = goal.to_string();
        input.chapter_id = chapter_id.map(str::to_string);
        input.required_read_tools = reads.into_iter().map(str::to_string).collect();
        validate_turn_contract(&input).expect("valid task-specific contract");

        let prompt = workbench_turn_prompt(&input);
        for tool in CANDIDATE_TOOLS.split(',') {
            assert_eq!(
                prompt.contains(tool),
                expected_tool == Some(tool),
                "{task_kind} leaked candidate tool {tool}: {prompt}"
            );
        }
        for schema_marker in schema_markers {
            assert_eq!(
                prompt.contains(schema_marker),
                schema_marker == marker,
                "{task_kind} leaked schema marker {schema_marker}: {prompt}"
            );
        }
        assert!(prompt.chars().count() < 700, "oversized {task_kind} prompt");
    }
}

#[test]
fn automatic_asset_prompts_add_only_their_special_constraint() {
    let mut settings = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    settings.task_kind = "setting_expand".to_string();
    settings.expected_tool = Some("expand_settings".to_string());
    settings.expected_artifact_type = Some("setting_candidates".to_string());
    settings.required_read_tools = vec!["novel.read_context".to_string()];
    settings.goal = "扩展世界设定".to_string();
    assert!(!workbench_turn_prompt(&settings).contains("targetType=rule_system"));
    settings.goal = "生成世界与规则设定候选。创意依据：近未来悬疑。".to_string();
    assert!(workbench_turn_prompt(&settings).contains("targetType=rule_system"));
    settings.goal = "生成规则设定候选。创意依据：近未来悬疑。".to_string();
    assert!(workbench_turn_prompt(&settings).contains("只能包含 targetType=rule_system"));

    let mut characters = settings;
    characters.task_kind = "character_generate".to_string();
    characters.expected_tool = Some("generate_characters".to_string());
    characters.expected_artifact_type = Some("character_candidates".to_string());
    characters.goal = "补充配角".to_string();
    assert!(!workbench_turn_prompt(&characters).contains("恰好包含一个"));
    characters.goal = "生成主角候选。创意依据：近未来悬疑。".to_string();
    assert!(workbench_turn_prompt(&characters).contains("恰好包含一个 roleType=protagonist"));
}

#[test]
fn automatic_candidate_policy_changes_worker_identity_and_remains_host_owned() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.task_kind = "character_generate".to_string();
    input.expected_tool = Some("generate_characters".to_string());
    input.expected_artifact_type = Some("character_candidates".to_string());
    input.goal = "补充配角".to_string();

    assert_eq!(candidate_validation_policy(&input), None);
    let ordinary_identity = provider_transport(&input)
        .expect("ordinary character transport")
        .identity_hash;

    input.goal = "生成主角候选。创意依据：近未来悬疑。".to_string();
    assert_eq!(
        candidate_validation_policy(&input),
        Some("primary_protagonist_v1".to_string())
    );
    let automatic_identity = provider_transport(&input)
        .expect("automatic protagonist transport")
        .identity_hash;
    assert_ne!(ordinary_identity, automatic_identity);

    input.task_kind = "setting_expand".to_string();
    input.expected_tool = Some("expand_settings".to_string());
    input.expected_artifact_type = Some("setting_candidates".to_string());
    input.goal = "生成世界与规则设定候选。创意依据：近未来悬疑。".to_string();
    assert_eq!(
        candidate_validation_policy(&input),
        Some("world_rule_bundle_v1".to_string())
    );
    input.goal = "生成规则设定候选。创意依据：近未来悬疑。".to_string();
    assert_eq!(
        candidate_validation_policy(&input),
        Some("rule_system_only_v1".to_string())
    );

    input.task_kind = "story_plan_generate".to_string();
    input.expected_tool = Some("generate_outline".to_string());
    input.expected_artifact_type = Some("outline".to_string());
    input.chapter_id = None;
    input.book_word_goal = Some(sparse_sixty_thousand_word_goal('a'));
    assert_eq!(
        candidate_validation_policy(&input),
        Some(format!(
            "book_word_goal_v1:60000:54000:66000:{}",
            "a".repeat(64)
        ))
    );
    let first_word_goal_identity = provider_transport(&input)
        .expect("first word goal transport")
        .identity_hash;
    input.book_word_goal = Some(sparse_sixty_thousand_word_goal('b'));
    let changed_source_identity = provider_transport(&input)
        .expect("changed word goal source transport")
        .identity_hash;
    assert_ne!(first_word_goal_identity, changed_source_identity);
}

#[test]
fn chapter_summary_recovery_is_exact_allowlisted_and_summary_only() {
    let mut input = chapter_summary_input();
    assert!(is_automatic_protocol_recovery_candidate(
        &input,
        "DSH_REQUIRED_CONTEXT_READ_MISSING"
    ));
    assert!(is_automatic_protocol_recovery_candidate(
        &input,
        "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states"
    ));
    assert!(is_automatic_protocol_recovery_candidate(
        &input,
        "DSH_REQUIRED_CANDIDATE_TOOL_MISSING: summarize_chapter"
    ));
    let stream_closed = verified_attestation_stream_closed_error();
    assert!(is_automatic_protocol_recovery_candidate(
        &input,
        &stream_closed
    ));
    assert_eq!(
        runtime_error_for_persistence(&stream_closed),
        AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR
    );
    for error in [
        "DSH_REQUIRED_CONTEXT_READ_MISSING_EXTRA: get_character_states",
        "DSH_REQUIRED_CANDIDATE_TOOL_MISSING_EXTRA: summarize_chapter",
        "prefix DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states",
        "DSH_TOOL_RESPONSE_METADATA_INVALID: missing step",
        "DSH 回合以错误结束: STREAM_CLOSED",
        AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR,
    ] {
        assert!(!is_automatic_protocol_recovery_candidate(&input, error));
    }

    for (from, to) in [
        ("responseStats status=200", "responseStats status=500"),
        (
            "toolNames=ans_runtime_attest_tool_call_v1",
            "toolNames=summarize_chapter",
        ),
        ("finish=tool_calls", "finish=stop"),
        ("done=true", "done=false"),
        ("status=200 ms=1812", "status=500 ms=1812"),
    ] {
        let invalid = stream_closed.replacen(from, to, 1);
        assert!(
            !is_automatic_protocol_recovery_candidate(&input, &invalid),
            "mutated probe evidence must fail closed: {from}"
        );
    }
    let prefixed = format!("prefix {stream_closed}");
    assert!(!is_automatic_protocol_recovery_candidate(&input, &prefixed));
    let missing_turn_end = stream_closed
        .strip_suffix(" | dsh.turn.end: STREAM_CLOSED")
        .expect("fixture turn/end suffix");
    assert!(!is_automatic_protocol_recovery_candidate(
        &input,
        missing_turn_end
    ));
    let altered_turn_end = stream_closed.replace(
        "dsh.turn.end: STREAM_CLOSED",
        "dsh.turn.end: STREAM_COMPLETED",
    );
    assert!(!is_automatic_protocol_recovery_candidate(
        &input,
        &altered_turn_end
    ));
    let extra_tail = format!("{stream_closed} | unexpected-tail");
    assert!(!is_automatic_protocol_recovery_candidate(
        &input,
        &extra_tail
    ));
    let later_request =
        format!("{stream_closed} | [model-proxy] request model=gpt-5.6-luna stream=true tools=8");
    assert!(!is_automatic_protocol_recovery_candidate(
        &input,
        &later_request
    ));
    let post_probe_request = format!(
        "{stream_closed}{} | [model-proxy] request model=gpt-5.6-luna stream=true tools=8",
        "x".repeat(600)
    );
    let truncated = runtime_error_for_persistence(&post_probe_request);
    assert_ne!(truncated, AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR);
    assert!(persisted_automatic_protocol_recovery_error_code(&truncated).is_none());

    input.task_kind = "quality_check".to_string();
    input.expected_tool = Some("check_quality".to_string());
    input.expected_artifact_type = Some("quality_report".to_string());
    assert!(!is_automatic_protocol_recovery_candidate(
        &input,
        "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states"
    ));
    assert!(!is_automatic_protocol_recovery_candidate(
        &input,
        &stream_closed
    ));
}

#[test]
fn chapter_summary_recovery_prompt_repeats_reads_in_a_later_step() {
    let input = chapter_summary_input();
    let ordinary = workbench_turn_prompt_for_attempt(&input, 0, 0);
    assert!(!ordinary.contains("协议自动恢复"));
    assert!(ordinary.contains(
            "必需读取：novel.read_context -> chapter.read_outline -> get_character_states -> search_memory"
        ));
    assert!(ordinary.contains("第一阶段在同一模型响应中并行调用全部必需读取"));
    assert!(ordinary.contains("第二阶段必须调用唯一候选工具"));

    let recovery = workbench_turn_prompt_for_attempt(&input, 1, 1);
    assert!(recovery.contains("第 1/2 次有限重试"));
    assert!(recovery.contains("上一 Run 已保留为失败事实"));
    assert!(recovery.contains("没有创建候选 Artifact"));
    assert!(recovery.contains("重新调用本轮全部必需读取工具"));
    assert!(recovery.contains("等待全部 Tool Result 返回后"));
    assert!(recovery.contains("第二阶段只调用且必须调用唯一候选工具"));
    // Automatic protocol recovery already demands fresh reads; the user-retry notice stays out.
    assert!(!recovery.contains("用户重试"));
}

#[test]
fn user_retry_prompt_demands_fresh_required_reads_in_this_run() {
    let input = chapter_write_input();
    let first = workbench_turn_prompt_for_attempt(&input, 0, 0);
    assert!(!first.contains("用户重试"));

    let retry = workbench_turn_prompt_for_attempt(&input, 0, 2);
    assert!(retry.contains("用户重试：同一目标此前已有 2 次失败或中断的运行"));
    assert!(retry.contains("宿主只承认本回合内完成的读取"));
    assert!(retry.contains("重新并行调用本轮全部必需读取工具"));
    assert!(retry.contains("禁止沿用此前读取结果直接调用候选工具"));
    assert!(!retry.contains("协议自动恢复"));
}

#[test]
fn previous_terminal_run_count_only_counts_failed_or_cancelled_runs_of_the_same_turn() {
    let input = chapter_summary_input();
    let connection = chapter_summary_recovery_connection();
    for (run_id, turn_id, status) in [
        ("run-a", input.turn_id.as_str(), "failed"),
        ("run-b", input.turn_id.as_str(), "cancelled"),
        ("run-c", input.turn_id.as_str(), "completed"),
        ("run-d", "another-turn", "failed"),
    ] {
        connection
            .execute(
                "INSERT INTO task_runs
                     (run_id,conversation_id,turn_id,status,error,model_snapshot_json,created_at)
                     VALUES (?1,?2,?3,?4,NULL,'{}','2026-09-08T00:00:01Z')",
                rusqlite::params![run_id, input.conversation_id, turn_id, status],
            )
            .expect("seed run");
    }
    assert_eq!(
        previous_terminal_run_count(&connection, &input.conversation_id, &input.turn_id)
            .expect("count"),
        2
    );
    assert_eq!(
        previous_terminal_run_count(&connection, "other-conversation", &input.turn_id)
            .expect("count"),
        0
    );
}

#[test]
fn chapter_summary_missing_candidate_recovery_is_persisted_and_bounded() {
    let input = chapter_summary_input();
    let connection = chapter_summary_recovery_connection();
    connection
        .execute(
            "INSERT INTO task_runs
                 (run_id,conversation_id,turn_id,status,error,model_snapshot_json,created_at)
                 VALUES ('run-missing',?1,?2,'failed',?3,?4,'2026-08-29T00:00:01Z')",
            rusqlite::params![
                &input.conversation_id,
                &input.turn_id,
                "DSH_REQUIRED_CANDIDATE_TOOL_MISSING: summarize_chapter",
                serde_json::to_string(&input.model_snapshot).expect("model snapshot"),
            ],
        )
        .expect("insert missing candidate summary run");

    assert_eq!(
        automatic_protocol_recovery_retry_number(
            &connection,
            &input,
            "DSH_REQUIRED_CANDIDATE_TOOL_MISSING: summarize_chapter",
        )
        .expect("missing candidate is recoverable"),
        Some(1)
    );
}

#[test]
fn chapter_summary_recovery_budget_is_persisted_and_bounded() {
    let input = chapter_summary_input();
    let connection = chapter_summary_recovery_connection();
    let error = "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states";

    insert_recoverable_summary_failure(&connection, &input, 1);
    assert_eq!(
        automatic_protocol_recovery_retry_number(&connection, &input, error)
            .expect("first persisted retry"),
        Some(1)
    );
    insert_recoverable_summary_failure(&connection, &input, 2);
    assert_eq!(
        automatic_protocol_recovery_retry_number(&connection, &input, error)
            .expect("second persisted retry"),
        Some(2)
    );
    insert_recoverable_summary_failure(&connection, &input, 3);
    assert_eq!(
        automatic_protocol_recovery_retry_number(&connection, &input, error)
            .expect("retry budget exhausted"),
        None
    );
}

#[test]
fn chapter_summary_verified_attestation_stream_closed_recovery_is_persisted_and_bounded() {
    let input = chapter_summary_input();
    let connection = chapter_summary_recovery_connection();
    let raw_error = verified_attestation_stream_closed_error();

    for attempt in 1..=3 {
        connection
            .execute(
                "INSERT INTO task_runs
                     (run_id,conversation_id,turn_id,status,error,model_snapshot_json,created_at)
                     VALUES (?1,?2,?3,'failed',?4,?5,?6)",
                rusqlite::params![
                    format!("run-stream-closed-{attempt}"),
                    &input.conversation_id,
                    &input.turn_id,
                    AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR,
                    serde_json::to_string(&input.model_snapshot).expect("model snapshot"),
                    format!("2026-08-29T00:01:0{attempt}Z"),
                ],
            )
            .expect("insert verified stream-closed summary run");
        let expected = (attempt <= MAX_AUTOMATIC_PROTOCOL_RECOVERY_RETRIES).then_some(attempt);
        assert_eq!(
            automatic_protocol_recovery_retry_number(&connection, &input, &raw_error)
                .expect("verified stream-closed retry decision"),
            expected
        );
        if attempt == 1 {
            let mut model_drift = input.clone();
            model_drift.model_snapshot["modelId"] = json!("different-model");
            assert_eq!(
                automatic_protocol_recovery_retry_number(&connection, &model_drift, &raw_error,)
                    .expect("model drift must fail closed"),
                None
            );

            let mut turn_drift = input.clone();
            turn_drift.turn_id = "summary-generation-different-authorization".to_string();
            assert_eq!(
                automatic_protocol_recovery_retry_number(&connection, &turn_drift, &raw_error,)
                    .expect("turn drift must fail closed"),
                None
            );

            let mut chapter_drift = input.clone();
            chapter_drift.chapter_id = Some("different-chapter".to_string());
            assert_eq!(
                automatic_protocol_recovery_retry_number(&connection, &chapter_drift, &raw_error,)
                    .expect_err("chapter drift must fail closed"),
                "DSH_PROTOCOL_RECOVERY_SCOPE_INVALID"
            );
        }
    }
}

#[test]
fn chapter_summary_recovery_stops_for_an_existing_valid_artifact() {
    let input = chapter_summary_input();
    let connection = chapter_summary_recovery_connection();
    insert_recoverable_summary_failure(&connection, &input, 1);
    connection
            .execute_batch(
                r#"INSERT INTO result_artifacts VALUES
                    ('artifact-summary','task-summary','chapter_summary','valid',
                     'novel-summary','chapter-summary','draft-summary');
                   INSERT INTO conversation_artifact_cards VALUES
                    ('card-summary','conversation-summary',
                     'summary-generation-authorization-summary','artifact-summary','chapter_summary');"#,
            )
            .expect("seed valid summary artifact card");

    assert_eq!(
        automatic_protocol_recovery_retry_number(
            &connection,
            &input,
            "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states",
        )
        .expect("valid artifact blocks recovery"),
        None
    );

    let artifact_only_connection = chapter_summary_recovery_connection();
    insert_recoverable_summary_failure(&artifact_only_connection, &input, 1);
    artifact_only_connection
        .execute_batch(
            r#"INSERT INTO ai_tasks VALUES ('task-summary','workbench-run-1');
                   INSERT INTO result_artifacts VALUES
                    ('artifact-summary','task-summary','chapter_summary','valid',
                     'novel-summary','chapter-summary','draft-summary');"#,
        )
        .expect("seed valid summary artifact without a projected card");
    assert_eq!(
        automatic_protocol_recovery_retry_number(
            &artifact_only_connection,
            &input,
            "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states",
        )
        .expect("orphaned valid artifact blocks recovery"),
        None
    );
}

#[test]
fn chapter_summary_recovery_stops_for_an_existing_formal_summary() {
    let input = chapter_summary_input();
    let connection = chapter_summary_recovery_connection();
    insert_recoverable_summary_failure(&connection, &input, 1);
    connection
        .execute(
            "INSERT INTO chapter_summaries VALUES
                 ('summary-formal','novel-summary','chapter-summary','draft-summary',1,1)",
            [],
        )
        .expect("seed expired formal summary");

    assert_eq!(
        automatic_protocol_recovery_retry_number(
            &connection,
            &input,
            "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states",
        )
        .expect("expired summary does not block recovery"),
        Some(1)
    );
    connection
        .execute(
            "UPDATE chapter_summaries SET is_expired=0 WHERE id='summary-formal'",
            [],
        )
        .expect("enable current formal summary");

    assert_eq!(
        automatic_protocol_recovery_retry_number(
            &connection,
            &input,
            "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states",
        )
        .expect("formal summary blocks recovery"),
        None
    );
}

#[test]
fn chapter_summary_contract_still_rejects_same_step_character_state_read() {
    let input = chapter_summary_input();
    validate_turn_contract(&input).expect("valid chapter summary contract");
    let connection = rusqlite::Connection::open_in_memory().expect("contract database");
    connection
        .execute_batch(
            r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-novel', 'run-1', 0, 'novel.read_context', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-chapter', 'run-1', 1, 'chapter.read_outline', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-memory', 'run-1', 2, 'search_memory', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-characters', 'run-1', 3, 'get_character_states', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}'),
                    ('candidate-summary', 'run-1', 4, 'summarize_chapter', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}');"#,
        )
        .expect("seed real failure ordering");

    let same_step = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("same-step character state read must remain rejected");
    assert_eq!(same_step.code, "DSH_REQUIRED_CONTEXT_READ_MISSING");

    connection
        .execute(
            r#"UPDATE tool_call_events
                   SET arguments_summary_json=
                       '{"dshTurn":1,"dshStep":3,"dshResponseId":"turn:1:step:3"}'
                   WHERE event_id='candidate-summary'"#,
            [],
        )
        .expect("move summary candidate to later step");
    assert_eq!(
        validate_turn_execution_contract(&connection, &input, "run-1")
            .expect("later-step summary candidate"),
        Some("candidate-summary".to_string())
    );
}

#[test]
fn chapter_summary_contract_keeps_character_and_memory_reads_optional() {
    let mut input = chapter_summary_input();
    input.required_read_tools = vec![
        "novel.read_context".to_string(),
        "chapter.read_outline".to_string(),
    ];
    validate_turn_contract(&input).expect("valid minimally grounded chapter summary");
    let connection = rusqlite::Connection::open_in_memory().expect("contract database");
    connection
        .execute_batch(
            r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-novel', 'run-1', 0, 'novel.read_context', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-chapter', 'run-1', 1, 'chapter.read_outline', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-characters', 'run-1', 2, 'get_character_states', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}'),
                    ('read-memory', 'run-1', 3, 'search_memory', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}'),
                    ('candidate-summary', 'run-1', 4, 'summarize_chapter', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}');"#,
        )
        .expect("seed optional context reads beside the summary candidate");

    assert_eq!(
        validate_turn_execution_contract(&connection, &input, "run-1")
            .expect("adopted prose and novel context are grounded in an earlier step"),
        Some("candidate-summary".to_string())
    );
}

#[test]
fn read_turn_contract_requires_every_declared_context_read_to_succeed() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.goal = "分析本作品现有世界背景".to_string();
    input.task_kind = "read".to_string();
    input.expected_tool = None;
    input.expected_artifact_type = None;
    input.required_read_tools = vec!["novel.read".to_string()];
    validate_turn_contract(&input).expect("valid grounded read contract");
    let prompt = workbench_turn_prompt(&input);
    assert!(prompt.contains("必需读取：novel.read"));
    assert!(prompt.contains("全部必需读取成功后"));
    input.required_read_tools = vec!["novel.read_context".to_string()];
    assert!(validate_turn_contract(&input)
        .expect_err("legacy reads are not valid on Canonical-only turns")
        .contains("未知上下文读取工具"));
    input.required_read_tools = vec!["novel.read".to_string()];

    let connection = rusqlite::Connection::open_in_memory().expect("contract database");
    connection
        .execute_batch(
            r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );"#,
        )
        .expect("tool event schema");

    let missing = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("a read-only answer without its declared source must fail");
    assert_eq!(missing.code, "DSH_REQUIRED_CONTEXT_READ_MISSING");

    connection
        .execute(
            "INSERT INTO tool_call_events VALUES
                 ('read-1', 'run-1', 0, 'novel.read', 'failed', '{}')",
            [],
        )
        .expect("failed read");
    let failed = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("a failed required read must not satisfy the contract");
    assert_eq!(failed.code, "DSH_REQUIRED_CONTEXT_READ_MISSING");

    connection
        .execute(
            "UPDATE tool_call_events SET status='succeeded' WHERE event_id='read-1'",
            [],
        )
        .expect("successful Canonical read");
    let metadata = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("a required read without DSH response evidence must fail closed");
    assert_eq!(metadata.code, "DSH_TOOL_RESPONSE_METADATA_INVALID");

    connection
        .execute(
            r#"UPDATE tool_call_events
                   SET arguments_summary_json=
                       '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'
                   WHERE event_id='read-1'"#,
            [],
        )
        .expect("grounded read metadata");
    assert_eq!(
        validate_turn_execution_contract(&connection, &input, "run-1")
            .expect("successful grounded read"),
        None
    );
}

#[test]
fn turn_contract_rejects_same_step_grounding_and_accepts_the_next_step() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.chapter_id = None;
    input.task_kind = "story_plan_generate".to_string();
    input.expected_tool = Some("generate_outline".to_string());
    input.expected_artifact_type = Some("outline".to_string());
    input.required_read_tools = vec!["novel.read_context".to_string()];
    validate_turn_contract(&input).expect("valid story plan contract");
    let prompt = workbench_turn_prompt(&input);
    assert!(prompt.contains("taskKind：story_plan_generate"));
    assert!(prompt.contains("唯一候选工具：generate_outline"));
    assert!(prompt.contains("必需读取：novel.read_context"));

    let connection = rusqlite::Connection::open_in_memory().expect("contract database");
    connection
        .execute_batch(
            r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-1', 'run-1', 0, 'novel.read_context', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('candidate-1', 'run-1', 1, 'generate_outline', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}');"#,
        )
        .expect("seed calls from one model response");
    let same_step = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("a read and candidate from the same model step must fail");
    assert_eq!(same_step.code, "DSH_REQUIRED_CONTEXT_READ_MISSING");

    connection
        .execute(
            r#"UPDATE tool_call_events
                   SET arguments_summary_json=
                       '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}'
                   WHERE event_id='candidate-1'"#,
            [],
        )
        .expect("move candidate to the response after the read result");
    assert_eq!(
        validate_turn_execution_contract(&connection, &input, "run-1")
            .expect("next-step candidate contract"),
        Some("candidate-1".to_string())
    );

    connection
        .execute(
            "UPDATE tool_call_events SET sequence=2 WHERE event_id='read-1'",
            [],
        )
        .expect("move read after candidate");
    let missing = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("late read must fail");
    assert_eq!(missing.code, "DSH_REQUIRED_CONTEXT_READ_MISSING");
}

#[test]
fn turn_contract_rejects_legacy_calls_without_response_metadata() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.chapter_id = None;
    input.task_kind = "story_plan_generate".to_string();
    input.expected_tool = Some("generate_outline".to_string());
    input.expected_artifact_type = Some("outline".to_string());
    input.required_read_tools = vec!["novel.read_context".to_string()];

    let connection = rusqlite::Connection::open_in_memory().expect("contract database");
    connection
        .execute_batch(
            r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-1', 'run-1', 0, 'novel.read_context', 'succeeded', '{}'),
                    ('candidate-1', 'run-1', 1, 'generate_outline', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}');"#,
        )
        .expect("seed a legacy read without response metadata");
    let legacy_read = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("legacy read metadata must fail closed");
    assert_eq!(legacy_read.code, "DSH_TOOL_RESPONSE_METADATA_INVALID");

    connection
        .execute_batch(
            r#"UPDATE tool_call_events
                    SET arguments_summary_json=
                        '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'
                    WHERE event_id='read-1';
                   UPDATE tool_call_events SET arguments_summary_json='{}'
                    WHERE event_id='candidate-1';"#,
        )
        .expect("move missing metadata to the candidate");
    let legacy_candidate = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("legacy candidate metadata must fail closed");
    assert_eq!(legacy_candidate.code, "DSH_TOOL_RESPONSE_METADATA_INVALID");
}

#[test]
fn turn_contract_distinguishes_a_missing_required_candidate() {
    let input = chapter_summary_input();
    let connection = rusqlite::Connection::open_in_memory().expect("contract database");
    connection
        .execute_batch(
            r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-1', 'run-1', 0, 'novel.read_context', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}');"#,
        )
        .expect("seed a summary run without a candidate call");

    let missing = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("a required candidate tool call cannot be omitted");
    assert_eq!(missing.code, "DSH_REQUIRED_CANDIDATE_TOOL_MISSING");
}

#[test]
fn turn_contract_allows_failed_repairs_and_rejects_wrong_or_duplicate_candidates() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.task_kind = "setting_expand".to_string();
    input.expected_tool = Some("expand_settings".to_string());
    input.expected_artifact_type = Some("setting_candidates".to_string());
    input.required_read_tools = vec![
        "novel.read_context".to_string(),
        "chapter.read_outline".to_string(),
    ];
    validate_turn_contract(&input).expect("valid setting contract");

    let connection = rusqlite::Connection::open_in_memory().expect("contract database");
    connection
        .execute_batch(
            r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-1', 'run-1', 0, 'novel.read_context', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-2', 'run-1', 1, 'chapter.read_outline', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('candidate-1', 'run-1', 2, 'generate_characters', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}');"#,
        )
        .expect("seed wrong candidate");
    let wrong = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("wrong candidate must fail");
    assert_eq!(wrong.code, "DSH_UNEXPECTED_CANDIDATE_TOOL");

    connection
        .execute(
            "UPDATE tool_call_events
                 SET tool_name='expand_settings', status='failed'
                 WHERE event_id='candidate-1'",
            [],
        )
        .expect("turn the first candidate into a failed validation attempt");
    connection
        .execute(
            r#"INSERT INTO tool_call_events VALUES
                    ('candidate-2', 'run-1', 3, 'expand_settings', 'succeeded',
                     '{"dshTurn":1,"dshStep":3,"dshResponseId":"turn:1:step:3"}')"#,
            [],
        )
        .expect("insert a corrected candidate");
    assert_eq!(
        validate_turn_execution_contract(&connection, &input, "run-1")
            .expect("a failed candidate followed by one success is valid"),
        Some("candidate-2".to_string())
    );

    connection
        .execute(
            "UPDATE tool_call_events SET status='succeeded' WHERE event_id='candidate-1'",
            [],
        )
        .expect("forge a second successful candidate");
    let duplicate = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("two successful candidates must fail");
    assert_eq!(duplicate.code, "DSH_CANDIDATE_TOOL_COUNT_INVALID");

    connection
        .execute_batch(
            r#"UPDATE tool_call_events SET status='failed' WHERE event_id='candidate-1';
                 INSERT INTO tool_call_events VALUES
                    ('candidate-3', 'run-1', 4, 'expand_settings', 'failed',
                     '{"dshTurn":1,"dshStep":4,"dshResponseId":"turn:1:step:4"}')"#,
        )
        .expect("append a call after success");
    let late_retry = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("a candidate call after success must fail");
    assert_eq!(late_retry.code, "DSH_CANDIDATE_RETRY_SEQUENCE_INVALID");

    connection
        .execute(
            "UPDATE tool_call_events SET status='failed' WHERE event_id='candidate-2'",
            [],
        )
        .expect("make all bounded attempts fail");
    let exhausted = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("three failed attempts must terminate without an artifact");
    assert_eq!(exhausted.code, "DSH_EXPECTED_CANDIDATE_FAILED");

    connection
        .execute(
            r#"INSERT INTO tool_call_events VALUES
                    ('candidate-4', 'run-1', 5, 'expand_settings', 'failed',
                     '{"dshTurn":1,"dshStep":5,"dshResponseId":"turn:1:step:5"}')"#,
            [],
        )
        .expect("exceed the candidate attempt limit");
    let over_limit = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("a fourth candidate attempt must fail closed");
    assert_eq!(over_limit.code, "DSH_CANDIDATE_TOOL_COUNT_INVALID");

    input.task_kind = "read".to_string();
    input.expected_tool = None;
    input.expected_artifact_type = None;
    input.required_read_tools.clear();
    let unexpected = validate_turn_execution_contract(&connection, &input, "run-1")
        .expect_err("read turn candidate must fail");
    assert_eq!(unexpected.code, "DSH_UNEXPECTED_CANDIDATE_TOOL");
}

#[test]
fn openai_compatible_snapshot_uses_exact_model_on_the_pinned_harness() {
    let input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    let route = selected_model_route(&input).expect("compatible route");
    assert_eq!(route.logical_provider, OPENAI_COMPATIBLE_PROVIDER);
    assert_eq!(route.harness_provider, DEEPSEEK_HARNESS_PROVIDER);
    assert_eq!(route.model, "gpt-5.6-luna");
    assert_eq!(route.base_url, "http://127.0.0.1:12074/v1");

    let probe = probe_input(Some(&input.model_snapshot), Some("session-only-probe-key"))
        .expect("dynamic probe input");
    let probe_route = selected_model_route(&probe).expect("dynamic probe route");
    assert_eq!(probe_route, route);
    assert_eq!(probe.api_key, "session-only-probe-key");

    let mut legacy = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1",
    );
    legacy
        .model_snapshot
        .as_object_mut()
        .unwrap()
        .remove("runtime");
    let legacy_route =
        selected_model_route(&legacy).expect("legacy snapshots default adapterProtocol");
    assert_eq!(legacy_route.model, "gpt-5.6-luna");
    let mut missing_url = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1",
    );
    missing_url
        .model_snapshot
        .as_object_mut()
        .expect("object snapshot")
        .remove("baseUrl");
    assert!(selected_model_route(&missing_url)
        .expect_err("openai_compatible still requires baseUrl to start")
        .contains("baseUrl"),);
    let mut missing_deepseek_url = api_input(
        DEEPSEEK_HARNESS_PROVIDER,
        "deepseek-chat",
        "https://api.deepseek.com/v1",
    );
    missing_deepseek_url
        .model_snapshot
        .as_object_mut()
        .expect("object snapshot")
        .remove("baseUrl");
    assert!(selected_model_route(&missing_deepseek_url)
        .expect_err("deepseek snapshots must also carry an explicit baseUrl")
        .contains("baseUrl"),);
    let mut empty_deepseek_url = api_input(
        DEEPSEEK_HARNESS_PROVIDER,
        "deepseek-chat",
        "https://api.deepseek.com/v1",
    );
    empty_deepseek_url.model_snapshot["baseUrl"] = json!("   ");
    assert!(selected_model_route(&empty_deepseek_url)
        .expect_err("an empty deepseek baseUrl must fail before routing")
        .contains("baseUrl"),);
    assert!(
        read_matching_plugin_probe_health(Some(&missing_url.model_snapshot), None)
            .expect_err("an invalid snapshot must not reuse an existing probe")
            .contains("baseUrl")
    );
    assert!(
        ensure_plugin_probe_health(Some(&missing_url.model_snapshot), None)
            .expect_err("an exact invalid snapshot must not probe a different default model")
            .contains("baseUrl")
    );
    assert!(!probe
        .model_snapshot
        .to_string()
        .contains("session-only-probe-key"));

    let transport = provider_transport(&input).expect("provider transport");
    let other = provider_transport(&api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "another-model",
        "http://127.0.0.1:12074/v1",
    ))
    .expect("other provider transport");
    assert_ne!(transport.identity_hash, other.identity_hash);
}

#[test]
fn provider_transport_rejects_empty_remote_credentials_but_allows_loopback() {
    let mut remote = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "https://api.example.com/v1",
    );
    remote.api_key.clear();
    let remote_error = provider_transport(&remote)
        .err()
        .expect("remote transport must require a credential");
    assert!(remote_error.contains("远程模型不得使用空凭据"));

    let mut loopback = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1",
    );
    loopback.api_key.clear();
    assert_eq!(
        provider_transport(&loopback)
            .expect("loopback transport may use the explicit no-key placeholder")
            .upstream_key,
        "local-no-key-required"
    );
}

#[test]
fn snapshot_provider_model_and_base_url_mismatches_fail_closed() {
    let mut provider_mismatch = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1",
    );
    provider_mismatch.model_snapshot["runtime"]["adapterProvider"] =
        json!(DEEPSEEK_HARNESS_PROVIDER);
    assert!(selected_model_route(&provider_mismatch)
        .expect_err("provider mismatch")
        .contains("不一致"));

    let model_mismatch = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        " gpt-5.6-luna",
        "http://127.0.0.1:12074/v1",
    );
    assert!(selected_model_route(&model_mismatch)
        .expect_err("non-exact model")
        .contains("modelId 无效"));

    let invalid_base = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1?credential=forbidden",
    );
    assert!(selected_model_route(&invalid_base).is_err());

    let mut mock_snapshot = provider_mismatch.model_snapshot.clone();
    mock_snapshot["runtimeMode"] = json!("mock");
    assert!(probe_input(Some(&mock_snapshot), None).is_err());
    let mut secret_snapshot = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1",
    )
    .model_snapshot;
    secret_snapshot["apiKey"] = json!("fixture-only");
    assert!(probe_input(Some(&secret_snapshot), None).is_err());
}

#[test]
fn runtime_health_identity_is_checked_before_logical_projection() {
    let route = selected_model_route(&api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1",
    ))
    .expect("compatible route");
    let verified_at = Utc::now();
    let health = json!({
        "route": {
            "provider": DEEPSEEK_HARNESS_PROVIDER,
            "model": "gpt-5.6-luna"
        },
        "providers": [{
            "id": DEEPSEEK_HARNESS_PROVIDER,
            "name": "DeepSeek",
            "status": "loaded",
            "models": [{
                "provider": DEEPSEEK_HARNESS_PROVIDER,
                "id": "deepseek-v4-flash"
            }]
        }],
        "models": [{
            "provider": DEEPSEEK_HARNESS_PROVIDER,
            "id": "deepseek-v4-flash"
        }],
        "modelToolAttestations": [{
            "protocol": MODEL_TOOL_ATTESTATION_PROTOCOL,
            "provider": DEEPSEEK_HARNESS_PROVIDER,
            "model": "gpt-5.6-luna",
            "verified": true,
            "cached": false,
            "verifiedAt": verified_at.to_rfc3339(),
            "expiresAt": (verified_at + chrono::Duration::milliseconds(MODEL_TOOL_ATTESTATION_TTL_MS)).to_rfc3339(),
            "cacheTtlMs": MODEL_TOOL_ATTESTATION_TTL_MS,
            "finishKind": "tool-calls",
            "observedToolCalls": 1
        }]
    });
    validate_runtime_health_identity(&health, &route).expect("exact harness health");
    let projected = project_runtime_health_identity(health, &route);
    assert_eq!(
        projected.pointer("/route/provider").and_then(Value::as_str),
        Some(OPENAI_COMPATIBLE_PROVIDER)
    );
    assert_eq!(
        projected.pointer("/providers/0/id").and_then(Value::as_str),
        Some(OPENAI_COMPATIBLE_PROVIDER)
    );
    assert_eq!(
        projected
            .pointer("/models/0/provider")
            .and_then(Value::as_str),
        Some(OPENAI_COMPATIBLE_PROVIDER)
    );
    assert_eq!(
        projected.pointer("/models/0/id").and_then(Value::as_str),
        Some("gpt-5.6-luna")
    );
    assert_eq!(
        projected
            .pointer("/providers/0/models/0/id")
            .and_then(Value::as_str),
        Some("gpt-5.6-luna")
    );
    assert_eq!(
        projected
            .pointer("/modelToolAttestations/0/provider")
            .and_then(Value::as_str),
        Some(OPENAI_COMPATIBLE_PROVIDER)
    );

    let wrong_provider = json!({
        "route": { "provider": OPENAI_COMPATIBLE_PROVIDER, "model": "gpt-5.6-luna" }
    });
    assert!(validate_runtime_health_identity(&wrong_provider, &route).is_err());
    let wrong_model = json!({
        "route": { "provider": DEEPSEEK_HARNESS_PROVIDER, "model": "other-model" }
    });
    assert!(validate_runtime_health_identity(&wrong_model, &route).is_err());
}

#[test]
fn tool_error_prefers_gateway_message_over_generic_code() {
    let event = json!({
        "data": {
            "message": {
                "content": [{
                    "content": [{
                        "type": "text",
                        "text": "{\"error\":\"candidateText must be a non-empty string\"}"
                    }]
                }]
            }
        }
    });
    assert_eq!(
        tool_error_message(&event, "DSH_TOOL_FAILED"),
        "candidateText must be a non-empty string"
    );
}

#[test]
fn artifact_projection_only_exposes_validated_candidates() {
    assert_eq!(
        artifact_projection_summary("valid", 0, 0).expect("valid summary"),
        "候选已通过产物契约校验，需在对话中确认后才会写入正式事实。"
    );
    assert!(artifact_projection_summary("valid_with_warnings", 2, 0)
        .expect("warning summary")
        .contains("包含警告"));
    let invalid = artifact_projection_summary("invalid", 0, 1)
        .expect_err("invalid artifact must not become a candidate card");
    assert_eq!(invalid.code, "ARTIFACT_VALIDATION_FAILED");
}

#[test]
fn provider_options_projection_excludes_runtime_only_snapshot_fields() {
    let projected = provider_options_from_model_snapshot(&json!({
        "providerId": OPENAI_COMPATIBLE_PROVIDER,
        "modelId": "gpt-5.6-luna",
        "options": {
            "temperature": 0.6,
            "maxTokens": 12_000,
            "timeoutSeconds": 600,
            "contextCompression": {
                "novelProviderId": "ans.novel-context.extractive-v1",
                "sessionCompaction": "dsh-compaction-basic"
            }
        }
    }));

    assert_eq!(
        projected,
        json!({
            "providerId": OPENAI_COMPATIBLE_PROVIDER,
            "model": "gpt-5.6-luna",
            "temperature": 0.6,
            "maxTokens": 12_000
        })
    );
    crate::services::ai_fact_security::validate_provider_options(&projected)
        .expect("projected provider options should satisfy the durable fact allowlist");
}

#[test]
fn provider_response_projection_excludes_request_governance_metadata() {
    let metadata = provider_response_metadata(
        &json!({
            "providerId": OPENAI_COMPATIBLE_PROVIDER,
            "modelId": "gpt-5.6-luna"
        }),
        "provider-request-1",
        "response-hash",
        4096,
        1200,
        800,
    );

    assert_eq!(metadata["provider"], OPENAI_COMPATIBLE_PROVIDER);
    assert_eq!(metadata["model"], "gpt-5.6-luna");
    assert_eq!(metadata["tokenTotal"], 2000);
    assert!(metadata.get("governedReservationId").is_none());
    crate::services::ai_fact_security::validate_response_metadata(&metadata)
        .expect("projected response metadata should satisfy the durable fact allowlist");
}

#[test]
fn novel_scoped_outline_projection_can_create_its_durable_ai_task() {
    let mut connection = ai_task_service::tests::connection().expect("task database");
    connection
        .execute(
            "INSERT INTO novels (id, title, created_at, updated_at)
                 VALUES ('novel-1', '测试作品', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')",
            [],
        )
        .expect("seed novel");
    let prompt_body = "你是 AI Novel Studio 的小说任务执行 Agent。只生成候选，不写入正式事实。";
    let input = CreateAiTaskInput {
        operation_id: "workbench-run-story-plan".to_string(),
        request_hash_version: None,
        request_hash: None,
        trace_id: None,
        task_type: "outline_generate".to_string(),
        novel_id: "novel-1".to_string(),
        chapter_id: None,
        draft_id: None,
        scope_type: "novel".to_string(),
        expected_artifact_type: "outline".to_string(),
        expected_artifact_schema_version: 1,
        target_hint_json: Some(json!({
            "conversationId": "conversation-1",
            "turnId": "turn-1",
            "runId": "run-1",
            "modelSnapshot": {
                "providerId": OPENAI_COMPATIBLE_PROVIDER,
                "modelId": "gpt-5.6-luna",
                "runtimeMode": "api",
                "baseUrl": "http://127.0.0.1:12074/v1",
                "options": {"maxTokens": 8000}
            },
            "baseChapterRevision": "2026-08-28T00:00:00Z",
            "baseDraftId": null,
            "baseDraftVersion": null,
            "baseContentHash": null
        })),
        input_snapshot: ai_task_service::InputSnapshotInput {
            schema_version: 1,
            input_type: "workbench_dsh_messages_v1".to_string(),
            payload_json: json!({
                "goal": "生成全书规划候选。创意依据：写一部约6万字的悬疑小说。",
                "conversationId": "conversation-1"
            }),
            body: json!({"messages":[{"role":"user","content":"生成全书规划候选"}]}).to_string(),
            source_draft_id: None,
            source_draft_version: None,
            base_content_hash: None,
        },
        context_snapshot: ai_task_service::ContextSnapshotInput {
            schema_version: 1,
            source_manifest_json: json!({
                "contractVersion": "workbench_dsh_context_evidence_v1",
                "compilerVersion": "workbench_dsh_context_evidence_v1",
                "compiledContextHash": large_text_repository::sha256("{}"),
                "sources": []
            }),
            compiled_context: "{}".to_string(),
            budget_json: json!({
                "maxChars": 2,
                "estimatedTokens": 1,
                "compiledContextChars": 2,
                "compiledContextBytes": 2,
                "includedSourceCount": 0,
                "truncatedSourceCount": 0,
                "omittedSourceCount": 0
            }),
            compiler_version: "workbench_dsh_context_evidence_v1".to_string(),
        },
        constraint_snapshot: ai_task_service::ConstraintSnapshotInput {
            schema_version: 1,
            payload_json: json!({"candidateOnly":true,"mayWriteBusinessData":false}),
            prompt_template_id: "workbench/outline".to_string(),
            prompt_template_version: "1".to_string(),
            prompt_template_hash: large_text_repository::sha256(prompt_body),
            prompt_template_body: prompt_body.to_string(),
            provider_options_json: json!({"maxTokens": 8000}),
        },
    };

    let task = ai_task_service::create_task(&mut connection, input)
        .expect("novel-scoped outline task should persist");
    assert_eq!(task.task_type, "outline_generate");
    assert_eq!(task.scope_type, "novel");
    assert_eq!(task.expected_artifact_type, "outline");
}

#[test]
fn chapter_scoped_setting_projection_uses_the_trusted_dsh_creation_boundary() {
    let mut connection = ai_task_service::tests::connection().expect("task database");
    connection
        .execute(
            "INSERT INTO novels (id, title, created_at, updated_at)
                 VALUES ('novel-1', '测试作品', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')",
            [],
        )
        .expect("seed novel");
    connection
        .execute(
            "INSERT INTO chapters
                 (id, novel_id, title, order_index, status, created_at, updated_at)
                 VALUES ('chapter-1', 'novel-1', '第一章', 1, 'outline_ready',
                         '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')",
            [],
        )
        .expect("seed chapter");
    let prompt_body = "你是 AI Novel Studio 的小说任务执行 Agent。只生成候选，不写入正式事实。";
    let compiled_context = "{}".to_string();
    let input = CreateAiTaskInput {
        operation_id: "workbench-run-setting".to_string(),
        request_hash_version: None,
        request_hash: None,
        trace_id: None,
        task_type: "setting_expand".to_string(),
        novel_id: "novel-1".to_string(),
        chapter_id: Some("chapter-1".to_string()),
        draft_id: None,
        scope_type: "chapter".to_string(),
        expected_artifact_type: "setting_candidates".to_string(),
        expected_artifact_schema_version: 1,
        target_hint_json: Some(json!({
            "conversationId": "conversation-1",
            "turnId": "turn-setting",
            "runId": "run-setting",
            "modelSnapshot": {
                "providerId": OPENAI_COMPATIBLE_PROVIDER,
                "modelId": "gpt-5.6-luna",
                "runtimeMode": "api",
                "baseUrl": "http://127.0.0.1:12074/v1",
                "options": {"maxTokens": 8000}
            },
            "baseChapterRevision": "2026-08-28T00:00:00Z",
            "baseDraftId": null,
            "baseDraftVersion": null,
            "baseContentHash": null
        })),
        input_snapshot: ai_task_service::InputSnapshotInput {
            schema_version: 1,
            input_type: "workbench_dsh_messages_v1".to_string(),
            payload_json: json!({
                "goal": "生成世界设定候选。创意依据：写一部约6万字的悬疑小说。",
                "conversationId": "conversation-1"
            }),
            body: json!({"messages":[{"role":"user","content":"生成世界设定候选"}]}).to_string(),
            source_draft_id: None,
            source_draft_version: None,
            base_content_hash: None,
        },
        context_snapshot: ai_task_service::ContextSnapshotInput {
            schema_version: 1,
            source_manifest_json: json!({
                "contractVersion": "workbench_dsh_context_evidence_v1",
                "compilerVersion": "workbench_dsh_context_evidence_v1",
                "compiledContextHash": large_text_repository::sha256(&compiled_context),
                "sources": []
            }),
            compiled_context,
            budget_json: json!({
                "maxChars": 2,
                "estimatedTokens": 1,
                "compiledContextChars": 2,
                "compiledContextBytes": 2,
                "includedSourceCount": 0,
                "truncatedSourceCount": 0,
                "omittedSourceCount": 0
            }),
            compiler_version: "workbench_dsh_context_evidence_v1".to_string(),
        },
        constraint_snapshot: ai_task_service::ConstraintSnapshotInput {
            schema_version: 1,
            payload_json: json!({"candidateOnly":true,"mayWriteBusinessData":false}),
            prompt_template_id: "workbench/setting_candidates".to_string(),
            prompt_template_version: "1".to_string(),
            prompt_template_hash: large_text_repository::sha256(prompt_body),
            prompt_template_body: prompt_body.to_string(),
            provider_options_json: json!({"maxTokens": 8000}),
        },
    };

    let task = ai_task_service::create_dsh_projected_task(
        &mut connection,
        input,
        "run-setting",
        "turn-setting",
        "conversation-1",
    )
    .expect("trusted DSH setting projection should persist");
    assert_eq!(task.task_type, "setting_expand");
    assert_eq!(task.scope_type, "chapter");
    assert_eq!(task.expected_artifact_type, "setting_candidates");
}

#[test]
fn artifact_context_evidence_records_only_read_tool_summaries() {
    let connection = rusqlite::Connection::open_in_memory().expect("open evidence database");
    connection
        .execute_batch(
            "CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    result_json TEXT
                );",
        )
        .expect("create evidence schema");
    connection
        .execute(
            "INSERT INTO tool_call_events VALUES (?1, 'run-1', 1,
                    'novel.read_context', ?2, 'succeeded', ?3)",
            rusqlite::params![
                "event-read-1",
                json!({
                    "toolVersion": "1",
                    "argumentsHash": "argument-hash",
                    "hiddenPrompt": "must-not-survive"
                })
                .to_string(),
                json!({
                    "largeTextRefId": "result-ref-1",
                    "contentHash": "content-hash",
                    "contentChars": 321,
                    "rawContent": "must-not-survive"
                })
                .to_string()
            ],
        )
        .expect("insert read evidence");
    connection
        .execute(
            "INSERT INTO tool_call_events VALUES (?1, 'run-1', 2,
                    'generate_chapter', '{}', 'succeeded', '{}')",
            rusqlite::params!["event-candidate-1"],
        )
        .expect("insert candidate event");

    let (manifest, compiled, budget, generation_context) =
        build_context_evidence(&connection, "run-1").expect("compile evidence");
    assert_eq!(manifest["sources"].as_array().map(Vec::len), Some(1));
    assert_eq!(manifest["sources"][0]["eventId"], "event-read-1");
    assert_eq!(manifest["sources"][0]["argumentsHash"], "argument-hash");
    assert_eq!(manifest["sources"][0]["largeTextRefId"], "result-ref-1");
    assert_eq!(budget["includedSourceCount"], 1);
    assert_eq!(
        generation_context["contractVersion"],
        "workbench_dsh_context_receipt_v1"
    );
    assert_eq!(
        manifest["compiledContextHash"],
        large_text_repository::sha256(&compiled)
    );
    assert!(!compiled.contains("must-not-survive"));
    assert!(!compiled.contains("generate_chapter"));

    let candidate_receipt =
        candidate_generation_context(&connection, "run-1", "generate_chapter", false)
            .expect("candidate receipt")
            .expect("candidate tools receive a context receipt before terminalization");
    assert_eq!(
        candidate_receipt["contractVersion"],
        "workbench_dsh_context_receipt_v1"
    );
    assert!(
        candidate_generation_context(&connection, "run-1", "novel.read_context", false)
            .expect("read tool projection")
            .is_none()
    );
    assert!(
        candidate_generation_context(&connection, "run-1", "generate_chapter", true)
            .expect("failed candidate projection")
            .is_none()
    );
}

#[test]
fn dsh_context_receipt_reports_formal_assets_without_exposing_content() {
    let mut sources = Vec::new();
    collect_context_receipts(
        "novel.read_context",
        &json!({
            "data": {
                "novel": {"id": "novel-1"},
                "worldSettings": [{"content": "secret-world-body"}],
                "ruleSystems": [],
                "protagonists": [{"name": "林默"}],
                "masterOutline": {"content": "secret-outline-body"},
                "volumeOutlines": [],
                "currentChapterOutline": null,
                "styleProfiles": [{"name": "克制悬疑"}],
                "outputProfiles": [{"name": "长篇正文"}],
                "factions": [],
                "locations": [],
                "referenceWorks": [{"title": "研究资料"}],
                "referenceExcerpts": [{"content": "secret-reference-body"}]
            }
        }),
        &mut sources,
    );
    collect_context_receipts(
        "search_memory",
        &json!({"data":{"chunks":[{"text":"secret-memory-body"}]}}),
        &mut sources,
    );
    assert!(sources
        .iter()
        .any(|source| { source["type"] == "world_setting" && source["status"] == "used" }));
    assert!(sources
        .iter()
        .any(|source| { source["type"] == "rule_system" && source["status"] == "missing" }));
    assert!(sources
        .iter()
        .any(|source| { source["type"] == "memory_context" && source["status"] == "used" }));
    assert!(sources
        .iter()
        .any(|source| { source["type"] == "reference_material" && source["status"] == "used" }));
    let serialized = serde_json::to_string(&sources).expect("serialize safe receipt");
    assert!(!serialized.contains("secret-world-body"));
    assert!(!serialized.contains("secret-outline-body"));
    assert!(!serialized.contains("secret-memory-body"));
    assert!(!serialized.contains("secret-reference-body"));
}

#[test]
fn model_tool_attestation_requires_exact_live_positive_evidence() {
    let verified_at = Utc::now();
    let evidence = json!({
        "protocol": MODEL_TOOL_ATTESTATION_PROTOCOL,
        "provider": "deepseek-official",
        "model": "deepseek-chat",
        "verified": true,
        "cached": false,
        "verifiedAt": verified_at.to_rfc3339(),
        "expiresAt": (verified_at + chrono::Duration::milliseconds(MODEL_TOOL_ATTESTATION_TTL_MS)).to_rfc3339(),
        "cacheTtlMs": MODEL_TOOL_ATTESTATION_TTL_MS,
        "finishKind": "tool-calls",
        "observedToolCalls": 1
    });
    let parsed =
        validate_model_tool_attestation(evidence.clone(), "deepseek-official", "deepseek-chat")
            .expect("exact positive evidence");
    assert!(parsed.verified);
    let frozen = model_snapshot_with_tool_attestation(
        &json!({
            "providerId": "deepseek-official",
            "modelId": "deepseek-chat",
            "runtime": {
                "toolCallingAttestation": {
                    "verified": true,
                    "nonce": "untrusted-client-claim",
                    "usage": { "inputTokens": 1 }
                }
            }
        }),
        &parsed,
    )
    .expect("freeze validated evidence");
    let frozen_evidence = frozen
        .pointer("/runtime/toolCallingAttestation")
        .and_then(Value::as_object)
        .expect("frozen evidence object");
    assert_eq!(frozen_evidence.len(), 10);
    assert!(!frozen_evidence.contains_key("nonce"));
    assert!(!frozen_evidence.contains_key("usage"));

    assert!(
        validate_model_tool_attestation(evidence.clone(), "deepseek-official", "other-model")
            .expect_err("model mismatch must fail")
            .contains("ATTESTATION_IDENTITY_MISMATCH")
    );

    assert!(validate_model_tool_attestation(
        evidence.clone(),
        "openai_compatible",
        "deepseek-chat"
    )
    .expect_err("provider mismatch must fail")
    .contains("ATTESTATION_IDENTITY_MISMATCH"));

    let mut expired = evidence;
    expired["expiresAt"] = json!((Utc::now() - chrono::Duration::seconds(1)).to_rfc3339());
    assert!(
        validate_model_tool_attestation(expired, "deepseek-official", "deepseek-chat")
            .expect_err("expired evidence must fail")
            .contains("INVALID_POSITIVE_EVIDENCE")
    );

    let rejected = json!({
        "protocol": MODEL_TOOL_ATTESTATION_PROTOCOL,
        "provider": "deepseek-official",
        "model": "deepseek-chat",
        "verified": false,
        "cached": false,
        "failureCode": "NO_TOOL_CALL"
    });
    assert!(
        validate_model_tool_attestation(rejected, "deepseek-official", "deepseek-chat")
            .expect_err("negative evidence must fail closed")
            .contains("NO_TOOL_CALL")
    );
}

#[test]
fn read_turn_allowlist_is_canonical_only() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.task_kind = "read".to_string();
    let allowed = turn_allowed_tools(&input);
    assert_eq!(allowed, CANONICAL_ALLOWED_TOOLS);
    assert_eq!(
        allowed.split(',').collect::<Vec<_>>(),
        [
            "novel.read",
            "structure.read",
            "context.read",
            "memory.search"
        ]
    );
    assert!(!allowed.contains("generate_chapter"));
    assert!(!allowed.contains("novel.read_context"));
    for tool in allowed.split(',') {
        assert!(
            !ALLOWED_TOOLS.split(',').any(|legacy| legacy == tool),
            "Canonical tool leaked into legacy allowlist: {tool}"
        );
    }
    assert_eq!(turn_context_read_tools(&input), CANONICAL_ALLOWED_TOOLS);

    input.task_kind = "outline_generate".to_string();
    input.expected_tool = Some("generate_outline".to_string());
    input.expected_artifact_type = Some("outline".to_string());
    input.required_read_tools = vec!["novel.read_context".to_string()];
    assert_eq!(turn_allowed_tools(&input), ALLOWED_TOOLS);
    assert_eq!(turn_context_read_tools(&input), CONTEXT_READ_TOOLS);
}

#[test]
fn workbench_prompts_for_read_turns_expose_canonical_tools_not_generate_chapter() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.task_kind = "read".to_string();
    input.goal = "读取当前世界设定".to_string();
    let prompt = workbench_turn_prompt(&input);
    let system = workbench_system_prompt(&input);
    for tool in [
        "novel.read",
        "structure.read",
        "context.read",
        "memory.search",
    ] {
        assert!(
            system.contains(tool) || prompt.contains(tool),
            "read prompt must expose {tool}: system={system} turn={prompt}"
        );
    }
    assert!(!prompt.contains("generate_chapter"));
    assert!(!system.contains("generate_chapter"));
    assert!(!prompt.contains("novel.read_context"));
    assert!(!system.contains("novel.read_context"));
    assert_eq!(system, CANONICAL_WORKBENCH_SYSTEM_PROMPT);

    input.task_kind = "outline_generate".to_string();
    input.expected_tool = Some("generate_outline".to_string());
    input.expected_artifact_type = Some("outline".to_string());
    input.required_read_tools = vec!["novel.read_context".to_string()];
    assert_eq!(workbench_system_prompt(&input), WORKBENCH_SYSTEM_PROMPT);
}

#[test]
fn normalize_tool_name_keeps_canonical_novel_read() {
    assert_eq!(normalize_tool_name("novel.read"), "novel.read");
    assert_eq!(normalize_tool_name("novel.read@1"), "novel.read");
    assert_eq!(normalize_tool_name("mcp__novel__novel.read"), "novel.read");
    assert_eq!(
        normalize_tool_name("mcp__novel__novel.read@1"),
        "novel.read"
    );
    assert_eq!(normalize_tool_name("novel_read_1e2b3adf9a19"), "novel.read");
    assert_eq!(
        normalize_tool_name("novel.read_context"),
        "novel.read_context"
    );
    assert_eq!(
        normalize_tool_name("mcp__novel__novel_read_context_1e2b3adf9a19"),
        "novel.read_context"
    );
    assert_eq!(normalize_tool_name("structure.read@1"), "structure.read");
    assert_eq!(normalize_tool_name("memory.search"), "memory.search");
}

#[test]
fn legacy_tool_name_is_rejected_on_canonical_only_turn() {
    let mut input = api_input(
        OPENAI_COMPATIBLE_PROVIDER,
        "gpt-5.6-luna",
        "http://127.0.0.1:12074/v1/",
    );
    input.task_kind = "read".to_string();
    let allowed = turn_allowed_tools(&input);
    let rejected = authorize_projected_tool("novel.read_context", allowed)
        .expect_err("legacy alias must fail closed on Canonical-only turns");
    assert!(rejected.contains("未授权"));
    assert_eq!(
        authorize_projected_tool("novel.read", allowed).expect("Canonical name is allowed"),
        "novel.read"
    );
    assert_eq!(
        authorize_projected_tool("novel.read@1", allowed).expect("versioned Canonical name"),
        "novel.read"
    );

    input.task_kind = "outline_generate".to_string();
    input.expected_tool = Some("generate_outline".to_string());
    let legacy = turn_allowed_tools(&input);
    assert_eq!(
        authorize_projected_tool("novel.read_context", legacy).expect("legacy candidate turn"),
        "novel.read_context"
    );
    let canonical_on_legacy = authorize_projected_tool("novel.read", legacy)
        .expect_err("Canonical names stay off the legacy candidate allowlist");
    assert!(canonical_on_legacy.contains("未授权"));
}
