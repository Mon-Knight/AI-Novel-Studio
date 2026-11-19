//! Explicit user application of immutable outline candidates. Never a model tool.
//! Domain generation can only publish candidates; this service owns native CAS,
//! IMMEDIATE transaction, append-only decisions and committed application receipts.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[path = "outline_candidate_apply_validation.rs"]
mod validation;
#[path = "outline_candidate_apply_write.rs"]
mod write;
#[cfg(test)]
#[path = "outline_candidate_apply_tests.rs"]
mod tests;

pub(crate) use validation::{capture_baseline, validate_request};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutlineRequest {
    pub kind: String,
    pub outline_type: String,
    pub format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_index: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_outline_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapter_goal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapter_count: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutlineSource {
    pub version: u32,
    pub novel_id: String,
    pub conversation_id: String,
    pub turn_id: String,
    pub run_id: String,
    pub card_id: String,
    pub artifact_id: String,
    pub artifact_hash: String,
    pub request: OutlineRequest,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveVersion {
    pub id: String,
    pub version: i64,
    pub content_hash: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Action {
    OutlineVersion {
        outline_type: String,
        target_id: Option<String>,
        parent_outline_id: Option<String>,
        target_index: Option<i64>,
        title: String,
        content: String,
        save_as_new_version: bool,
    },
    AdoptOutlineVersion {
        outline_type: String,
        target_id: Option<String>,
        outline_id: String,
        expected_version: i64,
        expected_content_hash: String,
        expected_active: Option<ActiveVersion>,
    },
    Volume { target_volume_id: Option<String>, candidate: Value },
    Chapter { target_volume_id: Option<String>, candidate_index: usize, candidate: Value },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyInput {
    pub source: OutlineSource,
    pub operation_id: String,
    pub action: Action,
}

fn hash(value: &Value) -> Result<String, String> {
    crate::services::ai_fact_security::canonical_hash(value).map_err(|error| error.to_string())
}
fn fail(code: &str, message: &str) -> String { format!("{code}: {message}") }

fn prior_receipts(connection: &Connection, source: &OutlineSource) -> Result<Vec<Value>, String> {
    let mut statement = connection.prepare("SELECT result_json FROM tool_call_events WHERE run_id=?1 AND tool_name='dsh.outline_application_receipt' AND status='succeeded' ORDER BY sequence")
        .map_err(|error| error.to_string())?;
    let rows = statement.query_map([&source.run_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|error| error.to_string())?;
    rows.into_iter().map(|raw| serde_json::from_str::<Value>(&raw).map_err(|_| fail("OUTLINE_RECEIPT_INVALID", "既有应用回执不可读")))
        .filter(|value| value.as_ref().map_or(true, |value| value["receipt"]["artifactId"] == source.artifact_id)).collect()
}

fn result_with_entity(connection: &Connection, stored: &Value) -> Result<Value, String> {
    let mut value = json!({"receipt":stored["receipt"],"decision":stored["decision"]});
    let receipt = &stored["receipt"];
    let entity = write::read_entity(connection, receipt["entityType"].as_str().ok_or("OUTLINE_RECEIPT_INVALID")?, receipt["entityId"].as_str().ok_or("OUTLINE_RECEIPT_INVALID")?)?;
    let key = match receipt["entityType"].as_str() { Some("volume") => "volume", Some("chapter") => "chapter", _ => "outline" };
    value[key] = entity;
    if let Some(volume) = stored.get("createdVolumeId").and_then(Value::as_str) {
        value["volume"] = write::read_entity(connection,"volume",volume)?;
    }
    Ok(value)
}

/// Execute exactly one explicit manual save/adopt/create. Replays never write twice.
pub fn apply_with(connection: &mut Connection, input: ApplyInput) -> Result<Value, String> {
    if input.operation_id.trim().is_empty() || input.operation_id.len() > 300 { return Err(fail("OUTLINE_OPERATION_INVALID", "缺少本次用户操作标识")); }
    let operation_hash = hash(&serde_json::to_value(&input).map_err(|error| error.to_string())?)?;
    let receipt_id = format!("outline-apply-{}", crate::repositories::large_text_repository::sha256(&format!("{}:{}", input.source.conversation_id, input.operation_id)));
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|error| error.to_string())?;
    let existing: Option<String> = transaction.query_row("SELECT result_json FROM tool_call_events WHERE event_id=?1 AND tool_name='dsh.outline_application_receipt' AND status='succeeded'", [&receipt_id], |row| row.get(0)).optional().map_err(|error| error.to_string())?;
    if let Some(raw) = existing {
        let stored: Value = serde_json::from_str(&raw).map_err(|_| fail("OUTLINE_RECEIPT_INVALID", "既有应用回执不可读"))?;
        if stored["operationHash"].as_str() != Some(&operation_hash) { return Err(fail("OUTLINE_OPERATION_CONFLICT", "同一用户操作已用于不同正文或范围")); }
        let output = result_with_entity(&transaction, &stored)?;
        transaction.commit().map_err(|error| error.to_string())?;
        return Ok(output);
    }
    let facts = validation::validate_source(&transaction, &input.source)?;
    let before = capture_baseline(&transaction, &input.source.novel_id)?;
    let receipts = prior_receipts(&transaction, &input.source)?;
    let adoption = matches!(input.action, Action::AdoptOutlineVersion { .. });
    // Saving uses the generation baseline or an exact owning receipt, never a
    // refreshed snapshot. Explicit adoption separately CASes the displayed active
    // version and the selected saved body; it is a new trusted human decision.
    let expected = receipts.last().and_then(|value| value["receipt"]["baselineAfter"].as_str()).unwrap_or(&facts.baseline_hash);
    if !adoption && before != expected { return Err(fail("OUTLINE_BASELINE_CONFLICT", "大纲、章节或来源已被其他操作修改；候选和编辑内容均保留，请重新核对目标")); }
    let saved = write::execute(&transaction, &input, &facts, &receipts, &receipt_id)?;
    let after = capture_baseline(&transaction, &input.source.novel_id)?;
    let decision_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let decision = json!({"decisionId":decision_id,"artifactId":input.source.artifact_id,"artifactHash":input.source.artifact_hash,"cardId":input.source.card_id,"conversationId":input.source.conversation_id,"decision":"request_apply","idempotencyKey":format!("{}:{}",input.source.card_id,input.operation_id),"actor":"user","targetType":saved.entity_type,"targetId":saved.entity_id,"baseRevision":before,"applyTransactionId":receipt_id,"createdAt":now});
    transaction.execute("INSERT INTO artifact_decisions(decision_id,artifact_id,artifact_hash,card_id,conversation_id,decision,idempotency_key,actor,target_type,target_id,base_revision,apply_transaction_id,created_at)VALUES(?1,?2,?3,?4,?5,'request_apply',?6,'user',?7,?8,?9,?10,?11)", params![decision_id,input.source.artifact_id,input.source.artifact_hash,input.source.card_id,input.source.conversation_id,decision["idempotencyKey"].as_str(),saved.entity_type,saved.entity_id,before,receipt_id,now]).map_err(|error|error.to_string())?;
    let receipt = json!({"receiptId":receipt_id,"operationId":input.operation_id,"artifactId":input.source.artifact_id,"artifactHash":input.source.artifact_hash,"baselineBefore":before,"baselineAfter":after,"appliedContentHash":saved.content_hash,"entityType":saved.entity_type,"entityId":saved.entity_id,"authority":"manual_confirmation"});
    let stored = json!({"receipt":receipt,"decision":decision,"operationHash":operation_hash,"candidateIndex":saved.candidate_index,"createdVolumeId":saved.created_volume_id});
    transaction.execute("INSERT INTO tool_call_events(event_id,run_id,sequence,tool_name,arguments_summary_json,status,result_json,created_at,finished_at)VALUES(?1,?2,(SELECT COALESCE(MAX(sequence),-1)+1 FROM tool_call_events WHERE run_id=?2),'dsh.outline_application_receipt',?3,'succeeded',?4,?5,?5)",params![receipt_id,input.source.run_id,json!({"source":"ans-native-host","authority":"manual_confirmation","artifactId":input.source.artifact_id,"operationId":input.operation_id,"formalWrites":1}).to_string(),stored.to_string(),now]).map_err(|error|error.to_string())?;
    crate::repositories::conversation_repository::reconcile_conversation_status(&transaction, &input.source.conversation_id, "completed", &now).map_err(|error| error.to_string())?;
    let output = result_with_entity(&transaction, &stored)?;
    transaction.commit().map_err(|error|error.to_string())?;
    Ok(output)
}

#[tauri::command]
pub fn apply_outline_candidate(input: ApplyInput) -> Result<Value, String> {
    let mut connection = crate::db::get_connection().lock().map_err(|_| "OUTLINE_DATABASE_UNAVAILABLE".to_string())?;
    apply_with(&mut connection, input)
}
