//! Read-only attestation for the shared canonical Tool projection.
//!
//! This module deliberately does not register tools, modify the legacy DSH
//! allowlist, or dispatch a tool call.  It only embeds the reviewed cross-
//! language artifact and verifies that Rust interprets its identity, schemas,
//! hash and exposure gate exactly as TypeScript does.

use crate::errors::AppError;
use crate::services::ai_fact_security;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeSet;

const CONTRACT_VERSION: &str = "canonical_tool_manifest_v1";
const PROJECTION_VERSION: &str = "1";
const CANONICALIZATION: &str = "ans_canonical_json_v1";
const EXPECTED_MODEL_VISIBLE_TOOL_COUNT: usize = 0;
const MANIFEST_ERROR: &str = "CANONICAL_TOOL_MANIFEST_INVALID";
const MANIFEST_JSON: &str =
    include_str!("../../../../contracts/agent/canonical-tool-manifest.v1.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalToolManifest {
    contract_version: String,
    projection_version: String,
    canonicalization: String,
    projection_hash: String,
    model_visible_tool_identities: Vec<String>,
    tools: Vec<CanonicalToolDescriptor>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalToolDescriptor {
    id: String,
    name: String,
    version: String,
    description: String,
    input_schema: Value,
    output_schema: Value,
    scope: String,
    permissions: Vec<String>,
    side_effect: String,
    confirmation_policy: String,
    timeout_ms: u64,
    exposure: String,
    projection_state: String,
    health: String,
}

/// Safe identity-only proof that Rust accepted the shared manifest.
///
/// Keeping this projection free of descriptions and schemas prevents callers
/// from treating the attestation as a second Tool Registry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CanonicalManifestAttestation {
    pub contract_version: String,
    pub projection_version: String,
    pub canonicalization: String,
    pub projection_hash: String,
    pub tool_identities: Vec<String>,
    pub model_visible_tool_identities: Vec<String>,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(MANIFEST_ERROR, message, false)
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_segment(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some(character) if character.is_ascii_lowercase())
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn valid_canonical_id(value: &str) -> bool {
    let mut segments = value.split('.');
    matches!(
        (segments.next(), segments.next(), segments.next()),
        (Some(domain), Some(action), None) if valid_segment(domain) && valid_segment(action)
    )
}

fn validate_schema(schema: &Value, label: &str) -> Result<(), AppError> {
    let object = schema
        .as_object()
        .ok_or_else(|| invalid(format!("{label} 必须是 JSON Schema 对象")))?;
    if object.get("type").and_then(Value::as_str) != Some("object") {
        return Err(invalid(format!("{label}.type 必须是 object")));
    }
    let properties = object
        .get("properties")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid(format!("{label}.properties 必须是对象")))?;
    if object.get("additionalProperties").and_then(Value::as_bool) != Some(false) {
        return Err(invalid(format!(
            "{label}.additionalProperties 必须显式为 false"
        )));
    }
    if properties.values().any(|property| !property.is_object()) {
        return Err(invalid(format!("{label}.properties 中存在非对象定义")));
    }
    if let Some(required) = object.get("required") {
        let required = required
            .as_array()
            .ok_or_else(|| invalid(format!("{label}.required 必须是数组")))?;
        let mut seen = BTreeSet::new();
        for field in required {
            let field = field
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| invalid(format!("{label}.required 包含无效字段")))?;
            if !seen.insert(field) {
                return Err(invalid(format!("{label}.required 包含重复字段 {field}")));
            }
            if !properties.contains_key(field) {
                return Err(invalid(format!(
                    "{label}.required 字段 {field} 不在 properties 中"
                )));
            }
        }
    }
    Ok(())
}

fn validate_tool(tool: &CanonicalToolDescriptor) -> Result<(), AppError> {
    if !valid_canonical_id(&tool.id) || tool.name != tool.id {
        return Err(invalid(format!(
            "Canonical Tool id/name 无效或不一致: {}",
            tool.id
        )));
    }
    if tool.version != "1" {
        return Err(invalid(format!("Canonical Tool {} 版本无效", tool.id)));
    }
    if tool.description.trim().is_empty() || tool.description.chars().count() > 2_000 {
        return Err(invalid(format!("Canonical Tool {} 描述无效", tool.id)));
    }
    if !matches!(tool.scope.as_str(), "novel" | "chapter") {
        return Err(invalid(format!("Canonical Tool {} scope 无效", tool.id)));
    }
    if tool.permissions.is_empty() || tool.permissions.len() > 32 {
        return Err(invalid(format!(
            "Canonical Tool {} permissions 无效",
            tool.id
        )));
    }
    let mut permissions = BTreeSet::new();
    for permission in &tool.permissions {
        if !valid_canonical_id(permission) || !permissions.insert(permission) {
            return Err(invalid(format!(
                "Canonical Tool {} 包含无效或重复 permission",
                tool.id
            )));
        }
    }
    if !matches!(tool.side_effect.as_str(), "none" | "proposal" | "write") {
        return Err(invalid(format!(
            "Canonical Tool {} sideEffect 无效",
            tool.id
        )));
    }
    if !matches!(tool.confirmation_policy.as_str(), "never" | "user_required")
        || (tool.side_effect == "write" && tool.confirmation_policy != "user_required")
    {
        return Err(invalid(format!(
            "Canonical Tool {} confirmationPolicy 无效",
            tool.id
        )));
    }
    if !(100..=300_000).contains(&tool.timeout_ms) {
        return Err(invalid(format!(
            "Canonical Tool {} timeoutMs 无效",
            tool.id
        )));
    }
    if !matches!(
        tool.exposure.as_str(),
        "catalog_only" | "candidate" | "stable"
    ) {
        return Err(invalid(format!("Canonical Tool {} exposure 无效", tool.id)));
    }
    if !matches!(
        tool.projection_state.as_str(),
        "catalog_only" | "candidate" | "stable" | "blocked"
    ) {
        return Err(invalid(format!(
            "Canonical Tool {} projectionState 无效",
            tool.id
        )));
    }
    if !matches!(
        tool.health.as_str(),
        "working" | "partial" | "broken" | "legacy" | "unknown"
    ) {
        return Err(invalid(format!("Canonical Tool {} health 无效", tool.id)));
    }
    validate_schema(&tool.input_schema, &format!("{}.inputSchema", tool.id))?;
    validate_schema(&tool.output_schema, &format!("{}.outputSchema", tool.id))?;
    Ok(())
}

fn attest_manifest(raw: &str) -> Result<CanonicalManifestAttestation, AppError> {
    let raw_value: Value =
        serde_json::from_str(raw).map_err(|_| invalid("Canonical Tool manifest 不是合法 JSON"))?;
    let manifest: CanonicalToolManifest = serde_json::from_value(raw_value.clone())
        .map_err(|error| invalid(format!("Canonical Tool manifest schema 无效: {error}")))?;

    if manifest.contract_version != CONTRACT_VERSION
        || manifest.projection_version != PROJECTION_VERSION
        || manifest.canonicalization != CANONICALIZATION
    {
        return Err(invalid("Canonical Tool manifest 身份无效"));
    }
    if !valid_sha256(&manifest.projection_hash) {
        return Err(invalid("Canonical Tool manifest projectionHash 无效"));
    }

    let mut hash_input = raw_value;
    let hash_object = hash_input
        .as_object_mut()
        .ok_or_else(|| invalid("Canonical Tool manifest 顶层必须是对象"))?;
    let embedded_hash = hash_object
        .remove("projectionHash")
        .and_then(|value| value.as_str().map(str::to_string))
        .ok_or_else(|| invalid("Canonical Tool manifest 缺少 projectionHash"))?;
    if embedded_hash != manifest.projection_hash {
        return Err(invalid("Canonical Tool manifest projectionHash 读取不一致"));
    }
    let computed_hash = ai_fact_security::canonical_hash(&hash_input)
        .map_err(|_| invalid("Canonical Tool manifest 无法计算 canonical hash"))?;
    if computed_hash != manifest.projection_hash {
        return Err(invalid("Canonical Tool manifest projectionHash 校验失败"));
    }

    if manifest.tools.is_empty() || manifest.tools.len() > 128 {
        return Err(invalid("Canonical Tool manifest tools 数量无效"));
    }
    let mut tool_identities = Vec::with_capacity(manifest.tools.len());
    let mut previous_id: Option<&str> = None;
    for tool in &manifest.tools {
        validate_tool(tool)?;
        if let Some(previous) = previous_id {
            if previous >= tool.id.as_str() {
                return Err(invalid(
                    "Canonical Tool manifest tools 必须按唯一 id 升序排列",
                ));
            }
        }
        previous_id = Some(tool.id.as_str());
        tool_identities.push(format!("{}@{}", tool.id, tool.version));
    }

    let derived_visible = manifest
        .tools
        .iter()
        .filter(|tool| {
            tool.exposure == "stable"
                && tool.projection_state == "stable"
                && tool.health == "working"
                && tool.side_effect == "none"
                && tool.confirmation_policy == "never"
        })
        .map(|tool| format!("{}@{}", tool.id, tool.version))
        .collect::<Vec<_>>();
    if manifest
        .model_visible_tool_identities
        .windows(2)
        .any(|pair| pair[0] >= pair[1])
    {
        return Err(invalid(
            "modelVisibleToolIdentities 必须按唯一 identity 升序排列",
        ));
    }
    if manifest.model_visible_tool_identities != derived_visible {
        return Err(invalid(
            "modelVisibleToolIdentities 与 stable/stable/working 只读 gate 不一致",
        ));
    }
    if manifest.model_visible_tool_identities.len() != EXPECTED_MODEL_VISIBLE_TOOL_COUNT {
        return Err(invalid("本阶段 Canonical Tool 模型可见数量必须保持为 0"));
    }

    Ok(CanonicalManifestAttestation {
        contract_version: manifest.contract_version,
        projection_version: manifest.projection_version,
        canonicalization: manifest.canonicalization,
        projection_hash: manifest.projection_hash,
        tool_identities,
        model_visible_tool_identities: manifest.model_visible_tool_identities,
    })
}

/// Verifies and returns the identity-only attestation embedded in the Rust
/// binary.  This is intentionally not exposed as a Tauri command or DSH
/// protocol method.
pub(crate) fn canonical_manifest_attestation() -> Result<CanonicalManifestAttestation, AppError> {
    attest_manifest(MANIFEST_JSON)
}

#[cfg(test)]
mod tests {
    use super::super::task_runtime::ALLOWED_TOOLS;
    use super::*;

    fn rehash(value: &mut Value) {
        let hash_input = {
            let object = value.as_object_mut().expect("manifest object");
            object.remove("projectionHash");
            value.clone()
        };
        let hash = ai_fact_security::canonical_hash(&hash_input).expect("canonical hash");
        value
            .as_object_mut()
            .expect("manifest object")
            .insert("projectionHash".to_string(), Value::String(hash));
    }

    #[test]
    fn embedded_manifest_has_valid_hash_schema_and_zero_canonical_model_tools() {
        let attestation = canonical_manifest_attestation().expect("valid canonical manifest");
        assert_eq!(attestation.contract_version, CONTRACT_VERSION);
        assert_eq!(attestation.projection_version, PROJECTION_VERSION);
        assert_eq!(attestation.canonicalization, CANONICALIZATION);
        assert!(valid_sha256(&attestation.projection_hash));
        assert_eq!(attestation.tool_identities.len(), 4);
        assert!(attestation.model_visible_tool_identities.is_empty());
    }

    #[test]
    fn canonical_candidates_are_disjoint_from_the_legacy_dsh_allowlist() {
        let attestation = canonical_manifest_attestation().expect("valid canonical manifest");
        let legacy = ALLOWED_TOOLS.split(',').collect::<BTreeSet<_>>();
        for identity in attestation.tool_identities {
            let name = identity.split('@').next().expect("canonical name");
            assert!(
                !legacy.contains(name),
                "canonical candidate leaked into legacy DSH allowlist: {name}"
            );
        }
    }

    #[test]
    fn strict_schema_and_hash_tampering_fail_closed() {
        let mut hash_tampered: Value = serde_json::from_str(MANIFEST_JSON).expect("manifest JSON");
        hash_tampered["tools"][0]["description"] = Value::String("tampered".to_string());
        let hash_error = attest_manifest(&hash_tampered.to_string()).expect_err("hash drift");
        assert!(hash_error.message.contains("projectionHash"));

        let mut unknown_field: Value = serde_json::from_str(MANIFEST_JSON).expect("manifest JSON");
        unknown_field["tools"][0]["legacyAlias"] = Value::String("forbidden".to_string());
        rehash(&mut unknown_field);
        let schema_error =
            attest_manifest(&unknown_field.to_string()).expect_err("strict descriptor schema");
        assert!(schema_error.message.contains("schema"));

        let mut unknown_top_level: Value =
            serde_json::from_str(MANIFEST_JSON).expect("manifest JSON");
        unknown_top_level["agentTools"] = Value::Array(Vec::new());
        rehash(&mut unknown_top_level);
        let top_level_error =
            attest_manifest(&unknown_top_level.to_string()).expect_err("strict top-level schema");
        assert!(top_level_error.message.contains("schema"));
    }

    #[test]
    fn explicit_model_visibility_must_equal_the_derived_gate_and_remain_empty() {
        let mut value: Value = serde_json::from_str(MANIFEST_JSON).expect("manifest JSON");
        value["modelVisibleToolIdentities"] = serde_json::json!(["context.read@1"]);
        rehash(&mut value);
        let error = attest_manifest(&value.to_string()).expect_err("visibility mismatch");
        assert!(error.message.contains("modelVisibleToolIdentities"));
    }
}
