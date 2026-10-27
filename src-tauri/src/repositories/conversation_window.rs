use super::{get_conversation, TaskConversationBundle};
use crate::errors::AppError;
#[path = "conversation_window_span.rs"]
mod span;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const PAGE_LIMIT: i64 = 32;
const REFRESH_LIMIT: i64 = 200;
const AUTOMATIC_ASSET_SUFFIX: &str = "\n\n[[ANS_WORKBENCH_TURN:v1;origin=workbench_asset_preparation]]\n工作台说明：这是根据已保留正文目标发起的自动资产准备回合，不是用户的新消息。";
const AUTOMATIC_SUMMARY_SUFFIX: &str = "\n\n[[ANS_WORKBENCH_TURN:v1;origin=workbench_chapter_summary]]\n工作台说明：这是章节正文采用后发起的自动总结回合，不是用户的新消息。";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationWindowInput {
    pub conversation_id: String,
    pub limit: Option<i64>,
    pub before_user_sequence: Option<i64>,
    pub min_user_sequence: Option<i64>,
    pub focus_turn_id: Option<String>,
    pub focus_card_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConversationWindow {
    pub bundle: TaskConversationBundle,
    pub start_sequence: Option<i64>,
    pub end_sequence_exclusive: Option<i64>,
    pub oldest_user_sequence: Option<i64>,
    pub newest_user_sequence: Option<i64>,
    pub has_older: bool,
    pub has_newer: bool,
    pub user_round_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningTaskTarget {
    pub conversation_id: String,
    pub novel_id: String,
    pub title: String,
    pub run_id: String,
    pub chapter_id: Option<String>,
    pub latest_goal: Option<String>,
}

struct Page {
    start_sequence: Option<i64>,
    end_sequence_exclusive: Option<i64>,
    oldest_user_sequence: Option<i64>,
    newest_user_sequence: Option<i64>,
    has_older: bool,
    has_newer: bool,
    user_round_count: i64,
}

enum Mode {
    Latest,
    Before(i64),
    Min(i64),
    Anchor(Option<i64>),
}

fn invalid(message: &str) -> AppError {
    AppError::new("CONVERSATION_WINDOW_INVALID", message, false)
}

fn present(value: &Option<String>) -> bool {
    value.as_ref().is_some_and(|item| !item.trim().is_empty())
}

fn validate(input: &ConversationWindowInput) -> Result<(i64, Mode), AppError> {
    if input.conversation_id.trim().is_empty() {
        return Err(invalid("任务编号不能为空"));
    }
    for sequence in [input.before_user_sequence, input.min_user_sequence]
        .into_iter()
        .flatten()
    {
        if sequence < 0 {
            return Err(invalid("分页序号不能为负数"));
        }
    }
    if input
        .focus_turn_id
        .as_ref()
        .is_some_and(|value| value.trim().is_empty())
        || input
            .focus_card_id
            .as_ref()
            .is_some_and(|value| value.trim().is_empty())
    {
        return Err(invalid("定位编号不能为空"));
    }
    let cursors = [
        input.before_user_sequence.is_some(),
        input.min_user_sequence.is_some(),
        present(&input.focus_turn_id),
        present(&input.focus_card_id),
    ]
    .into_iter()
    .filter(|active| *active)
    .count();
    if cursors > 1 {
        return Err(invalid("分页游标、刷新范围和定位不能同时使用"));
    }
    let refresh = input.min_user_sequence.is_some();
    let max = if refresh { REFRESH_LIMIT } else { PAGE_LIMIT };
    let limit = input.limit.unwrap_or(8);
    if !(1..=max).contains(&limit) {
        return Err(invalid(if refresh {
            "已加载区间一次最多刷新 200 个用户回合"
        } else {
            "单页最多读取 32 个用户回合"
        }));
    }
    let mode = if let Some(sequence) = input.before_user_sequence {
        Mode::Before(sequence)
    } else if let Some(sequence) = input.min_user_sequence {
        Mode::Min(sequence)
    } else if present(&input.focus_turn_id) || present(&input.focus_card_id) {
        Mode::Anchor(None)
    } else {
        Mode::Latest
    };
    Ok((limit, mode))
}

fn user_rounds(connection: &Connection, conversation_id: &str) -> Result<Vec<i64>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT sequence FROM conversation_turns
             WHERE conversation_id=?1 AND role='user'
               AND content NOT LIKE ?2 AND content NOT LIKE ?3
             ORDER BY sequence",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(
            params![
                conversation_id,
                format!("%{}", AUTOMATIC_ASSET_SUFFIX),
                format!("%{}", AUTOMATIC_SUMMARY_SUFFIX)
            ],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

fn require_user_round(rounds: &[i64], sequence: i64) -> Result<(), AppError> {
    if rounds.contains(&sequence) {
        Ok(())
    } else {
        Err(invalid("分页游标不是当前任务的用户回合"))
    }
}

fn focus_turn_sequence(
    connection: &Connection,
    conversation_id: &str,
    turn_id: &str,
) -> Result<i64, AppError> {
    connection
        .query_row(
            "SELECT sequence FROM conversation_turns WHERE turn_id=?1 AND conversation_id=?2",
            params![turn_id, conversation_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| invalid("定位的回合不属于当前任务"))
}

fn focus_card_sequence(
    connection: &Connection,
    conversation_id: &str,
    card_id: &str,
) -> Result<i64, AppError> {
    let located: Option<(Option<String>, Option<String>)> = connection
        .query_row(
            "SELECT turn_id, run_id FROM conversation_artifact_cards
             WHERE card_id=?1 AND conversation_id=?2",
            params![card_id, conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((turn_id, run_id)) = located else {
        return Err(invalid("定位的产物不属于当前任务"));
    };
    if let Some(turn_id) = turn_id {
        return focus_turn_sequence(connection, conversation_id, &turn_id);
    }
    let Some(run_id) = run_id else {
        return Err(invalid("定位的产物没有所属回合"));
    };
    let turn_id: Option<String> = connection
        .query_row(
            "SELECT turn_id FROM task_runs WHERE run_id=?1 AND conversation_id=?2",
            params![run_id, conversation_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some(turn_id) = turn_id else {
        return Err(invalid("定位的产物不属于当前任务"));
    };
    focus_turn_sequence(connection, conversation_id, &turn_id)
}

fn owning_user_round(rounds: &[i64], turn_sequence: i64) -> Option<i64> {
    rounds
        .iter()
        .rev()
        .find(|sequence| **sequence <= turn_sequence)
        .copied()
}

fn page_from_rounds(
    rounds: &[i64],
    min_turn: Option<i64>,
    selected: &[i64],
    has_older_rounds: bool,
) -> Page {
    if selected.is_empty() {
        return Page {
            start_sequence: None,
            end_sequence_exclusive: None,
            oldest_user_sequence: None,
            newest_user_sequence: None,
            has_older: false,
            has_newer: !rounds.is_empty(),
            user_round_count: 0,
        };
    }
    let includes_earliest = selected.first() == rounds.first();
    let last = *selected.last().expect("selected page");
    let end_sequence_exclusive = rounds.iter().find(|sequence| **sequence > last).copied();
    Page {
        start_sequence: if includes_earliest {
            min_turn.or(selected.first().copied())
        } else {
            selected.first().copied()
        },
        end_sequence_exclusive,
        oldest_user_sequence: selected.first().copied(),
        newest_user_sequence: Some(last),
        has_older: has_older_rounds || !includes_earliest,
        has_newer: end_sequence_exclusive.is_some(),
        user_round_count: selected.len() as i64,
    }
}

fn select_rounds(rounds: &[i64], limit: usize, mode: Mode) -> Result<Vec<i64>, AppError> {
    match mode {
        Mode::Latest => {
            let start = rounds.len().saturating_sub(limit);
            Ok(rounds[start..].to_vec())
        }
        Mode::Before(sequence) => {
            require_user_round(rounds, sequence)?;
            let eligible: Vec<i64> = rounds
                .iter()
                .copied()
                .filter(|item| *item < sequence)
                .collect();
            let start = eligible.len().saturating_sub(limit);
            Ok(eligible[start..].to_vec())
        }
        Mode::Min(sequence) => {
            require_user_round(rounds, sequence)?;
            let eligible: Vec<i64> = rounds
                .iter()
                .copied()
                .filter(|item| *item >= sequence)
                .collect();
            if eligible.len() > limit {
                let start = eligible.len() - limit;
                Ok(eligible[start..].to_vec())
            } else {
                Ok(eligible)
            }
        }
        Mode::Anchor(owning) => {
            let Some(owning) = owning else {
                let end = limit.min(rounds.len());
                return Ok(rounds[..end].to_vec());
            };
            let index = rounds
                .iter()
                .position(|sequence| *sequence == owning)
                .ok_or_else(|| invalid("定位的回合不是当前任务的用户回合"))?;
            let latest_start = rounds.len().saturating_sub(limit);
            if index >= latest_start {
                Ok(rounds[latest_start..].to_vec())
            } else {
                let end = (index + limit).min(rounds.len());
                Ok(rounds[index..end].to_vec())
            }
        }
    }
}

fn min_turn_sequence(connection: &Connection, conversation_id: &str) -> Result<Option<i64>, AppError> {
    connection
        .query_row(
            "SELECT MIN(sequence) FROM conversation_turns WHERE conversation_id=?1",
            params![conversation_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)
}

pub fn get_conversation_window(
    connection: &Connection,
    input: ConversationWindowInput,
) -> Result<Option<TaskConversationWindow>, AppError> {
    let (limit, mut mode) = validate(&input)?;
    let Some(conversation) = get_conversation(connection, input.conversation_id.trim())? else {
        return Ok(None);
    };
    let conversation_id = conversation.conversation_id.clone();
    if present(&input.focus_turn_id) {
        let sequence = focus_turn_sequence(
            connection,
            &conversation_id,
            input.focus_turn_id.as_deref().unwrap_or("").trim(),
        )?;
        mode = Mode::Anchor(Some(sequence));
    } else if present(&input.focus_card_id) {
        let sequence = focus_card_sequence(
            connection,
            &conversation_id,
            input.focus_card_id.as_deref().unwrap_or("").trim(),
        )?;
        mode = Mode::Anchor(Some(sequence));
    }
    let rounds = user_rounds(connection, &conversation_id)?;
    if let Mode::Anchor(Some(sequence)) = &mut mode {
        *sequence = owning_user_round(&rounds, *sequence).unwrap_or(*sequence);
        if !rounds.contains(sequence) {
            mode = Mode::Anchor(None);
        }
    }
    if rounds.is_empty() {
        if matches!(mode, Mode::Before(_) | Mode::Min(_)) {
            return Err(invalid("分页游标不是当前任务的用户回合"));
        }
        let sequences = turn_sequences(connection, &conversation_id)?;
        let Some(first) = sequences.first().copied() else {
            return Ok(Some(span::empty_window(conversation, false)));
        };
        let span_start = sequences[sequences.len().saturating_sub(limit as usize)];
        return span::load_window(
            connection,
            conversation,
            span_start,
            None,
            None,
            None,
            span_start != first,
            false,
            0,
        )
        .map(Some);
    }
    let selected = select_rounds(&rounds, limit as usize, mode)?;
    let has_older_gap = match input.min_user_sequence {
        Some(sequence) => rounds.iter().any(|item| *item < sequence) || {
            selected.first().is_some_and(|first| *first > sequence)
        },
        None => false,
    };
    if selected.is_empty() {
        return Ok(Some(span::empty_window(conversation, !rounds.is_empty())));
    }
    let page = page_from_rounds(
        &rounds,
        min_turn_sequence(connection, &conversation_id)?,
        &selected,
        has_older_gap,
    );
    let Some(start) = page.start_sequence else {
        return Ok(Some(span::empty_window(conversation, page.has_newer)));
    };
    span::load_window(
        connection,
        conversation,
        start,
        page.end_sequence_exclusive,
        page.oldest_user_sequence,
        page.newest_user_sequence,
        page.has_older,
        page.has_newer,
        page.user_round_count,
    )
    .map(Some)
}

fn turn_sequences(connection: &Connection, conversation_id: &str) -> Result<Vec<i64>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT sequence FROM conversation_turns WHERE conversation_id=?1 ORDER BY sequence",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![conversation_id], |row| row.get(0))
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

pub fn list_running_task_targets(
    connection: &Connection,
    novel_id: &str,
) -> Result<Vec<RunningTaskTarget>, AppError> {
    if novel_id.trim().is_empty() {
        return Err(invalid("小说编号不能为空"));
    }
    let mut statement = connection
        .prepare(
            "SELECT c.conversation_id, c.novel_id, c.title, r.run_id, r.chapter_id, t.content
             FROM task_runs r
             JOIN task_conversations c ON c.conversation_id=r.conversation_id
             LEFT JOIN conversation_turns t
               ON t.turn_id=r.turn_id AND t.conversation_id=r.conversation_id
             WHERE c.novel_id=?1
               AND r.status IN ('queued', 'running', 'cancel_requested')
             ORDER BY r.created_at, r.run_id",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![novel_id.trim()], |row| {
            Ok(RunningTaskTarget {
                conversation_id: row.get(0)?,
                novel_id: row.get(1)?,
                title: row.get(2)?,
                run_id: row.get(3)?,
                chapter_id: row.get(4)?,
                latest_goal: row.get(5)?,
            })
        })
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

#[cfg(test)]
#[path = "conversation_window_tests.rs"]
mod tests;
