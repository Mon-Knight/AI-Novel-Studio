//! Project deletion has to pass append-only guards without touching other novels.
//!
//! SQLite rolls `DROP TRIGGER` and `CREATE TRIGGER` back with the surrounding
//! transaction. Guards are restored before the caller commits; a later failure
//! therefore puts the original guards and rows back together.
use rusqlite::{params, Transaction};

const SUSPEND_DELETE_GUARDS: &str = "
PRAGMA defer_foreign_keys = ON;
DROP TRIGGER IF EXISTS trg_autonomous_run_checkpoints_append_only_delete;
DROP TRIGGER IF EXISTS trg_conversation_turns_append_only_delete;
DROP TRIGGER IF EXISTS trg_ai_tasks_no_delete;
DROP TRIGGER IF EXISTS trg_ai_task_attempts_no_delete;
DROP TRIGGER IF EXISTS trg_ai_input_snapshots_immutable_delete;
DROP TRIGGER IF EXISTS trg_ai_context_snapshots_immutable_delete;
DROP TRIGGER IF EXISTS trg_ai_constraint_snapshots_immutable_delete;
DROP TRIGGER IF EXISTS trg_result_artifacts_immutable_delete;
DROP TRIGGER IF EXISTS trg_artifact_validation_issues_append_only_delete;
DROP TRIGGER IF EXISTS trg_placement_proposals_no_delete;
DROP TRIGGER IF EXISTS trg_apply_plans_no_delete;
DROP TRIGGER IF EXISTS trg_artifact_target_links_no_delete;
DROP TRIGGER IF EXISTS trg_agent_plans_no_delete;
DROP TRIGGER IF EXISTS trg_agent_plan_steps_no_delete;
DROP TRIGGER IF EXISTS trg_agent_plan_dependencies_append_only_delete;
DROP TRIGGER IF EXISTS trg_agent_plan_attempts_no_delete;
DROP TRIGGER IF EXISTS trg_agent_execution_leases_no_delete;
DROP TRIGGER IF EXISTS trg_agent_plan_checkpoints_append_only_delete;
DROP TRIGGER IF EXISTS trg_content_transaction_targets_no_delete;
";

const RESUME_DELETE_GUARDS: &str = "
CREATE TRIGGER IF NOT EXISTS trg_conversation_turns_append_only_delete
BEFORE DELETE ON conversation_turns
BEGIN SELECT RAISE(ABORT, 'conversation turns are append only'); END;
CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_checkpoints_append_only_delete
BEFORE DELETE ON autonomous_run_checkpoints
BEGIN SELECT RAISE(ABORT, 'autonomous run checkpoint is append only'); END;
CREATE TRIGGER IF NOT EXISTS trg_ai_tasks_no_delete
BEFORE DELETE ON ai_tasks BEGIN SELECT RAISE(ABORT, 'durable task fact'); END;
CREATE TRIGGER IF NOT EXISTS trg_ai_task_attempts_no_delete
BEFORE DELETE ON ai_task_attempts BEGIN SELECT RAISE(ABORT, 'durable attempt fact'); END;
CREATE TRIGGER IF NOT EXISTS trg_ai_input_snapshots_immutable_delete
BEFORE DELETE ON ai_input_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
CREATE TRIGGER IF NOT EXISTS trg_ai_context_snapshots_immutable_delete
BEFORE DELETE ON ai_context_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
CREATE TRIGGER IF NOT EXISTS trg_ai_constraint_snapshots_immutable_delete
BEFORE DELETE ON ai_constraint_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
CREATE TRIGGER IF NOT EXISTS trg_result_artifacts_immutable_delete
BEFORE DELETE ON result_artifacts BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END;
CREATE TRIGGER IF NOT EXISTS trg_artifact_validation_issues_append_only_delete
BEFORE DELETE ON artifact_validation_issues BEGIN SELECT RAISE(ABORT, 'append-only issue'); END;
CREATE TRIGGER IF NOT EXISTS trg_placement_proposals_no_delete
BEFORE DELETE ON placement_proposals
BEGIN SELECT RAISE(ABORT, 'durable placement proposal'); END;
CREATE TRIGGER IF NOT EXISTS trg_apply_plans_no_delete
BEFORE DELETE ON apply_plans
BEGIN SELECT RAISE(ABORT, 'durable apply plan'); END;
CREATE TRIGGER IF NOT EXISTS trg_artifact_target_links_no_delete
BEFORE DELETE ON artifact_target_links
BEGIN SELECT RAISE(ABORT, 'durable artifact target link'); END;
CREATE TRIGGER IF NOT EXISTS trg_agent_plans_no_delete
BEFORE DELETE ON agent_plans
BEGIN SELECT RAISE(ABORT, 'durable agent plan'); END;
CREATE TRIGGER IF NOT EXISTS trg_agent_plan_steps_no_delete
BEFORE DELETE ON agent_plan_steps
BEGIN SELECT RAISE(ABORT, 'durable agent plan step'); END;
CREATE TRIGGER IF NOT EXISTS trg_agent_plan_dependencies_append_only_delete
BEFORE DELETE ON agent_plan_step_dependencies
BEGIN SELECT RAISE(ABORT, 'durable agent plan dependency'); END;
CREATE TRIGGER IF NOT EXISTS trg_agent_plan_attempts_no_delete
BEFORE DELETE ON agent_plan_step_attempts
BEGIN SELECT RAISE(ABORT, 'durable agent plan attempt'); END;
CREATE TRIGGER IF NOT EXISTS trg_agent_execution_leases_no_delete
BEFORE DELETE ON agent_execution_leases
BEGIN SELECT RAISE(ABORT, 'durable agent lease'); END;
CREATE TRIGGER IF NOT EXISTS trg_agent_plan_checkpoints_append_only_delete
BEFORE DELETE ON agent_plan_checkpoints
BEGIN SELECT RAISE(ABORT, 'durable agent checkpoint'); END;
CREATE TRIGGER IF NOT EXISTS trg_content_transaction_targets_no_delete
BEFORE DELETE ON content_transaction_targets
BEGIN SELECT RAISE(ABORT, 'content transaction target cannot be deleted'); END;
";

pub(super) fn suspend_delete_guards(tx: &Transaction<'_>) -> Result<(), String> {
    tx.execute_batch(SUSPEND_DELETE_GUARDS)
        .map_err(|error| format!("进入项目清理维护模式失败：{error}"))
}

pub(super) fn resume_delete_guards(tx: &Transaction<'_>) -> Result<(), String> {
    tx.execute_batch(RESUME_DELETE_GUARDS)
        .map_err(|error| format!("退出项目清理维护模式失败：{error}"))
}

pub(super) fn delete_guarded_project_facts(
    tx: &Transaction<'_>,
    novel_id: &str,
) -> Result<(), String> {
    reject_cross_work_target_links(tx, novel_id)?;
    // ON DELETE RESTRICT is immediate even while foreign keys are deferred.
    // Children of placement, agent plans and content transactions go first.
    for (sql, action) in [
        (
            "DELETE FROM agent_plan_checkpoints WHERE plan_id IN (SELECT plan_id FROM agent_plans WHERE novel_id=?1)",
            "清理 Agent 计划检查点",
        ),
        (
            "DELETE FROM agent_plan_step_attempts WHERE plan_id IN (SELECT plan_id FROM agent_plans WHERE novel_id=?1)",
            "清理 Agent 计划尝试",
        ),
        (
            "DELETE FROM agent_plan_step_dependencies WHERE plan_id IN (SELECT plan_id FROM agent_plans WHERE novel_id=?1)",
            "清理 Agent 计划依赖",
        ),
        (
            "DELETE FROM agent_execution_leases WHERE plan_id IN (SELECT plan_id FROM agent_plans WHERE novel_id=?1)",
            "清理 Agent 执行租约",
        ),
        (
            "DELETE FROM agent_plan_steps WHERE plan_id IN (SELECT plan_id FROM agent_plans WHERE novel_id=?1)",
            "清理 Agent 计划步骤",
        ),
        (
            "DELETE FROM agent_plans WHERE novel_id=?1",
            "清理 Agent 计划",
        ),
        (
            "DELETE FROM artifact_target_links WHERE proposal_id IN (SELECT proposal_id FROM placement_proposals WHERE target_novel_id=?1) AND target_id IN (SELECT id FROM world_settings WHERE novel_id=?1) AND artifact_id IN (SELECT artifact.artifact_id FROM result_artifacts AS artifact JOIN ai_tasks AS task ON task.task_id=artifact.task_id WHERE artifact.source_novel_id=?1 AND task.novel_id=?1)",
            "清理产物落位链接",
        ),
        (
            "DELETE FROM apply_plans WHERE proposal_id IN (SELECT proposal_id FROM placement_proposals WHERE target_novel_id=?1)",
            "清理落位应用计划",
        ),
        (
            "DELETE FROM placement_proposals WHERE target_novel_id=?1",
            "清理落位提案",
        ),
        (
            "DELETE FROM content_transaction_targets WHERE transaction_id IN (SELECT transaction_id FROM content_transactions WHERE novel_id=?1)",
            "清理内容事务目标",
        ),
        (
            "DELETE FROM content_transactions WHERE novel_id=?1",
            "清理内容事务",
        ),
        (
            "DELETE FROM setting_suggestions WHERE novel_id=?1",
            "清理设定建议",
        ),
        (
            "DELETE FROM dsh_preparation_runs WHERE novel_id=?1 OR chapter_id IN (SELECT id FROM chapters WHERE novel_id=?1)",
            "清理章节准备运行",
        ),
    ] {
        tx.execute(sql, params![novel_id])
            .map_err(|error| format!("{action}失败：{error}"))?;
    }
    Ok(())
}

fn reject_cross_work_target_links(tx: &Transaction<'_>, novel_id: &str) -> Result<(), String> {
    // A link is owned only when its proposal, world setting, source artifact and
    // task agree on this novel. The insert gate normally makes those equal; a
    // damaged row that touches this novel on only one side must stop the purge
    // instead of being removed from the other work.
    let mixed: i64 = tx
        .query_row(
            "SELECT COUNT(*)
             FROM artifact_target_links AS link
             LEFT JOIN placement_proposals AS proposal ON proposal.proposal_id = link.proposal_id
             LEFT JOIN world_settings AS setting ON setting.id = link.target_id
             LEFT JOIN result_artifacts AS artifact ON artifact.artifact_id = link.artifact_id
             LEFT JOIN ai_tasks AS task ON task.task_id = artifact.task_id
             WHERE (proposal.target_novel_id = ?1 OR setting.novel_id = ?1
                    OR artifact.source_novel_id = ?1 OR task.novel_id = ?1)
               AND NOT (proposal.target_novel_id = ?1 AND setting.novel_id = ?1
                        AND artifact.source_novel_id = ?1 AND task.novel_id = ?1)",
            params![novel_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("核对产物落位链接归属失败：{error}"))?;
    if mixed == 0 {
        Ok(())
    } else {
        Err("产物落位链接同时指向其他作品，已停止清理".to_string())
    }
}

#[cfg(test)]
#[path = "purge_tests.rs"]
mod tests;
