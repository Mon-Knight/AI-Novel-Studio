//! 作品来源（Source Novel）校验。
//!
//! 设定候选只能应用到 Artifact 明确归属的非 `system` 作品；来源作品还必须存在且未删除。
//! 本模块由 `placement_service` 通过 `#[path]` 引入，错误码、SQL 与事务边界保持原样。

use crate::errors::{codes, AppError};
use rusqlite::Connection;

/// 返回 Artifact 明确声明的作品 ID；缺少归属或归属 `system` 时失败关闭。
pub(super) fn required_source_novel_id(value: Option<&str>) -> Result<&str, AppError> {
    value
        .filter(|novel_id| *novel_id != "system")
        .ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_NOT_SUPPORTED,
                "Artifact 缺少明确作品归属或属于 system，不能应用设定候选",
                false,
            )
        })
}

/// 校验来源作品存在且未删除。调用方必须在 `Immediate` 事务内调用。
pub(super) fn ensure_source_novel_exists(
    connection: &Connection,
    novel_id: &str,
) -> Result<(), AppError> {
    let novel_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM novels WHERE id=?1 AND deleted_at IS NULL",
            [novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if novel_exists != 1 {
        return Err(AppError::new(
            codes::TARGET_NOVEL_NOT_FOUND,
            "Artifact 所属作品不存在",
            false,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placement00_source_novel_requires_explicit_non_system_id() {
        for value in [None, Some("system")] {
            assert_eq!(
                required_source_novel_id(value).unwrap_err().code,
                codes::PLACEMENT_NOT_SUPPORTED
            );
        }
        assert_eq!(
            required_source_novel_id(Some("novel-safe-0")).unwrap(),
            "novel-safe-0"
        );
    }
}
