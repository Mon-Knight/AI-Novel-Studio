use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactProcessingStatus {
    Raw,
    Parsing,
    Valid,
    ValidWithWarnings,
    Invalid,
}

impl ArtifactProcessingStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Raw => "raw",
            Self::Parsing => "parsing",
            Self::Valid => "valid",
            Self::ValidWithWarnings => "valid_with_warnings",
            Self::Invalid => "invalid",
        }
    }
}

pub fn is_supported_artifact_type(value: &str) -> bool {
    matches!(
        value,
        "generic_text"
            | "generic_json"
            | "chapter_text"
            | "scene_text"
            | "quality_report"
            | "character_candidates"
            | "event_candidates"
            | "setting_candidates"
            | "style_analysis"
            | "chapter_summary"
            | "volume_summary"
            | "outline"
            | "tool_result"
            | "plan"
    )
}

pub fn is_supported_artifact_contract(value: &str, schema_version: i64) -> bool {
    schema_version == 1 && is_supported_artifact_type(value)
}

pub fn requires_json(value: &str) -> bool {
    matches!(
        value,
        "generic_json"
            | "quality_report"
            | "character_candidates"
            | "event_candidates"
            | "setting_candidates"
            | "style_analysis"
            | "chapter_summary"
            | "volume_summary"
            | "outline"
            | "tool_result"
            | "plan"
    )
}
