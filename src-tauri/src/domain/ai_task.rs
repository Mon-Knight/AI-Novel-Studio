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

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Applied | Self::Cancelled)
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        use AiTaskStatus::*;
        matches!(
            (self, next),
            (Created, PreparingContext | Cancelled | Failed)
                | (PreparingContext, Ready | CancelRequested | Failed)
                | (Ready, Queued | Cancelled | Failed)
                | (Queued, Running | Cancelled | Failed)
                | (Running, Validating | CancelRequested | Failed)
                | (Validating, Completed | CancelRequested | Failed)
                | (Completed, Applying)
                | (Applying, Applied | Completed)
                | (Failed, PreparingContext | Queued)
                | (CancelRequested, Cancelled)
        )
    }

    pub fn validate_transition(self, next: Self) -> Result<(), AppError> {
        if self.is_terminal() {
            return Err(AppError::new(
                codes::AI_TASK_TERMINAL_STATE,
                "AI Task 已进入终态",
                false,
            ));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task01_accepts_frozen_legal_edges() {
        assert!(AiTaskStatus::Created
            .validate_transition(AiTaskStatus::PreparingContext)
            .is_ok());
        assert!(AiTaskStatus::Running
            .validate_transition(AiTaskStatus::CancelRequested)
            .is_ok());
        assert!(AiTaskStatus::Validating
            .validate_transition(AiTaskStatus::Completed)
            .is_ok());
    }

    #[test]
    fn task02_rejects_illegal_and_terminal_edges() {
        let illegal = AiTaskStatus::Created
            .validate_transition(AiTaskStatus::Completed)
            .expect_err("created cannot complete directly");
        assert_eq!(illegal.code, codes::AI_TASK_ILLEGAL_TRANSITION);
        let terminal = AiTaskStatus::Cancelled
            .validate_transition(AiTaskStatus::Queued)
            .expect_err("cancelled is terminal");
        assert_eq!(terminal.code, codes::AI_TASK_TERMINAL_STATE);
    }
}
