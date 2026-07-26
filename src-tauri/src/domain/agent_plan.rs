use serde::{Deserialize, Serialize};

pub const AGENT_PLAN_CONTRACT_VERSION: &str = "agent_plan_v1";
pub const CHAPTER_READINESS_PLANNER_ID: &str = "chapter_readiness_plan_v1";
pub const CHAPTER_READINESS_PLANNER_VERSION: i64 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentPlanStatus {
    Ready,
    Running,
    WaitingRetry,
    Completed,
    Failed,
    Cancelled,
}

impl AgentPlanStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Running => "running",
            Self::WaitingRetry => "waiting_retry",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentPlanStepStatus {
    Pending,
    Running,
    WaitingRetry,
    Completed,
    Failed,
    Cancelled,
}

impl AgentPlanStepStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::WaitingRetry => "waiting_retry",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}
