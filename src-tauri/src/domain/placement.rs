use crate::errors::{codes, AppError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyPlanStatus {
    AwaitingConfirmation,
    Applying,
    Applied,
    Conflict,
}

impl ApplyPlanStatus {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "awaiting_confirmation" => Ok(Self::AwaitingConfirmation),
            "applying" => Ok(Self::Applying),
            "applied" => Ok(Self::Applied),
            "conflict" => Ok(Self::Conflict),
            _ => Err(AppError::new(
                codes::PLACEMENT_PLAN_INVALID,
                "ApplyPlan 状态无效",
                false,
            )),
        }
    }

    pub fn validate_transition(self, next: Self) -> Result<(), AppError> {
        let legal = matches!(
            (self, next),
            (Self::AwaitingConfirmation, Self::Applying)
                | (Self::Applying, Self::Applied)
                | (Self::Applying, Self::Conflict)
        );
        if legal {
            Ok(())
        } else {
            Err(AppError::new(
                codes::PLACEMENT_PLAN_INVALID,
                "ApplyPlan 状态转换无效",
                false,
            ))
        }
    }
}

pub fn validate_supported_placement(
    proposal_type: &str,
    target_type: &str,
) -> Result<(), AppError> {
    if proposal_type == "create_world_setting" && target_type == "world_setting" {
        Ok(())
    } else {
        Err(AppError::new(
            codes::PLACEMENT_NOT_SUPPORTED,
            "当前版本只支持把单个设定候选安全创建为世界设定",
            false,
        ))
    }
}
