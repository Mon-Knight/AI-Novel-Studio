//! Recheck explicit chapter targets against durable author turns, never the planner's rewritten prose.
use super::*;

const INVALID: &str = "WORKBENCH_WORD_TARGET_INVALID: 请明确一个正整数章节目标字数";
const MISMATCH: &str =
    "DSH_CHAPTER_WORD_TARGET_MISMATCH: 章节目标字数与持久化用户要求不一致，请重新确认本次目标";
const EXCLUDED: &[&str] = &[
    "不要",
    "不必",
    "不用",
    "别",
    "禁止",
    "不允许",
    "不准",
    "无需",
    "暂不",
    "不能",
    "不是",
    "保持",
    "不改",
    "是否",
    "能否",
    "怎么",
    "如何",
    "建议",
    "例如",
    "比如",
    "全书",
    "整本",
    "整部",
    "总字数",
];

fn directive_text(text: &str) -> String {
    let chars: Vec<_> = text.chars().collect();
    let mut clean = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index..].starts_with(&['`', '`', '`']) {
            index += 3;
            while index < chars.len() && !chars[index..].starts_with(&['`', '`', '`']) {
                index += 1;
            }
            index = (index + 3).min(chars.len());
            clean.push(' ');
            continue;
        }
        let close = match chars[index] {
            '“' => Some('”'),
            '「' => Some('」'),
            '『' => Some('』'),
            '"' => Some('"'),
            '\'' if index == 0 || !chars[index - 1].is_ascii_alphabetic() => Some('\''),
            _ => None,
        };
        if let Some(close) = close {
            let mut end = index + 1;
            while end < chars.len()
                && chars[end] != close
                && (!matches!(close, '"' | '\'') || !matches!(chars[end], '\r' | '\n'))
            {
                end += 1;
            }
            if end < chars.len() && chars[end] == close {
                index = end + 1;
                clean.push(' ');
                continue;
            }
            if !matches!(close, '"' | '\'') {
                break;
            }
        }
        clean.push(chars[index]);
        index += 1;
    }
    clean
        .lines()
        .take_while(|line| {
            let line = line.trim_start().to_lowercase();
            ![
                "引用",
                "原文",
                "待分析文本",
                "参考文本",
                "故事内容",
                "以下正文",
                "以下原文",
                "quoted text",
                "source text",
            ]
            .iter()
            .any(|heading| {
                line.strip_prefix(heading)
                    .is_some_and(|tail| tail.trim_start().starts_with([':', '：']))
            })
        })
        .filter(|line| !line.trim_start().starts_with('>'))
        .collect::<Vec<_>>()
        .join("\n")
}

fn clause_target(clause: &str) -> Result<Option<(i64, bool, bool)>, String> {
    let mut rest = clause.trim();
    loop {
        if let Some(next) = ["请", "把", "将"]
            .iter()
            .find_map(|prefix| rest.strip_prefix(prefix))
        {
            rest = next.trim_start();
        } else {
            break;
        }
    }
    let mut task_scope = false;
    let mut chapter_scope = false;
    if let Some(next) = ["本任务", "当前任务", "这个任务"]
        .iter()
        .find_map(|scope| rest.strip_prefix(scope))
    {
        rest = next.strip_prefix('的').unwrap_or(next);
        rest = rest.strip_prefix("每章").unwrap_or(rest);
        task_scope = true;
    } else if let Some(scope) = ["每一章", "每章", "本章", "这一章", "当前章", "下一章"]
        .iter()
        .find(|scope| rest.starts_with(**scope))
    {
        rest = &rest[scope.len()..];
        task_scope = scope.starts_with('每');
        chapter_scope = !task_scope;
    }
    rest = rest.strip_prefix('的').unwrap_or(rest);
    let Some(next) = rest.strip_prefix("目标") else {
        return Ok(None);
    };
    rest = next.strip_prefix("字数").unwrap_or(next).trim_start();
    if let Some(next) = [
        "设置为",
        "设置成",
        "调整为",
        "调整成",
        "设为",
        "设成",
        "改为",
        "改成",
        "为",
        "是",
        ":",
        "：",
        "=",
    ]
    .iter()
    .find_map(|prefix| rest.strip_prefix(prefix))
    {
        rest = next.trim_start();
    }
    let end = rest
        .find(|character: char| !character.is_ascii_digit() && character != '.')
        .unwrap_or(rest.len());
    let number = rest[..end]
        .parse::<f64>()
        .map_err(|_| INVALID.to_string())?;
    rest = rest[end..].trim_start();
    let multiplier = if let Some(next) = rest.strip_prefix('万') {
        rest = next;
        10000.0
    } else if let Some(next) = rest.strip_prefix('千') {
        rest = next;
        1000.0
    } else {
        1.0
    };
    rest = rest.trim_start();
    rest = rest.strip_prefix('字').unwrap_or(rest).trim();
    let approximate = rest == "左右";
    if !rest.is_empty() && !approximate {
        return Err(INVALID.into());
    }
    let target = number * multiplier;
    if !target.is_finite()
        || target <= 0.0
        || target.fract() != 0.0
        || target > 9_007_199_254_740_991.0
    {
        return Err(INVALID.into());
    }
    Ok(Some((
        target as i64,
        task_scope,
        !chapter_scope && !approximate,
    )))
}

pub(super) fn parse(text: &str) -> Result<Option<(i64, bool)>, String> {
    let text = directive_text(text);
    if text.contains(['?', '？'])
        || text
            .trim_end_matches(['。', '！', '!', ' '])
            .ends_with(['吗', '呢'])
    {
        return Ok(None);
    }
    let clauses: Vec<_> = text
        .split(['，', ',', '；', ';', '。', '！', '!', '？', '?', '\n'])
        .filter(|clause| {
            !clause.trim().is_empty() && !EXCLUDED.iter().any(|word| clause.contains(word))
        })
        .collect();
    let targets = clauses
        .iter()
        .filter_map(|clause| clause_target(clause).transpose())
        .collect::<Result<Vec<_>, _>>()?;
    let Some(first) = targets.first() else {
        return Ok(None);
    };
    if targets.iter().any(|target| target.0 != first.0) {
        return Err(INVALID.into());
    }
    let setting_only = clauses.len() == 1 && targets.len() == 1 && first.2;
    if !setting_only && clauses.len() == targets.len() {
        return Err(INVALID.into());
    }
    Ok(Some((
        first.0,
        setting_only || targets.iter().any(|target| target.1),
    )))
}

pub(super) fn validate(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<(), String> {
    if !is_chapter_writing_turn(input)
        || input.retry_source_run_id.is_some()
        || input
            .chapter_host_gate
            .as_ref()
            .is_some_and(|gate| gate.phase == "admit" || gate.continues_run_id.is_some())
    {
        return Ok(());
    }
    let current: (String, i64) = connection.query_row(
        "SELECT content,sequence FROM conversation_turns WHERE turn_id=?1 AND conversation_id=?2 AND role='user'",
        rusqlite::params![input.turn_id,input.conversation_id], |row|Ok((row.get(0)?,row.get(1)?)),
    ).map_err(|e|e.to_string())?;
    let (content, _) =
        super::revision_source::decode_turn(&current.0).map_err(|e| e.to_string())?;
    let mut target = parse(&content)?.map(|value| value.0);
    if target.is_none() {
        let mut statement = connection.prepare("SELECT content FROM conversation_turns WHERE conversation_id=?1 AND role='user' AND sequence<?2 ORDER BY sequence DESC").map_err(|e|e.to_string())?;
        let turns = statement
            .query_map(rusqlite::params![input.conversation_id, current.1], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        for turn in turns {
            let raw = turn.map_err(|e| e.to_string())?;
            if raw.contains("[[ANS_WORKBENCH_TURN:v1;origin=") {
                continue;
            }
            let (goal, _) = super::revision_source::decode_turn(&raw).map_err(|e| e.to_string())?;
            if let Ok(Some((value, true))) = parse(&goal) {
                target = Some(value);
                break;
            }
        }
    }
    if let Some(target) = target {
        if input.chapter_word_range.as_ref().map(|range| range.target) != Some(target) {
            return Err(MISMATCH.into());
        }
    }
    Ok(())
}
