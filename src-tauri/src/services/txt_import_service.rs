//! TXT 小说导入：作品、卷、章节与导入草稿在同一个 SQLite 事务内落库。
//!
//! 此前前端逐条调用 `create_novel / create_volume / create_chapter / save_chapter_draft_atomic`，
//! 任一步失败都会留下半导入作品（审计 GAP-16）。这里把整条链路收进一个 `Immediate` 事务：
//! 任何校验或写入失败都回滚，不产生部分作品；成功则一次性返回作品与章节统计。
use crate::domain::project::{CreateNovelInput, NovelDto};
use crate::domain::writing::{CreateChapterInput, CreateVolumeInput};
use crate::repositories::{draft_repository, large_text_repository};
use crate::services::{chapter_service, draft_service, project_service, volume_service};
use rusqlite::{Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};

pub const MAX_IMPORT_CHAPTERS: usize = 5_000;
pub const MAX_IMPORT_TITLE_CHARS: usize = 200;
pub const MAX_IMPORT_CHAPTER_CHARS: usize = 2_000_000;
pub const IMPORTED_DRAFT_SOURCE: &str = "imported";
pub const TXT_IMPORT_INVALID: &str = "TXT_IMPORT_INVALID";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTxtChapterInput {
    pub title: String,
    pub order_index: i64,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTxtNovelInput {
    pub title: String,
    pub genre: Option<String>,
    pub description: Option<String>,
    pub volume_title: Option<String>,
    pub chapters: Vec<ImportTxtChapterInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTxtChapter {
    pub chapter_id: String,
    pub draft_id: String,
    pub title: String,
    pub order_index: i64,
    pub word_count: i64,
    pub storage_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTxtNovelOutput {
    pub novel: NovelDto,
    pub volume_id: String,
    pub chapter_count: usize,
    pub total_word_count: i64,
    pub chapters: Vec<ImportedTxtChapter>,
}

fn invalid(detail: &str) -> String {
    format!("{TXT_IMPORT_INVALID}: {detail}")
}

fn trimmed_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn validate(input: &ImportTxtNovelInput) -> Result<(), String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(invalid("作品标题不能为空"));
    }
    if title.chars().count() > MAX_IMPORT_TITLE_CHARS {
        return Err(invalid("作品标题过长"));
    }
    if input.chapters.is_empty() {
        return Err(invalid("没有可导入的章节"));
    }
    if input.chapters.len() > MAX_IMPORT_CHAPTERS {
        return Err(invalid("章节数量超过单次导入上限"));
    }
    let mut seen_orders = std::collections::BTreeSet::new();
    for (index, chapter) in input.chapters.iter().enumerate() {
        let position = index + 1;
        if chapter.title.trim().is_empty() {
            return Err(invalid(&format!("第 {position} 个章节缺少标题")));
        }
        if chapter.title.chars().count() > MAX_IMPORT_TITLE_CHARS {
            return Err(invalid(&format!("第 {position} 个章节标题过长")));
        }
        if chapter.content.trim().is_empty() {
            return Err(invalid(&format!("第 {position} 个章节正文为空")));
        }
        if chapter.content.chars().count() > MAX_IMPORT_CHAPTER_CHARS {
            return Err(invalid(&format!("第 {position} 个章节正文超过单章上限")));
        }
        if chapter.order_index < 0 {
            return Err(invalid(&format!("第 {position} 个章节序号无效")));
        }
        if !seen_orders.insert(chapter.order_index) {
            return Err(invalid(&format!("第 {position} 个章节序号重复")));
        }
    }
    Ok(())
}

fn insert_imported_draft(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    title: &str,
    content: &str,
    now: &str,
) -> Result<(String, i64, &'static str), String> {
    let draft_id = uuid::Uuid::new_v4().to_string();
    let content_hash = large_text_repository::sha256(content);
    let use_large_text = content.len() > large_text_repository::LARGE_TEXT_THRESHOLD_BYTES;
    let document_id = use_large_text.then(|| uuid::Uuid::new_v4().to_string());
    if let Some(document_id) = document_id.as_deref() {
        large_text_repository::insert_document(
            connection,
            document_id,
            &draft_id,
            Some(title),
            content,
            &content_hash,
            now,
        )
        .map_err(|error| error.to_string())?;
    }
    let stored_content = if use_large_text {
        content.chars().take(500).collect::<String>()
    } else {
        content.to_string()
    };
    let word_count = draft_service::word_count(content);
    let version = draft_repository::next_version(connection, chapter_id)
        .map_err(|error| error.to_string())?;
    draft_repository::insert_draft(
        connection,
        &draft_id,
        novel_id,
        chapter_id,
        Some(title),
        &stored_content,
        IMPORTED_DRAFT_SOURCE,
        version,
        word_count,
        None,
        None,
        document_id.as_deref(),
        &content_hash,
        now,
    )
    .map_err(|error| error.to_string())?;
    Ok((
        draft_id,
        word_count,
        if use_large_text { "chunked" } else { "inline" },
    ))
}

/// 在一个事务内导入整本 TXT：失败关闭且零部分写入。
pub fn import_txt_novel(
    connection: &mut Connection,
    input: ImportTxtNovelInput,
) -> Result<ImportTxtNovelOutput, String> {
    validate(&input)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;

    let novel = project_service::create_novel(
        &transaction,
        CreateNovelInput {
            title: input.title.trim().to_string(),
            subtitle: None,
            description: Some(
                trimmed_optional(input.description).unwrap_or_else(|| "由 TXT 导入".to_string()),
            ),
            outline: None,
            genre: trimmed_optional(input.genre),
            target_word_count: None,
        },
    )?;
    let volume = volume_service::create_volume(
        &transaction,
        CreateVolumeInput {
            novel_id: novel.id.clone(),
            title: trimmed_optional(input.volume_title).unwrap_or_else(|| "第一卷".to_string()),
            summary: None,
            goal: None,
            main_conflict: None,
            order_index: Some(1),
        },
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut chapters = Vec::with_capacity(input.chapters.len());
    let mut total_word_count = 0_i64;
    let mut ordered = input.chapters;
    ordered.sort_by_key(|chapter| chapter.order_index);
    for chapter_input in ordered {
        let title = chapter_input.title.trim().to_string();
        let chapter = chapter_service::create_chapter(
            &transaction,
            CreateChapterInput {
                novel_id: novel.id.clone(),
                volume_id: Some(volume.id.clone()),
                title: title.clone(),
                outline: None,
                goal: None,
                target_word_count: None,
                order_index: Some(chapter_input.order_index),
            },
        )?;
        let (draft_id, word_count, storage_mode) = insert_imported_draft(
            &transaction,
            &novel.id,
            &chapter.id,
            &title,
            &chapter_input.content,
            &now,
        )?;
        total_word_count += word_count;
        chapters.push(ImportedTxtChapter {
            chapter_id: chapter.id,
            draft_id,
            title,
            order_index: chapter_input.order_index,
            word_count,
            storage_mode: storage_mode.to_string(),
        });
    }

    let novel = project_service::get_novel(&transaction, &novel.id)?
        .ok_or_else(|| "导入后无法读取作品".to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(ImportTxtNovelOutput {
        volume_id: volume.id,
        chapter_count: chapters.len(),
        total_word_count,
        chapters,
        novel,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("foreign keys");
        crate::db::create_tables(&mut connection).expect("schema");
        connection
    }

    fn chapter(title: &str, order_index: i64, content: &str) -> ImportTxtChapterInput {
        ImportTxtChapterInput {
            title: title.to_string(),
            order_index,
            content: content.to_string(),
        }
    }

    fn count(connection: &Connection, sql: &str) -> i64 {
        connection
            .query_row(sql, [], |row| row.get(0))
            .expect("count")
    }

    #[test]
    fn imports_novel_volume_chapters_and_drafts_in_one_transaction() {
        let mut connection = connection();
        let output = import_txt_novel(
            &mut connection,
            ImportTxtNovelInput {
                title: " 导入测试 ".to_string(),
                genre: Some("悬疑".to_string()),
                description: None,
                volume_title: None,
                chapters: vec![
                    chapter("第二章", 2, "第二章正文内容。"),
                    chapter("第一章", 1, "第一章正文内容，包含 English words。"),
                ],
            },
        )
        .expect("import");
        assert_eq!(output.novel.title, "导入测试");
        assert_eq!(output.novel.genre.as_deref(), Some("悬疑"));
        assert_eq!(output.novel.description.as_deref(), Some("由 TXT 导入"));
        assert_eq!(output.chapter_count, 2);
        assert_eq!(output.chapters[0].title, "第一章");
        assert_eq!(output.chapters[1].title, "第二章");
        assert!(output.total_word_count > 0);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM novels"), 1);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM volumes"), 1);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM chapters"), 2);
        let (adopted, source, version): (i64, String, i64) = connection
            .query_row(
                "SELECT is_adopted, source, version_no FROM chapter_drafts WHERE chapter_id = ?1",
                params![output.chapters[0].chapter_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("draft");
        assert_eq!(adopted, 0, "imported drafts stay unadopted");
        assert_eq!(source, IMPORTED_DRAFT_SOURCE);
        assert_eq!(version, 1);
    }

    #[test]
    fn rejects_invalid_payloads_before_touching_the_database() {
        let mut connection = connection();
        let base = ImportTxtNovelInput {
            title: "书".to_string(),
            genre: None,
            description: None,
            volume_title: None,
            chapters: vec![chapter("第一章", 1, "正文")],
        };
        let cases: Vec<(&str, ImportTxtNovelInput)> = vec![
            (
                "empty title",
                ImportTxtNovelInput {
                    title: "   ".to_string(),
                    ..base.clone()
                },
            ),
            (
                "no chapters",
                ImportTxtNovelInput {
                    chapters: vec![],
                    ..base.clone()
                },
            ),
            (
                "empty chapter body",
                ImportTxtNovelInput {
                    chapters: vec![chapter("第一章", 1, "  ")],
                    ..base.clone()
                },
            ),
            (
                "duplicate order",
                ImportTxtNovelInput {
                    chapters: vec![chapter("一", 1, "a"), chapter("二", 1, "b")],
                    ..base.clone()
                },
            ),
        ];
        for (label, input) in cases {
            let error = import_txt_novel(&mut connection, input).expect_err(label);
            assert!(error.starts_with(TXT_IMPORT_INVALID), "{label}: {error}");
        }
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM novels"), 0);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM chapter_drafts"), 0);
    }

    #[test]
    fn a_failing_chapter_rolls_back_the_whole_import() {
        let mut connection = connection();
        // 先证明超过阈值的正文走 chunked 存储；随后移除分块表模拟第二章写入阶段的存储失败，
        // 验证同一次导入里已写入的作品、卷与首章全部回滚，不留半导入作品。
        let big = "长".repeat(large_text_repository::LARGE_TEXT_THRESHOLD_BYTES / 3 + 1);
        let output = import_txt_novel(
            &mut connection,
            ImportTxtNovelInput {
                title: "大文本".to_string(),
                genre: None,
                description: None,
                volume_title: Some("卷一".to_string()),
                chapters: vec![chapter("第一章", 1, &big)],
            },
        )
        .expect("chunked import");
        assert_eq!(output.chapters[0].storage_mode, "chunked");
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM large_text_documents"),
            1
        );

        connection
            .execute_batch("DROP TABLE large_text_chunks;")
            .expect("simulate storage failure");
        let error = import_txt_novel(
            &mut connection,
            ImportTxtNovelInput {
                title: "会失败".to_string(),
                genre: None,
                description: None,
                volume_title: None,
                chapters: vec![chapter("第一章", 1, "短正文"), chapter("第二章", 2, &big)],
            },
        )
        .expect_err("second chapter storage failure");
        assert!(!error.is_empty());
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM novels"), 1);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM chapters"), 1);
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM chapter_drafts WHERE source = 'imported'"
            ),
            1
        );
    }
}
