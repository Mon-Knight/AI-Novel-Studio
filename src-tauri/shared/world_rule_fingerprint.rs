//! One canonical rule-set fingerprint for the desktop authority and read-only Gateway.
//! Input records use the persisted camelCase DTO fields documented by project sources.
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(Map::from_iter(
            map.iter()
                .map(|(key, value)| (key.clone(), canonical(value)))
                .collect::<BTreeMap<_, _>>(),
        )),
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        _ => value.clone(),
    }
}
fn text_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn hash(value: &Value) -> String {
    text_hash(&canonical(value).to_string())
}
fn optional_hash(value: &Value) -> Value {
    value
        .as_str()
        .map(|text| json!(text_hash(text)))
        .unwrap_or(Value::Null)
}

/// Records must include id, novelId, title, content, structuredJson, isActive,
/// createdAt, updatedAt; rule rows also category and forbiddenRules, including null.
/// No row is omitted just because it is currently inactive.
pub fn snapshot_from_records(
    novel_id: &str,
    world_settings: &[Value],
    rule_systems: &[Value],
) -> Value {
    let mut sources = Vec::new();
    for (kind, rows) in [
        ("world_setting", world_settings),
        ("rule_system", rule_systems),
    ] {
        for row in rows {
            sources.push(
                json!({"sourceType":kind,"sourceId":row["id"],"title":row["title"],
                "isActive":row["isActive"],"contentHash":optional_hash(&row["content"]),
                "forbiddenRulesHash":optional_hash(&row["forbiddenRules"]),
                "structuredJsonHash":optional_hash(&row["structuredJson"]),"recordHash":hash(row)}),
            );
        }
    }
    snapshot_from_sources(novel_id, sources)
}

pub fn snapshot_from_sources(novel_id: &str, mut sources: Vec<Value>) -> Value {
    sources.sort_by(|a, b| {
        (a["sourceType"].as_str(), a["sourceId"].as_str())
            .cmp(&(b["sourceType"].as_str(), b["sourceId"].as_str()))
    });
    let fingerprint =
        hash(&json!({"schema":"world-rule-set-v1","novelId":novel_id,"sources":sources}));
    json!({"novelId":novel_id,"fingerprint":fingerprint,"sources":sources})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fingerprint_covers_rules_and_is_order_independent() {
        let a = json!({"id":"a","novelId":"n","title":"law","content":"cost","forbiddenRules":"none","structuredJson":"{}","isActive":true,"createdAt":"t","updatedAt":"t","category":null});
        let mut b = a.clone();
        b["id"] = json!("b");
        assert_eq!(
            snapshot_from_records("n", &[], &[a.clone(), b.clone()]),
            snapshot_from_records("n", &[], &[b, a.clone()])
        );
        for key in [
            "content",
            "forbiddenRules",
            "structuredJson",
            "isActive",
            "id",
        ] {
            let mut changed = a.clone();
            changed[key] = json!("changed");
            assert_ne!(
                snapshot_from_records("n", &[], &[a.clone()])["fingerprint"],
                snapshot_from_records("n", &[], &[changed])["fingerprint"],
                "{key}"
            );
        }
    }
}
