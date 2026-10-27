use super::super::{
    artifact_from_row, authorization_from_row, decision_from_row, event_from_row, run_from_row,
    turn_from_row, ArtifactDecisionRecord, ConversationArtifactCardRecord, ConversationTurnRecord,
    ReviewAuthorizationRecord, TaskConversationBundle, TaskConversationRecord, TaskRunRecord,
    ToolCallEventRecord, TASK_RUN_COLUMNS,
};
use super::TaskConversationWindow;
use crate::errors::AppError;
use rusqlite::{params, Connection};

pub(super) fn empty_window(
    conversation: TaskConversationRecord,
    has_newer: bool,
) -> TaskConversationWindow {
    TaskConversationWindow {
        bundle: TaskConversationBundle {
            conversation,
            turns: Vec::new(),
            runs: Vec::new(),
            tool_events: Vec::new(),
            artifacts: Vec::new(),
            decisions: Vec::new(),
            authorizations: Vec::new(),
        },
        start_sequence: None,
        end_sequence_exclusive: None,
        oldest_user_sequence: None,
        newest_user_sequence: None,
        has_older: false,
        has_newer,
        user_round_count: 0,
    }
}

pub(super) fn load_window(
    connection: &Connection,
    conversation: TaskConversationRecord,
    start: i64,
    end: Option<i64>,
    oldest_user_sequence: Option<i64>,
    newest_user_sequence: Option<i64>,
    has_older: bool,
    has_newer: bool,
    user_round_count: i64,
) -> Result<TaskConversationWindow, AppError> {
    let conversation_id = conversation.conversation_id.clone();
    let created_at = conversation.created_at.clone();
    Ok(TaskConversationWindow {
        bundle: TaskConversationBundle {
            conversation,
            turns: load_turns(connection, &conversation_id, start, end)?,
            runs: load_runs(connection, &conversation_id, start, end)?,
            tool_events: load_events(connection, &conversation_id, start, end)?,
            artifacts: stamped_artifacts(
                connection,
                &conversation_id,
                &created_at,
                start,
                end,
            )?,
            decisions: load_decisions(connection, &conversation_id, start, end)?,
            authorizations: load_authorizations(connection, &conversation_id, start, end)?,
        },
        start_sequence: Some(start),
        end_sequence_exclusive: end,
        oldest_user_sequence,
        newest_user_sequence,
        has_older,
        has_newer,
        user_round_count,
    })
}

fn card_span_sql() -> &'static str {
    "AND (
       EXISTS (
         SELECT 1 FROM conversation_turns t
         WHERE t.turn_id=card.turn_id AND t.conversation_id=card.conversation_id
           AND t.sequence>=?2 AND (?3 IS NULL OR t.sequence<?3)
       )
       OR EXISTS (
         SELECT 1 FROM task_runs r
         JOIN conversation_turns t ON t.turn_id=r.turn_id AND t.conversation_id=r.conversation_id
         WHERE r.run_id=card.run_id AND r.conversation_id=card.conversation_id
           AND t.sequence>=?2 AND (?3 IS NULL OR t.sequence<?3)
       )
       OR (card.turn_id IS NULL AND card.run_id IS NULL AND ?3 IS NULL)
     )"
}

fn load_turns(
    connection: &Connection,
    conversation_id: &str,
    start: i64,
    end: Option<i64>,
) -> Result<Vec<ConversationTurnRecord>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT turn_id, conversation_id, sequence, role, content, run_id, created_at
             FROM conversation_turns
             WHERE conversation_id=?1 AND sequence>=?2 AND (?3 IS NULL OR sequence<?3)
             ORDER BY sequence",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![conversation_id, start, end], turn_from_row)
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

fn load_runs(
    connection: &Connection,
    conversation_id: &str,
    start: i64,
    end: Option<i64>,
) -> Result<Vec<TaskRunRecord>, AppError> {
    let sql = format!(
        "SELECT {TASK_RUN_COLUMNS} FROM task_runs
         WHERE conversation_id=?1 AND turn_id IN (
           SELECT turn_id FROM conversation_turns
           WHERE conversation_id=?1 AND sequence>=?2 AND (?3 IS NULL OR sequence<?3)
         )
         ORDER BY created_at, rowid"
    );
    let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
    let rows = statement
        .query_map(params![conversation_id, start, end], run_from_row)
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

fn load_events(
    connection: &Connection,
    conversation_id: &str,
    start: i64,
    end: Option<i64>,
) -> Result<Vec<ToolCallEventRecord>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT e.event_id, e.run_id, e.sequence, e.tool_name, e.arguments_summary_json,
                    e.status, e.duration_ms, e.error, e.result_json, e.created_at, e.finished_at, e.call_id
             FROM tool_call_events e
             JOIN task_runs r ON r.run_id=e.run_id
             JOIN conversation_turns t ON t.turn_id=r.turn_id AND t.conversation_id=r.conversation_id
             WHERE r.conversation_id=?1 AND t.sequence>=?2 AND (?3 IS NULL OR t.sequence<?3)
             ORDER BY e.sequence, e.event_id",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![conversation_id, start, end], event_from_row)
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

fn stamped_artifacts(
    connection: &Connection,
    conversation_id: &str,
    conversation_created_at: &str,
    start: i64,
    end: Option<i64>,
) -> Result<Vec<ConversationArtifactCardRecord>, AppError> {
    let mut artifacts = load_artifacts(connection, conversation_id, start, end)?;
    let ordinals = candidate_ordinals(connection, conversation_id, conversation_created_at)?;
    for card in &mut artifacts {
        card.candidate_ordinal = ordinals.get(&card.card_id).copied();
    }
    Ok(artifacts)
}

fn candidate_ordinals(
    connection: &Connection,
    conversation_id: &str,
    conversation_created_at: &str,
) -> Result<std::collections::HashMap<String, i64>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT card.card_id, card.created_at, card.run_id, turn.sequence, run_turn.sequence, run.created_at
             FROM conversation_artifact_cards card
             LEFT JOIN conversation_turns turn
               ON turn.turn_id = card.turn_id AND turn.conversation_id = card.conversation_id
             LEFT JOIN task_runs run
               ON run.run_id = card.run_id AND run.conversation_id = card.conversation_id
             LEFT JOIN conversation_turns run_turn
               ON run_turn.turn_id = run.turn_id AND run_turn.conversation_id = run.conversation_id
             WHERE card.conversation_id = ?1",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![conversation_id], |row| {
            Ok(CardOrder {
                card_id: row.get(0)?,
                created_at: row.get(1)?,
                run_id: row.get(2)?,
                turn_sequence: row.get(3)?,
                run_turn_sequence: row.get(4)?,
                run_created_at: row.get(5)?,
            })
        })
        .map_err(AppError::database)?;
    let mut cards = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
    let fallback = epoch_millis(conversation_created_at).unwrap_or(0);
    cards.sort_by(|left, right| {
        let left_key = left.sort_key(fallback);
        let right_key = right.sort_key(fallback);
        left_key
            .0
            .cmp(&right_key.0)
            .then(left_key.1.cmp(&right_key.1))
            .then(left.card_id.cmp(&right.card_id))
    });
    Ok(cards
        .into_iter()
        .enumerate()
        .map(|(index, card)| (card.card_id, (index + 1) as i64))
        .collect())
}

struct CardOrder {
    card_id: String,
    created_at: String,
    run_id: Option<String>,
    turn_sequence: Option<i64>,
    run_turn_sequence: Option<i64>,
    run_created_at: Option<String>,
}

impl CardOrder {
    fn sort_key(&self, fallback: i64) -> (i64, i64) {
        let at = epoch_millis(&self.created_at)
            .or_else(|| self.run_created_at.as_deref().and_then(epoch_millis))
            .unwrap_or(fallback);
        let turn_sequence = if self.run_id.is_some() && self.run_created_at.is_some() {
            self.run_turn_sequence.unwrap_or(MISSING_TURN_SEQUENCE)
        } else {
            self.turn_sequence.unwrap_or(MISSING_TURN_SEQUENCE)
        };
        (at, turn_sequence)
    }
}

const MISSING_TURN_SEQUENCE: i64 = 9_007_199_254_740_991;

fn epoch_millis(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.timestamp_millis())
}

fn load_artifacts(
    connection: &Connection,
    conversation_id: &str,
    start: i64,
    end: Option<i64>,
) -> Result<Vec<ConversationArtifactCardRecord>, AppError> {
    let sql = format!(
        "SELECT card.card_id, card.conversation_id, card.turn_id, card.run_id, card.artifact_id,
                card.artifact_type, card.title, card.summary, card.content, card.status, card.created_at
         FROM conversation_artifact_cards card
         WHERE card.conversation_id=?1 {}
         ORDER BY card.created_at, card.card_id",
        card_span_sql()
    );
    let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
    let rows = statement
        .query_map(params![conversation_id, start, end], artifact_from_row)
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

fn load_decisions(
    connection: &Connection,
    conversation_id: &str,
    start: i64,
    end: Option<i64>,
) -> Result<Vec<ArtifactDecisionRecord>, AppError> {
    let sql = format!(
        "SELECT d.decision_id, d.artifact_id, d.artifact_hash, d.card_id, d.conversation_id,
                d.decision, d.idempotency_key, d.actor, d.target_type, d.target_id, d.base_revision,
                d.apply_transaction_id, d.conflict_code, d.created_at
         FROM artifact_decisions d
         JOIN conversation_artifact_cards card
           ON card.card_id=d.card_id AND card.conversation_id=d.conversation_id
         WHERE d.conversation_id=?1 {}
         ORDER BY d.created_at, d.decision_id",
        card_span_sql()
    );
    let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
    let rows = statement
        .query_map(params![conversation_id, start, end], decision_from_row)
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

fn load_authorizations(
    connection: &Connection,
    conversation_id: &str,
    start: i64,
    end: Option<i64>,
) -> Result<Vec<ReviewAuthorizationRecord>, AppError> {
    let sql = format!(
        "SELECT a.authorization_id, a.artifact_id, a.chapter_id, a.novel_id, a.decision_id,
                a.status, a.issued_at, a.consumed_at, a.consumed_by_draft_id
         FROM review_authorizations a
         JOIN artifact_decisions d ON d.decision_id=a.decision_id
         JOIN conversation_artifact_cards card
           ON card.card_id=d.card_id AND card.conversation_id=d.conversation_id
         WHERE d.conversation_id=?1 {}
         ORDER BY a.issued_at, a.authorization_id",
        card_span_sql()
    );
    let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
    let rows = statement
        .query_map(
            params![conversation_id, start, end],
            authorization_from_row,
        )
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}
