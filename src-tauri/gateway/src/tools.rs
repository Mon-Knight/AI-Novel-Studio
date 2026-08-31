//! Novel-domain read tools plus a candidate-only validation sink.
//!
//! SQL and column semantics mirror the app's Rust schema (`src-tauri/src/db.rs`,
//! `src/outline_commands.rs`, `src/migrations.rs`) and the read semantics of
//! the production tool registry (`novel.read_context@1`, `chapter.read_*@1`,
//! memory `retrieve`). The gateway opens the database READ-ONLY and never runs
//! migrations or recovery. v3.2 should extract a shared read-only crate to
//! remove the SQL drift risk versus the app repositories.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub const TOOL_VERSION: &str = "v1";

const ID_MAX: usize = 160;
const QUERY_MAX: usize = 2000;
const CANDIDATE_TEXT_MAX: usize = 400_000;
const CANDIDATE_ITEM_MAX: usize = 200;
const CANDIDATE_NAME_MAX: usize = 240;
const CHARACTER_ROLE_TYPE_MAX: usize = 40;
const STORY_PLAN_VOLUME_MAX: usize = 50;
const STORY_PLAN_CHAPTER_MAX: usize = 200;
const STORY_PLAN_TITLE_MAX: usize = 240;
const STORY_PLAN_CONTENT_MAX: usize = CANDIDATE_TEXT_MAX;
const STORY_PLAN_VOLUME_FIELD_MAX: usize = CANDIDATE_TEXT_MAX;
const STORY_PLAN_CHAPTER_OUTLINE_MAX: usize = CANDIDATE_TEXT_MAX;
const STORY_PLAN_GOAL_MAX: usize = CANDIDATE_TEXT_MAX;
const STORY_PLAN_TOTAL_WORD_MIN: u64 = 1;
const STORY_PLAN_TOTAL_WORD_MAX: u64 = 10_000_000;
const STORY_PLAN_CHAPTER_WORD_MIN: u64 = 500;
const STORY_PLAN_CHAPTER_WORD_MAX: u64 = 10_000;
const TOP_K_MIN: i64 = 1;
const TOP_K_MAX: i64 = 20;
const CHUNK_CLIP: usize = 2_000;
const ADOPTED_BODY_CLIP: usize = 120_000;
const NOVEL_OUTLINE_CLIP: usize = 6_000;
const CORE_OUTLINE_CLIP: usize = 6_000;
const VOLUME_OUTLINE_CLIP: usize = 2_000;
const CONTEXT_TEXT_CLIP: usize = 1_200;
const CONTEXT_JSON_CLIP: usize = 800;
const CHARACTER_FIELD_CLIP: usize = 800;
const ENGINEERING_FIELD_CLIP: usize = 4_000;
const SUMMARY_FIELD_CLIP: usize = 2_000;
const WORLD_SETTING_LIMIT: usize = 6;
const RULE_SYSTEM_LIMIT: usize = 8;
const VOLUME_OUTLINE_LIMIT: usize = 8;
const VOLUME_LIMIT: usize = 24;
const CHAPTER_LIMIT: usize = 160;
const STYLE_PROFILE_LIMIT: usize = 1;
const PROTAGONIST_LIMIT: usize = 8;
const CHARACTER_LIMIT: usize = 64;
const CHARACTER_STATE_LIMIT: usize = 48;
const CHAPTER_ROLE_LIMIT: usize = 32;
const CHAPTER_EVENT_LIMIT: usize = 24;
const STORY_ASSET_LIMIT: usize = 8;
const REFERENCE_WORK_LIMIT: usize = 4;
const REFERENCE_EXCERPT_LIMIT: usize = 4;
const REFERENCE_EXCERPT_CLIP: usize = 800;

const TASK_SCOPE_UNAVAILABLE: &str = "task scope unavailable";
const TASK_TOOL_ALLOWLIST_UNAVAILABLE: &str = "task tool allowlist unavailable";
const TASK_CANDIDATE_POLICY_UNAVAILABLE: &str = "task candidate policy unavailable";
const TASK_NOVEL_SCOPE_REJECTED: &str = "tool arguments rejected by task novel scope";
const TASK_CHAPTER_SCOPE_REJECTED: &str = "tool arguments rejected by task chapter scope";

#[derive(Debug, Clone, PartialEq, Eq)]
enum CandidatePolicy {
    WorldRuleBundleV1,
    RuleSystemOnlyV1,
    PrimaryProtagonistV1,
    BookWordGoalV1 {
        target_word_count: u64,
        minimum_word_count: u64,
        maximum_word_count: u64,
        source_content_sha256: String,
    },
}

#[derive(Debug, PartialEq, Eq)]
struct TaskScope {
    novel_id: String,
    chapter_id: Option<String>,
}

struct TaskSecurityContext {
    allowed_tools: Option<HashSet<String>>,
    scope: Option<TaskScope>,
    candidate_policy: Option<CandidatePolicy>,
}

fn resolve_task_scope(
    allowed_tools_present: bool,
    novel_id: Option<&str>,
    chapter_id: Option<&str>,
) -> Result<Option<TaskScope>, String> {
    let novel_id = match novel_id {
        Some(value) if valid_scope_id(value) => value,
        Some(_) => return Err(TASK_SCOPE_UNAVAILABLE.to_string()),
        None if allowed_tools_present || chapter_id.is_some() => {
            return Err(TASK_SCOPE_UNAVAILABLE.to_string())
        }
        None => return Ok(None),
    };
    let chapter_id = match chapter_id {
        Some(value) if valid_scope_id(value) => Some(value.to_string()),
        Some(_) => return Err(TASK_SCOPE_UNAVAILABLE.to_string()),
        None => None,
    };
    Ok(Some(TaskScope {
        novel_id: novel_id.to_string(),
        chapter_id,
    }))
}

fn valid_scope_id(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= ID_MAX
}

fn task_scope_from_env(allowed_tools_present: bool) -> Result<Option<TaskScope>, String> {
    let novel_id = read_task_scope_env("ANS_TASK_NOVEL_ID")?;
    let chapter_id = read_task_scope_env("ANS_TASK_CHAPTER_ID")?;
    resolve_task_scope(
        allowed_tools_present,
        novel_id.as_deref(),
        chapter_id.as_deref(),
    )
}

fn read_task_scope_env(name: &str) -> Result<Option<String>, String> {
    match std::env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(std::env::VarError::NotUnicode(_)) => Err(TASK_SCOPE_UNAVAILABLE.to_string()),
    }
}

fn resolve_allowed_tools(
    raw: Result<String, std::env::VarError>,
) -> Result<Option<HashSet<String>>, String> {
    match raw {
        Ok(raw) => Ok(Some(
            raw.split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect(),
        )),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(std::env::VarError::NotUnicode(_)) => Err(TASK_TOOL_ALLOWLIST_UNAVAILABLE.to_string()),
    }
}

fn allowed_tools_from_env() -> Result<Option<HashSet<String>>, String> {
    resolve_allowed_tools(std::env::var("ANS_ALLOWED_TOOLS"))
}

fn canonical_policy_word_count(value: &str) -> Option<u64> {
    let parsed = value.parse::<u64>().ok()?;
    (parsed >= STORY_PLAN_TOTAL_WORD_MIN
        && parsed <= STORY_PLAN_TOTAL_WORD_MAX
        && parsed.to_string() == value)
        .then_some(parsed)
}

fn parse_book_word_goal_policy(value: &str) -> Option<CandidatePolicy> {
    let mut parts = value.split(':');
    if parts.next()? != "book_word_goal_v1" {
        return None;
    }
    let target_word_count = canonical_policy_word_count(parts.next()?)?;
    let minimum_word_count = canonical_policy_word_count(parts.next()?)?;
    let maximum_word_count = canonical_policy_word_count(parts.next()?)?;
    let source_content_sha256 = parts.next()?;
    if parts.next().is_some()
        || source_content_sha256.len() != 64
        || !source_content_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || minimum_word_count > target_word_count
        || target_word_count > maximum_word_count
    {
        return None;
    }
    Some(CandidatePolicy::BookWordGoalV1 {
        target_word_count,
        minimum_word_count,
        maximum_word_count,
        source_content_sha256: source_content_sha256.to_string(),
    })
}

fn resolve_candidate_policy(
    raw: Result<String, std::env::VarError>,
) -> Result<Option<CandidatePolicy>, String> {
    match raw {
        Ok(value) if value == "world_rule_bundle_v1" => {
            Ok(Some(CandidatePolicy::WorldRuleBundleV1))
        }
        Ok(value) if value == "rule_system_only_v1" => Ok(Some(CandidatePolicy::RuleSystemOnlyV1)),
        Ok(value) if value == "primary_protagonist_v1" => {
            Ok(Some(CandidatePolicy::PrimaryProtagonistV1))
        }
        Ok(value) => parse_book_word_goal_policy(&value)
            .map(Some)
            .ok_or_else(|| TASK_CANDIDATE_POLICY_UNAVAILABLE.to_string()),
        Err(std::env::VarError::NotUnicode(_)) => {
            Err(TASK_CANDIDATE_POLICY_UNAVAILABLE.to_string())
        }
        Err(std::env::VarError::NotPresent) => Ok(None),
    }
}

fn candidate_policy_from_env() -> Result<Option<CandidatePolicy>, String> {
    resolve_candidate_policy(std::env::var("ANS_CANDIDATE_POLICY"))
}

fn task_security_context_from_env() -> Result<TaskSecurityContext, String> {
    let allowed_tools = allowed_tools_from_env()?;
    let scope = task_scope_from_env(allowed_tools.is_some())?;
    Ok(TaskSecurityContext {
        allowed_tools,
        scope,
        candidate_policy: candidate_policy_from_env()?,
    })
}

fn validate_task_scope(scope: Option<&TaskScope>, arguments: &Value) -> Result<(), String> {
    let Some(scope) = scope else {
        return Ok(());
    };
    let object = arguments
        .as_object()
        .ok_or_else(|| TASK_NOVEL_SCOPE_REJECTED.to_string())?;
    if object.get("novelId").and_then(Value::as_str) != Some(scope.novel_id.as_str()) {
        return Err(TASK_NOVEL_SCOPE_REJECTED.to_string());
    }
    if let Some(chapter_id) = object.get("chapterId") {
        let matches_bound_chapter = chapter_id
            .as_str()
            .zip(scope.chapter_id.as_deref())
            .map(|(argument, bound)| argument == bound)
            .unwrap_or(false);
        if !matches_bound_chapter {
            return Err(TASK_CHAPTER_SCOPE_REJECTED.to_string());
        }
    }
    Ok(())
}

fn bind_search_memory_target(
    scope: Option<&TaskScope>,
    arguments: &Value,
) -> Result<Value, String> {
    let Some(bound_chapter_id) = scope.and_then(|scope| scope.chapter_id.as_deref()) else {
        return Ok(arguments.clone());
    };
    let mut object = arguments
        .as_object()
        .cloned()
        .ok_or_else(|| TASK_CHAPTER_SCOPE_REJECTED.to_string())?;
    for key in ["targetChapterId", "target_chapter_id"] {
        if let Some(explicit_target) = object.get(key) {
            if explicit_target.as_str() != Some(bound_chapter_id) {
                return Err(TASK_CHAPTER_SCOPE_REJECTED.to_string());
            }
        }
    }
    if !object.contains_key("targetChapterId") && !object.contains_key("target_chapter_id") {
        object.insert(
            "targetChapterId".to_string(),
            Value::String(bound_chapter_id.to_string()),
        );
    }
    Ok(Value::Object(object))
}

fn bind_novel_candidate_target(
    scope: Option<&TaskScope>,
    arguments: &Value,
) -> Result<Value, String> {
    let Some(scope) = scope else {
        return Ok(arguments.clone());
    };
    if scope.chapter_id.is_some() {
        return Ok(arguments.clone());
    }
    let mut object = arguments
        .as_object()
        .cloned()
        .ok_or_else(|| TASK_NOVEL_SCOPE_REJECTED.to_string())?;
    match object.get("novelId") {
        Some(value) if value.as_str() != Some(scope.novel_id.as_str()) => {
            return Err(TASK_NOVEL_SCOPE_REJECTED.to_string())
        }
        Some(_) => {}
        None => {
            object.insert("novelId".to_string(), Value::String(scope.novel_id.clone()));
        }
    }
    object.remove("chapterId");
    object.remove("chapter_id");
    Ok(Value::Object(object))
}

/// The `tools/list` payload.
pub fn tool_list() -> Vec<Value> {
    let tools = vec![
        json!({
            "name": "novel.read_context",
            "description": "读取小说上下文与章节结构。只读。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX}
                },
                "required": ["novelId"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "chapter.read_outline",
            "description": "读取目标章节大纲与工程上下文。只读。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX}
                },
                "required": ["novelId", "chapterId"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "generate_chapter",
            "description": "接收并验证模型已经写好的章节候选。必须传入 candidateText。问候、能力询问或闲聊时不要调用。只返回 candidate-only 结构，不写入正式正文。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "candidateText": {"type": "string", "minLength": 1, "maxLength": CANDIDATE_TEXT_MAX}
                },
                "required": ["novelId", "chapterId", "candidateText"],
                "additionalProperties": false
            },
            "outputSchema": {
                "type": "object",
                "properties": {
                    "ok": {"type": "boolean", "enum": [true]},
                    "toolVersion": {"type": "string", "enum": [TOOL_VERSION]},
                    "artifactType": {"type": "string", "enum": ["chapter_text"]},
                    "candidateOnly": {"type": "boolean", "enum": [true]},
                    "data": {
                        "type": "object",
                        "properties": {
                            "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                            "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                            "text": {"type": "string", "minLength": 1, "maxLength": CANDIDATE_TEXT_MAX}
                        },
                        "required": ["novelId", "chapterId", "text"],
                        "additionalProperties": false
                    }
                },
                "required": ["ok", "toolVersion", "artifactType", "candidateOnly", "data"],
                "additionalProperties": false
            }
        }),
        candidate_tool_schema(
            "generate_outline",
            "outline",
            "接收并验证大纲候选。普通大纲可提交 {\"title\":\"...\",\"content\":\"...\"}；全书规划不传 chapterId，必须提交 planKind=story_plan 的完整卷章 JSON。候选只供审阅，不写入正式大纲。",
        ),
        candidate_tool_schema(
            "generate_characters",
            "character_candidates",
            "接收并验证角色候选。普通配角至少提交 name；roleType=protagonist 的主角必须同时提交 identity、goal、personality，并应按设定提供 motivation、specialAbility、abilityLimits、background、arc 等正式主角字段。behaviorLimits 只表示行为边界，不得代替 specialAbility 或 abilityLimits；可追加 forbiddenBehaviors。不写入角色库。",
        ),
        candidate_tool_schema(
            "suggest_events",
            "event_candidates",
            "接收并验证事件候选。不写入章节事件。",
        ),
        candidate_tool_schema(
            "expand_settings",
            "setting_candidates",
            "接收并验证模型生成的世界设定或规则候选。普通设定提交 name/description；规则使用 targetType=rule_system，或将 category 设为 world_rules、magic、technology、cultivation、combat、social，可附 forbiddenRules。当任务要求生成世界与规则设定候选时，settings 必须同时包含至少一个普通世界设定和一个 targetType=rule_system 规则项。直接生成候选，不要要求用户填写这些字段；本工具不写入正式设定。",
        ),
        candidate_tool_schema(
            "polish_chapter",
            "chapter_text",
            "接收并验证润色候选。不覆盖正式正文。",
        ),
        candidate_tool_schema(
            "check_quality",
            "quality_report",
            "接收并验证基于当前已采用章节正文生成的质量报告。提交前必须先用 chapter.read_outline 读取正文；报告不能直接应用。",
        ),
        candidate_tool_schema(
            "summarize_chapter",
            "chapter_summary",
            "接收并验证基于当前已采用章节正文生成的章节总结候选。提交前必须先用 chapter.read_outline 读取正文。candidateText 必须是 JSON 对象的字符串，至少包含 summary；应从正文提取 keyEvents、factsMustRemember，并在存在变化时提供 characterChanges 与 contextRecords。直接生成完整候选，不要要求用户填写 JSON；本工具不写入正式上下文。",
        ),
        json!({
            "name": "get_metadata",
            "description": "读取小说元信息、分卷与章节结构、目标章节位置，以及风格/输出方案列表。只读。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX}
                },
                "required": ["novelId", "chapterId"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "get_chapter_context",
            "description": "读取目标章节的当前大纲、工程状态（章节卡/场景计划/生成约束）、章节事件，以及已采用的前序章节总结。只读。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX}
                },
                "required": ["novelId", "chapterId"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "search_memory",
            "description": "在已采用正文的记忆库中检索与查询相关的片段（FTS5，回退 LIKE）。targetChapterId 会严格排除目标章节及之后的事实；chapterId 保留为精确章节过滤。只读。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "query": {"type": "string", "minLength": 1, "maxLength": QUERY_MAX},
                    "topK": {"type": "integer", "minimum": TOP_K_MIN, "maximum": TOP_K_MAX},
                    "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "targetChapterId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": ID_MAX,
                        "description": "当前创作目标章节；检索只返回其之前章节的已采用事实。"
                    },
                    "sourceTypes": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["adopted_draft", "chapter_summary", "context_record"]}
                    },
                    "minImportance": {"type": "number", "minimum": 0.0, "maximum": 1.0}
                },
                "required": ["novelId", "query"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "get_character_states",
            "description": "读取角色库、主角设定、目标章节之前的角色状态轨迹，以及目标章节的角色出场安排。只读。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                    "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX}
                },
                "required": ["novelId", "chapterId"],
                "additionalProperties": false
            }
        }),
    ];
    filter_tool_list(tools, allowed_tools_from_env())
}

fn filter_tool_list(
    tools: Vec<Value>,
    allowed_tools: Result<Option<HashSet<String>>, String>,
) -> Vec<Value> {
    match allowed_tools {
        Ok(Some(allowed)) => tools
            .into_iter()
            .filter(|tool| {
                tool.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| allowed.contains(name))
            })
            .collect(),
        Ok(None) => tools,
        Err(_) => Vec::new(),
    }
}

/// Dispatches one `tools/call`.
pub fn call_tool(connection: &Connection, name: &str, arguments: &Value) -> Result<Value, String> {
    call_tool_with_security_context(
        connection,
        name,
        arguments,
        task_security_context_from_env(),
    )
}

fn call_tool_with_security_context(
    connection: &Connection,
    name: &str,
    arguments: &Value,
    security_context: Result<TaskSecurityContext, String>,
) -> Result<Value, String> {
    let security_context = security_context?;
    if crate::secret_guard::contains_secret_value(arguments) {
        return Err("suspicious credential-like input rejected".to_string());
    }
    if let Some(allowed) = &security_context.allowed_tools {
        if !allowed.contains(name) {
            return Err(format!("tool not allowed for this task: {}", name));
        }
    }
    let scoped_arguments = match name {
        "search_memory" => Some(bind_search_memory_target(
            security_context.scope.as_ref(),
            arguments,
        )?),
        "generate_outline" | "generate_characters" | "expand_settings" => Some(
            bind_novel_candidate_target(security_context.scope.as_ref(), arguments)?,
        ),
        _ => None,
    };
    let arguments = scoped_arguments.as_ref().unwrap_or(arguments);
    validate_task_scope(security_context.scope.as_ref(), arguments)?;
    match name {
        "novel.read_context" => get_metadata(connection, arguments, false),
        "get_metadata" => get_metadata(connection, arguments, true),
        "chapter.read_outline" | "get_chapter_context" => {
            get_chapter_context(connection, arguments)
        }
        "search_memory" => search_memory(connection, arguments),
        "get_character_states" => get_character_states(connection, arguments),
        "generate_chapter" => {
            generate_chapter(connection, arguments, security_context.candidate_policy)
        }
        "generate_outline" => candidate_tool(
            connection,
            arguments,
            "outline",
            false,
            security_context.candidate_policy,
        ),
        "generate_characters" => candidate_tool(
            connection,
            arguments,
            "character_candidates",
            false,
            security_context.candidate_policy,
        ),
        "suggest_events" => candidate_tool(
            connection,
            arguments,
            "event_candidates",
            true,
            security_context.candidate_policy,
        ),
        "expand_settings" => candidate_tool(
            connection,
            arguments,
            "setting_candidates",
            false,
            security_context.candidate_policy,
        ),
        "polish_chapter" => candidate_tool(
            connection,
            arguments,
            "chapter_text",
            true,
            security_context.candidate_policy,
        ),
        "check_quality" => candidate_tool(
            connection,
            arguments,
            "quality_report",
            true,
            security_context.candidate_policy,
        ),
        "summarize_chapter" => candidate_tool(
            connection,
            arguments,
            "chapter_summary",
            true,
            security_context.candidate_policy,
        ),
        other => Err(format!("unknown tool: {}", other)),
    }
}

fn candidate_tool_schema(name: &str, artifact_type: &str, description: &str) -> Value {
    let candidate_description = match artifact_type {
        "outline" => concat!(
            "模型生成的大纲 JSON 对象。普通大纲最小形状为 {\"title\":\"...\",\"content\":\"...\"}；",
            "全书规划根对象必须包含 planKind=story_plan、title、content、正整数 targetWordCount 和 volumes；",
            "每卷必须包含 title、summary、goal、mainConflict、outline、chapters；",
            "每章必须包含 title、outline、goal、正整数 targetWordCount，可用 characterNames 字符串数组明确本章涉及的正式角色；",
            "没有角色线索时省略 characterNames。直接提交完整候选，不要让用户填写 JSON"
        ),
        "character_candidates" => concat!(
            "模型生成的角色 JSON 对象，根对象为 {\"characters\":[...]}。普通配角至少包含 name；",
            "标记为 roleType=protagonist 的主角必须包含 name、identity、goal、personality；",
            "并应按设定提供 motivation、specialAbility、abilityLimits、background、arc 等正式主角字段；",
            "behaviorLimits 只表示行为边界，不得代替 specialAbility 或 abilityLimits；可补充 forbiddenBehaviors"
        ),
        "setting_candidates" => concat!(
            "模型生成的设定 JSON 对象，根对象为 {\"settings\":[...]}。每项至少包含 name 和 description；",
            "普通世界设定可使用 category=location/culture/history 等；规则项使用 targetType=rule_system，",
            "或 category=world_rules/magic/technology/cultivation/combat/social，可附 forbiddenRules 数组；",
            "当任务要求生成世界与规则设定候选时，两类条目必须同时存在"
        ),
        "chapter_summary" => concat!(
            "模型生成的 JSON 对象字符串，至少包含 summary。应从已采用正文提取 keyEvents 和 factsMustRemember；",
            "人物发生变化时提供 characterChanges（characterId 或 characterName、stateSummary，可附 location/healthState/knowledgeState）；",
            "需要长期沉淀的事实提供 contextRecords（contextType、title、content、importance）。不要让用户填写 JSON"
        ),
        _ => "模型已经生成完毕的候选内容；不要把格式填写工作转交给用户",
    };
    let structured_candidate = matches!(
        artifact_type,
        "outline" | "character_candidates" | "setting_candidates"
    );
    let candidate_field = if structured_candidate {
        "candidate"
    } else {
        "candidateText"
    };
    let candidate_schema = if artifact_type == "character_candidates" {
        json!({
            "type": "object",
            "description": candidate_description,
            "properties": {
                "characters": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": CANDIDATE_ITEM_MAX,
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "minLength": 1, "maxLength": CANDIDATE_NAME_MAX},
                            "roleType": {"type": "string", "enum": ["protagonist", "supporting", "antagonist", "neutral"]},
                            "gender": {"type": "string"},
                            "identity": {"type": "string"},
                            "faction": {"type": "string"},
                            "relationToProtagonist": {"type": "string"},
                            "goal": {"type": "string"},
                            "personality": {"type": "string"},
                            "motivation": {"type": "string"},
                            "ability": {"type": "string"},
                            "limitation": {"type": "string"},
                            "background": {"type": "string"},
                            "arc": {"type": "string"},
                            "notes": {"type": "string"},
                            "specialAbility": {"type": "string"},
                            "abilityLimits": {"type": "string"},
                            "behaviorLimits": {"type": "string"},
                            "forbiddenBehaviors": {"type": "string"},
                            "currentState": {"type": "string"}
                        },
                        "required": ["name"]
                    }
                }
            },
            "required": ["characters"]
        })
    } else if artifact_type == "setting_candidates" {
        json!({
            "type": "object",
            "description": candidate_description,
            "properties": {
                "settings": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": CANDIDATE_ITEM_MAX,
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "minLength": 1, "maxLength": CANDIDATE_NAME_MAX},
                            "description": {"type": "string", "minLength": 1},
                            "targetType": {"type": "string", "enum": ["world_setting", "rule_system"]},
                            "category": {"type": "string"},
                            "forbiddenRules": {"type": "array", "items": {"type": "string"}}
                        },
                        "required": ["name", "description"]
                    }
                }
            },
            "required": ["settings"]
        })
    } else if structured_candidate {
        json!({
            "type": "object",
            "description": candidate_description
        })
    } else {
        json!({
            "type": "string",
            "minLength": 1,
            "maxLength": CANDIDATE_TEXT_MAX,
            "description": candidate_description
        })
    };
    let mut input_schema = json!({
        "type": "object",
        "properties": {
            "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
            "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX}
        },
        "required": ["novelId", candidate_field],
        "additionalProperties": false
    });
    input_schema["properties"][candidate_field] = candidate_schema;
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema,
        "outputSchema": {
            "type": "object",
            "properties": {
                "ok": {"type": "boolean", "enum": [true]},
                "toolVersion": {"type": "string", "enum": [TOOL_VERSION]},
                "artifactType": {"type": "string", "enum": [artifact_type]},
                "candidateOnly": {"type": "boolean", "enum": [true]},
                "data": {
                    "type": "object",
                    "properties": {
                        "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                        "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                        "text": {"type": "string", "minLength": 1, "maxLength": CANDIDATE_TEXT_MAX}
                    },
                    "required": ["novelId", "text"],
                    "additionalProperties": false
                }
            },
            "required": ["ok", "toolVersion", "artifactType", "candidateOnly", "data"],
            "additionalProperties": false
        }
    })
}

fn candidate_tool(
    connection: &Connection,
    arguments: &Value,
    artifact_type: &str,
    require_chapter: bool,
    candidate_policy: Option<CandidatePolicy>,
) -> Result<Value, String> {
    let novel_id = arg_id(arguments, "novelId")?;
    let chapter_id = arguments
        .get("chapterId")
        .or_else(|| arguments.get("chapter_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if require_chapter && chapter_id.is_none() {
        return Err("chapterId is required".to_string());
    }
    generate_chapter_like(
        connection,
        &novel_id,
        chapter_id,
        arguments,
        artifact_type,
        candidate_policy,
    )
}

fn generate_chapter_like(
    connection: &Connection,
    novel_id: &str,
    chapter_id: Option<&str>,
    arguments: &Value,
    artifact_type: &str,
    candidate_policy: Option<CandidatePolicy>,
) -> Result<Value, String> {
    let candidate_text = candidate_payload_text(arguments)?;
    if candidate_text.chars().count() > CANDIDATE_TEXT_MAX {
        return Err(format!(
            "candidateText exceeds {} characters",
            CANDIDATE_TEXT_MAX
        ));
    }
    let novel_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM novels WHERE id = ?1 AND deleted_at IS NULL)",
            params![novel_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !novel_exists {
        return Err(format!("novel not found: {}", novel_id));
    }
    if let Some(chapter_id) = chapter_id {
        let chapter_exists: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM chapters
                    WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL
                 )",
                params![chapter_id, novel_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !chapter_exists {
            return Err(format!(
                "chapter not found in novel: {}/{}",
                novel_id, chapter_id
            ));
        }
        if matches!(artifact_type, "quality_report" | "chapter_summary") {
            let body = read_current_adopted_body(connection, novel_id, chapter_id)?;
            if body
                .as_ref()
                .and_then(|value| value.get("content"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
            {
                return Err(format!(
                    "current adopted chapter body is required for {}",
                    artifact_type
                ));
            }
        }
    }
    validate_candidate_payload(artifact_type, &candidate_text)?;
    validate_candidate_policy(candidate_policy, artifact_type, &candidate_text)?;
    let candidate_text = normalize_candidate_text(artifact_type, &candidate_text);
    Ok(json!({
        "ok": true,
        "toolVersion": TOOL_VERSION,
        "artifactType": artifact_type,
        "candidateOnly": true,
        "data": {
            "novelId": novel_id,
            "chapterId": chapter_id.unwrap_or(""),
            "text": candidate_text
        }
    }))
}

fn candidate_payload_text(arguments: &Value) -> Result<String, String> {
    if let Some(candidate) = arguments.get("candidate") {
        if !candidate.is_object() {
            return Err("candidate must be a JSON object".to_string());
        }
        return serde_json::to_string(candidate).map_err(|error| error.to_string());
    }
    arguments
        .get("candidateText")
        .or_else(|| arguments.get("candidate_text"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "candidate or candidateText must contain a complete candidate".to_string())
}

fn generate_chapter(
    connection: &Connection,
    arguments: &Value,
    candidate_policy: Option<CandidatePolicy>,
) -> Result<Value, String> {
    let novel_id = arg_id(arguments, "novelId")?;
    let chapter_id = arg_id(arguments, "chapterId")?;
    let candidate_text = arguments
        .get("candidateText")
        .or_else(|| arguments.get("candidate_text"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "candidateText must be a non-empty string".to_string())?;
    if candidate_text.chars().count() > CANDIDATE_TEXT_MAX {
        return Err(format!(
            "candidateText exceeds {} characters",
            CANDIDATE_TEXT_MAX
        ));
    }
    let chapter_exists: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM chapters
                WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL
             )",
            params![chapter_id, novel_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !chapter_exists {
        return Err(format!(
            "chapter not found in novel: {}/{}",
            novel_id, chapter_id
        ));
    }
    validate_candidate_payload("chapter_text", candidate_text)?;
    validate_candidate_policy(candidate_policy, "chapter_text", candidate_text)?;
    Ok(json!({
        "ok": true,
        "toolVersion": TOOL_VERSION,
        "artifactType": "chapter_text",
        "candidateOnly": true,
        "data": {"novelId": novel_id, "chapterId": chapter_id, "text": candidate_text}
    }))
}

fn parse_candidate_json(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    serde_json::from_str(trimmed).ok().or_else(|| {
        let start = trimmed.find(['{', '['])?;
        let prefix = &trimmed[..start];
        if !safe_json_wrapper_fragment(prefix) {
            return None;
        }
        let source = &trimmed[start..];
        let mut values = serde_json::Deserializer::from_str(source).into_iter::<Value>();
        let value = values.next()?.ok()?;
        let remainder = &source[values.byte_offset()..];
        safe_json_wrapper_fragment(remainder).then_some(value)
    })
}

fn safe_json_wrapper_fragment(fragment: &str) -> bool {
    let trimmed = fragment.trim();
    trimmed.is_empty()
        || (!trimmed
            .chars()
            .any(|character| matches!(character, '{' | '}' | '[' | ']' | ','))
            && serde_json::from_str::<Value>(trimmed).is_err())
}

fn normalize_candidate_text(artifact_type: &str, candidate_text: &str) -> String {
    let Some(parsed) = parse_candidate_json(candidate_text) else {
        return candidate_text.to_string();
    };
    let structured = match artifact_type {
        "outline" => parsed.is_object(),
        "character_candidates" | "event_candidates" | "setting_candidates" | "quality_report" => {
            true
        }
        "chapter_summary" => parsed.get("summary").is_some(),
        _ => false,
    };
    if structured {
        serde_json::to_string(&parsed).unwrap_or_else(|_| candidate_text.to_string())
    } else {
        candidate_text.to_string()
    }
}

fn named_entries(value: &Value, keys: &[&str], name_key: &str) -> bool {
    let lists = keys
        .iter()
        .filter_map(|key| value.get(key))
        .chain(std::iter::once(value));
    for list in lists {
        if let Some(items) = list.as_array() {
            if items.iter().any(|item| {
                item.get(name_key)
                    .and_then(Value::as_str)
                    .map(|name| !name.trim().is_empty())
                    .unwrap_or(false)
            }) {
                return true;
            }
        }
    }
    value
        .get(name_key)
        .and_then(Value::as_str)
        .map(|name| !name.trim().is_empty())
        .unwrap_or(false)
}

fn required_story_plan_text<'a>(
    value: &'a Value,
    field: &str,
    path: &str,
    max_chars: usize,
) -> Result<&'a str, String> {
    let text = value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("全书规划 {} 必须是非空字符串", path))?;
    if text.chars().count() > max_chars {
        return Err(format!("全书规划 {} 超过 {} 字符", path, max_chars));
    }
    Ok(text)
}

fn required_story_plan_word_count(
    value: &Value,
    path: &str,
    minimum: u64,
    maximum: u64,
) -> Result<u64, String> {
    let count = value
        .get("targetWordCount")
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("全书规划 {} 必须是整数", path))?;
    if !(minimum..=maximum).contains(&count) {
        return Err(format!(
            "全书规划 {} 必须在 {} 到 {} 之间",
            path, minimum, maximum
        ));
    }
    Ok(count)
}

fn validate_story_plan_character_names(value: &Value, path: &str) -> Result<(), String> {
    let Some(names) = value.get("characterNames") else {
        return Ok(());
    };
    let names = names
        .as_array()
        .ok_or_else(|| format!("全书规划 {}.characterNames 必须是字符串数组", path))?;
    if names.len() > CANDIDATE_ITEM_MAX {
        return Err(format!(
            "全书规划 {}.characterNames 数量不能超过 {}",
            path, CANDIDATE_ITEM_MAX
        ));
    }
    let mut seen = HashSet::new();
    for (name_index, name) in names.iter().enumerate() {
        let name = name
            .as_str()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| {
                format!(
                    "全书规划 {}.characterNames[{}] 必须是非空字符串",
                    path, name_index
                )
            })?;
        if name.chars().count() > CANDIDATE_NAME_MAX {
            return Err(format!(
                "全书规划 {}.characterNames[{}] 超过 {} 字符",
                path, name_index, CANDIDATE_NAME_MAX
            ));
        }
        if !seen.insert(name) {
            return Err(format!(
                "全书规划 {}.characterNames[{}] 与同章角色名重复",
                path, name_index
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StoryPlanWordCounts {
    target_word_count: u64,
    chapter_word_sum: u64,
}

fn validate_story_plan(value: &Value) -> Result<StoryPlanWordCounts, String> {
    required_story_plan_text(value, "title", "title", STORY_PLAN_TITLE_MAX)?;
    required_story_plan_text(value, "content", "content", STORY_PLAN_CONTENT_MAX)?;
    let target_word_count = required_story_plan_word_count(
        value,
        "targetWordCount",
        STORY_PLAN_TOTAL_WORD_MIN,
        STORY_PLAN_TOTAL_WORD_MAX,
    )?;
    let volumes = value
        .get("volumes")
        .and_then(Value::as_array)
        .ok_or_else(|| "全书规划 volumes 必须是数组".to_string())?;
    if volumes.is_empty() || volumes.len() > STORY_PLAN_VOLUME_MAX {
        return Err(format!(
            "全书规划 volumes 数量必须在 1 到 {} 之间",
            STORY_PLAN_VOLUME_MAX
        ));
    }

    let mut chapter_count = 0usize;
    let mut chapter_word_sum = 0u64;
    for (volume_index, volume) in volumes.iter().enumerate() {
        if !volume.is_object() {
            return Err(format!("全书规划 volumes[{}] 必须是对象", volume_index));
        }
        let path = format!("volumes[{}]", volume_index);
        required_story_plan_text(
            volume,
            "title",
            &format!("{}.title", path),
            STORY_PLAN_TITLE_MAX,
        )?;
        for field in ["summary", "goal", "mainConflict", "outline"] {
            required_story_plan_text(
                volume,
                field,
                &format!("{}.{}", path, field),
                STORY_PLAN_VOLUME_FIELD_MAX,
            )?;
        }
        let chapters = volume
            .get("chapters")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("全书规划 {}.chapters 必须是数组", path))?;
        if chapters.is_empty() {
            return Err(format!("全书规划 {}.chapters 不能为空", path));
        }
        chapter_count = chapter_count
            .checked_add(chapters.len())
            .ok_or_else(|| "全书规划章节数量溢出".to_string())?;
        if chapter_count > STORY_PLAN_CHAPTER_MAX {
            return Err(format!(
                "全书规划章节总数不能超过 {}",
                STORY_PLAN_CHAPTER_MAX
            ));
        }

        for (chapter_index, chapter) in chapters.iter().enumerate() {
            if !chapter.is_object() {
                return Err(format!(
                    "全书规划 {}.chapters[{}] 必须是对象",
                    path, chapter_index
                ));
            }
            let chapter_path = format!("{}.chapters[{}]", path, chapter_index);
            required_story_plan_text(
                chapter,
                "title",
                &format!("{}.title", chapter_path),
                STORY_PLAN_TITLE_MAX,
            )?;
            required_story_plan_text(
                chapter,
                "outline",
                &format!("{}.outline", chapter_path),
                STORY_PLAN_CHAPTER_OUTLINE_MAX,
            )?;
            required_story_plan_text(
                chapter,
                "goal",
                &format!("{}.goal", chapter_path),
                STORY_PLAN_GOAL_MAX,
            )?;
            validate_story_plan_character_names(chapter, &chapter_path)?;
            chapter_word_sum = chapter_word_sum
                .checked_add(required_story_plan_word_count(
                    chapter,
                    &format!("{}.targetWordCount", chapter_path),
                    STORY_PLAN_CHAPTER_WORD_MIN,
                    STORY_PLAN_CHAPTER_WORD_MAX,
                )?)
                .ok_or_else(|| "全书规划章节目标字数溢出".to_string())?;
        }
    }

    let minimum_consistent_total = chapter_word_sum.saturating_mul(4) / 5;
    let maximum_consistent_total = chapter_word_sum.saturating_mul(6) / 5;
    if target_word_count < minimum_consistent_total || target_word_count > maximum_consistent_total
    {
        return Err("全书规划 targetWordCount 必须与各章目标字数总和基本一致".to_string());
    }
    Ok(StoryPlanWordCounts {
        target_word_count,
        chapter_word_sum,
    })
}

fn candidate_items_for_policy<'a>(
    value: &'a Value,
    keys: &[&str],
    label: &str,
) -> Result<&'a [Value], String> {
    let items = keys
        .iter()
        .find_map(|key| value.get(key).and_then(Value::as_array))
        .map(Vec::as_slice)
        .filter(|items| !items.is_empty())
        .ok_or_else(|| format!("{}必须包含非空数组 {}", label, keys.join(" 或 ")))?;
    if items.len() > CANDIDATE_ITEM_MAX {
        return Err(format!("{}条目数不能超过 {}", label, CANDIDATE_ITEM_MAX));
    }
    Ok(items)
}

fn object_has_text(object: &serde_json::Map<String, Value>, key: &str) -> bool {
    object
        .get(key)
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
}

fn required_policy_name(
    object: &serde_json::Map<String, Value>,
    path: &str,
) -> Result<String, String> {
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{} 必须包含非空 name", path))?;
    if name.chars().count() > CANDIDATE_NAME_MAX {
        return Err(format!(
            "{} 的 name 不能超过 {} 字符",
            path, CANDIDATE_NAME_MAX
        ));
    }
    Ok(name.to_string())
}

fn setting_candidate_is_rule(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let target = object
        .get("targetType")
        .or_else(|| object.get("target"))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase());
    if matches!(target.as_deref(), Some("rule_system" | "rule")) {
        return true;
    }
    let category = object
        .get("category")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase());
    matches!(
        category.as_deref(),
        Some(
            "world_rules"
                | "world_rule"
                | "rule"
                | "rules"
                | "magic"
                | "technology"
                | "cultivation"
                | "combat"
                | "social"
        )
    )
}

fn validate_primary_protagonist_policy(candidate_text: &str) -> Result<(), String> {
    let parsed = parse_candidate_json(candidate_text)
        .ok_or_else(|| "自动主角候选必须是 JSON 对象".to_string())?;
    let items = candidate_items_for_policy(&parsed, &["characters", "candidates"], "自动主角候选")?;
    let mut protagonists = Vec::new();
    let mut names = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let object = item
            .as_object()
            .ok_or_else(|| format!("characters[{}] 必须是 JSON 对象", index))?;
        let role_type = object
            .get("roleType")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.chars().count() <= CHARACTER_ROLE_TYPE_MAX)
            .unwrap_or("supporting");
        if !matches!(
            role_type,
            "protagonist" | "supporting" | "antagonist" | "neutral"
        ) {
            return Err(format!(
                "characters[{}] 的 roleType 必须是 protagonist、supporting、antagonist 或 neutral",
                index
            ));
        }
        if role_type == "protagonist" {
            protagonists.push(item);
        }
        let name = required_policy_name(object, &format!("characters[{}]", index))?;
        if !names.insert(name) {
            return Err(format!("characters[{}] 的 name 与其他角色重复", index));
        }
    }
    if protagonists.len() != 1 {
        return Err("自动主角候选必须恰好包含一个使用 roleType=protagonist 标记的主角".to_string());
    }
    let protagonist = protagonists[0]
        .as_object()
        .ok_or_else(|| "自动主角候选的 protagonist 必须是 JSON 对象".to_string())?;
    let missing = ["identity", "goal", "personality"]
        .into_iter()
        .filter(|key| !object_has_text(protagonist, key))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "自动主角候选不完整：缺少非空字段 {}；请补齐后重试",
            missing.join(", ")
        ));
    }
    Ok(())
}

fn validate_world_rule_bundle_policy(candidate_text: &str) -> Result<(), String> {
    let parsed = parse_candidate_json(candidate_text)
        .ok_or_else(|| "自动世界与规则候选必须是 JSON 对象".to_string())?;
    let items =
        candidate_items_for_policy(&parsed, &["settings", "candidates"], "自动世界与规则候选")?;
    let mut has_world = false;
    let mut has_rule = false;
    let mut names = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let object = item
            .as_object()
            .ok_or_else(|| format!("settings[{}] 必须是 JSON 对象", index))?;
        let name = required_policy_name(object, &format!("settings[{}]", index))?;
        let is_rule = setting_candidate_is_rule(item);
        if !names.insert((is_rule, name)) {
            return Err(format!("settings[{}] 的 name 与同类设定重复", index));
        }
        if !object_has_text(object, "description") && !object_has_text(object, "content") {
            return Err(format!(
                "settings[{}] 必须包含具体的 description 或 content",
                index
            ));
        }
        if is_rule {
            has_rule = true;
        } else {
            has_world = true;
        }
    }
    if !has_world || !has_rule {
        return Err(
            "自动世界与规则候选必须同时包含普通世界设定和 targetType=rule_system 的规则项"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_rule_system_only_policy(candidate_text: &str) -> Result<(), String> {
    let parsed = parse_candidate_json(candidate_text)
        .ok_or_else(|| "自动规则候选必须是 JSON 对象".to_string())?;
    let items = candidate_items_for_policy(&parsed, &["settings", "candidates"], "自动规则候选")?;
    let mut names = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let object = item
            .as_object()
            .ok_or_else(|| format!("settings[{}] 必须是 JSON 对象", index))?;
        let name = required_policy_name(object, &format!("settings[{}]", index))?;
        if !setting_candidate_is_rule(item) {
            return Err(format!(
                "settings[{}] 必须声明 targetType=rule_system",
                index
            ));
        }
        if !names.insert(name) {
            return Err(format!("settings[{}] 的 name 与其他规则重复", index));
        }
        if !object_has_text(object, "description") && !object_has_text(object, "content") {
            return Err(format!(
                "settings[{}] 必须包含具体的 description 或 content",
                index
            ));
        }
    }
    Ok(())
}

fn validate_candidate_policy(
    policy: Option<CandidatePolicy>,
    artifact_type: &str,
    candidate_text: &str,
) -> Result<(), String> {
    match policy {
        None => Ok(()),
        Some(CandidatePolicy::PrimaryProtagonistV1) if artifact_type == "character_candidates" => {
            validate_primary_protagonist_policy(candidate_text)
        }
        Some(CandidatePolicy::WorldRuleBundleV1) if artifact_type == "setting_candidates" => {
            validate_world_rule_bundle_policy(candidate_text)
        }
        Some(CandidatePolicy::RuleSystemOnlyV1) if artifact_type == "setting_candidates" => {
            validate_rule_system_only_policy(candidate_text)
        }
        Some(CandidatePolicy::BookWordGoalV1 {
            target_word_count,
            minimum_word_count,
            maximum_word_count,
            ..
        }) if artifact_type == "outline" => {
            let parsed = parse_candidate_json(candidate_text)
                .ok_or_else(|| "冻结字数目标只允许提交有效的全书规划 JSON".to_string())?;
            if parsed.get("planKind").and_then(Value::as_str) != Some("story_plan") {
                return Err("冻结字数目标只允许提交 planKind=story_plan 的全书规划".to_string());
            }
            let counts = validate_story_plan(&parsed)?;
            if !(minimum_word_count..=maximum_word_count).contains(&counts.target_word_count)
                || !(minimum_word_count..=maximum_word_count).contains(&counts.chapter_word_sum)
            {
                return Err(format!(
                    "全书规划字数不符合宿主冻结目标：目标 {}，根 targetWordCount={}，章节合计={}，两者都必须在 {} 到 {} 之间",
                    target_word_count,
                    counts.target_word_count,
                    counts.chapter_word_sum,
                    minimum_word_count,
                    maximum_word_count
                ));
            }
            Ok(())
        }
        Some(CandidatePolicy::PrimaryProtagonistV1) => {
            Err("当前自动候选策略只允许提交角色候选".to_string())
        }
        Some(CandidatePolicy::WorldRuleBundleV1) => {
            Err("当前自动候选策略只允许提交世界与规则设定候选".to_string())
        }
        Some(CandidatePolicy::RuleSystemOnlyV1) => {
            Err("当前自动候选策略只允许提交规则设定候选".to_string())
        }
        Some(CandidatePolicy::BookWordGoalV1 { .. }) => {
            Err("冻结字数目标只允许提交全书规划候选".to_string())
        }
    }
}

fn validate_candidate_payload(artifact_type: &str, candidate_text: &str) -> Result<(), String> {
    match artifact_type {
        "chapter_text" => {
            if candidate_text.chars().count() < 8 {
                return Err("章节候选过短".to_string());
            }
        }
        "outline" => {
            let parsed = parse_candidate_json(candidate_text);
            let declares_story_plan = candidate_text.contains("\"planKind\"")
                && candidate_text.contains("\"story_plan\"");
            if parsed.as_ref().and_then(Value::as_object).is_none()
                && candidate_text.chars().count() < 20
            {
                return Err("大纲候选必须是 JSON 对象或足够长的正文".to_string());
            }
            let story_plan = parsed.as_ref().filter(|value| {
                value.get("planKind").and_then(Value::as_str) == Some("story_plan")
            });
            if declares_story_plan && story_plan.is_none() {
                return Err("全书规划必须是有效的 JSON 对象".to_string());
            }
            if let Some(story_plan) = story_plan {
                validate_story_plan(story_plan)?;
            }
        }
        "character_candidates" => {
            let parsed = parse_candidate_json(candidate_text)
                .ok_or_else(|| "角色候选必须是 JSON".to_string())?;
            if !named_entries(&parsed, &["characters", "candidates"], "name") {
                return Err("角色候选必须包含至少一个带 name 的条目".to_string());
            }
        }
        "event_candidates" => {
            let parsed = parse_candidate_json(candidate_text)
                .ok_or_else(|| "事件候选必须是 JSON".to_string())?;
            if !named_entries(&parsed, &["events", "suggestions", "candidates"], "title") {
                return Err("事件候选必须包含至少一个带 title 的条目".to_string());
            }
        }
        "setting_candidates" => {
            let parsed = parse_candidate_json(candidate_text)
                .ok_or_else(|| "设定候选必须是 JSON".to_string())?;
            if !named_entries(&parsed, &["settings", "candidates"], "name") {
                return Err("设定候选必须包含至少一个带 name 的条目".to_string());
            }
        }
        "quality_report" => {
            let parsed = parse_candidate_json(candidate_text)
                .ok_or_else(|| "质量报告必须是 JSON".to_string())?;
            if parsed.get("summary").and_then(Value::as_str).is_none()
                && !parsed.get("issues").map(Value::is_array).unwrap_or(false)
            {
                return Err("质量报告必须包含 summary 或 issues".to_string());
            }
        }
        "chapter_summary" => {
            let parsed = parse_candidate_json(candidate_text);
            let summary = parsed
                .as_ref()
                .and_then(|value| value.get("summary"))
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            if summary.is_empty() && candidate_text.chars().count() < 12 {
                return Err("总结候选过短".to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

fn arg_id(arguments: &Value, key: &str) -> Result<String, String> {
    // Accept both camelCase (declared schema) and snake_case (some models emit it).
    let snake = key
        .chars()
        .flat_map(|ch| {
            if ch.is_ascii_uppercase() {
                vec!['_', ch.to_ascii_lowercase()]
            } else {
                vec![ch]
            }
        })
        .collect::<String>();
    let value = arguments
        .get(key)
        .or_else(|| arguments.get(&snake))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing string argument: {}", key))?;
    if value.is_empty() || value.len() > ID_MAX {
        return Err(format!("argument {} must be 1..={} chars", key, ID_MAX));
    }
    Ok(value.to_string())
}

fn optional_arg_id(arguments: &Value, key: &str) -> Result<Option<String>, String> {
    let snake = key
        .chars()
        .flat_map(|ch| {
            if ch.is_ascii_uppercase() {
                vec!['_', ch.to_ascii_lowercase()]
            } else {
                vec![ch]
            }
        })
        .collect::<String>();
    if arguments.get(key).is_none() && arguments.get(&snake).is_none() {
        return Ok(None);
    }
    arg_id(arguments, key).map(Some)
}

fn clip_to(value: String, limit: usize) -> String {
    if value.chars().count() > limit {
        let mut truncated: String = value.chars().take(limit).collect();
        truncated.push_str("…[truncated]");
        truncated
    } else {
        value
    }
}

fn bounded_profile_field(profile: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = profile
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return clip_to(value.to_string(), CHARACTER_FIELD_CLIP);
        }
    }
    String::new()
}

fn project_protagonists_json(raw: &str) -> Vec<Value> {
    let Ok(Value::Array(profiles)) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    profiles
        .into_iter()
        .filter_map(|profile| {
            let name = profile.get("name").and_then(Value::as_str)?.trim();
            if name.is_empty() {
                return None;
            }
            let ability = bounded_profile_field(&profile, &["ability", "specialAbility", "special_ability"]);
            let special_ability = bounded_profile_field(&profile, &["specialAbility", "special_ability", "ability"]);
            Some(json!({
                "id": bounded_profile_field(&profile, &["id"]),
                "label": bounded_profile_field(&profile, &["label"]),
                "name": clip_to(name.to_string(), CHARACTER_FIELD_CLIP),
                "gender": bounded_profile_field(&profile, &["gender"]),
                "identity": bounded_profile_field(&profile, &["identity"]),
                "faction": bounded_profile_field(&profile, &["faction"]),
                "relationToProtagonist": bounded_profile_field(&profile, &["relationToProtagonist", "relation_to_protagonist"]),
                "personality": bounded_profile_field(&profile, &["personality"]),
                "goal": bounded_profile_field(&profile, &["goal", "goals"]),
                "motivation": bounded_profile_field(&profile, &["motivation"]),
                "ability": ability,
                "limitation": bounded_profile_field(&profile, &["limitation", "abilityLimits", "ability_limits"]),
                "background": bounded_profile_field(&profile, &["background"]),
                "arc": bounded_profile_field(&profile, &["arc"]),
                "notes": bounded_profile_field(&profile, &["notes", "currentState", "current_state"]),
                "currentState": bounded_profile_field(&profile, &["currentState", "current_state", "notes"]),
                "specialAbility": special_ability,
                "abilityLimits": bounded_profile_field(&profile, &["abilityLimits", "ability_limits", "limitation"]),
                "behaviorLimits": bounded_profile_field(&profile, &["behaviorLimits", "behavior_limits"]),
                "forbiddenBehaviors": bounded_profile_field(&profile, &["forbiddenBehaviors", "forbidden_behaviors"])
            }))
        })
        .take(PROTAGONIST_LIMIT)
        .collect()
}

fn project_character_protagonists(
    connection: &Connection,
    novel_id: &str,
) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, gender, identity, faction, relation_to_protagonist,
                    COALESCE(NULLIF(goal, ''), goals), background, ability, personality,
                    constraints, behavior_limits, forbidden_behaviors, current_state,
                    protagonist_key, protagonist_label, protagonist_order
             FROM characters
             WHERE novel_id = ?1 AND is_active = 1
               AND (is_protagonist = 1 OR role_type = 'protagonist')
             ORDER BY protagonist_order, name, id LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![novel_id, PROTAGONIST_LIMIT as i64], |row| {
            let protagonist_key = row.get::<_, Option<String>>(14)?.unwrap_or_default();
            let protagonist_label = row.get::<_, Option<String>>(15)?.unwrap_or_default();
            let protagonist_order = row.get::<_, i64>(16)?;
            let label = match protagonist_key.trim() {
                "primary" | "secondary" => protagonist_key.trim().to_string(),
                _ => String::new(),
            };
            let ability = clip_to(
                row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                CHARACTER_FIELD_CLIP,
            );
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "label": label,
                "name": clip_to(row.get::<_, String>(1)?, CHARACTER_FIELD_CLIP),
                "gender": clip_to(row.get::<_, Option<String>>(2)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "identity": clip_to(row.get::<_, Option<String>>(3)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "faction": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "relationToProtagonist": clip_to(row.get::<_, Option<String>>(5)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "goal": clip_to(row.get::<_, Option<String>>(6)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "background": clip_to(row.get::<_, Option<String>>(7)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "ability": ability,
                "specialAbility": ability,
                "personality": clip_to(row.get::<_, Option<String>>(9)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "constraints": clip_to(row.get::<_, Option<String>>(10)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "behaviorLimits": clip_to(row.get::<_, Option<String>>(11)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "forbiddenBehaviors": clip_to(row.get::<_, Option<String>>(12)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "currentState": clip_to(row.get::<_, Option<String>>(13)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "protagonistLabel": clip_to(protagonist_label, CHARACTER_FIELD_CLIP),
                "protagonistOrder": protagonist_order
            }))
        })
        .map_err(|error| error.to_string())?;
    let mut projected = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let primary_index = projected
        .iter()
        .position(|profile| profile.get("label").and_then(Value::as_str) == Some("primary"))
        .or_else(|| {
            projected
                .iter()
                .position(|profile| profile.get("label").and_then(Value::as_str) == Some(""))
        })
        .unwrap_or(0);
    for (index, profile) in projected.iter_mut().enumerate() {
        if let Some(object) = profile.as_object_mut() {
            object.insert(
                "label".to_string(),
                Value::String(
                    if index == primary_index {
                        "primary"
                    } else {
                        "secondary"
                    }
                    .to_string(),
                ),
            );
        }
    }
    Ok(projected)
}

fn project_legacy_protagonists(
    connection: &Connection,
    novel_id: &str,
) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, identity, personality, goal, special_ability,
                    ability_limits, forbidden_behaviors, current_state
             FROM protagonists WHERE novel_id = ?1 ORDER BY name, id LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![novel_id, PROTAGONIST_LIMIT as i64], |row| {
            let ability = clip_to(
                row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                CHARACTER_FIELD_CLIP,
            );
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": clip_to(row.get::<_, String>(1)?, CHARACTER_FIELD_CLIP),
                "identity": clip_to(row.get::<_, Option<String>>(2)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "personality": clip_to(row.get::<_, Option<String>>(3)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "goal": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "ability": ability,
                "specialAbility": ability,
                "abilityLimits": clip_to(row.get::<_, Option<String>>(6)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "limitation": clip_to(row.get::<_, Option<String>>(6)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "forbiddenBehaviors": clip_to(row.get::<_, Option<String>>(7)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                "currentState": clip_to(row.get::<_, Option<String>>(8)?.unwrap_or_default(), CHARACTER_FIELD_CLIP)
            }))
        })
        .map_err(|error| error.to_string())?;
    let mut projected = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for (index, profile) in projected.iter_mut().enumerate() {
        if let Some(object) = profile.as_object_mut() {
            object.insert(
                "label".to_string(),
                Value::String(if index == 0 { "primary" } else { "secondary" }.to_string()),
            );
        }
    }
    Ok(projected)
}

fn json_value_has_content(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(value) => !value.trim().is_empty(),
        Value::Array(values) => !values.is_empty(),
        Value::Object(values) => !values.is_empty(),
        Value::Bool(_) | Value::Number(_) => true,
    }
}

fn merge_lower_priority_profile(existing: &mut Value, lower_priority: Value) {
    let (Some(existing), Value::Object(lower_priority)) =
        (existing.as_object_mut(), lower_priority)
    else {
        return;
    };
    for (key, value) in lower_priority {
        if !json_value_has_content(&value) {
            continue;
        }
        let should_fill = existing
            .get(&key)
            .map(|current| !json_value_has_content(current))
            .unwrap_or(true);
        if should_fill {
            existing.insert(key, value);
        }
    }
}

fn append_or_merge_protagonist(profiles: &mut Vec<Value>, profile: Value) {
    let Some(name) = profile
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
    else {
        return;
    };
    if let Some(existing) = profiles.iter_mut().find(|candidate| {
        candidate
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|candidate_name| candidate_name.trim() == name)
    }) {
        merge_lower_priority_profile(existing, profile);
    } else if profiles.len() < PROTAGONIST_LIMIT {
        profiles.push(profile);
    }
}

fn read_protagonists(
    connection: &Connection,
    novel_id: &str,
    protagonists_json: &str,
    main_character: &str,
    protagonist_ability: &str,
) -> Result<(Vec<Value>, &'static str), String> {
    let character_profiles = project_character_protagonists(connection, novel_id)?;
    let json_profiles = project_protagonists_json(protagonists_json);
    let legacy_profiles = project_legacy_protagonists(connection, novel_id)?;
    let fallback_profile = (!main_character.trim().is_empty()).then(|| {
        json!({
            "id": "",
            "label": "primary",
            "name": clip_to(main_character.trim().to_string(), CHARACTER_FIELD_CLIP),
            "ability": clip_to(protagonist_ability.trim().to_string(), CHARACTER_FIELD_CLIP),
            "specialAbility": clip_to(protagonist_ability.trim().to_string(), CHARACTER_FIELD_CLIP)
        })
    });
    let source = if !character_profiles.is_empty() {
        "characters"
    } else if !json_profiles.is_empty() {
        "novels.protagonists_json"
    } else if !legacy_profiles.is_empty() {
        "legacy.protagonists"
    } else if fallback_profile.is_some() {
        "novels.main_character"
    } else {
        "none"
    };

    let mut projected = Vec::new();
    for profile in character_profiles
        .into_iter()
        .chain(json_profiles)
        .chain(legacy_profiles)
    {
        append_or_merge_protagonist(&mut projected, profile);
    }
    if let Some(profile) = fallback_profile {
        let fallback_name = profile
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let matches_formal_profile = projected.iter().any(|candidate| {
            candidate
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| name.trim() == fallback_name)
        });
        if projected.is_empty() || matches_formal_profile {
            append_or_merge_protagonist(&mut projected, profile);
        }
    }
    Ok((projected, source))
}

fn project_dual_protagonist_relation(raw: &str) -> Value {
    let parsed = serde_json::from_str::<Value>(raw).unwrap_or_else(|_| json!({}));
    let field = |keys: &[&str], fallback: &str| {
        keys.iter()
            .find_map(|key| parsed.get(*key).and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(fallback)
            .to_string()
    };
    json!({
        "type": clip_to(field(&["type", "relation_type"], "partner"), CHARACTER_FIELD_CLIP),
        "description": clip_to(field(&["description"], ""), CHARACTER_FIELD_CLIP),
        "conflict": clip_to(field(&["conflict"], ""), CHARACTER_FIELD_CLIP),
        "cooperation": clip_to(field(&["cooperation"], ""), CHARACTER_FIELD_CLIP),
        "emotionalProgression": clip_to(field(&["emotionalProgression", "emotional_progression"], ""), CHARACTER_FIELD_CLIP),
        "narrativeWeight": clip_to(field(&["narrativeWeight", "narrative_weight"], "balanced"), CHARACTER_FIELD_CLIP)
    })
}

fn max_updated_at(
    connection: &Connection,
    table: &str,
    column: &str,
    param: &str,
) -> Option<String> {
    // table/column come from hardcoded call sites, never user input.
    let sql = format!(
        "SELECT MAX(updated_at) FROM {} WHERE {} = ?1",
        table, column
    );
    connection
        .query_row(&sql, params![param], |row| row.get::<_, Option<String>>(0))
        .ok()
        .flatten()
}

fn max_created_at(
    connection: &Connection,
    table: &str,
    column: &str,
    param: &str,
) -> Option<String> {
    // For tables without an updated_at column (e.g. character_states).
    let sql = format!(
        "SELECT MAX(created_at) FROM {} WHERE {} = ?1",
        table, column
    );
    connection
        .query_row(&sql, params![param], |row| row.get::<_, Option<String>>(0))
        .ok()
        .flatten()
}

fn chapter_sequence_index(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            "WITH ordered AS (
                SELECT c.id,
                       ROW_NUMBER() OVER (
                           ORDER BY
                               CASE
                                   WHEN c.volume_id IS NULL THEN -1
                                   ELSE COALESCE(v.order_index, 2147483647)
                               END,
                               COALESCE(v.id, ''),
                               c.order_index,
                               c.created_at,
                               c.id
                       ) - 1 AS sequence_index
                  FROM chapters c
             LEFT JOIN volumes v
                    ON v.id = c.volume_id
                   AND v.novel_id = c.novel_id
                   AND v.deleted_at IS NULL
                 WHERE c.novel_id = ?1
                   AND c.deleted_at IS NULL
            )
            SELECT sequence_index FROM ordered WHERE id = ?2",
            params![novel_id, chapter_id],
            |row| row.get(0),
        )
        .map_err(|_| {
            format!(
                "target chapter not found in novel: {}/{}",
                novel_id, chapter_id
            )
        })
}

fn sha256(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn clip_adopted_body(value: &str) -> (String, bool) {
    let length = value.chars().count();
    if length <= ADOPTED_BODY_CLIP {
        return (value.to_string(), false);
    }
    let marker = "\n\n...[middle truncated]...\n\n";
    let marker_chars = marker.chars().count();
    let available = ADOPTED_BODY_CLIP.saturating_sub(marker_chars);
    let head_chars = available * 2 / 3;
    let tail_chars = available - head_chars;
    let head: String = value.chars().take(head_chars).collect();
    let tail: String = value
        .chars()
        .rev()
        .take(tail_chars)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    (format!("{}{}{}", head, marker, tail), true)
}

fn read_verified_large_text(
    connection: &Connection,
    document_id: &str,
    draft_id: &str,
    chapter_id: &str,
) -> Result<(String, String), String> {
    let document = connection
        .query_row(
            "SELECT target_type, target_id, field_name, total_chars, total_bytes,
                    chunk_count, content_sha256, status
             FROM large_text_documents WHERE id = ?1",
            params![document_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .map_err(|_| "adopted chapter large-text reference is invalid".to_string())?;
    let (target_type, target_id, field_name, chars, bytes, chunks, expected_hash, status) =
        document;
    let compatible_target = target_id
        .as_deref()
        .map(|value| value == draft_id || value == chapter_id)
        .unwrap_or(true);
    if target_type != "draft" || !compatible_target || field_name != "content" || status != "ready"
    {
        return Err("adopted chapter large-text reference is invalid".to_string());
    }
    let expected_hash = expected_hash
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "adopted chapter large-text hash is missing".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT chunk_index, content, char_count, byte_count, chunk_sha256
             FROM large_text_chunks WHERE document_id = ?1 ORDER BY chunk_index",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![document_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if rows.len() as i64 != chunks {
        return Err("adopted chapter large-text chunks are incomplete".to_string());
    }
    let mut content = String::with_capacity(bytes.max(0) as usize);
    for (expected_index, (index, chunk, chunk_chars, chunk_bytes, chunk_hash)) in
        rows.into_iter().enumerate()
    {
        if index != expected_index as i64
            || chunk_chars != chunk.chars().count() as i64
            || chunk_bytes != chunk.len() as i64
            || chunk_hash
                .as_deref()
                .map(|value| value.eq_ignore_ascii_case(&sha256(&chunk)))
                != Some(true)
        {
            return Err("adopted chapter large-text chunk integrity check failed".to_string());
        }
        content.push_str(&chunk);
    }
    let actual_hash = sha256(&content);
    if content.chars().count() as i64 != chars
        || content.len() as i64 != bytes
        || !actual_hash.eq_ignore_ascii_case(&expected_hash)
    {
        return Err("adopted chapter large-text integrity check failed".to_string());
    }
    Ok((content, actual_hash))
}

fn read_current_adopted_body(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<Option<Value>, String> {
    let draft = connection
        .query_row(
            "SELECT d.id, d.version_no, d.content, d.large_text_ref_id, d.content_hash
             FROM chapters c
             JOIN chapter_drafts d ON d.id = c.adopted_draft_id
             WHERE c.id = ?1 AND c.novel_id = ?2 AND c.deleted_at IS NULL
               AND d.novel_id = c.novel_id AND d.chapter_id = c.id AND d.is_adopted = 1",
            params![chapter_id, novel_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((draft_id, version_no, inline_content, large_text_ref_id, draft_hash)) = draft else {
        return Ok(None);
    };
    let (content, content_hash) = if let Some(document_id) = large_text_ref_id.as_deref() {
        read_verified_large_text(connection, document_id, &draft_id, chapter_id)?
    } else {
        let actual_hash = sha256(&inline_content);
        if draft_hash
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.eq_ignore_ascii_case(&actual_hash))
            == Some(false)
        {
            return Err("adopted chapter body integrity check failed".to_string());
        }
        (inline_content, actual_hash)
    };
    if draft_hash
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.eq_ignore_ascii_case(&content_hash))
        == Some(false)
    {
        return Err("adopted chapter body integrity check failed".to_string());
    }
    let content_length = content.chars().count();
    let (bounded_content, truncated) = clip_adopted_body(&content);
    Ok(Some(json!({
        "draftId": draft_id,
        "versionNo": version_no,
        "contentHash": content_hash,
        "contentLength": content_length,
        "content": bounded_content,
        "truncated": truncated,
        "maxExposedChars": ADOPTED_BODY_CLIP
    })))
}

// ---------------------------------------------------------------------------
// get_metadata
// ---------------------------------------------------------------------------

fn get_metadata(
    connection: &Connection,
    arguments: &Value,
    require_chapter: bool,
) -> Result<Value, String> {
    let novel_id = arg_id(arguments, "novelId")?;
    let chapter_id = if require_chapter {
        Some(arg_id(arguments, "chapterId")?)
    } else {
        None
    };

    let (
        novel,
        current_volume_id,
        current_chapter_id,
        protagonists_json,
        main_character,
        protagonist_ability,
    ) = connection
        .query_row(
            "SELECT id, title, subtitle, genre, description, outline, status,
                    current_volume_id, current_chapter_id, total_word_count,
                    target_word_count, protagonist_mode, protagonists_json,
                    dual_protagonist_relation_json, main_character, protagonist_ability
             FROM novels WHERE id = ?1 AND deleted_at IS NULL",
            params![novel_id],
            |row| {
                let current_volume_id = row.get::<_, Option<String>>(7)?;
                let current_chapter_id = row.get::<_, Option<String>>(8)?;
                let protagonist_mode = row.get::<_, String>(11)?;
                let protagonists_json = row.get::<_, String>(12)?;
                let dual_relation_json = row.get::<_, String>(13)?;
                let main_character = row.get::<_, String>(14)?;
                let protagonist_ability = row.get::<_, String>(15)?;
                Ok((
                    json!({
                        "id": row.get::<_, String>(0)?,
                        "title": row.get::<_, String>(1)?,
                        "subtitle": row.get::<_, Option<String>>(2)?,
                        "genre": row.get::<_, Option<String>>(3)?,
                        "description": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                        "outline": clip_to(row.get::<_, String>(5)?, NOVEL_OUTLINE_CLIP),
                        "status": row.get::<_, String>(6)?,
                        "currentVolumeId": current_volume_id,
                        "currentChapterId": current_chapter_id,
                        "totalWordCount": row.get::<_, i64>(9)?,
                        "targetWordCount": row.get::<_, Option<i64>>(10)?,
                        "protagonistMode": protagonist_mode,
                        "dualProtagonistRelation": project_dual_protagonist_relation(&dual_relation_json),
                        "mainCharacter": clip_to(main_character.clone(), CHARACTER_FIELD_CLIP),
                        "protagonistAbility": clip_to(protagonist_ability.clone(), CHARACTER_FIELD_CLIP)
                    }),
                    current_volume_id,
                    current_chapter_id,
                    protagonists_json,
                    main_character,
                    protagonist_ability,
                ))
            },
        )
        .map_err(|_| format!("novel not found: {}", novel_id))?;
    let (protagonists, protagonist_source) = read_protagonists(
        connection,
        &novel_id,
        &protagonists_json,
        &main_character,
        &protagonist_ability,
    )?;

    let mut world_settings = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, title, content, structured_json, created_at, updated_at
                 FROM world_settings
                 WHERE novel_id = ?1 AND is_active = 1
                 ORDER BY updated_at DESC, created_at DESC, id DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let (id, title, content, structured_json, created_at, updated_at) =
                row.map_err(|error| error.to_string())?;
            if content.trim().is_empty() {
                continue;
            }
            let role = if world_settings.is_empty() {
                "primary"
            } else {
                "supplemental"
            };
            world_settings.push(json!({
                "id": id,
                "novelId": novel_id,
                "title": title,
                "content": clip_to(content, CONTEXT_TEXT_CLIP),
                "structuredJson": clip_to(structured_json, CONTEXT_JSON_CLIP),
                "isActive": true,
                "role": role,
                "createdAt": created_at,
                "updatedAt": updated_at
            }));
            if world_settings.len() == WORLD_SETTING_LIMIT {
                break;
            }
        }
    }

    let mut rule_systems = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, title, category, content, forbidden_rules, structured_json
                 FROM rule_systems WHERE novel_id = ?1 AND is_active = 1
                 ORDER BY updated_at DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "category": row.get::<_, Option<String>>(2)?,
                    "content": clip_to(row.get::<_, String>(3)?, CONTEXT_TEXT_CLIP),
                    "forbiddenRules": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CONTEXT_JSON_CLIP),
                    "structuredJson": clip_to(row.get::<_, Option<String>>(5)?.unwrap_or_default(), CONTEXT_JSON_CLIP)
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(RULE_SYSTEM_LIMIT) {
            rule_systems.push(row.map_err(|error| error.to_string())?);
        }
    }

    let master_outline = connection
        .query_row(
            "SELECT id, title, content, status, version, source_type
             FROM master_outlines WHERE project_id = ?1 AND is_active = 1
             ORDER BY version DESC LIMIT 1",
            params![novel_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "content": clip_to(row.get::<_, String>(2)?, CORE_OUTLINE_CLIP),
                    "status": row.get::<_, String>(3)?,
                    "version": row.get::<_, i64>(4)?,
                    "sourceType": row.get::<_, String>(5)?
                }))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let mut volume_outlines = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, master_outline_id, volume_id, volume_index, title, content,
                        status, version, source_type
                 FROM volume_outlines WHERE project_id = ?1 AND is_active = 1
                 ORDER BY CASE WHEN volume_id = ?2 THEN 0 ELSE 1 END,
                          volume_index, version DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, current_volume_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "masterOutlineId": row.get::<_, Option<String>>(1)?,
                    "volumeId": row.get::<_, Option<String>>(2)?,
                    "volumeIndex": row.get::<_, i64>(3)?,
                    "title": row.get::<_, String>(4)?,
                    "content": clip_to(row.get::<_, String>(5)?, VOLUME_OUTLINE_CLIP),
                    "status": row.get::<_, String>(6)?,
                    "version": row.get::<_, i64>(7)?,
                    "sourceType": row.get::<_, String>(8)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(VOLUME_OUTLINE_LIMIT) {
            volume_outlines.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut volumes = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, title, summary, goal, main_conflict, order_index, status
                 FROM volumes WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "summary": clip_to(row.get::<_, Option<String>>(2)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "goal": clip_to(row.get::<_, Option<String>>(3)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "mainConflict": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "orderIndex": row.get::<_, i64>(5)?,
                    "status": row.get::<_, String>(6)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(VOLUME_LIMIT) {
            volumes.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut chapters = Vec::new();
    let mut target_position = Value::Null;
    {
        let mut statement = connection
            .prepare(
                "SELECT c.id, c.volume_id, c.title, c.goal, c.order_index, c.status,
                        c.adopted_draft_id, c.word_count
                   FROM chapters c
              LEFT JOIN volumes v
                     ON v.id = c.volume_id
                    AND v.novel_id = c.novel_id
                    AND v.deleted_at IS NULL
                  WHERE c.novel_id = ?1
                    AND c.deleted_at IS NULL
               ORDER BY CASE
                            WHEN c.volume_id IS NULL THEN -1
                            ELSE COALESCE(v.order_index, 2147483647)
                        END,
                        COALESCE(v.id, ''),
                        c.order_index,
                        c.created_at,
                        c.id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "volumeId": row.get::<_, Option<String>>(1)?,
                    "title": row.get::<_, String>(2)?,
                    "goal": clip_to(row.get::<_, Option<String>>(3)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "orderIndex": row.get::<_, i64>(4)?,
                    "status": row.get::<_, String>(5)?,
                    "adoptedDraftId": row.get::<_, Option<String>>(6)?,
                    "wordCount": row.get::<_, i64>(7)?
                }))
            })
            .map_err(|error| error.to_string())?;
        let mut index = 0i64;
        for row in rows.take(CHAPTER_LIMIT) {
            let chapter = row.map_err(|error| error.to_string())?;
            index += 1;
            if chapter.get("id").and_then(Value::as_str) == chapter_id.as_deref() {
                target_position = json!({
                    "orderIndex": index,
                    "volumeId": chapter["volumeId"],
                    "title": chapter["title"],
                    "status": chapter["status"]
                });
            }
            chapters.push(chapter);
        }
    }
    if let Some(chapter_id) = chapter_id.as_deref() {
        if target_position.is_null() {
            let sequence_index = chapter_sequence_index(connection, &novel_id, chapter_id)?;
            target_position = connection
                .query_row(
                    "SELECT volume_id, title, status
                     FROM chapters
                     WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL",
                    params![chapter_id, novel_id],
                    |row| {
                        Ok(json!({
                            "orderIndex": sequence_index + 1,
                            "volumeId": row.get::<_, Option<String>>(0)?,
                            "title": row.get::<_, String>(1)?,
                            "status": row.get::<_, String>(2)?
                        }))
                    },
                )
                .map_err(|_| format!("chapter not found in novel: {}", chapter_id))?;
        }
    }

    let mut style_profiles = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, name, description, narrative_perspective, tone, pace,
                        sentence_style, dialogue_ratio, description_ratio, psychological_ratio,
                        battle_style, battle_intensity, emotion_tendency, chapter_ending,
                        forbidden_styles, style_summary, raw_config_json, is_active
                 FROM style_profiles
                 WHERE is_active = 1
                   AND (novel_id = ?1 OR novel_id IS NULL)
                 ORDER BY CASE
                              WHEN novel_id = ?1 THEN 0
                              WHEN source_type = 'system_default'
                               AND name = '默认小说风格' THEN 1
                              ELSE 2
                          END,
                          updated_at DESC,
                          id ASC
                 LIMIT 1",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "description": clip_to(row.get::<_, Option<String>>(2)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "narrativePerspective": clip_to(row.get::<_, Option<String>>(3)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "tone": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "pace": clip_to(row.get::<_, Option<String>>(5)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "sentenceStyle": clip_to(row.get::<_, Option<String>>(6)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "dialogueRatio": row.get::<_, Option<f64>>(7)?,
                    "descriptionRatio": row.get::<_, Option<f64>>(8)?,
                    "psychologicalRatio": row.get::<_, Option<f64>>(9)?,
                    "battleStyle": clip_to(row.get::<_, Option<String>>(10)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "battleIntensity": clip_to(row.get::<_, Option<String>>(11)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "emotionTendency": clip_to(row.get::<_, Option<String>>(12)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "chapterEnding": clip_to(row.get::<_, Option<String>>(13)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "forbiddenStyles": clip_to(row.get::<_, Option<String>>(14)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "styleSummary": clip_to(row.get::<_, Option<String>>(15)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "rawConfigJson": clip_to(row.get::<_, Option<String>>(16)?.unwrap_or_default(), CONTEXT_JSON_CLIP),
                    "isActive": row.get::<_, i64>(17)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(STYLE_PROFILE_LIMIT) {
            style_profiles.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut output_profiles = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, name, target_word_count, min_word_count, max_word_count,
                        pace_level, dialogue_ratio, description_ratio, battle_intensity,
                        emotion_tendency, ending_hook_required, extra_requirements,
                        forbidden_items, is_default
                 FROM output_profiles
                 WHERE is_default = 1
                   AND (novel_id = ?1 OR novel_id IS NULL)
                 ORDER BY CASE WHEN novel_id = ?1 THEN 0 ELSE 1 END,
                          updated_at DESC,
                          id ASC
                 LIMIT 1",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "targetWordCount": row.get::<_, Option<i64>>(2)?,
                    "minWordCount": row.get::<_, Option<i64>>(3)?,
                    "maxWordCount": row.get::<_, Option<i64>>(4)?,
                    "paceLevel": row.get::<_, Option<String>>(5)?,
                    "dialogueRatio": row.get::<_, Option<f64>>(6)?,
                    "descriptionRatio": row.get::<_, Option<f64>>(7)?,
                    "battleIntensity": row.get::<_, Option<String>>(8)?,
                    "emotionTendency": row.get::<_, Option<String>>(9)?,
                    "endingHookRequired": row.get::<_, i64>(10)?,
                    "extraRequirements": clip_to(row.get::<_, Option<String>>(11)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "forbiddenItems": clip_to(row.get::<_, Option<String>>(12)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "isDefault": row.get::<_, i64>(13)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(1) {
            output_profiles.push(row.map_err(|error| error.to_string())?);
        }
    }

    let projected_chapter_id = chapter_id.as_deref().or(current_chapter_id.as_deref());
    let current_chapter_outline = if let Some(projected_chapter_id) = projected_chapter_id {
        connection
            .query_row(
                "SELECT id, chapter_id, title, content, status, version, source_type
                 FROM chapter_outlines
                 WHERE project_id = ?1 AND chapter_id = ?2 AND is_active = 1
                 ORDER BY version DESC LIMIT 1",
                params![novel_id, projected_chapter_id],
                |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "chapterId": row.get::<_, Option<String>>(1)?,
                        "title": row.get::<_, String>(2)?,
                        "content": clip_to(row.get::<_, String>(3)?, VOLUME_OUTLINE_CLIP),
                        "status": row.get::<_, String>(4)?,
                        "version": row.get::<_, i64>(5)?,
                        "sourceType": row.get::<_, String>(6)?
                    }))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
    } else {
        None
    };

    let mut factions = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, name, kind, description, goals, revision
                 FROM factions WHERE novel_id = ?1 ORDER BY updated_at DESC, id LIMIT ?2",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, STORY_ASSET_LIMIT as i64], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "kind": row.get::<_, Option<String>>(2)?,
                    "description": clip_to(row.get::<_, String>(3)?, CONTEXT_TEXT_CLIP),
                    "goals": clip_to(row.get::<_, String>(4)?, CONTEXT_TEXT_CLIP),
                    "revision": row.get::<_, i64>(5)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            factions.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut locations = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, name, kind, description, parent_location_id, revision
                 FROM locations WHERE novel_id = ?1 ORDER BY updated_at DESC, id LIMIT ?2",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, STORY_ASSET_LIMIT as i64], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "kind": row.get::<_, Option<String>>(2)?,
                    "description": clip_to(row.get::<_, String>(3)?, CONTEXT_TEXT_CLIP),
                    "parentLocationId": row.get::<_, Option<String>>(4)?,
                    "revision": row.get::<_, i64>(5)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            locations.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut reference_works = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, title, purpose, description, revision
                 FROM reference_works WHERE novel_id = ?1
                 ORDER BY updated_at DESC, id LIMIT ?2",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, REFERENCE_WORK_LIMIT as i64], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "purpose": row.get::<_, String>(2)?,
                    "description": clip_to(row.get::<_, Option<String>>(3)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "revision": row.get::<_, i64>(4)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            reference_works.push(row.map_err(|error| error.to_string())?);
        }
    }

    let mut reference_excerpts = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT rw.id, rw.title, rw.purpose, ri.id, rs.id, rs.title,
                        rs.order_index, rs.content, rs.content_hash, rs.char_count
                   FROM reference_works rw
                   JOIN reference_imports ri
                     ON ri.reference_work_id = rw.id
                    AND ri.novel_id = rw.novel_id
                    AND ri.is_current = 1
                   JOIN reference_sections rs
                     ON rs.reference_work_id = rw.id
                    AND rs.reference_import_id = ri.id
                    AND rs.novel_id = rw.novel_id
                  WHERE rw.novel_id = ?1
                    AND rw.purpose IN ('research', 'inspiration')
               ORDER BY rw.updated_at DESC, rw.id, rs.order_index
                  LIMIT ?2",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, REFERENCE_EXCERPT_LIMIT as i64], |row| {
                let char_count = row.get::<_, i64>(9)?;
                Ok(json!({
                    "workId": row.get::<_, String>(0)?,
                    "workTitle": row.get::<_, String>(1)?,
                    "purpose": row.get::<_, String>(2)?,
                    "importId": row.get::<_, String>(3)?,
                    "sectionId": row.get::<_, String>(4)?,
                    "sectionTitle": row.get::<_, String>(5)?,
                    "orderIndex": row.get::<_, i64>(6)?,
                    "content": clip_to(row.get::<_, String>(7)?, REFERENCE_EXCERPT_CLIP),
                    "contentHash": row.get::<_, String>(8)?,
                    "sourceCharCount": char_count,
                    "truncated": char_count > REFERENCE_EXCERPT_CLIP as i64
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            reference_excerpts.push(row.map_err(|error| error.to_string())?);
        }
    }

    Ok(json!({
        "ok": true,
        "toolVersion": TOOL_VERSION,
        "revisions": {
            "novel": max_updated_at(connection, "novels", "id", &novel_id),
            "volumes": max_updated_at(connection, "volumes", "novel_id", &novel_id),
            "chapters": max_updated_at(connection, "chapters", "novel_id", &novel_id),
            "characters": max_updated_at(connection, "characters", "novel_id", &novel_id),
            "protagonists": max_updated_at(connection, "protagonists", "novel_id", &novel_id),
            "world_settings": max_updated_at(connection, "world_settings", "novel_id", &novel_id),
            "rule_systems": max_updated_at(connection, "rule_systems", "novel_id", &novel_id),
            "master_outline": max_updated_at(connection, "master_outlines", "project_id", &novel_id),
            "volume_outlines": max_updated_at(connection, "volume_outlines", "project_id", &novel_id),
            "chapter_outline": max_updated_at(connection, "chapter_outlines", "project_id", &novel_id),
            "style_profile": max_updated_at(connection, "style_profiles", "novel_id", &novel_id),
            "output_profile": max_updated_at(connection, "output_profiles", "novel_id", &novel_id),
            "factions": max_updated_at(connection, "factions", "novel_id", &novel_id),
            "locations": max_updated_at(connection, "locations", "novel_id", &novel_id),
            "reference_works": max_updated_at(connection, "reference_works", "novel_id", &novel_id)
        },
        "data": {
            "novel": novel,
            "protagonistSource": protagonist_source,
            "protagonists": protagonists,
            "worldSettings": world_settings,
            "ruleSystems": rule_systems,
            "masterOutline": master_outline,
            "volumeOutlines": volume_outlines,
            "currentChapterOutline": current_chapter_outline,
            "volumes": volumes,
            "chapters": chapters,
            "targetChapter": chapter_id.map(|chapter_id| json!({
                "chapterId": chapter_id,
                "position": target_position
            })),
            "styleProfiles": style_profiles,
            "outputProfiles": output_profiles,
            "factions": factions,
            "locations": locations,
            "referenceWorks": reference_works,
            "referenceExcerpts": reference_excerpts,
            "projectionLimits": {
                "worldSettings": WORLD_SETTING_LIMIT,
                "ruleSystems": RULE_SYSTEM_LIMIT,
                "volumeOutlines": VOLUME_OUTLINE_LIMIT,
                "volumes": VOLUME_LIMIT,
                "chapters": CHAPTER_LIMIT,
                "styleProfiles": STYLE_PROFILE_LIMIT,
                "outputProfiles": 1,
                "protagonists": PROTAGONIST_LIMIT,
                "storyAssetsPerType": STORY_ASSET_LIMIT,
                "referenceWorks": REFERENCE_WORK_LIMIT,
                "referenceExcerpts": REFERENCE_EXCERPT_LIMIT,
                "referenceExcerptChars": REFERENCE_EXCERPT_CLIP
            }
        }
    }))
}

// ---------------------------------------------------------------------------
// get_chapter_context
// ---------------------------------------------------------------------------

fn get_chapter_context(connection: &Connection, arguments: &Value) -> Result<Value, String> {
    let novel_id = arg_id(arguments, "novelId")?;
    let chapter_id = arg_id(arguments, "chapterId")?;

    let chapter = connection
        .query_row(
            "SELECT id, volume_id, title, outline, goal, order_index, status,
                    target_word_count, adopted_draft_id, word_count
             FROM chapters WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL",
            params![chapter_id, novel_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "volumeId": row.get::<_, Option<String>>(1)?,
                    "title": row.get::<_, String>(2)?,
                    "outline": clip_to(row.get::<_, Option<String>>(3)?.unwrap_or_default(), VOLUME_OUTLINE_CLIP),
                    "goal": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "orderIndex": row.get::<_, i64>(5)?,
                    "status": row.get::<_, String>(6)?,
                    "targetWordCount": row.get::<_, Option<i64>>(7)?,
                    "adoptedDraftId": row.get::<_, Option<String>>(8)?,
                    "wordCount": row.get::<_, i64>(9)?
                }))
            },
        )
        .map_err(|_| format!("chapter not found in novel: {}/{}", novel_id, chapter_id))?;
    let volume_id = chapter
        .get("volumeId")
        .and_then(Value::as_str)
        .map(str::to_string);

    let master_outline = connection
        .query_row(
            "SELECT id, title, content, status, version, source_type
             FROM master_outlines WHERE project_id = ?1 AND is_active = 1
             ORDER BY version DESC LIMIT 1",
            params![novel_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "content": clip_to(row.get::<_, String>(2)?, CORE_OUTLINE_CLIP),
                    "status": row.get::<_, String>(3)?,
                    "version": row.get::<_, i64>(4)?,
                    "sourceType": row.get::<_, String>(5)?
                }))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let volume_outline = if let Some(volume_id) = volume_id.as_deref() {
        connection
            .query_row(
                "SELECT id, master_outline_id, volume_id, volume_index, title, content,
                        status, version, source_type
                 FROM volume_outlines
                 WHERE project_id = ?1 AND volume_id = ?2 AND is_active = 1
                 ORDER BY version DESC LIMIT 1",
                params![novel_id, volume_id],
                |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "masterOutlineId": row.get::<_, Option<String>>(1)?,
                        "volumeId": row.get::<_, Option<String>>(2)?,
                        "volumeIndex": row.get::<_, i64>(3)?,
                        "title": row.get::<_, String>(4)?,
                        "content": clip_to(row.get::<_, String>(5)?, VOLUME_OUTLINE_CLIP),
                        "status": row.get::<_, String>(6)?,
                        "version": row.get::<_, i64>(7)?,
                        "sourceType": row.get::<_, String>(8)?
                    }))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
    } else {
        None
    };

    let outline = connection
        .query_row(
            "SELECT id, version, title, content, status, source_type
             FROM chapter_outlines
             WHERE chapter_id = ?1 AND project_id = ?2 AND is_active = 1
             ORDER BY version DESC LIMIT 1",
            params![chapter_id, novel_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "version": row.get::<_, i64>(1)?,
                    "title": row.get::<_, String>(2)?,
                    "content": clip_to(row.get::<_, String>(3)?, VOLUME_OUTLINE_CLIP),
                    "status": row.get::<_, String>(4)?,
                    "sourceType": row.get::<_, String>(5)?
                }))
            },
        )
        .ok();

    let engineering_state = connection
        .query_row(
            "SELECT active_version, status, chapter_card_json, scene_plan_json, generation_constraints_json
             FROM chapter_engineering_states
             WHERE chapter_id = ?1 AND novel_id = ?2 AND status = 'active' LIMIT 1",
            params![chapter_id, novel_id],
            |row| {
                Ok(json!({
                    "activeVersion": row.get::<_, i64>(0)?,
                    "status": row.get::<_, String>(1)?,
                    "chapterCard": clip_to(row.get::<_, String>(2)?, ENGINEERING_FIELD_CLIP),
                    "scenePlan": clip_to(row.get::<_, String>(3)?, ENGINEERING_FIELD_CLIP),
                    "generationConstraints": clip_to(row.get::<_, String>(4)?, ENGINEERING_FIELD_CLIP)
                }))
            },
        )
        .ok();

    let mut events = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, title, description, impact, risk, status
                 FROM chapter_events WHERE novel_id = ?1 AND chapter_id = ?2 ORDER BY created_at",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, chapter_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "description": clip_to(row.get::<_, String>(2)?, CONTEXT_TEXT_CLIP),
                    "impact": clip_to(row.get::<_, Option<String>>(3)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "risk": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "status": row.get::<_, String>(5)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(CHAPTER_EVENT_LIMIT) {
            events.push(row.map_err(|error| error.to_string())?);
        }
    }

    let target_sequence_index = chapter_sequence_index(connection, &novel_id, &chapter_id)?;
    let mut previous_summaries = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "WITH ordered_chapters AS (
                    SELECT c.id,
                           c.title,
                           c.order_index,
                           ROW_NUMBER() OVER (
                               ORDER BY
                                   CASE
                                       WHEN c.volume_id IS NULL THEN -1
                                       ELSE COALESCE(v.order_index, 2147483647)
                                   END,
                                   COALESCE(v.id, ''),
                                   c.order_index,
                                   c.created_at,
                                   c.id
                           ) - 1 AS sequence_index
                      FROM chapters c
                 LEFT JOIN volumes v
                        ON v.id = c.volume_id
                       AND v.novel_id = c.novel_id
                       AND v.deleted_at IS NULL
                     WHERE c.novel_id = ?1
                       AND c.deleted_at IS NULL
                 )
                 SELECT c.id, c.title, c.order_index, s.summary, s.key_events,
                        s.character_changes, s.next_chapter_hints
                   FROM ordered_chapters c
                   JOIN chapter_summaries s
                     ON s.chapter_id = c.id
                    AND s.novel_id = ?1
                  WHERE c.sequence_index < ?2
               ORDER BY c.sequence_index DESC, s.created_at DESC, s.id DESC
                  LIMIT 3",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, target_sequence_index], |row| {
                Ok(json!({
                    "chapterId": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "orderIndex": row.get::<_, i64>(2)?,
                    "summary": clip_to(row.get::<_, String>(3)?, SUMMARY_FIELD_CLIP),
                    "keyEvents": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "characterChanges": clip_to(row.get::<_, Option<String>>(5)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "nextChapterHints": clip_to(row.get::<_, Option<String>>(6)?.unwrap_or_default(), CONTEXT_TEXT_CLIP)
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(3) {
            previous_summaries.push(row.map_err(|error| error.to_string())?);
        }
    }

    let target_summary = connection
        .query_row(
            "SELECT summary, key_events, character_changes FROM chapter_summaries
             WHERE novel_id = ?1 AND chapter_id = ?2 ORDER BY created_at DESC LIMIT 1",
            params![novel_id, chapter_id],
            |row| {
                Ok(json!({
                    "summary": clip_to(row.get::<_, String>(0)?, SUMMARY_FIELD_CLIP),
                    "keyEvents": clip_to(row.get::<_, Option<String>>(1)?.unwrap_or_default(), CONTEXT_TEXT_CLIP),
                    "characterChanges": clip_to(row.get::<_, Option<String>>(2)?.unwrap_or_default(), CONTEXT_TEXT_CLIP)
                }))
            },
        )
        .ok();

    let mut chapter_roles = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT cc.character_id, COALESCE(cc.character_name, c.name),
                        cc.role_in_chapter, cc.must_appear, cc.note,
                        c.current_state, c.personality, c.constraints
                 FROM chapter_characters cc
                 LEFT JOIN characters c
                   ON c.id = cc.character_id AND c.novel_id = cc.novel_id
                 WHERE cc.novel_id = ?1 AND cc.chapter_id = ?2
                 ORDER BY cc.must_appear DESC, COALESCE(cc.character_name, c.name)",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, chapter_id], |row| {
                Ok(json!({
                    "characterId": row.get::<_, String>(0)?,
                    "characterName": row.get::<_, Option<String>>(1)?,
                    "roleInChapter": row.get::<_, String>(2)?,
                    "mustAppear": row.get::<_, i64>(3)?,
                    "note": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "currentState": clip_to(row.get::<_, Option<String>>(5)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "personality": clip_to(row.get::<_, Option<String>>(6)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "constraints": clip_to(row.get::<_, Option<String>>(7)?.unwrap_or_default(), CHARACTER_FIELD_CLIP)
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(CHAPTER_ROLE_LIMIT) {
            chapter_roles.push(row.map_err(|error| error.to_string())?);
        }
    }
    let current_adopted_draft = read_current_adopted_body(connection, &novel_id, &chapter_id)?;

    Ok(json!({
        "ok": true,
        "toolVersion": TOOL_VERSION,
        "revisions": {
            "outline": max_updated_at(connection, "chapter_outlines", "chapter_id", &chapter_id),
            "master_outline": max_updated_at(connection, "master_outlines", "project_id", &novel_id),
            "volume_outline": max_updated_at(connection, "volume_outlines", "project_id", &novel_id),
            "adopted_draft": max_updated_at(connection, "chapter_drafts", "chapter_id", &chapter_id),
            "chapter_characters": max_updated_at(connection, "chapter_characters", "chapter_id", &chapter_id),
            "engineering_state": max_updated_at(connection, "chapter_engineering_states", "chapter_id", &chapter_id),
            "events": max_updated_at(connection, "chapter_events", "chapter_id", &chapter_id),
            "summaries": max_updated_at(connection, "chapter_summaries", "novel_id", &novel_id)
        },
        "data": {
            "chapter": chapter,
            "masterOutline": master_outline,
            "volumeOutline": volume_outline,
            "outline": outline,
            "engineeringState": engineering_state,
            "chapterRoles": chapter_roles,
            "currentAdoptedDraft": current_adopted_draft,
            "chapterEvents": events,
            "previousChapterSummaries": previous_summaries,
            "targetChapterSummary": target_summary,
            "projectionLimits": {
                "chapterEvents": CHAPTER_EVENT_LIMIT,
                "chapterRoles": CHAPTER_ROLE_LIMIT,
                "previousChapterSummaries": 3,
                "engineeringFieldChars": ENGINEERING_FIELD_CLIP,
                "outlineFieldChars": VOLUME_OUTLINE_CLIP
            }
        }
    }))
}

// ---------------------------------------------------------------------------
// search_memory
// ---------------------------------------------------------------------------

fn search_memory(connection: &Connection, arguments: &Value) -> Result<Value, String> {
    let novel_id = arg_id(arguments, "novelId")?;
    let query = arguments
        .get("query")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.len() <= QUERY_MAX)
        .ok_or_else(|| "query must be 1..=2000 chars".to_string())?;
    let top_k = arguments
        .get("topK")
        .or_else(|| arguments.get("top_k"))
        .and_then(Value::as_i64)
        .unwrap_or(8)
        .clamp(TOP_K_MIN, TOP_K_MAX);
    let chapter_filter = arguments
        .get("chapterId")
        .or_else(|| arguments.get("chapter_id"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= ID_MAX);
    let target_chapter_id = optional_arg_id(arguments, "targetChapterId")?;
    let target_sequence_index = target_chapter_id
        .as_deref()
        .map(|chapter_id| chapter_sequence_index(connection, &novel_id, chapter_id))
        .transpose()?;
    let source_types: Vec<String> = arguments
        .get("sourceTypes")
        .or_else(|| arguments.get("source_types"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|value| {
                    matches!(
                        *value,
                        "adopted_draft" | "chapter_summary" | "context_record"
                    )
                })
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let min_importance = arguments
        .get("minImportance")
        .or_else(|| arguments.get("min_importance"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    let has_fts: bool = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'memory_chunks_fts'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    let mut rows = Vec::new();
    if has_fts && query.chars().count() >= 3 {
        let mut conditions = vec![
            "f.novel_id = ?1".to_string(),
            "d.status = 'active'".to_string(),
            "memory_chunks_fts MATCH ?2".to_string(),
        ];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> =
            vec![Box::new(novel_id.clone()), Box::new(query.to_string())];
        if let Some(chapter) = chapter_filter {
            conditions.push(format!("m.chapter_id = ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(chapter.to_string()));
        }
        if let Some(target_sequence_index) = target_sequence_index {
            let boundary_param = params_vec.len() + 1;
            conditions.push(format!(
                "m.chapter_order_index < ?{0}
                 AND (m.temporal_start_chapter IS NULL OR m.temporal_start_chapter <= ?{0})
                 AND (m.temporal_end_chapter IS NULL OR m.temporal_end_chapter >= ?{0})",
                boundary_param
            ));
            params_vec.push(Box::new(target_sequence_index));
        }
        if !source_types.is_empty() {
            let rebuilt: Vec<String> = source_types
                .iter()
                .enumerate()
                .map(|(index, _)| format!("?{}", params_vec.len() + 1 + index))
                .collect();
            conditions.push(format!("d.source_type IN ({})", rebuilt.join(",")));
            for value in source_types.iter() {
                params_vec.push(Box::new(value.clone()));
            }
        }
        if min_importance > 0.0 {
            conditions.push(format!("m.importance >= ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(min_importance));
        }
        let sql = format!(
            "SELECT m.id, m.chapter_id, m.ordinal, m.text, m.importance, m.entity_keys_json, m.metadata_json, d.source_type, d.source_id, d.source_version
             FROM memory_chunks_fts f
             JOIN memory_chunks m ON m.id = f.chunk_id AND m.novel_id = f.novel_id
             JOIN memory_documents d ON d.id = m.document_id AND d.novel_id = m.novel_id
             WHERE {}
             ORDER BY m.importance DESC LIMIT ?{}",
            conditions.join(" AND "),
            params_vec.len() + 1
        );
        params_vec.push(Box::new(top_k));
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| error.to_string())?;
        let mapped = statement
            .query_map(
                rusqlite::params_from_iter(params_vec.iter().map(|value| value.as_ref())),
                |row| {
                    Ok(json!({
                        "chunkId": row.get::<_, String>(0)?,
                        "chapterId": row.get::<_, String>(1)?,
                        "ordinal": row.get::<_, i64>(2)?,
                        "text": clip_chunk(row.get::<_, String>(3)?),
                        "importance": row.get::<_, f64>(4)?,
                        "entityKeys": row.get::<_, String>(5)?,
                        "metadata": row.get::<_, String>(6)?,
                        "sourceType": row.get::<_, String>(7)?,
                        "sourceId": row.get::<_, String>(8)?,
                        "sourceVersion": row.get::<_, i64>(9)?
                    }))
                },
            )
            .map_err(|error| error.to_string())?;
        for row in mapped {
            rows.push(row.map_err(|error| error.to_string())?);
        }
    } else {
        // LIKE fallback
        let mut conditions = vec![
            "m.novel_id = ?1".to_string(),
            "d.status = 'active'".to_string(),
            "m.text LIKE ?2".to_string(),
        ];
        let pattern = format!("%{}%", query);
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> =
            vec![Box::new(novel_id.clone()), Box::new(pattern)];
        if let Some(chapter) = chapter_filter {
            conditions.push(format!("m.chapter_id = ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(chapter.to_string()));
        }
        if let Some(target_sequence_index) = target_sequence_index {
            let boundary_param = params_vec.len() + 1;
            conditions.push(format!(
                "m.chapter_order_index < ?{0}
                 AND (m.temporal_start_chapter IS NULL OR m.temporal_start_chapter <= ?{0})
                 AND (m.temporal_end_chapter IS NULL OR m.temporal_end_chapter >= ?{0})",
                boundary_param
            ));
            params_vec.push(Box::new(target_sequence_index));
        }
        if !source_types.is_empty() {
            let placeholders: Vec<String> = source_types
                .iter()
                .enumerate()
                .map(|(index, _)| format!("?{}", params_vec.len() + 1 + index))
                .collect();
            conditions.push(format!("d.source_type IN ({})", placeholders.join(",")));
            for value in source_types.iter() {
                params_vec.push(Box::new(value.clone()));
            }
        }
        if min_importance > 0.0 {
            conditions.push(format!("m.importance >= ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(min_importance));
        }
        let sql = format!(
            "SELECT m.id, m.chapter_id, m.ordinal, m.text, m.importance, m.entity_keys_json, m.metadata_json, d.source_type, d.source_id, d.source_version
             FROM memory_chunks m
             JOIN memory_documents d ON d.id = m.document_id AND d.novel_id = m.novel_id
             WHERE {}
             ORDER BY m.importance DESC LIMIT ?{}",
            conditions.join(" AND "),
            params_vec.len() + 1
        );
        params_vec.push(Box::new(top_k));
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| error.to_string())?;
        let mapped = statement
            .query_map(
                rusqlite::params_from_iter(params_vec.iter().map(|value| value.as_ref())),
                |row| {
                    Ok(json!({
                        "chunkId": row.get::<_, String>(0)?,
                        "chapterId": row.get::<_, String>(1)?,
                        "ordinal": row.get::<_, i64>(2)?,
                        "text": clip_chunk(row.get::<_, String>(3)?),
                        "importance": row.get::<_, f64>(4)?,
                        "entityKeys": row.get::<_, String>(5)?,
                        "metadata": row.get::<_, String>(6)?,
                        "sourceType": row.get::<_, String>(7)?,
                        "sourceId": row.get::<_, String>(8)?,
                        "sourceVersion": row.get::<_, i64>(9)?
                    }))
                },
            )
            .map_err(|error| error.to_string())?;
        for row in mapped {
            rows.push(row.map_err(|error| error.to_string())?);
        }
    }

    Ok(json!({
        "ok": true,
        "toolVersion": TOOL_VERSION,
        "revisions": {
            "memory": max_updated_at(connection, "memory_documents", "novel_id", &novel_id)
        },
        "data": {
            "query": query,
            "matchedChunks": rows.len(),
            "chunks": rows,
            "searchMode": if has_fts { "fts5" } else { "like" }
        }
    }))
}

fn clip_chunk(value: String) -> String {
    if value.chars().count() > CHUNK_CLIP {
        let mut truncated: String = value.chars().take(CHUNK_CLIP).collect();
        truncated.push_str("…[truncated]");
        truncated
    } else {
        value
    }
}

// ---------------------------------------------------------------------------
// get_character_states
// ---------------------------------------------------------------------------

fn get_character_states(connection: &Connection, arguments: &Value) -> Result<Value, String> {
    let novel_id = arg_id(arguments, "novelId")?;
    let chapter_id = arg_id(arguments, "chapterId")?;
    let target_sequence_index = chapter_sequence_index(connection, &novel_id, &chapter_id)?;

    let mut characters = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, name, role_type, is_protagonist, current_state, personality, constraints, ability, goals, relation_to_protagonist, faction
                 FROM characters WHERE novel_id = ?1 AND is_active = 1 ORDER BY protagonist_order, name",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "roleType": row.get::<_, String>(2)?,
                    "isProtagonist": row.get::<_, i64>(3)?,
                    "currentState": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "personality": clip_to(row.get::<_, Option<String>>(5)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "constraints": clip_to(row.get::<_, Option<String>>(6)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "ability": clip_to(row.get::<_, Option<String>>(7)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "goals": clip_to(row.get::<_, Option<String>>(8)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "relationToProtagonist": clip_to(row.get::<_, Option<String>>(9)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "faction": row.get::<_, Option<String>>(10)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(CHARACTER_LIMIT) {
            characters.push(row.map_err(|error| error.to_string())?);
        }
    }

    let (protagonists_json, main_character, protagonist_ability) = connection
        .query_row(
            "SELECT protagonists_json, main_character, protagonist_ability
             FROM novels WHERE id = ?1 AND deleted_at IS NULL",
            params![novel_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|_| format!("novel not found: {}", novel_id))?;
    let (mut protagonists, protagonist_source) = read_protagonists(
        connection,
        &novel_id,
        &protagonists_json,
        &main_character,
        &protagonist_ability,
    )?;

    let mut state_track = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "WITH ordered_chapters AS (
                    SELECT c.id,
                           ROW_NUMBER() OVER (
                               ORDER BY
                                   CASE
                                       WHEN c.volume_id IS NULL THEN -1
                                       ELSE COALESCE(v.order_index, 2147483647)
                                   END,
                                   COALESCE(v.id, ''),
                                   c.order_index,
                                   c.created_at,
                                   c.id
                           ) - 1 AS sequence_index
                      FROM chapters c
                 LEFT JOIN volumes v
                        ON v.id = c.volume_id
                       AND v.novel_id = c.novel_id
                       AND v.deleted_at IS NULL
                     WHERE c.novel_id = ?1
                       AND c.deleted_at IS NULL
                 )
                 SELECT cs.character_id, cs.chapter_id, cs.state_summary,
                        cs.relationship_changes, cs.goal_changes, cs.location,
                        cs.health_state, cs.knowledge_state, cs.created_at
                   FROM character_states cs
              LEFT JOIN ordered_chapters c ON c.id = cs.chapter_id
                  WHERE cs.novel_id = ?1
                    AND (cs.chapter_id IS NULL OR c.sequence_index < ?2)
               ORDER BY COALESCE(c.sequence_index, -1) DESC, cs.created_at DESC, cs.id DESC
                  LIMIT 100",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, target_sequence_index], |row| {
                Ok(json!({
                    "characterId": row.get::<_, String>(0)?,
                    "chapterId": row.get::<_, Option<String>>(1)?,
                    "stateSummary": clip_to(row.get::<_, String>(2)?, CHARACTER_FIELD_CLIP),
                    "relationshipChanges": clip_to(row.get::<_, Option<String>>(3)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "goalChanges": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CHARACTER_FIELD_CLIP),
                    "location": row.get::<_, Option<String>>(5)?,
                    "healthState": row.get::<_, Option<String>>(6)?,
                    "knowledgeState": row.get::<_, Option<String>>(7)?,
                    "createdAt": row.get::<_, String>(8)?
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(CHARACTER_STATE_LIMIT) {
            state_track.push(row.map_err(|error| error.to_string())?);
        }
    }

    // Novel-level profile rows hold the latest state. Chapter-scoped reads
    // must expose only the newest state that existed before the target chapter.
    for character in &mut characters {
        let character_id = character
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let historical_state = state_track
            .iter()
            .find(|state| state.get("characterId").and_then(Value::as_str) == Some(character_id));
        if let Some(object) = character.as_object_mut() {
            object.insert(
                "currentState".to_string(),
                Value::String(
                    historical_state
                        .and_then(|state| state.get("stateSummary"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                ),
            );
            object.insert(
                "currentStateChapterId".to_string(),
                historical_state
                    .and_then(|state| state.get("chapterId"))
                    .cloned()
                    .unwrap_or(Value::Null),
            );
        }
    }
    for protagonist in &mut protagonists {
        let protagonist_id = protagonist
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let protagonist_name = protagonist
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let matching_character_id = characters
            .iter()
            .find(|character| {
                character.get("id").and_then(Value::as_str) == Some(protagonist_id)
                    || (!protagonist_name.is_empty()
                        && character.get("name").and_then(Value::as_str) == Some(protagonist_name))
            })
            .and_then(|character| character.get("id"))
            .and_then(Value::as_str)
            .unwrap_or(protagonist_id);
        let historical_state = state_track.iter().find(|state| {
            state.get("characterId").and_then(Value::as_str) == Some(matching_character_id)
        });
        if let Some(object) = protagonist.as_object_mut() {
            object.insert(
                "currentState".to_string(),
                Value::String(
                    historical_state
                        .and_then(|state| state.get("stateSummary"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                ),
            );
            object.insert(
                "currentStateChapterId".to_string(),
                historical_state
                    .and_then(|state| state.get("chapterId"))
                    .cloned()
                    .unwrap_or(Value::Null),
            );
        }
    }

    let mut chapter_roles = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT character_id, character_name, role_in_chapter, must_appear, note
                 FROM chapter_characters WHERE novel_id = ?1 AND chapter_id = ?2",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![novel_id, chapter_id], |row| {
                Ok(json!({
                    "characterId": row.get::<_, String>(0)?,
                    "characterName": row.get::<_, Option<String>>(1)?,
                    "roleInChapter": row.get::<_, String>(2)?,
                    "mustAppear": row.get::<_, i64>(3)?,
                    "note": clip_to(row.get::<_, Option<String>>(4)?.unwrap_or_default(), CHARACTER_FIELD_CLIP)
                }))
            })
            .map_err(|error| error.to_string())?;
        for row in rows.take(CHAPTER_ROLE_LIMIT) {
            chapter_roles.push(row.map_err(|error| error.to_string())?);
        }
    }

    Ok(json!({
        "ok": true,
        "toolVersion": TOOL_VERSION,
        "revisions": {
            "novel": max_updated_at(connection, "novels", "id", &novel_id),
            "characters": max_updated_at(connection, "characters", "novel_id", &novel_id),
            "protagonists": max_updated_at(connection, "protagonists", "novel_id", &novel_id),
            "character_states": max_created_at(connection, "character_states", "novel_id", &novel_id),
            "chapter_characters": max_updated_at(connection, "chapter_characters", "chapter_id", &chapter_id)
        },
        "data": {
            "characters": characters,
            "protagonistSource": protagonist_source,
            "protagonists": protagonists,
            "stateTrack": state_track,
            "chapterRoles": chapter_roles,
            "projectionLimits": {
                "characters": CHARACTER_LIMIT,
                "protagonists": PROTAGONIST_LIMIT,
                "stateTrack": CHARACTER_STATE_LIMIT,
                "chapterRoles": CHAPTER_ROLE_LIMIT
            }
        }
    }))
}

// ---------------------------------------------------------------------------
// Smoke mode: exercises every tool against the read-only database.
// ---------------------------------------------------------------------------

pub fn run_smoke(connection: &Connection) {
    let novel_id: Option<String> = connection
        .query_row(
            "SELECT id FROM novels WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();
    let chapter_id: Option<String> = novel_id.as_ref().and_then(|novel| {
        connection
            .query_row(
                "SELECT id FROM chapters WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index LIMIT 1",
                params![novel],
                |row| row.get(0),
            )
            .ok()
    });

    println!(
        "smoke: novel={} chapter={}",
        novel_id.as_deref().unwrap_or("none"),
        chapter_id.as_deref().unwrap_or("none")
    );
    println!("tool count: {}", tool_list().len());

    // Negative checks: unknown tool, missing args, and unknown ids must all reject.
    assert!(call_tool(connection, "not_a_tool", &json!({})).is_err());
    assert!(call_tool(connection, "get_metadata", &json!({})).is_err());
    assert!(call_tool(
        connection,
        "get_metadata",
        &json!({"novelId": "does-not-exist", "chapterId": "does-not-exist"})
    )
    .is_err());
    println!("smoke negative checks: ok (unknown tool / missing args / unknown ids rejected)");

    match (novel_id.as_deref(), chapter_id.as_deref()) {
        (Some(novel), Some(chapter)) => {
            let arguments = json!({"novelId": novel, "chapterId": chapter});
            for name in [
                "get_metadata",
                "get_chapter_context",
                "get_character_states",
            ] {
                match call_tool(connection, name, &arguments) {
                    Ok(payload) => {
                        let size = serde_json::to_string(&payload)
                            .map(|value| value.len())
                            .unwrap_or(0);
                        println!("smoke {}: ok, {} bytes", name, size);
                    }
                    Err(error) => println!("smoke {}: ERROR {}", name, error),
                }
            }
            let search = json!({"novelId": novel, "query": "主角", "topK": 5});
            match call_tool(connection, "search_memory", &search) {
                Ok(payload) => println!(
                    "smoke search_memory: ok, matched={}",
                    payload["data"]["matchedChunks"]
                ),
                Err(error) => println!("smoke search_memory: ERROR {}", error),
            }
        }
        _ => println!("smoke: database has no novels/chapters; only tool listing verified"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open fixture database");
        connection
            .execute_batch(
                "CREATE TABLE novels (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    subtitle TEXT,
                    genre TEXT,
                    description TEXT,
                    outline TEXT NOT NULL DEFAULT '',
                    current_volume_id TEXT,
                    current_chapter_id TEXT,
                    protagonist_mode TEXT NOT NULL DEFAULT 'single',
                    protagonists_json TEXT NOT NULL DEFAULT '[]',
                    dual_protagonist_relation_json TEXT NOT NULL DEFAULT '{}',
                    main_character TEXT NOT NULL DEFAULT '',
                    protagonist_ability TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    total_word_count INTEGER NOT NULL,
                    target_word_count INTEGER,
                    deleted_at TEXT,
                    updated_at TEXT
                );
                CREATE TABLE volumes (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    summary TEXT,
                    goal TEXT,
                    main_conflict TEXT,
                    order_index INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    deleted_at TEXT,
                    updated_at TEXT
                );
                CREATE TABLE chapters (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    volume_id TEXT,
                    title TEXT NOT NULL,
                    outline TEXT,
                    goal TEXT,
                    order_index INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    adopted_draft_id TEXT,
                    word_count INTEGER NOT NULL,
                    target_word_count INTEGER,
                    created_at TEXT,
                    deleted_at TEXT,
                    updated_at TEXT
                );
                CREATE TABLE style_profiles (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT,
                    name TEXT NOT NULL,
                    source_type TEXT NOT NULL DEFAULT 'manual',
                    description TEXT,
                    narrative_perspective TEXT,
                    tone TEXT,
                    pace TEXT,
                    sentence_style TEXT,
                    dialogue_ratio REAL,
                    description_ratio REAL,
                    psychological_ratio REAL,
                    battle_style TEXT,
                    battle_intensity TEXT,
                    emotion_tendency TEXT,
                    chapter_ending TEXT,
                    forbidden_styles TEXT,
                    style_summary TEXT,
                    raw_config_json TEXT,
                    is_active INTEGER NOT NULL,
                    updated_at TEXT
                );
                CREATE TABLE output_profiles (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT,
                    name TEXT NOT NULL,
                    target_word_count INTEGER,
                    min_word_count INTEGER,
                    max_word_count INTEGER,
                    pace_level TEXT,
                    dialogue_ratio REAL,
                    description_ratio REAL,
                    battle_intensity TEXT,
                    emotion_tendency TEXT,
                    ending_hook_required INTEGER NOT NULL DEFAULT 0,
                    extra_requirements TEXT,
                    forbidden_items TEXT,
                    is_default INTEGER NOT NULL,
                    updated_at TEXT
                );
                CREATE TABLE world_settings (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL,
                    content TEXT NOT NULL, structured_json TEXT, is_active INTEGER NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE rule_systems (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL,
                    category TEXT, content TEXT NOT NULL, forbidden_rules TEXT,
                    structured_json TEXT, is_active INTEGER NOT NULL, updated_at TEXT
                );
                CREATE TABLE master_outlines (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
                    content TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL,
                    is_active INTEGER NOT NULL, source_type TEXT NOT NULL, updated_at TEXT
                );
                CREATE TABLE volume_outlines (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, master_outline_id TEXT,
                    volume_id TEXT, volume_index INTEGER NOT NULL, title TEXT NOT NULL,
                    content TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL,
                    is_active INTEGER NOT NULL, source_type TEXT NOT NULL, updated_at TEXT
                );
                CREATE TABLE chapter_outlines (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chapter_id TEXT,
                    title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
                    version INTEGER NOT NULL, is_active INTEGER NOT NULL,
                    source_type TEXT NOT NULL, updated_at TEXT
                );
                CREATE TABLE chapter_engineering_states (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                    active_version INTEGER NOT NULL, status TEXT NOT NULL,
                    chapter_card_json TEXT NOT NULL, scene_plan_json TEXT NOT NULL,
                    generation_constraints_json TEXT NOT NULL, updated_at TEXT
                );
                CREATE TABLE chapter_events (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                    title TEXT NOT NULL, description TEXT NOT NULL, impact TEXT, risk TEXT,
                    status TEXT NOT NULL, created_at TEXT, updated_at TEXT
                );
                CREATE TABLE chapter_summaries (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                    summary TEXT NOT NULL, key_events TEXT, character_changes TEXT,
                    next_chapter_hints TEXT, created_at TEXT, updated_at TEXT
                );
                CREATE TABLE characters (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, name TEXT NOT NULL,
                    role_type TEXT NOT NULL, gender TEXT, identity TEXT, faction TEXT,
                    relation_to_protagonist TEXT, goal TEXT, goals TEXT, background TEXT,
                    ability TEXT, personality TEXT, constraints TEXT, behavior_limits TEXT,
                    forbidden_behaviors TEXT, current_state TEXT,
                    is_protagonist INTEGER NOT NULL, protagonist_key TEXT,
                    protagonist_label TEXT,
                    protagonist_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL,
                    updated_at TEXT
                );
                CREATE TABLE protagonists (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, name TEXT NOT NULL,
                    identity TEXT, personality TEXT, goal TEXT, special_ability TEXT,
                    ability_limits TEXT, forbidden_behaviors TEXT, current_state TEXT,
                    created_at TEXT, updated_at TEXT
                );
                CREATE TABLE character_states (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, character_id TEXT NOT NULL,
                    chapter_id TEXT, state_summary TEXT NOT NULL, relationship_changes TEXT,
                    goal_changes TEXT, location TEXT, health_state TEXT, knowledge_state TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE chapter_characters (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                    character_id TEXT NOT NULL, character_name TEXT, role_in_chapter TEXT NOT NULL,
                    must_appear INTEGER NOT NULL, note TEXT, updated_at TEXT
                );
                CREATE TABLE factions (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, name TEXT NOT NULL,
                    kind TEXT, description TEXT NOT NULL, goals TEXT NOT NULL,
                    revision INTEGER NOT NULL, updated_at TEXT
                );
                CREATE TABLE locations (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, name TEXT NOT NULL,
                    kind TEXT, description TEXT NOT NULL, parent_location_id TEXT,
                    revision INTEGER NOT NULL, updated_at TEXT
                );
                CREATE TABLE reference_works (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL,
                    purpose TEXT NOT NULL, description TEXT, revision INTEGER NOT NULL,
                    updated_at TEXT
                );
                CREATE TABLE reference_imports (
                    id TEXT PRIMARY KEY, reference_work_id TEXT NOT NULL,
                    novel_id TEXT NOT NULL, is_current INTEGER NOT NULL
                );
                CREATE TABLE reference_sections (
                    id TEXT PRIMARY KEY, reference_import_id TEXT NOT NULL,
                    reference_work_id TEXT NOT NULL, novel_id TEXT NOT NULL,
                    order_index INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
                    content_hash TEXT NOT NULL, char_count INTEGER NOT NULL
                );
                CREATE TABLE chapter_drafts (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                    content TEXT NOT NULL, version_no INTEGER NOT NULL, is_adopted INTEGER NOT NULL,
                    large_text_ref_id TEXT, content_hash TEXT, updated_at TEXT
                );
                CREATE TABLE large_text_documents (
                    id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT,
                    field_name TEXT NOT NULL, total_chars INTEGER NOT NULL,
                    total_bytes INTEGER NOT NULL, chunk_count INTEGER NOT NULL,
                    content_sha256 TEXT, status TEXT NOT NULL
                );
                CREATE TABLE large_text_chunks (
                    document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
                    content TEXT NOT NULL, char_count INTEGER NOT NULL,
                    byte_count INTEGER NOT NULL, chunk_sha256 TEXT,
                    PRIMARY KEY (document_id, chunk_index)
                );
                CREATE TABLE memory_documents (
                    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL,
                    source_type TEXT NOT NULL, source_id TEXT NOT NULL,
                    source_version INTEGER NOT NULL, status TEXT NOT NULL,
                    updated_at TEXT
                );
                CREATE TABLE memory_chunks (
                    id TEXT PRIMARY KEY, document_id TEXT NOT NULL, novel_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL,
                    importance REAL NOT NULL, chapter_order_index INTEGER,
                    temporal_start_chapter INTEGER, temporal_end_chapter INTEGER,
                    entity_keys_json TEXT NOT NULL, metadata_json TEXT NOT NULL
                );
                INSERT INTO novels (
                    id, title, outline, current_volume_id, current_chapter_id,
                    protagonists_json, status, total_word_count, updated_at
                ) VALUES (
                    'novel-1', '测试小说', '作品纲要：沈砚追查雾城异象', 'volume-1', 'chapter-1',
                    '[{\"id\":\"hero-new\",\"label\":\"primary\",\"name\":\"新主角\",\"identity\":\"调查员\",\"personality\":\"冷静\",\"goal\":\"找到真相\",\"specialAbility\":\"听见回响\"}]',
                    'draft', 0, '2026-08-21T00:00:00Z'
                );
                INSERT INTO volumes VALUES (
                    'volume-1', 'novel-1', '第一卷', '卷摘要', '找到入口', '雾城封锁',
                    1, 'planned', NULL, '2026-08-21T00:00:00Z'
                );
                INSERT INTO chapters (
                    id, novel_id, volume_id, title, outline, goal, order_index, status,
                    word_count, target_word_count, updated_at
                ) VALUES (
                    'chapter-1', 'novel-1', 'volume-1', '第一章', '字段大纲', '推进谜团',
                    1, 'draft', 0, 3000, '2026-08-21T00:00:00Z'
                );
                INSERT INTO world_settings VALUES (
                    'world-1', 'novel-1', '雾城', '城中终年有雾', '{}', 1,
                    '2026-08-21T00:00:00Z',
                    '2026-08-21T00:00:00Z'
                );
                INSERT INTO rule_systems VALUES (
                    'rule-1', 'novel-1', '回响规则', '能力', '记忆可换取力量',
                    '不可复活死者', '{}', 1, '2026-08-21T00:00:00Z'
                );
                INSERT INTO master_outlines VALUES (
                    'master-1', 'novel-1', '总纲', '主角追查雾城真相', 'active', 2, 1,
                    'manual', '2026-08-21T00:00:00Z'
                );
                INSERT INTO volume_outlines VALUES (
                    'volume-outline-1', 'novel-1', 'master-1', 'volume-1', 1,
                    '第一卷纲', '主角进入并逃离雾城', 'active', 1, 1, 'manual',
                    '2026-08-21T00:00:00Z'
                );
                INSERT INTO chapter_outlines VALUES (
                    'outline-1', 'novel-1', 'chapter-1', '第一章纲', '主角进入雾城',
                    'active', 1, 1, 'manual', '2026-08-21T00:00:00Z'
                );
                INSERT INTO characters (
                    id, novel_id, name, role_type, gender, identity, faction,
                    relation_to_protagonist, goal, goals, background, ability, personality,
                    constraints, behavior_limits, forbidden_behaviors, current_state,
                    is_protagonist, protagonist_key, protagonist_label, protagonist_order,
                    is_active, updated_at
                ) VALUES (
                    'character-1', 'novel-1', '沈砚', 'protagonist', NULL, '调查员',
                    '调查局', NULL, '查明真相', '查明真相', NULL, '听见回响', '冷静',
                    '不伤无辜', '不得无故冒险', '不得伤害无辜者', '戒备', 1, 'primary',
                    '主角', 0, 1, '2026-08-21T00:00:00Z'
                );
                INSERT INTO chapter_characters VALUES (
                    'role-1', 'novel-1', 'chapter-1', 'character-1', '沈砚',
                    'protagonist', 1, '必须发现门牌异常', '2026-08-21T00:00:00Z'
                );
                INSERT INTO protagonists (
                    id, novel_id, name, identity, personality, goal, special_ability,
                    ability_limits, forbidden_behaviors, current_state, created_at, updated_at
                ) VALUES (
                    'hero-legacy', 'novel-1', '旧主角', '旧身份', '犹疑', '旧目标',
                    '旧能力', '旧限制', '不得背叛', '旧状态',
                    '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z'
                );
                INSERT INTO factions VALUES (
                    'faction-1', 'novel-1', '调查局', '组织', '负责处理异常', '封锁雾城', 2,
                    '2026-08-21T00:00:00Z'
                );
                INSERT INTO locations VALUES (
                    'location-1', 'novel-1', '雾城', '城市', '终年被雾笼罩', NULL, 3,
                    '2026-08-21T00:00:00Z'
                );
                INSERT INTO reference_works VALUES (
                    'reference-1', 'novel-1', '雾都研究笔记', 'research', '用于校验城市历史', 1,
                    '2026-08-21T00:00:00Z'
                );
                INSERT INTO reference_imports VALUES (
                    'reference-import-1', 'reference-1', 'novel-1', 1
                );
                INSERT INTO reference_sections VALUES (
                    'reference-section-1', 'reference-import-1', 'reference-1', 'novel-1', 1,
                    '旧城档案', '城北旧钟楼曾在大雾中停摆。',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 14
                );",
            )
            .expect("create fixture schema");
        connection
    }

    fn listed_tool<'a>(tools: &'a [Value], name: &str) -> &'a Value {
        tools
            .iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some(name))
            .unwrap_or_else(|| panic!("missing tool schema: {}", name))
    }

    fn total_changes(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT total_changes()", [], |row| row.get(0))
            .expect("read SQLite total_changes")
    }

    fn adopt_inline_draft(connection: &Connection, content: &str) {
        let hash = sha256(content);
        connection
            .execute(
                "INSERT INTO chapter_drafts (
                    id, novel_id, chapter_id, content, version_no, is_adopted,
                    large_text_ref_id, content_hash, updated_at
                 ) VALUES ('draft-1', 'novel-1', 'chapter-1', ?1, 3, 1, NULL, ?2,
                           '2026-08-21T00:00:00Z')",
                params![content, hash],
            )
            .expect("insert adopted draft");
        connection
            .execute(
                "UPDATE chapters SET adopted_draft_id = 'draft-1' WHERE id = 'chapter-1'",
                [],
            )
            .expect("adopt draft");
    }

    fn install_memory_boundary_fixture(connection: &Connection, with_fts: bool) {
        connection
            .execute_batch(
                "INSERT INTO volumes VALUES (
                    'volume-2', 'novel-1', '第二卷', '', '', '', 2, 'planned', NULL,
                    '2026-08-21T00:00:00Z'
                );
                INSERT INTO chapters (
                    id, novel_id, volume_id, title, outline, goal, order_index, status,
                    word_count, target_word_count, created_at, updated_at
                ) VALUES
                    ('chapter-2', 'novel-1', 'volume-1', '第二章', '', '', 2, 'adopted',
                     100, 3000, '2026-08-21T00:01:00Z', '2026-08-21T00:01:00Z'),
                    ('chapter-3', 'novel-1', 'volume-2', '第三章', '', '', 1, 'draft',
                     0, 3000, '2026-08-21T00:02:00Z', '2026-08-21T00:02:00Z'),
                    ('chapter-4', 'novel-1', 'volume-2', '第四章', '', '', 2, 'adopted',
                     100, 3000, '2026-08-21T00:03:00Z', '2026-08-21T00:03:00Z');
                INSERT INTO memory_documents VALUES
                    ('memory-1', 'novel-1', 'adopted_draft', 'draft-memory-1', 1, 'active',
                     '2026-08-21T00:00:00Z'),
                    ('memory-2', 'novel-1', 'chapter_summary', 'summary-memory-2', 1, 'active',
                     '2026-08-21T00:01:00Z'),
                    ('memory-3', 'novel-1', 'context_record', 'context-memory-3', 1, 'active',
                     '2026-08-21T00:02:00Z'),
                    ('memory-4', 'novel-1', 'adopted_draft', 'draft-memory-4', 1, 'active',
                     '2026-08-21T00:03:00Z'),
                    ('memory-not-yet-valid', 'novel-1', 'context_record', 'context-future', 1,
                     'active', '2026-08-21T00:03:30Z'),
                    ('memory-expired', 'novel-1', 'context_record', 'context-expired', 1,
                     'active', '2026-08-21T00:03:40Z'),
                    ('memory-invalidated', 'novel-1', 'adopted_draft', 'draft-old', 1,
                     'invalidated', '2026-08-21T00:04:00Z');
                INSERT INTO memory_chunks (
                    id, document_id, novel_id, chapter_id, ordinal, text, importance,
                    chapter_order_index, temporal_start_chapter, temporal_end_chapter,
                    entity_keys_json, metadata_json
                ) VALUES
                    ('chunk-1', 'memory-1', 'novel-1', 'chapter-1', 0,
                     'shared memory fact from chapter one', 0.70, 0, 0, NULL, '[]', '{}'),
                    ('chunk-2', 'memory-2', 'novel-1', 'chapter-2', 0,
                     'shared memory fact from chapter two', 0.80, 1, 1, NULL, '[]', '{}'),
                    ('chunk-3', 'memory-3', 'novel-1', 'chapter-3', 0,
                     'shared memory fact from target chapter', 0.90, 2, 2, NULL, '[]', '{}'),
                    ('chunk-4', 'memory-4', 'novel-1', 'chapter-4', 0,
                     'shared memory fact from future chapter', 0.95, 3, 3, NULL, '[]', '{}'),
                    ('chunk-not-yet-valid', 'memory-not-yet-valid', 'novel-1', 'chapter-1', 0,
                     'shared memory fact that starts in the future', 0.99, 0, 3, NULL, '[]', '{}'),
                    ('chunk-expired', 'memory-expired', 'novel-1', 'chapter-1', 0,
                     'shared memory fact that already expired', 0.98, 0, 0, 1, '[]', '{}'),
                    ('chunk-invalidated', 'memory-invalidated', 'novel-1', 'chapter-1', 0,
                     'shared memory fact from invalidated draft', 1.0, 0, 0, NULL, '[]', '{}');",
            )
            .expect("install memory boundary fixture");
        if with_fts {
            connection
                .execute_batch(
                    "CREATE VIRTUAL TABLE memory_chunks_fts
                     USING fts5(chunk_id UNINDEXED, novel_id UNINDEXED, text);
                     INSERT INTO memory_chunks_fts (chunk_id, novel_id, text)
                     SELECT id, novel_id, text FROM memory_chunks;",
                )
                .expect("install memory FTS fixture");
        }
    }

    fn install_cross_volume_context_fixture(connection: &Connection) {
        connection
            .execute_batch(
                "INSERT INTO volumes VALUES
                    ('volume-2', 'novel-1', '第二卷', '', '', '', 2, 'planned', NULL,
                     '2026-08-21T00:02:00Z'),
                    ('volume-3', 'novel-1', '第三卷', '', '', '', 3, 'planned', NULL,
                     '2026-08-21T00:04:00Z');
                 INSERT INTO chapters (
                     id, novel_id, volume_id, title, outline, goal, order_index, status,
                     word_count, target_word_count, created_at, updated_at
                 ) VALUES
                    ('chapter-2', 'novel-1', 'volume-1', '第二章', '', '', 2, 'summarized',
                     100, 3000, '2026-08-21T00:01:00Z', '2026-08-21T00:01:00Z'),
                    ('chapter-3', 'novel-1', 'volume-2', '第三章', '', '', 1, 'summarized',
                     100, 3000, '2026-08-21T00:02:00Z', '2026-08-21T00:02:00Z'),
                    ('chapter-4', 'novel-1', 'volume-2', '第四章', '', '', 2, 'summarized',
                     100, 3000, '2026-08-21T00:03:00Z', '2026-08-21T00:03:00Z'),
                    ('chapter-5', 'novel-1', 'volume-3', '第五章', '', '', 1, 'summarized',
                     100, 3000, '2026-08-21T00:04:00Z', '2026-08-21T00:04:00Z');
                 INSERT INTO chapter_summaries VALUES
                    ('summary-1', 'novel-1', 'chapter-1', '第一章事实', '', '', '',
                     '2026-08-21T00:00:01Z', '2026-08-21T00:00:01Z'),
                    ('summary-2', 'novel-1', 'chapter-2', '第二章事实', '', '', '',
                     '2026-08-21T00:01:01Z', '2026-08-21T00:01:01Z'),
                    ('summary-3', 'novel-1', 'chapter-3', '目标章事实', '', '', '',
                     '2026-08-21T00:02:01Z', '2026-08-21T00:02:01Z'),
                    ('summary-4', 'novel-1', 'chapter-4', '同卷未来事实', '', '', '',
                     '2026-08-21T00:03:01Z', '2026-08-21T00:03:01Z'),
                    ('summary-5', 'novel-1', 'chapter-5', '后卷未来事实', '', '', '',
                     '2026-08-21T00:04:01Z', '2026-08-21T00:04:01Z');
                 INSERT INTO character_states VALUES
                    ('state-1', 'novel-1', 'character-1', 'chapter-1', '第一章后状态',
                     '', '', '', '', '', '2026-08-21T00:00:02Z'),
                    ('state-2', 'novel-1', 'character-1', 'chapter-2', '第二章后状态',
                     '', '', '', '', '', '2026-08-21T00:01:02Z'),
                    ('state-3', 'novel-1', 'character-1', 'chapter-3', '目标章后状态',
                     '', '', '', '', '', '2026-08-21T00:02:02Z'),
                    ('state-4', 'novel-1', 'character-1', 'chapter-4', '同卷未来状态',
                     '', '', '', '', '', '2026-08-21T00:03:02Z'),
                    ('state-5', 'novel-1', 'character-1', 'chapter-5', '后卷未来状态',
                     '', '', '', '', '', '2026-08-21T00:04:02Z');",
            )
            .expect("install cross-volume context fixture");
    }

    fn matched_chapter_ids(result: &Value) -> Vec<String> {
        result["data"]["chunks"]
            .as_array()
            .expect("memory chunks")
            .iter()
            .filter_map(|chunk| chunk["chapterId"].as_str().map(str::to_string))
            .collect()
    }

    fn story_plan_candidate(
        volume_count: usize,
        chapters_per_volume: usize,
        chapter_target_word_count: u64,
    ) -> Value {
        let volumes = (0..volume_count)
            .map(|volume_index| {
                let chapters = (0..chapters_per_volume)
                    .map(|chapter_index| {
                        json!({
                            "title": format!("第{}章", chapter_index + 1),
                            "outline": "主角追查一条新线索，并让局势发生不可逆的变化。",
                            "goal": "推进调查并付出代价",
                            "targetWordCount": chapter_target_word_count
                        })
                    })
                    .collect::<Vec<_>>();
                json!({
                    "title": format!("第{}卷", volume_index + 1),
                    "summary": "主角从发现异常到揭开这一阶段的真相。",
                    "goal": "完成阶段调查",
                    "mainConflict": "个人记忆与城市秩序之间的冲突",
                    "outline": "线索逐步收束，人物选择持续改变后续局势。",
                    "chapters": chapters
                })
            })
            .collect::<Vec<_>>();
        json!({
            "planKind": "story_plan",
            "title": "作品总纲",
            "content": "档案修复师发现城市正在删除人的记忆，并追查删除机制背后的选择。",
            "targetWordCount": volume_count as u64
                * chapters_per_volume as u64
                * chapter_target_word_count,
            "volumes": volumes
        })
    }

    fn sixty_thousand_word_goal_policy() -> CandidatePolicy {
        parse_book_word_goal_policy(&format!(
            "book_word_goal_v1:60000:54000:66000:{}",
            "a".repeat(64)
        ))
        .expect("canonical sixty-thousand-word policy")
    }

    #[test]
    fn book_word_goal_policy_parses_canonical_value_and_rejects_malformed_values() {
        assert_eq!(
            resolve_candidate_policy(Ok(format!(
                "book_word_goal_v1:60000:54000:66000:{}",
                "a".repeat(64)
            )))
            .expect("canonical policy"),
            Some(sixty_thousand_word_goal_policy())
        );

        for malformed in [
            "book_word_goal_v1:060000:54000:66000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            "book_word_goal_v1:60000:61000:66000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            "book_word_goal_v1:60000:54000:59000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            "book_word_goal_v1:60000:54000:66000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            "book_word_goal_v1:60000:54000:66000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string(),
            "book_word_goal_v1:60000:54000:66000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:extra".to_string(),
        ] {
            assert_eq!(
                resolve_candidate_policy(Ok(malformed)).expect_err("malformed policy"),
                TASK_CANDIDATE_POLICY_UNAVAILABLE
            );
        }
    }

    #[test]
    fn book_word_goal_policy_accepts_root_and_chapter_sum_inside_frozen_range() {
        let candidate = story_plan_candidate(1, 12, 5_000);
        validate_candidate_payload("outline", &candidate.to_string())
            .expect("generic story-plan validation");
        validate_candidate_policy(
            Some(sixty_thousand_word_goal_policy()),
            "outline",
            &candidate.to_string(),
        )
        .expect("frozen word goal validation");
    }

    #[test]
    fn book_word_goal_policy_rejects_root_below_range_before_artifact_creation() {
        let mut candidate = story_plan_candidate(1, 12, 5_000);
        candidate["targetWordCount"] = json!(53_000);
        validate_candidate_payload("outline", &candidate.to_string())
            .expect("the legacy twenty-percent consistency check still passes");
        let error = validate_candidate_policy(
            Some(sixty_thousand_word_goal_policy()),
            "outline",
            &candidate.to_string(),
        )
        .expect_err("frozen root target must reject the candidate");
        assert!(error.contains("根 targetWordCount=53000"));
        assert!(error.contains("54000 到 66000"));
    }

    #[test]
    fn book_word_goal_policy_rejects_chapter_sum_below_range_even_when_legacy_check_passes() {
        let mut candidate = story_plan_candidate(1, 10, 5_000);
        candidate["targetWordCount"] = json!(54_000);
        validate_candidate_payload("outline", &candidate.to_string())
            .expect("the legacy twenty-percent consistency check still passes");
        let error = validate_candidate_policy(
            Some(sixty_thousand_word_goal_policy()),
            "outline",
            &candidate.to_string(),
        )
        .expect_err("frozen chapter sum must reject the candidate");
        assert!(error.contains("章节合计=50000"));
        assert!(error.contains("54000 到 66000"));
    }

    #[test]
    fn task_scope_accepts_exact_novel_and_chapter_match() {
        let scope = resolve_task_scope(true, Some("novel-1"), Some("chapter-1"))
            .expect("valid task scope")
            .expect("task scope should be active");

        validate_task_scope(
            Some(&scope),
            &json!({
                "novelId": "novel-1",
                "chapterId": "chapter-1",
                "candidateText": "候选正文"
            }),
        )
        .expect("matching task arguments should pass");
    }

    #[test]
    fn task_scope_binds_authoritative_memory_target_and_rejects_conflicts() {
        let scope = TaskScope {
            novel_id: "novel-1".to_string(),
            chapter_id: Some("chapter-3".to_string()),
        };
        let bound = bind_search_memory_target(
            Some(&scope),
            &json!({"novelId": "novel-1", "query": "shared memory"}),
        )
        .expect("missing target should be bound from task scope");
        assert_eq!(bound["targetChapterId"], "chapter-3");

        let error = bind_search_memory_target(
            Some(&scope),
            &json!({
                "novelId": "novel-1",
                "query": "shared memory",
                "targetChapterId": "chapter-4"
            }),
        )
        .expect_err("an explicit target cannot escape the task chapter scope");
        assert_eq!(error, TASK_CHAPTER_SCOPE_REJECTED);
        assert!(!error.contains("chapter-3"));
        assert!(!error.contains("chapter-4"));
    }

    #[test]
    fn task_scope_rejects_cross_novel_without_echoing_scope_or_content() {
        let scope = TaskScope {
            novel_id: "novel-authorized".to_string(),
            chapter_id: Some("chapter-authorized".to_string()),
        };
        let error = validate_task_scope(
            Some(&scope),
            &json!({
                "novelId": "novel-cross-scope",
                "chapterId": "chapter-authorized",
                "candidateText": "sensitive candidate body"
            }),
        )
        .expect_err("cross-novel access must fail closed");

        assert_eq!(error, TASK_NOVEL_SCOPE_REJECTED);
        for sensitive in [
            "novel-authorized",
            "novel-cross-scope",
            "chapter-authorized",
            "sensitive candidate body",
        ] {
            assert!(!error.contains(sensitive));
        }
    }

    #[test]
    fn task_scope_rejects_cross_chapter_without_echoing_ids() {
        let scope = TaskScope {
            novel_id: "novel-1".to_string(),
            chapter_id: Some("chapter-authorized".to_string()),
        };
        let error = validate_task_scope(
            Some(&scope),
            &json!({"novelId": "novel-1", "chapterId": "chapter-cross-scope"}),
        )
        .expect_err("cross-chapter access must fail closed");

        assert_eq!(error, TASK_CHAPTER_SCOPE_REJECTED);
        assert!(!error.contains("chapter-authorized"));
        assert!(!error.contains("chapter-cross-scope"));
    }

    #[test]
    fn task_scope_rejects_chapter_argument_when_chapter_is_unbound() {
        let scope = TaskScope {
            novel_id: "novel-1".to_string(),
            chapter_id: None,
        };
        let error = validate_task_scope(
            Some(&scope),
            &json!({"novelId": "novel-1", "chapterId": "chapter-1"}),
        )
        .expect_err("chapter access requires an authoritative chapter binding");

        assert_eq!(error, TASK_CHAPTER_SCOPE_REJECTED);
    }

    #[test]
    fn novel_scoped_candidates_discard_a_model_supplied_chapter_target() {
        let connection = fixture_connection();
        for (tool, artifact_type, candidate) in [
            (
                "generate_outline",
                "outline",
                story_plan_candidate(1, 1, 4_100),
            ),
            (
                "generate_characters",
                "character_candidates",
                json!({"characters":[{"name":"林默"}]}),
            ),
            (
                "expand_settings",
                "setting_candidates",
                json!({"settings":[{"name":"雾城"}]}),
            ),
        ] {
            let result = call_tool_with_security_context(
                &connection,
                tool,
                &json!({
                    "novelId": "novel-1",
                    "chapterId": "model-supplied-unbound-chapter",
                    "candidate": candidate
                }),
                Ok(TaskSecurityContext {
                    allowed_tools: Some(HashSet::from([tool.to_string()])),
                    scope: Some(TaskScope {
                        novel_id: "novel-1".to_string(),
                        chapter_id: None,
                    }),
                    candidate_policy: None,
                }),
            )
            .expect("the host novel scope should override an irrelevant model chapter target");

            assert_eq!(result["artifactType"], artifact_type);
            assert_eq!(result["data"]["novelId"], "novel-1");
            assert_eq!(result["data"]["chapterId"], "");
        }
    }

    #[test]
    fn novel_scoped_story_plan_binds_a_missing_model_novel_target() {
        let connection = fixture_connection();
        let result = call_tool_with_security_context(
            &connection,
            "generate_outline",
            &json!({
                "candidate": story_plan_candidate(1, 1, 4_100)
            }),
            Ok(TaskSecurityContext {
                allowed_tools: Some(HashSet::from(["generate_outline".to_string()])),
                scope: Some(TaskScope {
                    novel_id: "novel-1".to_string(),
                    chapter_id: None,
                }),
                candidate_policy: None,
            }),
        )
        .expect("the host task must bind a novel-scoped story plan candidate");

        assert_eq!(result["artifactType"], "outline");
        assert_eq!(result["data"]["novelId"], "novel-1");
        assert_eq!(result["data"]["chapterId"], "");
    }

    #[test]
    fn novel_scoped_story_plan_rejects_an_explicit_cross_novel_target() {
        let connection = fixture_connection();
        let error = call_tool_with_security_context(
            &connection,
            "generate_outline",
            &json!({
                "novelId": "novel-cross-scope",
                "candidate": story_plan_candidate(1, 1, 4_100)
            }),
            Ok(TaskSecurityContext {
                allowed_tools: Some(HashSet::from(["generate_outline".to_string()])),
                scope: Some(TaskScope {
                    novel_id: "novel-authorized".to_string(),
                    chapter_id: None,
                }),
                candidate_policy: None,
            }),
        )
        .expect_err("an explicit cross-novel story plan target must fail closed");

        assert_eq!(error, TASK_NOVEL_SCOPE_REJECTED);
        assert!(!error.contains("novel-authorized"));
        assert!(!error.contains("novel-cross-scope"));
    }

    #[test]
    fn allowed_tools_environment_requires_novel_scope() {
        let error = resolve_task_scope(true, None, None)
            .expect_err("an allowlisted task without novel scope must fail closed");

        assert_eq!(error, TASK_SCOPE_UNAVAILABLE);
    }

    #[test]
    fn non_unicode_allowed_tools_fail_closed_for_list_and_call() {
        let non_unicode = || {
            Err(std::env::VarError::NotUnicode(std::ffi::OsString::from(
                "invalid allowlist",
            )))
        };
        let error = resolve_allowed_tools(non_unicode())
            .expect_err("non-Unicode allowlist must not become unrestricted");
        assert_eq!(error, TASK_TOOL_ALLOWLIST_UNAVAILABLE);

        let listed = filter_tool_list(
            vec![json!({"name": "generate_chapter"})],
            resolve_allowed_tools(non_unicode()),
        );
        assert!(listed.is_empty());

        let connection = fixture_connection();
        let call_context =
            resolve_allowed_tools(non_unicode()).map(|allowed_tools| TaskSecurityContext {
                allowed_tools,
                scope: None,
                candidate_policy: None,
            });
        let call_error = call_tool_with_security_context(
            &connection,
            "generate_chapter",
            &json!({
                "novelId": "novel-1",
                "chapterId": "chapter-1",
                "candidateText": "候选正文足够长"
            }),
            call_context,
        )
        .expect_err("tool calls must return the fixed allowlist error");
        assert_eq!(call_error, TASK_TOOL_ALLOWLIST_UNAVAILABLE);
    }

    #[test]
    fn absent_task_environment_preserves_legacy_direct_calls() {
        let scope = resolve_task_scope(false, None, None).expect("legacy scope resolution");

        assert!(scope.is_none());
        validate_task_scope(None, &json!({"legacy": true}))
            .expect("unscoped legacy calls remain compatible");
    }

    #[test]
    fn schemas_freeze_read_context_and_candidate_contracts() {
        let tools = tool_list();
        let read_context = listed_tool(&tools, "novel.read_context");
        assert_eq!(read_context["inputSchema"]["required"], json!(["novelId"]));
        assert!(read_context["inputSchema"]["properties"]
            .get("chapterId")
            .is_none());

        let search_memory = listed_tool(&tools, "search_memory");
        assert_eq!(
            search_memory["inputSchema"]["required"],
            json!(["novelId", "query"])
        );
        assert!(search_memory["inputSchema"]["properties"]
            .get("chapterId")
            .is_some());
        assert!(search_memory["inputSchema"]["properties"]
            .get("targetChapterId")
            .is_some());

        let generate = listed_tool(&tools, "generate_chapter");
        assert_eq!(
            generate["inputSchema"]["required"],
            json!(["novelId", "chapterId", "candidateText"])
        );
        assert!(generate["inputSchema"]["properties"]
            .get("candidateText")
            .is_some());
        assert!(generate["inputSchema"]["properties"].get("goal").is_none());
        assert!(generate["inputSchema"]["properties"]
            .get("prompt")
            .is_none());
        assert_eq!(generate["outputSchema"]["additionalProperties"], false);
        assert_eq!(
            generate["outputSchema"]["required"],
            json!(["ok", "toolVersion", "artifactType", "candidateOnly", "data"])
        );
        assert_eq!(
            generate["outputSchema"]["properties"]["artifactType"]["enum"],
            json!(["chapter_text"])
        );
        assert_eq!(
            generate["outputSchema"]["properties"]["candidateOnly"]["enum"],
            json!([true])
        );

        let characters = listed_tool(&tools, "generate_characters");
        assert_eq!(
            characters["inputSchema"]["required"],
            json!(["novelId", "candidate"])
        );
        assert!(
            characters["inputSchema"]["properties"]["candidate"]["description"]
                .as_str()
                .is_some_and(|description| description.contains("characters"))
        );
        assert_eq!(
            characters["inputSchema"]["properties"]["candidate"]["type"],
            "object"
        );
        let character_properties = &characters["inputSchema"]["properties"]["candidate"]
            ["properties"]["characters"]["items"]["properties"];
        for formal_field in [
            "motivation",
            "specialAbility",
            "abilityLimits",
            "background",
            "arc",
        ] {
            assert!(
                character_properties.get(formal_field).is_some(),
                "missing formal protagonist field {formal_field}"
            );
        }
        let character_description = characters["inputSchema"]["properties"]["candidate"]
            ["description"]
            .as_str()
            .expect("character candidate description");
        assert!(character_description.contains("behaviorLimits 只表示行为边界"));
        assert!(character_description.contains("不得代替 specialAbility 或 abilityLimits"));
        let settings = listed_tool(&tools, "expand_settings");
        assert_eq!(
            settings["inputSchema"]["required"],
            json!(["novelId", "candidate"])
        );
        assert!(
            settings["inputSchema"]["properties"]["candidate"]["description"]
                .as_str()
                .is_some_and(|description| description.contains("settings"))
        );
        let settings_description = settings["inputSchema"]["properties"]["candidate"]
            ["description"]
            .as_str()
            .expect("settings candidate description");
        for required_contract_term in ["targetType", "rule_system", "world_rules", "forbiddenRules"]
        {
            assert!(settings_description.contains(required_contract_term));
        }
        let summary = listed_tool(&tools, "summarize_chapter");
        assert_eq!(
            summary["inputSchema"]["required"],
            json!(["novelId", "candidateText"])
        );
        let summary_description = summary["inputSchema"]["properties"]["candidateText"]
            ["description"]
            .as_str()
            .expect("chapter summary candidate description");
        for required_contract_term in [
            "summary",
            "keyEvents",
            "factsMustRemember",
            "characterChanges",
            "contextRecords",
        ] {
            assert!(summary_description.contains(required_contract_term));
        }
        let outline = listed_tool(&tools, "generate_outline");
        assert_eq!(
            outline["inputSchema"]["required"],
            json!(["novelId", "candidate"])
        );
        let outline_description = outline["inputSchema"]["properties"]["candidate"]["description"]
            .as_str()
            .expect("outline candidate description");
        for required_contract_term in [
            "planKind",
            "story_plan",
            "targetWordCount",
            "volumes",
            "mainConflict",
            "chapters",
        ] {
            assert!(outline_description.contains(required_contract_term));
        }
    }

    #[test]
    fn story_plan_outline_accepts_a_complete_fifteen_chapter_candidate() {
        let connection = fixture_connection();
        let candidate = story_plan_candidate(3, 5, 4_100);
        let result = call_tool(
            &connection,
            "generate_outline",
            &json!({
                "novelId": "novel-1",
                "candidate": candidate
            }),
        )
        .expect("complete story plan should validate");

        assert_eq!(result["artifactType"], "outline");
        assert_eq!(result["candidateOnly"], true);
        assert_eq!(
            parse_candidate_json(result["data"]["text"].as_str().expect("candidate text"))
                .expect("stored JSON")["targetWordCount"],
            61_500
        );
    }

    #[test]
    fn story_plan_outline_normalizes_a_complete_wrapped_json_object() {
        let connection = fixture_connection();
        let candidate = story_plan_candidate(3, 5, 4_100).to_string();

        for wrapped in [
            format!("```json\n{}\n```", candidate),
            format!("已生成全书规划：\n{}\n以上为完整候选。", candidate),
        ] {
            let result = call_tool(
                &connection,
                "generate_outline",
                &json!({
                    "novelId": "novel-1",
                    "candidateText": wrapped
                }),
            )
            .expect("a complete wrapped story plan should validate");
            let normalized = result["data"]["text"]
                .as_str()
                .expect("normalized candidate text");
            let parsed: Value =
                serde_json::from_str(normalized).expect("normalized text must be plain JSON");
            assert_eq!(parsed["planKind"], "story_plan");
            assert_eq!(parsed["targetWordCount"], 61_500);
            assert!(!normalized.contains("```"));
        }
    }

    #[test]
    fn story_plan_outline_rejects_structural_content_after_the_first_json_value() {
        let candidate = story_plan_candidate(3, 5, 4_100).to_string();
        for malformed in [
            format!("{}]}}", candidate),
            format!("{},{{\"extra\":true}}", candidate),
            format!("{}\n{}", candidate, candidate),
            format!("{} true", candidate),
            format!("{} \"extra\"", candidate),
            format!("true {}", candidate),
        ] {
            assert!(validate_candidate_payload("outline", &malformed)
                .expect_err("trailing structural content must remain invalid")
                .contains("有效的 JSON 对象"));
        }
    }

    #[test]
    fn story_plan_outline_rejects_missing_fields_empty_arrays_and_bad_word_counts() {
        let mut missing_field = story_plan_candidate(1, 1, 4_100);
        missing_field["volumes"][0]
            .as_object_mut()
            .expect("volume object")
            .remove("mainConflict");
        assert!(
            validate_candidate_payload("outline", &missing_field.to_string())
                .expect_err("missing volume field")
                .contains("mainConflict")
        );

        let mut empty_volumes = story_plan_candidate(1, 1, 4_100);
        empty_volumes["volumes"] = json!([]);
        assert!(
            validate_candidate_payload("outline", &empty_volumes.to_string())
                .expect_err("empty volumes")
                .contains("volumes 数量")
        );

        let mut empty_chapters = story_plan_candidate(1, 1, 4_100);
        empty_chapters["volumes"][0]["chapters"] = json!([]);
        assert!(
            validate_candidate_payload("outline", &empty_chapters.to_string())
                .expect_err("empty chapters")
                .contains("chapters 不能为空")
        );

        let mut named_characters = story_plan_candidate(1, 1, 4_100);
        named_characters["volumes"][0]["chapters"][0]["characterNames"] = json!(["沈砚", "闻舟"]);
        validate_candidate_payload("outline", &named_characters.to_string())
            .expect("optional chapter character names should validate");

        let mut invalid_character_names = story_plan_candidate(1, 1, 4_100);
        invalid_character_names["volumes"][0]["chapters"][0]["characterNames"] =
            json!(["沈砚", "沈砚"]);
        assert!(
            validate_candidate_payload("outline", &invalid_character_names.to_string())
                .expect_err("duplicate chapter character names")
                .contains("角色名重复")
        );

        let too_many_volumes = story_plan_candidate(STORY_PLAN_VOLUME_MAX + 1, 1, 500);
        assert!(
            validate_candidate_payload("outline", &too_many_volumes.to_string())
                .expect_err("too many volumes")
                .contains("volumes 数量")
        );

        let too_many_chapters = story_plan_candidate(1, STORY_PLAN_CHAPTER_MAX + 1, 500);
        assert!(
            validate_candidate_payload("outline", &too_many_chapters.to_string())
                .expect_err("too many chapters")
                .contains("章节总数")
        );

        let too_short_chapter = story_plan_candidate(1, 1, STORY_PLAN_CHAPTER_WORD_MIN - 1);
        assert!(
            validate_candidate_payload("outline", &too_short_chapter.to_string())
                .expect_err("chapter word count below minimum")
                .contains("targetWordCount")
        );

        let mut inconsistent_total = story_plan_candidate(1, 2, 4_100);
        inconsistent_total["targetWordCount"] = json!(60_000);
        assert!(
            validate_candidate_payload("outline", &inconsistent_total.to_string())
                .expect_err("inconsistent total word count")
                .contains("基本一致")
        );
    }

    #[test]
    fn story_plan_outline_rejects_oversized_fields_and_preserves_legacy_outlines() {
        let mut oversized_title = story_plan_candidate(1, 1, 4_100);
        oversized_title["title"] = json!("长".repeat(STORY_PLAN_TITLE_MAX + 1));
        assert!(
            validate_candidate_payload("outline", &oversized_title.to_string())
                .expect_err("oversized title")
                .contains("title 超过")
        );

        validate_candidate_payload(
            "outline",
            r#"{"title":"旧版总纲","content":"主角沿着线索逐步揭开真相。"}"#,
        )
        .expect("legacy JSON outline remains valid");
        validate_candidate_payload(
            "outline",
            "这是一份足够长的旧版纯文本大纲候选，仍应继续兼容原有工作台。",
        )
        .expect("legacy prose outline remains valid");

        let malformed_story_plan = r#"{"planKind":"story_plan","title":"损坏的规划","volumes":[}"#;
        assert!(validate_candidate_payload("outline", malformed_story_plan)
            .expect_err("declared story plan must be valid JSON")
            .contains("有效的 JSON 对象"));
        assert!(validate_candidate_payload(
            "outline",
            &format!("```json\n{}\n```", malformed_story_plan)
        )
        .expect_err("a fenced truncated story plan must remain invalid")
        .contains("有效的 JSON 对象"));
    }

    #[test]
    fn scoped_memory_search_excludes_target_and_future_chapters_for_fts_and_like() {
        for with_fts in [false, true] {
            let connection = fixture_connection();
            install_memory_boundary_fixture(&connection, with_fts);
            let result = call_tool_with_security_context(
                &connection,
                "search_memory",
                &json!({
                    "novelId": "novel-1",
                    "query": "shared memory",
                    "topK": 20
                }),
                Ok(TaskSecurityContext {
                    allowed_tools: None,
                    scope: Some(TaskScope {
                        novel_id: "novel-1".to_string(),
                        chapter_id: Some("chapter-3".to_string()),
                    }),
                    candidate_policy: None,
                }),
            )
            .expect("task scope should supply the temporal target");

            assert_eq!(
                matched_chapter_ids(&result),
                vec!["chapter-2".to_string(), "chapter-1".to_string()]
            );
            assert_eq!(
                result["data"]["searchMode"],
                if with_fts { "fts5" } else { "like" }
            );
        }
    }

    #[test]
    fn memory_search_target_fails_closed_and_first_chapter_has_no_prior_facts() {
        let connection = fixture_connection();
        install_memory_boundary_fixture(&connection, false);

        let missing_target = call_tool_with_security_context(
            &connection,
            "search_memory",
            &json!({
                "novelId": "novel-1",
                "query": "shared memory",
                "targetChapterId": "missing-chapter"
            }),
            Ok(TaskSecurityContext {
                allowed_tools: None,
                scope: None,
                candidate_policy: None,
            }),
        )
        .expect_err("an unresolved temporal boundary must stop retrieval");
        assert!(missing_target.contains("target chapter not found in novel"));

        let first_chapter = call_tool_with_security_context(
            &connection,
            "search_memory",
            &json!({
                "novelId": "novel-1",
                "query": "shared memory",
                "targetChapterId": "chapter-1"
            }),
            Ok(TaskSecurityContext {
                allowed_tools: None,
                scope: None,
                candidate_policy: None,
            }),
        )
        .expect("the first chapter boundary should produce an empty result");
        assert!(matched_chapter_ids(&first_chapter).is_empty());
    }

    #[test]
    fn unscoped_memory_search_preserves_exact_chapter_filter() {
        let connection = fixture_connection();
        install_memory_boundary_fixture(&connection, false);
        let result = call_tool_with_security_context(
            &connection,
            "search_memory",
            &json!({
                "novelId": "novel-1",
                "query": "shared memory",
                "chapterId": "chapter-4"
            }),
            Ok(TaskSecurityContext {
                allowed_tools: None,
                scope: None,
                candidate_policy: None,
            }),
        )
        .expect("legacy exact chapter queries should remain available");

        assert_eq!(matched_chapter_ids(&result), vec!["chapter-4"]);
    }

    #[test]
    fn scoped_memory_search_rejects_explicit_target_conflict_before_querying() {
        let connection = fixture_connection();
        let error = call_tool_with_security_context(
            &connection,
            "search_memory",
            &json!({
                "novelId": "novel-1",
                "query": "shared memory",
                "targetChapterId": "chapter-4"
            }),
            Ok(TaskSecurityContext {
                allowed_tools: None,
                scope: Some(TaskScope {
                    novel_id: "novel-1".to_string(),
                    chapter_id: Some("chapter-3".to_string()),
                }),
                candidate_policy: None,
            }),
        )
        .expect_err("the model cannot override the authoritative task chapter");

        assert_eq!(error, TASK_CHAPTER_SCOPE_REJECTED);
    }

    #[test]
    fn generate_chapter_preserves_candidate_without_writing() {
        let connection = fixture_connection();
        let before_changes = total_changes(&connection);
        let candidate = "  雨声落在窗沿。\r\n\r\n沈砚没有回头。  ";
        let result = call_tool(
            &connection,
            "generate_chapter",
            &json!({
                "novelId": "novel-1",
                "chapterId": "chapter-1",
                "candidateText": candidate
            }),
        )
        .expect("candidate should validate");

        assert_eq!(result["ok"], true);
        assert_eq!(result["toolVersion"], TOOL_VERSION);
        assert_eq!(result["artifactType"], "chapter_text");
        assert_eq!(result["candidateOnly"], true);
        assert_eq!(result["data"]["novelId"], "novel-1");
        assert_eq!(result["data"]["chapterId"], "chapter-1");
        assert_eq!(result["data"]["text"], candidate);
        assert_eq!(total_changes(&connection), before_changes);
    }

    #[test]
    fn generate_characters_rejects_unstructured_candidate() {
        let connection = fixture_connection();
        let error = call_tool(
            &connection,
            "generate_characters",
            &json!({
                "novelId": "novel-1",
                "candidateText": "随便写两个角色"
            }),
        )
        .expect_err("unstructured character candidates must be rejected");
        assert!(error.contains("角色候选"));
        let result = call_tool(
            &connection,
            "generate_characters",
            &json!({
                "novelId": "novel-1",
                "candidateText": "{\"characters\":[{\"name\":\"林默\"}]}"
            }),
        )
        .expect("structured character candidates should validate");
        assert_eq!(result["artifactType"], "character_candidates");
        assert_eq!(result["candidateOnly"], true);
    }

    #[test]
    fn automatic_protagonist_policy_rejects_shallow_candidate_before_tool_success() {
        let connection = fixture_connection();
        let context = |policy| {
            Ok(TaskSecurityContext {
                allowed_tools: None,
                scope: None,
                candidate_policy: policy,
            })
        };
        let incomplete = call_tool_with_security_context(
            &connection,
            "generate_characters",
            &json!({
                "novelId": "novel-1",
                "candidate": {
                    "characters": [{"name": "林默", "roleType": "protagonist"}]
                }
            }),
            context(Some(CandidatePolicy::PrimaryProtagonistV1)),
        )
        .expect_err("the model must receive a failed tool result for a shallow protagonist");
        assert!(incomplete.contains("identity"));

        let wrong_tool = call_tool_with_security_context(
            &connection,
            "generate_chapter",
            &json!({
                "novelId": "novel-1",
                "chapterId": "chapter-1",
                "candidateText": "这是一段不应在主角准备回合成功的正文候选。"
            }),
            context(Some(CandidatePolicy::PrimaryProtagonistV1)),
        )
        .expect_err("a wrong candidate tool must fail while the host policy is active");
        assert!(wrong_tool.contains("只允许提交角色候选"));

        let result = call_tool_with_security_context(
            &connection,
            "generate_characters",
            &json!({
                "novelId": "novel-1",
                "candidate": {
                    "characters": [
                        {
                            "name": "林默",
                            "roleType": "protagonist",
                            "identity": "调查记者",
                            "goal": "查清失踪案",
                            "personality": "谨慎而固执"
                        },
                        {"name": "周屿"}
                    ]
                }
            }),
            context(Some(CandidatePolicy::PrimaryProtagonistV1)),
        )
        .expect("a complete automatic protagonist should pass the gateway policy");
        assert_eq!(result["artifactType"], "character_candidates");

        let invalid_companion_role = call_tool_with_security_context(
            &connection,
            "generate_characters",
            &json!({
                "novelId": "novel-1",
                "candidate": {
                    "characters": [
                        {
                            "name": "林默",
                            "roleType": "protagonist",
                            "identity": "调查记者",
                            "goal": "查清失踪案",
                            "personality": "谨慎而固执"
                        },
                        {"name": "周屿", "roleType": "Supporting"}
                    ]
                }
            }),
            context(Some(CandidatePolicy::PrimaryProtagonistV1)),
        )
        .expect_err("every supplied character role must match the apply enum exactly");
        assert!(invalid_companion_role.contains("characters[1]"));
        assert!(invalid_companion_role.contains("roleType"));

        for candidate in [
            json!({
                "characters": [
                    {"name": "林默"},
                    {
                        "name": "林默",
                        "roleType": "protagonist",
                        "identity": "调查记者",
                        "goal": "查清失踪案",
                        "personality": "谨慎而固执"
                    }
                ]
            }),
            json!({
                "characters": [{
                    "name": "林默",
                    "roleType": "Protagonist",
                    "identity": "调查记者",
                    "goal": "查清失踪案",
                    "personality": "谨慎而固执"
                }]
            }),
        ] {
            call_tool_with_security_context(
                &connection,
                "generate_characters",
                &json!({"novelId": "novel-1", "candidate": candidate}),
                context(Some(CandidatePolicy::PrimaryProtagonistV1)),
            )
            .expect_err("automatic protagonist candidates must match the apply contract");
        }
    }

    #[test]
    fn automatic_world_rule_policy_requires_applicable_named_descriptions_and_both_kinds() {
        let connection = fixture_connection();
        let context = || {
            Ok(TaskSecurityContext {
                allowed_tools: None,
                scope: None,
                candidate_policy: Some(CandidatePolicy::WorldRuleBundleV1),
            })
        };
        for candidate in [
            json!({
                "settings": [
                    {"name": "雾城", "description": "城内每晚会遗失一段公共记录"},
                    {"targetType": "rule_system", "description": "被删除的记录不能直接恢复"}
                ]
            }),
            json!({
                "settings": [
                    {"name": "雾城", "description": "城内每晚会遗失一段公共记录"},
                    {"name": "记录律", "targetType": "rule_system"}
                ]
            }),
            json!({
                "settings": [
                    {"name": "雾城", "description": "城内每晚会遗失一段公共记录"}
                ]
            }),
        ] {
            call_tool_with_security_context(
                &connection,
                "expand_settings",
                &json!({"novelId": "novel-1", "candidate": candidate}),
                context(),
            )
            .expect_err("an incomplete automatic world/rule bundle must fail in the tool call");
        }

        let result = call_tool_with_security_context(
            &connection,
            "expand_settings",
            &json!({
                "novelId": "novel-1",
                "candidate": {
                    "settings": [
                        {"name": "雾城", "description": "城内每晚会遗失一段公共记录"},
                        {
                            "name": "记录律",
                            "targetType": "rule_system",
                            "description": "被删除的记录不能直接恢复",
                            "forbiddenRules": ["不得凭空找回已删除记录"]
                        }
                    ]
                }
            }),
            context(),
        )
        .expect("a complete world/rule bundle should pass the gateway policy");
        assert_eq!(result["artifactType"], "setting_candidates");
    }

    #[test]
    fn automatic_rule_only_policy_rejects_world_candidates() {
        let connection = fixture_connection();
        let context = || {
            Ok(TaskSecurityContext {
                allowed_tools: None,
                scope: None,
                candidate_policy: Some(CandidatePolicy::RuleSystemOnlyV1),
            })
        };

        call_tool_with_security_context(
            &connection,
            "expand_settings",
            &json!({
                "novelId": "novel-1",
                "candidate": {
                    "settings": [
                        {"name": "雾城", "description": "城内每晚会遗失一段公共记录"}
                    ]
                }
            }),
            context(),
        )
        .expect_err("a world candidate must not satisfy a rule-only recovery");

        let result = call_tool_with_security_context(
            &connection,
            "expand_settings",
            &json!({
                "novelId": "novel-1",
                "candidate": {
                    "settings": [
                        {
                            "name": "记录律",
                            "targetType": "rule_system",
                            "description": "被删除的记录不能直接恢复"
                        }
                    ]
                }
            }),
            context(),
        )
        .expect("a named rule candidate should pass the rule-only policy");
        assert_eq!(result["artifactType"], "setting_candidates");
    }

    #[test]
    fn generate_chapter_rejects_invalid_candidate_and_scope() {
        let connection = fixture_connection();
        for arguments in [
            json!({"novelId": "novel-1", "chapterId": "chapter-1"}),
            json!({
                "novelId": "novel-1",
                "chapterId": "chapter-1",
                "candidateText": "  \n\t "
            }),
        ] {
            let error = call_tool(&connection, "generate_chapter", &arguments)
                .expect_err("empty candidates must be rejected");
            assert!(error.contains("candidateText"));
        }

        let oversized = "章".repeat(CANDIDATE_TEXT_MAX + 1);
        let error = call_tool(
            &connection,
            "generate_chapter",
            &json!({
                "novelId": "novel-1",
                "chapterId": "chapter-1",
                "candidateText": oversized
            }),
        )
        .expect_err("oversized candidate must be rejected");
        assert!(error.contains("exceeds"));

        let error = call_tool(
            &connection,
            "generate_chapter",
            &json!({
                "novelId": "novel-2",
                "chapterId": "chapter-1",
                "candidateText": "候选正文"
            }),
        )
        .expect_err("chapter must belong to the scoped novel");
        assert!(error.contains("chapter not found in novel"));
    }

    #[test]
    fn read_context_accepts_novel_scope_while_legacy_metadata_requires_chapter() {
        let connection = fixture_connection();
        let result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("novel-scoped context should not require a chapter");
        assert_eq!(result["data"]["novel"]["id"], "novel-1");
        assert!(result["data"]["targetChapter"].is_null());

        let legacy_error = call_tool(&connection, "get_metadata", &json!({"novelId": "novel-1"}))
            .expect_err("legacy metadata contract still requires chapterId");
        assert!(legacy_error.contains("chapterId"));
    }

    #[test]
    fn read_context_exposes_active_domain_assets_and_outline_chain() {
        let connection = fixture_connection();
        let result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("domain context should be readable");

        assert_eq!(result["data"]["worldSettings"][0]["title"], "雾城");
        assert_eq!(result["data"]["worldSettings"][0]["role"], "primary");
        assert_eq!(
            result["data"]["ruleSystems"][0]["forbiddenRules"],
            "不可复活死者"
        );
        assert_eq!(result["data"]["masterOutline"]["id"], "master-1");
        assert_eq!(result["data"]["volumeOutlines"][0]["volumeId"], "volume-1");
        assert_eq!(
            result["data"]["novel"]["outline"],
            "作品纲要：沈砚追查雾城异象"
        );
        assert_eq!(result["data"]["protagonistSource"], "characters");
        assert_eq!(result["data"]["protagonists"][0]["name"], "沈砚");
        assert_eq!(result["data"]["novel"]["protagonistMode"], "single");
        assert_eq!(
            result["data"]["novel"]["dualProtagonistRelation"]["type"],
            "partner"
        );
        assert_eq!(result["data"]["currentChapterOutline"]["id"], "outline-1");
        assert_eq!(result["data"]["factions"][0]["name"], "调查局");
        assert_eq!(result["data"]["locations"][0]["name"], "雾城");
        assert_eq!(result["data"]["referenceWorks"][0]["title"], "雾都研究笔记");
        assert_eq!(
            result["data"]["referenceExcerpts"][0]["sectionId"],
            "reference-section-1"
        );
        assert_eq!(
            result["data"]["referenceExcerpts"][0]["content"],
            "城北旧钟楼曾在大雾中停摆。"
        );
        assert_eq!(
            result["data"]["referenceExcerpts"][0]["purpose"],
            "research"
        );
        assert_eq!(result["revisions"]["characters"], "2026-08-21T00:00:00Z");
        assert_eq!(result["revisions"]["protagonists"], "2026-08-21T00:00:00Z");
        assert!(result["data"]["chapters"][0].get("content").is_none());
        assert!(result["data"]["chapters"][0].get("outline").is_none());
    }

    #[test]
    fn read_context_resolves_generation_profiles_with_scoped_fallbacks() {
        let connection = fixture_connection();
        connection
            .execute_batch(
                "INSERT INTO style_profiles (
                    id, novel_id, name, source_type, is_active, updated_at
                 ) VALUES
                    ('global-style-specialized', NULL, '快节奏战斗风', 'system_default', 1,
                     '2026-08-31T00:00:00Z'),
                    ('global-style-default', NULL, '默认小说风格', 'system_default', 1,
                     '2026-08-20T00:00:00Z'),
                    ('project-style-z', 'novel-1', '作品风格 Z', 'manual', 1,
                     '2026-08-30T00:00:00Z'),
                    ('project-style-a', 'novel-1', '作品风格 A', 'manual', 1,
                     '2026-08-30T00:00:00Z'),
                    ('foreign-style', 'novel-2', '其他作品风格', 'manual', 1,
                     '2026-09-01T00:00:00Z');
                 INSERT INTO output_profiles (
                    id, novel_id, name, is_default, updated_at
                 ) VALUES
                    ('global-output-z', NULL, '全局输出 Z', 1, '2026-08-30T00:00:00Z'),
                    ('global-output-a', NULL, '全局输出 A', 1, '2026-08-30T00:00:00Z'),
                    ('project-output-z', 'novel-1', '作品输出 Z', 1,
                     '2026-08-31T00:00:00Z'),
                    ('project-output-a', 'novel-1', '作品输出 A', 1,
                     '2026-08-31T00:00:00Z'),
                    ('foreign-output', 'novel-2', '其他作品输出', 1,
                     '2026-09-01T00:00:00Z');",
            )
            .expect("install generation profile fixtures");

        let project_result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("project generation profiles should be readable");
        assert_eq!(
            project_result["data"]["styleProfiles"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            project_result["data"]["styleProfiles"][0]["id"],
            "project-style-a"
        );
        assert_eq!(
            project_result["data"]["outputProfiles"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            project_result["data"]["outputProfiles"][0]["id"],
            "project-output-a"
        );
        assert_eq!(
            project_result["data"]["projectionLimits"]["styleProfiles"],
            1
        );

        connection
            .execute_batch(
                "UPDATE style_profiles SET is_active = 0 WHERE novel_id = 'novel-1';
                 UPDATE output_profiles SET is_default = 0 WHERE novel_id = 'novel-1';",
            )
            .expect("disable project generation profiles");
        let global_result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("global generation profiles should be used as fallback");
        assert_eq!(
            global_result["data"]["styleProfiles"][0]["id"],
            "global-style-default"
        );
        assert_eq!(
            global_result["data"]["outputProfiles"][0]["id"],
            "global-output-a"
        );

        connection
            .execute(
                "UPDATE style_profiles SET is_active = 0 WHERE id = 'global-style-default'",
                [],
            )
            .expect("disable built-in global default");
        let remaining_global_result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("remaining active global style should be used");
        assert_eq!(
            remaining_global_result["data"]["styleProfiles"][0]["id"],
            "global-style-specialized"
        );
    }

    #[test]
    fn read_context_orders_chapters_by_full_book_sequence() {
        let connection = fixture_connection();
        install_cross_volume_context_fixture(&connection);

        let result = call_tool(
            &connection,
            "get_metadata",
            &json!({"novelId": "novel-1", "chapterId": "chapter-5"}),
        )
        .expect("cross-volume structure should be readable");
        let chapter_ids: Vec<&str> = result["data"]["chapters"]
            .as_array()
            .expect("chapter structure")
            .iter()
            .filter_map(|chapter| chapter["id"].as_str())
            .collect();

        assert_eq!(
            chapter_ids,
            vec![
                "chapter-1",
                "chapter-2",
                "chapter-3",
                "chapter-4",
                "chapter-5"
            ]
        );
        assert_eq!(result["data"]["targetChapter"]["position"]["orderIndex"], 5);
    }

    #[test]
    fn previous_summaries_include_prior_volumes_without_leaking_target_or_future() {
        let connection = fixture_connection();
        install_cross_volume_context_fixture(&connection);

        let result = call_tool(
            &connection,
            "chapter.read_outline",
            &json!({"novelId": "novel-1", "chapterId": "chapter-3"}),
        )
        .expect("cross-volume chapter context should be readable");
        let previous_ids: Vec<&str> = result["data"]["previousChapterSummaries"]
            .as_array()
            .expect("previous summaries")
            .iter()
            .filter_map(|summary| summary["chapterId"].as_str())
            .collect();

        assert_eq!(previous_ids, vec!["chapter-2", "chapter-1"]);
        assert!(previous_ids
            .iter()
            .all(|chapter_id| !matches!(*chapter_id, "chapter-3" | "chapter-4" | "chapter-5")));
    }

    #[test]
    fn character_states_include_only_strictly_prior_cross_volume_facts() {
        let connection = fixture_connection();
        install_cross_volume_context_fixture(&connection);

        let result = call_tool(
            &connection,
            "get_character_states",
            &json!({"novelId": "novel-1", "chapterId": "chapter-3"}),
        )
        .expect("cross-volume character state history should be readable");
        let state_chapter_ids: Vec<&str> = result["data"]["stateTrack"]
            .as_array()
            .expect("state track")
            .iter()
            .filter_map(|state| state["chapterId"].as_str())
            .collect();

        assert_eq!(state_chapter_ids, vec!["chapter-2", "chapter-1"]);
        assert_eq!(result["revisions"]["novel"], "2026-08-21T00:00:00Z");
        assert_eq!(result["revisions"]["protagonists"], "2026-08-21T00:00:00Z");
        assert!(state_chapter_ids
            .iter()
            .all(|chapter_id| !matches!(*chapter_id, "chapter-3" | "chapter-4" | "chapter-5")));
        assert_eq!(
            result["data"]["characters"][0]["currentState"],
            "第二章后状态"
        );
        assert_eq!(
            result["data"]["characters"][0]["currentStateChapterId"],
            "chapter-2"
        );
        assert_eq!(
            result["data"]["protagonists"][0]["currentState"],
            "第二章后状态"
        );
        assert_eq!(
            result["data"]["protagonists"][0]["currentStateChapterId"],
            "chapter-2"
        );

        let first_chapter = call_tool(
            &connection,
            "get_character_states",
            &json!({"novelId": "novel-1", "chapterId": "chapter-1"}),
        )
        .expect("first chapter state boundary should be readable");
        assert!(first_chapter["data"]["stateTrack"]
            .as_array()
            .expect("first chapter state track")
            .is_empty());
        assert_eq!(first_chapter["data"]["characters"][0]["currentState"], "");
        assert_eq!(
            first_chapter["data"]["characters"][0]["currentStateChapterId"],
            Value::Null
        );
        assert_eq!(first_chapter["data"]["protagonists"][0]["currentState"], "");
    }

    #[test]
    fn protagonist_projection_merges_sources_by_precedence_without_losing_richer_fields() {
        let connection = fixture_connection();
        connection
            .execute_batch(
                "DELETE FROM protagonists;
                 UPDATE novels
                    SET main_character='沈砚', protagonist_ability='fallback-ability'
                  WHERE id='novel-1';",
            )
            .expect("prepare protagonist precedence fixture");
        connection
            .execute(
                "UPDATE novels SET protagonists_json=?1 WHERE id='novel-1'",
                params![r#"[{"id":"json-hero","label":"primary","name":"沈砚","identity":"JSON身份","personality":"JSON性格","motivation":"JSON动机","specialAbility":"JSON特殊能力"}]"#],
            )
            .expect("write JSON protagonist fixture");
        connection
            .execute(
                "INSERT INTO protagonists (
                    id, novel_id, name, identity, personality, goal, special_ability,
                    ability_limits, forbidden_behaviors, current_state
                 ) VALUES ('legacy-same', 'novel-1', '沈砚', 'legacy身份', 'legacy性格',
                           'legacy目标', 'legacy能力', 'legacy限制', 'legacy禁止', 'legacy状态')",
                [],
            )
            .expect("write legacy protagonist fixture");

        let result = call_tool(
            &connection,
            "get_character_states",
            &json!({"novelId": "novel-1", "chapterId": "chapter-1"}),
        )
        .expect("character state projection should be readable");
        let protagonists = result["data"]["protagonists"]
            .as_array()
            .expect("projected protagonists");
        assert_eq!(result["data"]["protagonistSource"], "characters");
        assert_eq!(protagonists.len(), 1);
        assert_eq!(protagonists[0]["id"], "character-1");
        assert_eq!(protagonists[0]["identity"], "调查员");
        assert_eq!(protagonists[0]["personality"], "冷静");
        assert_eq!(protagonists[0]["motivation"], "JSON动机");
        assert_eq!(protagonists[0]["specialAbility"], "听见回响");
        assert_eq!(protagonists[0]["abilityLimits"], "legacy限制");
        assert_eq!(protagonists[0]["forbiddenBehaviors"], "不得伤害无辜者");
        assert_eq!(protagonists[0]["ability"], "听见回响");
    }

    #[test]
    fn read_context_falls_back_to_main_character_only() {
        let connection = fixture_connection();
        connection
            .execute_batch(
                "DELETE FROM characters;
                 DELETE FROM protagonists;
                 UPDATE novels
                    SET protagonists_json='[]', main_character='遗档主角',
                        protagonist_ability='读取残响'
                  WHERE id='novel-1';",
            )
            .expect("prepare main-character-only fixture");

        let result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("main-character fallback should be readable");
        assert_eq!(result["data"]["protagonistSource"], "novels.main_character");
        assert_eq!(result["data"]["protagonists"][0]["name"], "遗档主角");
        assert_eq!(result["data"]["protagonists"][0]["ability"], "读取残响");
        assert_eq!(
            result["data"]["protagonists"][0]["specialAbility"],
            "读取残响"
        );
    }

    #[test]
    fn read_context_does_not_append_a_stale_main_character_to_formal_protagonists() {
        let connection = fixture_connection();
        connection
            .execute_batch(
                "DELETE FROM protagonists;
                 UPDATE novels
                    SET protagonists_json='[]', main_character='已废弃主角',
                        protagonist_ability='旧能力'
                  WHERE id='novel-1';",
            )
            .expect("prepare stale main-character fixture");

        let result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("formal protagonist should remain authoritative");
        let protagonists = result["data"]["protagonists"]
            .as_array()
            .expect("projected protagonists");
        assert_eq!(protagonists.len(), 1);
        assert_eq!(protagonists[0]["name"], "沈砚");
    }

    #[test]
    fn read_context_projects_character_only_protagonist() {
        let connection = fixture_connection();
        connection
            .execute_batch(
                "DELETE FROM protagonists;
                 UPDATE novels
                    SET protagonists_json='[]', main_character='', protagonist_ability=''
                  WHERE id='novel-1';",
            )
            .expect("prepare character-only fixture");

        let result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("character-only protagonist should be readable");
        assert_eq!(result["data"]["protagonistSource"], "characters");
        assert_eq!(result["data"]["protagonists"][0]["name"], "沈砚");
        assert_eq!(result["data"]["protagonists"][0]["identity"], "调查员");
        assert_eq!(
            result["data"]["protagonists"][0]["specialAbility"],
            "听见回响"
        );
        assert_eq!(
            result["data"]["protagonists"][0]["behaviorLimits"],
            "不得无故冒险"
        );
    }

    #[test]
    fn read_context_assigns_one_primary_label_to_unkeyed_character_protagonists() {
        let connection = fixture_connection();
        connection
            .execute_batch(
                "DELETE FROM characters;
                 DELETE FROM protagonists;
                 UPDATE novels
                    SET protagonists_json='[]', main_character='', protagonist_ability=''
                  WHERE id='novel-1';
                 INSERT INTO characters (
                    id, novel_id, name, role_type, is_protagonist, protagonist_key,
                    protagonist_label, protagonist_order, is_active, updated_at
                 ) VALUES
                    ('character-a', 'novel-1', 'Alpha', 'protagonist', 1, NULL, NULL, 0, 1,
                     '2026-08-22T00:00:00Z'),
                    ('character-b', 'novel-1', 'Beta', 'protagonist', 1, NULL, NULL, 0, 1,
                     '2026-08-22T00:00:00Z');",
            )
            .expect("prepare unkeyed dual-character fixture");

        let result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("unkeyed protagonists should be normalized");
        let protagonists = result["data"]["protagonists"]
            .as_array()
            .expect("projected protagonists");
        assert_eq!(protagonists.len(), 2);
        assert_eq!(protagonists[0]["label"], "primary");
        assert_eq!(protagonists[1]["label"], "secondary");
    }

    #[test]
    fn read_context_projects_dual_protagonist_mode_and_relation() {
        let connection = fixture_connection();
        connection
            .execute_batch("DELETE FROM characters; DELETE FROM protagonists;")
            .expect("remove alternate protagonist sources");
        connection
            .execute(
                "UPDATE novels
                    SET protagonist_mode='dual', protagonists_json=?1,
                        dual_protagonist_relation_json=?2,
                        main_character='', protagonist_ability=''
                  WHERE id='novel-1'",
                params![
                    r#"[{"id":"hero-a","label":"primary","name":"林默","specialAbility":"读取残响"},{"id":"hero-b","label":"secondary","name":"周岚"}]"#,
                    r#"{"type":"rival","description":"互相怀疑但必须合作","conflict":"争夺唯一证据","cooperation":"共同破解雾钟","emotionalProgression":"从对抗到信任","narrativeWeight":"balanced"}"#
                ],
            )
            .expect("write dual-protagonist fixture");

        let result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("dual-protagonist context should be readable");
        assert_eq!(result["data"]["novel"]["protagonistMode"], "dual");
        assert_eq!(
            result["data"]["novel"]["dualProtagonistRelation"]["type"],
            "rival"
        );
        assert_eq!(
            result["data"]["novel"]["dualProtagonistRelation"]["emotionalProgression"],
            "从对抗到信任"
        );
        assert_eq!(result["data"]["protagonists"][0]["name"], "林默");
        assert_eq!(result["data"]["protagonists"][0]["ability"], "读取残响");
        assert_eq!(result["data"]["protagonists"][1]["name"], "周岚");
    }

    #[test]
    fn read_context_projects_rich_legacy_protagonist_fields() {
        let connection = fixture_connection();
        connection
            .execute_batch(
                "DELETE FROM characters;
                 UPDATE novels
                    SET protagonists_json='[]', main_character='', protagonist_ability=''
                  WHERE id='novel-1';",
            )
            .expect("prepare rich legacy fixture");

        let result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("rich legacy protagonist should be readable");
        assert_eq!(result["data"]["protagonistSource"], "legacy.protagonists");
        assert_eq!(result["data"]["protagonists"][0]["name"], "旧主角");
        assert_eq!(result["data"]["protagonists"][0]["identity"], "旧身份");
        assert_eq!(result["data"]["protagonists"][0]["personality"], "犹疑");
        assert_eq!(result["data"]["protagonists"][0]["ability"], "旧能力");
        assert_eq!(result["data"]["protagonists"][0]["abilityLimits"], "旧限制");
        assert_eq!(
            result["data"]["protagonists"][0]["forbiddenBehaviors"],
            "不得背叛"
        );
    }

    #[test]
    fn read_context_uses_latest_active_world_as_primary_with_stable_ordering() {
        let connection = fixture_connection();
        connection
            .execute_batch(
                "DELETE FROM world_settings;
                 INSERT INTO world_settings (
                    id, novel_id, title, content, structured_json, is_active,
                    created_at, updated_at
                 ) VALUES
                    ('world-blank', 'novel-1', '空白占位', '
	　', '{}', 1,
                     '2026-07-01T00:00:00Z', '2026-08-29T00:00:00Z'),
                    ('world-inactive', 'novel-1', '停用旧设定', '不应进入上下文', '{}', 0,
                     '2026-07-02T00:00:00Z', '2026-08-29T00:00:00Z'),
                    ('world-a', 'novel-1', '同刻先序', '同刻第一条正式设定', '{}', 1,
                     '2026-08-02T00:00:00Z', '2026-08-29T00:00:00Z'),
                    ('world-b', 'novel-1', '同刻后序', '主世界正式设定', '{}', 1,
                     '2026-08-02T00:00:00Z', '2026-08-29T00:00:00Z'),
                    ('world-c', 'novel-1', '较早创建', '第三条正式设定', '{}', 1,
                     '2026-08-01T00:00:00Z', '2026-08-29T00:00:00Z'),
                    ('world-d', 'novel-1', '较早更新', '第四条正式设定', '{}', 1,
                     '2026-08-03T00:00:00Z', '2026-08-28T00:00:00Z');",
            )
            .expect("prepare multi-world fixture");

        let result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("ordered world settings should be readable");
        let worlds = result["data"]["worldSettings"]
            .as_array()
            .expect("world settings projection");
        let ids = worlds
            .iter()
            .filter_map(|world| world["id"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["world-b", "world-a", "world-c", "world-d"]);
        assert_eq!(worlds.len(), 4);
        assert_eq!(worlds[0]["role"], "primary");
        assert_eq!(worlds[0]["isActive"], true);
        assert_eq!(worlds[0]["novelId"], "novel-1");
        assert_eq!(worlds[1]["role"], "supplemental");
        assert_eq!(worlds[2]["role"], "supplemental");
        assert_eq!(worlds[3]["role"], "supplemental");
        assert_eq!(worlds[0]["content"], "主世界正式设定");
    }

    #[test]
    fn context_projection_enforces_item_and_field_budgets_without_chapter_bodies() {
        let connection = fixture_connection();
        let oversized = "界".repeat(CONTEXT_TEXT_CLIP + 500);
        for index in 0..(WORLD_SETTING_LIMIT + 4) {
            connection
                .execute(
                    "INSERT INTO world_settings (
                        id, novel_id, title, content, structured_json, is_active,
                        created_at, updated_at
                     ) VALUES (?1, 'novel-1', ?2, ?3, ?4, 1, ?5, ?5)",
                    params![
                        format!("world-budget-{index}"),
                        format!("世界{index}"),
                        oversized,
                        "规".repeat(CONTEXT_JSON_CLIP + 500),
                        format!("2026-08-22T00:{index:02}:00Z")
                    ],
                )
                .expect("insert budget fixture");
        }
        for index in 0..(CHAPTER_LIMIT + 3) {
            connection
                .execute(
                    "INSERT INTO chapters (
                        id, novel_id, volume_id, title, outline, goal, order_index,
                        status, word_count, target_word_count, updated_at
                     ) VALUES (?1, 'novel-1', 'volume-1', ?2, ?3, '', ?4,
                               'planned', 0, 3000, '2026-08-22T00:00:00Z')",
                    params![
                        format!("chapter-budget-{index}"),
                        format!("预算章节{index}"),
                        "不应进入结构列表的正文式大纲".repeat(200),
                        index as i64 + 2
                    ],
                )
                .expect("insert chapter budget fixture");
        }

        let result = call_tool(
            &connection,
            "novel.read_context",
            &json!({"novelId": "novel-1"}),
        )
        .expect("bounded context should be readable");
        let worlds = result["data"]["worldSettings"]
            .as_array()
            .expect("world settings array");
        assert_eq!(worlds.len(), WORLD_SETTING_LIMIT);
        assert!(worlds.iter().all(|world| {
            world["content"]
                .as_str()
                .is_some_and(|content| content.chars().count() <= CONTEXT_TEXT_CLIP + 20)
        }));
        assert!(result["data"]["chapters"]
            .as_array()
            .expect("chapter structure")
            .iter()
            .all(|chapter| chapter.get("content").is_none() && chapter.get("outline").is_none()));

        let tail_chapter_id = format!("chapter-budget-{}", CHAPTER_LIMIT + 2);
        let scoped = call_tool(
            &connection,
            "get_metadata",
            &json!({"novelId": "novel-1", "chapterId": tail_chapter_id}),
        )
        .expect("a target beyond the chapter list budget must remain addressable");
        assert_eq!(
            scoped["data"]["targetChapter"]["position"]["title"],
            format!("预算章节{}", CHAPTER_LIMIT + 2)
        );
        assert_eq!(
            scoped["data"]["chapters"]
                .as_array()
                .expect("bounded chapters")
                .len(),
            CHAPTER_LIMIT
        );
    }

    #[test]
    fn chapter_context_exposes_scoped_outline_roles_and_adopted_body() {
        let connection = fixture_connection();
        let body = "雾城的钟声响了三次。沈砚在门牌背后发现自己的名字。";
        adopt_inline_draft(&connection, body);

        let result = call_tool(
            &connection,
            "chapter.read_outline",
            &json!({"novelId": "novel-1", "chapterId": "chapter-1"}),
        )
        .expect("chapter context should be readable");

        assert_eq!(result["data"]["chapter"]["outline"], "字段大纲");
        assert_eq!(result["data"]["masterOutline"]["id"], "master-1");
        assert_eq!(result["data"]["volumeOutline"]["id"], "volume-outline-1");
        assert_eq!(result["data"]["outline"]["id"], "outline-1");
        assert_eq!(result["data"]["chapterRoles"][0]["characterName"], "沈砚");
        assert_eq!(result["data"]["currentAdoptedDraft"]["content"], body);
        assert_eq!(
            result["data"]["currentAdoptedDraft"]["contentHash"],
            sha256(body)
        );
        assert_eq!(result["data"]["currentAdoptedDraft"]["truncated"], false);
    }

    #[test]
    fn chapter_reads_reject_cross_novel_chapter_ids() {
        let connection = fixture_connection();
        connection
            .execute(
                "INSERT INTO novels (id, title, status, total_word_count, updated_at)
                 VALUES ('novel-2', '另一部小说', 'draft', 0, '2026-08-21T00:00:00Z')",
                [],
            )
            .expect("insert second novel");
        let error = call_tool(
            &connection,
            "chapter.read_outline",
            &json!({"novelId": "novel-2", "chapterId": "chapter-1"}),
        )
        .expect_err("chapter must be scoped to the requested novel");
        assert!(error.contains("chapter not found in novel"));

        let error = call_tool(
            &connection,
            "get_character_states",
            &json!({"novelId": "novel-2", "chapterId": "chapter-1"}),
        )
        .expect_err("character state order must be scoped to the requested novel");
        assert!(error.contains("chapter not found in novel"));
    }

    #[test]
    fn adopted_large_text_corruption_fails_closed() {
        let connection = fixture_connection();
        let content = "真实章节正文";
        let content_hash = sha256(content);
        connection
            .execute(
                "INSERT INTO large_text_documents VALUES (
                    'large-1', 'draft', 'draft-1', 'content', ?1, ?2, 1, ?3, 'ready'
                )",
                params![
                    content.chars().count() as i64,
                    content.len() as i64,
                    content_hash
                ],
            )
            .expect("insert large-text document");
        connection
            .execute(
                "INSERT INTO large_text_chunks VALUES ('large-1', 0, ?1, ?2, ?3, 'bad-hash')",
                params![
                    content,
                    content.chars().count() as i64,
                    content.len() as i64
                ],
            )
            .expect("insert corrupt chunk");
        connection
            .execute(
                "INSERT INTO chapter_drafts VALUES (
                    'draft-1', 'novel-1', 'chapter-1', '', 1, 1, 'large-1', ?1,
                    '2026-08-21T00:00:00Z'
                )",
                params![sha256(content)],
            )
            .expect("insert adopted draft");
        connection
            .execute(
                "UPDATE chapters SET adopted_draft_id = 'draft-1' WHERE id = 'chapter-1'",
                [],
            )
            .expect("adopt draft");

        let error = call_tool(
            &connection,
            "chapter.read_outline",
            &json!({"novelId": "novel-1", "chapterId": "chapter-1"}),
        )
        .expect_err("corrupt adopted body must not be exposed");
        assert!(error.contains("integrity check failed"));
    }

    #[test]
    fn quality_and_summary_require_current_adopted_body() {
        let connection = fixture_connection();
        let quality = json!({
            "novelId": "novel-1",
            "chapterId": "chapter-1",
            "candidateText": "{\"summary\":\"节奏稳定\"}"
        });
        let summary = json!({
            "novelId": "novel-1",
            "chapterId": "chapter-1",
            "candidateText": "{\"summary\":\"主角进入雾城并发现异常门牌。\"}"
        });
        let quality_error = call_tool(&connection, "check_quality", &quality)
            .expect_err("quality check requires adopted prose");
        assert_eq!(
            quality_error,
            "current adopted chapter body is required for quality_report"
        );
        let summary_error = call_tool(&connection, "summarize_chapter", &summary)
            .expect_err("summary requires adopted prose");
        assert_eq!(
            summary_error,
            "current adopted chapter body is required for chapter_summary"
        );

        adopt_inline_draft(&connection, "沈砚进入雾城，并在旧门牌后发现自己的名字。");
        assert_eq!(
            call_tool(&connection, "check_quality", &quality)
                .expect("quality candidate should validate")["artifactType"],
            "quality_report"
        );
        assert_eq!(
            call_tool(&connection, "summarize_chapter", &summary)
                .expect("summary candidate should validate")["artifactType"],
            "chapter_summary"
        );
    }
}
