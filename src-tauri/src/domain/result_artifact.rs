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
