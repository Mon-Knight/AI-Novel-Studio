use crate::errors::{codes, AppError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiTaskStatus {
    Created,
    PreparingContext,
    Ready,
    Queued,
    Running,
    Validating,
    Completed,
    Applying,
    Applied,
    Failed,
    CancelRequested,
    Cancelled,
}

impl AiTaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::PreparingContext => "preparing_context",
            Self::Ready => "ready",
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Validating => "validating",
            Self::Completed => "completed",
            Self::Applying => "applying",
            Self::Applied => "applied",
            Self::Failed => "failed",
            Self::CancelRequested => "cancel_requested",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "created" => Ok(Self::Created),
            "preparing_context" => Ok(Self::PreparingContext),
            "ready" => Ok(Self::Ready),
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "validating" => Ok(Self::Validating),
            "completed" => Ok(Self::Completed),
            "applying" => Ok(Self::Applying),
            "applied" => Ok(Self::Applied),
            "failed" => Ok(Self::Failed),
            "cancel_requested" => Ok(Self::CancelRequested),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(AppError::new(
                codes::AI_TASK_ILLEGAL_TRANSITION,
                "未知 AI Task 状态",
                false,
            )),
        }
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        use AiTaskStatus::*;
        matches!(
            (self, next),
            (Created, PreparingContext | Ready | Failed | Cancelled)
                | (PreparingContext, Ready | CancelRequested | Failed)
                | (Ready, Queued | Cancelled | Failed)
                | (Queued, Running | CancelRequested | Cancelled | Failed)
                | (Running, Validating | CancelRequested | Failed)
                | (Validating, Completed | CancelRequested | Failed)
                | (Completed, Applying)
                | (Applying, Applied | Completed | Failed)
                | (Failed, Queued)
                | (CancelRequested, Cancelled)
        )
    }

    pub fn validate_transition(self, next: Self) -> Result<(), AppError> {
        if !self.can_transition_to(next) {
            return Err(AppError::new(
                codes::AI_TASK_ILLEGAL_TRANSITION,
                "AI Task 状态转换不合法",
                false,
            )
            .with_details(serde_json::json!({
                "from": self.as_str(),
                "to": next.as_str(),
            })));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiAttemptStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    CancelRequested,
    Cancelled,
    LateResponseIgnored,
}

impl AiAttemptStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::CancelRequested => "cancel_requested",
            Self::Cancelled => "cancelled",
            Self::LateResponseIgnored => "late_response_ignored",
        }
    }
}

pub fn is_supported_scope(value: &str) -> bool {
    matches!(
        value,
        "system" | "novel" | "chapter" | "draft" | "selection"
    )
}

pub fn is_supported_task_type(value: &str) -> bool {
    matches!(
        value,
        "connection_test"
            | "chapter_generate"
            | "chapter_rewrite"
            | "chapter_polish"
            | "character_generate"
            | "event_suggest"
            | "setting_expand"
            | "outline_generate"
            | "volume_outline_generate"
            | "chapter_outline_generate"
            | "context_summarize"
            | "chapter_summary"
            | "volume_summary"
            | "style_analyze"
            | "quality_check"
            | "quality_fix"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task01_accepts_frozen_legal_edges() {
        assert!(AiTaskStatus::Ready
            .validate_transition(AiTaskStatus::Queued)
            .is_ok());
        assert!(AiTaskStatus::Running
            .validate_transition(AiTaskStatus::CancelRequested)
            .is_ok());
        assert!(AiTaskStatus::Validating
            .validate_transition(AiTaskStatus::Completed)
            .is_ok());
    }

    #[test]
    fn task02_rejects_illegal_edges() {
        let error = AiTaskStatus::Created
            .validate_transition(AiTaskStatus::Completed)
            .expect_err("created cannot complete directly");
        assert_eq!(error.code, codes::AI_TASK_ILLEGAL_TRANSITION);
    }
}
