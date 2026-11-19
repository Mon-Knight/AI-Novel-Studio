//! Pure synthetic chapter response. Offline output is never literary-effect evidence.
use super::*;

pub(super) fn chapter(input: &StartTaskTurnInput) -> Result<String, String> {
    let target = input
        .chapter_word_range
        .as_ref()
        .map(|r| r.target)
        .unwrap_or(3000)
        .clamp(1, 100_000) as usize;
    let base_scope = input
        .chapter_id
        .as_deref()
        .unwrap_or(input.require_novel_id()?);
    let scope_material = if let Some(revision) = input.verified_revision_source.as_ref() {
        format!(
            "{base_scope}:{}:{}:{}",
            input.task_kind, revision.source.artifact_id, input.turn_id
        )
    } else if input.task_kind != "chapter_write" {
        format!("{base_scope}:{}:{}", input.task_kind, input.turn_id)
    } else {
        base_scope.to_string()
    };
    let scope = large_text_repository::sha256(&scope_material);
    let mut body = if target >= 200 {
        format!("他把刻着「{}」的木牌收进袖里，沿着尚未醒来的街巷走去。木牌背面还有「{}」的旧印，提醒他先核对手里的证据。桥边的纸片留下「{}」的细痕，他没有替未知的事情下结论。\n\n",&scope[..32],&scope[8..40],&scope[16..48])
    } else {
        String::new()
    };
    let used = crate::services::draft_service::word_count(&body) as usize;
    let narrative="晨光落在长街石阶雨水缓缓流过门前远处传来脚步他收起旧信推开木窗望见山影于是决定沿河寻找那个尚未回答的问题";
    let chars: Vec<_> = narrative.chars().collect();
    for n in 0..target.saturating_sub(used) {
        body.push(chars[n % chars.len()]);
        if n % 32 == 31 {
            body.push('。');
            if n % 128 == 127 {
                body.push_str("\n\n");
            }
        }
    }
    if !body.ends_with('。') {
        body.push('。');
    }
    Ok(body)
}
