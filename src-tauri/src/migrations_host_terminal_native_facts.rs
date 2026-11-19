//! 043 allows append-only native control facts after their owning Run is terminal.
//! Ordinary tool events retain the original active-Run insert boundary.
use crate::errors::AppError;
use rusqlite::Transaction;

pub(crate) const MIGRATION_ID: &str = "043_host_terminal_native_facts";
pub(crate) const MIGRATION_DEFINITION: &str =
    "host_terminal_native_facts_v1(terminal_dsh_control_facts,ordinary_tool_scope_preserved)";

pub(crate) fn apply(tx: &Transaction<'_>) -> Result<(), AppError> {
    tx.execute_batch(
        "DROP TRIGGER IF EXISTS trg_tool_call_events_validate_insert;
         CREATE TRIGGER trg_tool_call_events_validate_insert
            BEFORE INSERT ON tool_call_events
            WHEN (
                    NEW.status NOT IN ('pending', 'queued', 'running')
                    AND NOT (NEW.tool_name LIKE 'dsh.%' AND NEW.status IN ('succeeded', 'failed', 'cancelled'))
                 )
              OR NEW.sequence < 0
              OR json_valid(NEW.arguments_summary_json) = 0
              OR json_type(NEW.arguments_summary_json) <> 'object'
              OR NOT EXISTS (
                  SELECT 1 FROM task_runs
                  WHERE run_id = NEW.run_id
                    AND (
                        status IN ('queued', 'running', 'cancel_requested')
                        OR (NEW.tool_name LIKE 'dsh.%' AND status IN ('completed', 'failed', 'cancelled'))
                    )
              )
            BEGIN SELECT RAISE(ABORT, 'invalid tool call event'); END;",
    )
    .map_err(AppError::database)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn terminal_native_control_facts_are_append_only_but_ordinary_tools_stay_active_only() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::create_tables(&mut connection).unwrap();
        connection
            .execute_batch(
                "INSERT INTO novels(id,title,outline,created_at,updated_at)
                 VALUES('novel-native-facts','作品','','2026-11-13T00:00:00Z','2026-11-13T00:00:00Z');
                 INSERT INTO task_conversations(conversation_id,novel_id,title,status,created_at,updated_at)
                 VALUES('conversation-native-facts','novel-native-facts','任务','idle','2026-11-13T00:00:00Z','2026-11-13T00:00:00Z');
                 INSERT INTO conversation_turns(turn_id,conversation_id,sequence,role,content,created_at)
                 VALUES('turn-native-facts','conversation-native-facts',0,'user','生成','2026-11-13T00:00:00Z');
                 INSERT INTO task_runs(run_id,conversation_id,turn_id,status,model_snapshot_json,worker_id,created_at,updated_at)
                 VALUES('run-native-facts','conversation-native-facts','turn-native-facts','queued','{}','worker','2026-11-13T00:00:00Z','2026-11-13T00:00:00Z');
                 UPDATE task_runs SET status='running',started_at='2026-11-13T00:00:01Z',updated_at='2026-11-13T00:00:01Z' WHERE run_id='run-native-facts';
                 UPDATE task_runs SET status='completed',finished_at='2026-11-13T00:00:02Z',updated_at='2026-11-13T00:00:02Z' WHERE run_id='run-native-facts';",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO tool_call_events(event_id,run_id,sequence,tool_name,arguments_summary_json,status,created_at)
                 VALUES('native-fact-after-run','run-native-facts',0,'dsh.candidate_admission','{}','succeeded','2026-11-13T00:00:03Z')",
                [],
            )
            .unwrap();
        assert!(connection
            .execute(
                "INSERT INTO tool_call_events(event_id,run_id,sequence,tool_name,arguments_summary_json,status,created_at)
                 VALUES('ordinary-after-run','run-native-facts',1,'novel.read_context','{}','succeeded','2026-11-13T00:00:03Z')",
                [],
            )
            .is_err());
    }
}
