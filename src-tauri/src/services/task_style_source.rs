//! Bounded style-source snapshots. Text is data, never executable instructions.
use crate::errors::AppError;
use crate::repositories::large_text_repository;
use crate::services::reference_library_service;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleSampleSnapshot {
    pub sample_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub content_hash: String,
    pub utf8_byte_length: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_utf16: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_utf16: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleReferenceScope {
    pub novel_id: String,
    pub work_id: String,
    pub import_id: String,
    pub source_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleSourceSnapshot {
    pub source_id: String,
    pub content_hash: String,
    pub utf8_byte_length: usize,
    pub samples: Vec<StyleSampleSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<StyleReferenceScope>,
}

pub(crate) fn invalid(message: &str) -> AppError {
    AppError::new("STYLE_SOURCE_SCOPE_INVALID", message, false)
}
fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 160
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Project content is always reconstructed from authoritative, explicitly bounded ranges.
/// Global content comes only from the explicit caller-provided snapshot, never a hidden novel.
pub fn validate_source(
    connection: &Connection,
    novel_id: Option<&str>,
    source: &StyleSourceSnapshot,
) -> Result<Vec<StyleSampleSnapshot>, AppError> {
    if !valid_id(&source.source_id) || !valid_hash(&source.content_hash)
        || source.samples.is_empty() || source.samples.len() > 6
    {
        return Err(invalid("风格来源身份、哈希或样本数量无效"));
    }
    let project = source.reference.as_ref();
    if let Some(reference) = project {
        if novel_id != Some(reference.novel_id.as_str())
            || !valid_id(&reference.work_id) || !valid_id(&reference.import_id)
            || reference.source_hash != source.content_hash
        {
            return Err(invalid("参考资料不属于当前任务作品"));
        }
        let matches: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM reference_imports i JOIN reference_works w ON w.id=i.reference_work_id AND w.novel_id=i.novel_id WHERE i.id=?1 AND i.reference_work_id=?2 AND i.novel_id=?3 AND i.source_sha256=?4 AND i.is_current=1)",
            params![reference.import_id, reference.work_id, reference.novel_id, reference.source_hash], |row| row.get(0),
        ).map_err(AppError::database)?;
        if !matches { return Err(invalid("参考资料版本或完整源哈希已变化")); }
    } else if novel_id.is_some() || source.samples.len() != 1 {
        return Err(invalid("全局文本分析必须属于独立 library 任务"));
    }
    let mut ids = HashSet::new();
    let mut hydrated = Vec::new();
    let mut total_bytes = 0usize;
    for sample in &source.samples {
        if !valid_id(&sample.sample_id) || !ids.insert(&sample.sample_id)
            || !valid_hash(&sample.content_hash)
            || sample.layers.iter().any(|layer| !["opening", "development", "dialogue_dense", "description_dense", "climax", "closing"].contains(&layer.as_str()))
        { return Err(invalid("样本身份、层级或哈希无效")); }
        let text = if let Some(reference) = project {
            if sample.content.is_some() { return Err(invalid("项目样本不能自报权威正文")); }
            let section_id = sample.section_id.as_deref().filter(|id| valid_id(id)).ok_or_else(|| invalid("样本缺少章节身份"))?;
            let section = reference_library_service::get_section_content(connection, &reference.novel_id, &reference.work_id, &reference.import_id, section_id)?;
            let start = sample.start_utf16.ok_or_else(|| invalid("样本缺少起点"))?;
            let end = sample.end_utf16.ok_or_else(|| invalid("样本缺少终点"))?;
            if end <= start || end - start > 8_000 { return Err(invalid("项目样本超出有限范围")); }
            let units: Vec<_> = section.content.encode_utf16().collect();
            let range = units.get(start..end).ok_or_else(|| invalid("样本范围超出源章节"))?;
            String::from_utf16(range).map_err(|_| invalid("样本范围截断 Unicode 字符"))?
        } else {
            if sample.section_id.is_some() || sample.start_utf16.is_some() || sample.end_utf16.is_some() {
                return Err(invalid("library 样本不得声明作品或章节范围"));
            }
            sample.content.clone().ok_or_else(|| invalid("全局分析缺少显式文本快照"))?
        };
        let max_units = if project.is_some() { 8_000 } else { 20_000 };
        if text.trim().is_empty() || text.encode_utf16().count() > max_units
            || text.len() != sample.utf8_byte_length || large_text_repository::sha256(&text) != sample.content_hash
        { return Err(invalid("样本文本、字节数或完整哈希不一致")); }
        total_bytes = total_bytes.checked_add(text.len()).ok_or_else(|| invalid("样本字节数溢出"))?;
        let mut sample = sample.clone();
        sample.content = Some(text);
        hydrated.push(sample);
    }
    let max_bytes = if project.is_some() { 192_000 } else { 80_000 };
    if total_bytes != source.utf8_byte_length || total_bytes > max_bytes
        || (project.is_none() && hydrated[0].content_hash != source.content_hash)
    { return Err(invalid("快照字节预算或完整源哈希不一致")); }
    Ok(hydrated)
}

#[cfg(test)]
#[path = "task_style_source_tests.rs"]
mod tests;
