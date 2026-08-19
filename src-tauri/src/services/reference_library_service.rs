use crate::domain::reference_library::{
    ActivateReferenceImportInput, DeleteReferenceWorkInput, ImportReferenceWorkInput,
    ImportReferenceWorkResultDto, InspectReferenceDuplicateResultDto,
    InspectReferenceDuplicatesInput, LegacyReferenceWorkBundleDto, ReferenceDuplicateAction,
    ReferenceFileAnalysisInput, ReferenceSectionDto, ReferenceSectionInput,
    ReferenceSectionPageDto, ReferenceWorkBundleDto,
};
use crate::errors::{codes, AppError};
use crate::repositories::{large_text_repository, reference_library_repository};
use chrono::Utc;
use rusqlite::{params, Connection, Transaction, TransactionBehavior};
use serde::Serialize;
use std::fs;
use uuid::Uuid;

const MAX_REFERENCE_BYTES: i64 = 64 * 1024 * 1024;
const MAX_REFERENCE_CHARS: i64 = 20_000_000;
const MAX_REFERENCE_SECTIONS: usize = 10_000;
const SOURCE_TEXT_PREVIEW_CHARS: usize = 4_000;
const SECTION_TEXT_PREVIEW_CHARS: usize = 4_000;
pub const DEFAULT_REFERENCE_SECTION_PAGE_SIZE: i64 = 100;
pub const MAX_REFERENCE_SECTION_PAGE_SIZE: i64 = 500;

fn input_error(message: impl Into<String>) -> AppError {
    AppError::new(codes::REFERENCE_INPUT_INVALID, message, false)
}

fn content_error(message: impl Into<String>) -> AppError {
    AppError::new(codes::REFERENCE_CONTENT_INVALID, message, false)
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SourceFileFingerprint {
    byte_length: i64,
    source_hash: String,
}

fn verify_source_file_path(
    source_file_path: Option<&str>,
    analysis: &ReferenceFileAnalysisInput,
) -> Result<Option<SourceFileFingerprint>, AppError> {
    let Some(path) = source_file_path else {
        return Ok(None);
    };
    if path.trim().is_empty() || path.contains('\0') {
        return Err(input_error("参考资料源文件路径无效"));
    }
    let metadata = fs::metadata(path).map_err(|_| content_error("参考资料源文件无法读取"))?;
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_REFERENCE_BYTES as u64
        || metadata.len() as i64 != analysis.source_byte_length
    {
        return Err(content_error("参考资料源文件字节数与解析结果不一致"));
    }
    let bytes = fs::read(path).map_err(|_| content_error("参考资料源文件无法读取"))?;
    let fingerprint = SourceFileFingerprint {
        byte_length: bytes.len() as i64,
        source_hash: large_text_repository::sha256_bytes(&bytes),
    };
    if fingerprint.byte_length != analysis.source_byte_length
        || fingerprint.source_hash != analysis.source_hash
    {
        return Err(content_error("参考资料源文件字节哈希与解析结果不一致"));
    }
    Ok(Some(fingerprint))
}

fn normalize_section_page(offset: i64, limit: i64) -> Result<(i64, i64), AppError> {
    if offset < 0 || !(1..=MAX_REFERENCE_SECTION_PAGE_SIZE).contains(&limit) {
        return Err(input_error("参考章节分页参数无效"));
    }
    Ok((offset, limit))
}

fn validate_identity(value: &str, field: &str, maximum: usize) -> Result<(), AppError> {
    if value.trim().is_empty() || value.chars().count() > maximum {
        return Err(input_error(format!("{} 无效", field)));
    }
    Ok(())
}

fn utf16_range_matches(
    units: &[u16],
    start: i64,
    end: i64,
    expected: &str,
) -> Result<bool, AppError> {
    if start < 0 || end <= start {
        return Err(content_error("参考章节 UTF-16 区间无效"));
    }
    let start = start as usize;
    let end = end as usize;
    if end > units.len() {
        return Err(content_error("参考章节 UTF-16 区间越界"));
    }
    Ok(expected
        .encode_utf16()
        .eq(units[start..end].iter().copied()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SectionPlanIdentity<'a> {
    order_index: i64,
    title: &'a str,
    content_hash: &'a str,
    char_count: i64,
    source_start_utf16: i64,
    source_end_utf16: i64,
}

fn validate_analysis(analysis: &ReferenceFileAnalysisInput) -> Result<(), AppError> {
    let file_name = analysis.file_name.trim();
    if file_name.is_empty()
        || file_name.chars().count() > 255
        || !file_name.to_ascii_lowercase().ends_with(".txt")
    {
        return Err(input_error("参考资料文件名或格式无效"));
    }
    if !matches!(
        analysis.encoding.as_str(),
        "utf-8" | "utf-16le" | "utf-16be" | "gb18030"
    ) || !matches!(
        analysis.encoding_source.as_str(),
        "bom" | "utf8_valid" | "fallback" | "user_override"
    ) {
        return Err(input_error("参考资料编码元数据无效"));
    }
    if !valid_hash(&analysis.source_hash)
        || !valid_hash(&analysis.decoded_text_hash)
        || !valid_hash(&analysis.section_plan_hash)
    {
        return Err(input_error("参考资料哈希元数据无效"));
    }
    if analysis.source_byte_length <= 0 || analysis.source_byte_length > MAX_REFERENCE_BYTES {
        return Err(input_error("参考资料原始字节数超出限制"));
    }
    if analysis.total_chars <= 0 || analysis.total_chars > MAX_REFERENCE_CHARS {
        return Err(input_error("参考资料字符数超出限制"));
    }
    if analysis.sections.is_empty() || analysis.sections.len() > MAX_REFERENCE_SECTIONS {
        return Err(input_error("参考资料章节数超出限制"));
    }
    if analysis.parser_version.trim().is_empty() || analysis.parser_version.chars().count() > 96 {
        return Err(input_error("参考资料解析器版本无效"));
    }
    if analysis.warnings.len() > 64
        || analysis
            .warnings
            .iter()
            .any(|warning| warning.chars().count() > 500)
    {
        return Err(input_error("参考资料警告元数据无效"));
    }
    if analysis.text.chars().count() as i64 != analysis.total_chars
        || analysis.text.len() as i64 != analysis.decoded_utf8_byte_length
        || large_text_repository::sha256(&analysis.text) != analysis.decoded_text_hash
    {
        return Err(content_error("参考资料正文计数或哈希不一致"));
    }

    // Build the UTF-16 representation once. Rebuilding it for every section makes
    // validation O(section_count * source_length) and becomes prohibitive for a
    // long reference split into thousands of chapters.
    let source_utf16 = analysis.text.encode_utf16().collect::<Vec<_>>();
    for (index, section) in analysis.sections.iter().enumerate() {
        validate_section(section, index + 1, &source_utf16)?;
    }
    let plan = analysis
        .sections
        .iter()
        .map(|section| SectionPlanIdentity {
            order_index: section.order_index,
            title: &section.title,
            content_hash: &section.content_hash,
            char_count: section.char_count,
            source_start_utf16: section.source_start_utf16,
            source_end_utf16: section.source_end_utf16,
        })
        .collect::<Vec<_>>();
    let serialized =
        serde_json::to_string(&plan).map_err(|_| content_error("参考资料章节计划无法序列化"))?;
    if large_text_repository::sha256(&serialized) != analysis.section_plan_hash {
        return Err(content_error("参考资料章节计划哈希不一致"));
    }
    Ok(())
}

fn validate_section(
    section: &ReferenceSectionInput,
    expected_index: usize,
    source_utf16: &[u16],
) -> Result<(), AppError> {
    if section.order_index != expected_index as i64
        || section.title.trim().is_empty()
        || section.title.chars().count() > 160
        || section.content.is_empty()
        || !valid_hash(&section.content_hash)
    {
        return Err(content_error("参考资料章节身份无效"));
    }
    if section.content.chars().count() as i64 != section.char_count
        || large_text_repository::sha256(&section.content) != section.content_hash
    {
        return Err(content_error("参考资料章节计数或哈希不一致"));
    }
    if !utf16_range_matches(
        source_utf16,
        section.source_start_utf16,
        section.source_end_utf16,
        &section.content,
    )? {
        return Err(content_error("参考资料章节范围与权威正文不一致"));
    }
    Ok(())
}

fn request_hash(input: &ImportReferenceWorkInput) -> String {
    let action = match input.duplicate_action {
        ReferenceDuplicateAction::Skip => "skip",
        ReferenceDuplicateAction::CreateWork => "createWork",
        ReferenceDuplicateAction::CreateVersion => "createVersion",
    };
    let identity = serde_json::json!({
        "novelId": input.novel_id,
        "action": action,
        "duplicateImportId": input.duplicate_import_id,
        "workId": input.work_id,
        "title": input.title.as_deref().map(str::trim),
        "purpose": input.purpose,
        "description": input
            .description
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        "sourceFilePath": input.source_file_path,
        "fileName": input.analysis.file_name,
        "encoding": input.analysis.encoding,
        "encodingSource": input.analysis.encoding_source,
        "sourceHash": input.analysis.source_hash,
        "decodedTextHash": input.analysis.decoded_text_hash,
        "sourceByteLength": input.analysis.source_byte_length,
        "decodedUtf8ByteLength": input.analysis.decoded_utf8_byte_length,
        "totalChars": input.analysis.total_chars,
        "parserVersion": input.analysis.parser_version,
        "sectionPlanHash": input.analysis.section_plan_hash,
        "warnings": input.analysis.warnings,
    });
    large_text_repository::sha256(&identity.to_string())
}

fn require_novel(transaction: &Transaction<'_>, novel_id: &str) -> Result<(), AppError> {
    let count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM novels WHERE id = ?1",
            params![novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if count != 1 {
        return Err(AppError::new(
            codes::TARGET_NOVEL_NOT_FOUND,
            "目标小说不存在",
            false,
        ));
    }
    Ok(())
}

pub fn inspect_duplicates(
    connection: &Connection,
    input: InspectReferenceDuplicatesInput,
) -> Result<InspectReferenceDuplicateResultDto, AppError> {
    validate_identity(&input.novel_id, "novelId", 160)?;
    if !valid_hash(&input.source_hash) {
        return Err(input_error("参考资料原始文件哈希无效"));
    }
    Ok(InspectReferenceDuplicateResultDto {
        matches: reference_library_repository::inspect_duplicates(
            connection,
            &input.novel_id,
            &input.source_hash,
        )?,
        novel_id: input.novel_id,
        source_hash: input.source_hash,
    })
}

pub fn list_works(
    connection: &Connection,
    novel_id: &str,
) -> Result<Vec<crate::domain::reference_library::ReferenceWorkDto>, AppError> {
    validate_identity(novel_id, "novelId", 160)?;
    reference_library_repository::list_works(connection, novel_id)
}

pub fn get_bundle(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
) -> Result<ReferenceWorkBundleDto, AppError> {
    get_bundle_page(
        connection,
        novel_id,
        work_id,
        0,
        DEFAULT_REFERENCE_SECTION_PAGE_SIZE,
    )
}

pub fn get_bundle_page(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
    section_offset: i64,
    section_limit: i64,
) -> Result<ReferenceWorkBundleDto, AppError> {
    validate_identity(novel_id, "novelId", 160)?;
    validate_identity(work_id, "workId", 160)?;
    let (section_offset, section_limit) = normalize_section_page(section_offset, section_limit)?;
    reference_library_repository::get_bundle(
        connection,
        novel_id,
        work_id,
        section_offset,
        section_limit,
    )?
    .ok_or_else(|| {
        AppError::new(
            codes::REFERENCE_WORK_NOT_FOUND,
            "参考作品不存在或不属于当前小说",
            false,
        )
    })
}

pub fn get_legacy_bundle(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
) -> Result<LegacyReferenceWorkBundleDto, AppError> {
    validate_identity(novel_id, "novelId", 160)?;
    validate_identity(work_id, "workId", 160)?;
    reference_library_repository::get_legacy_bundle(connection, novel_id, work_id)?.ok_or_else(
        || {
            AppError::new(
                codes::REFERENCE_WORK_NOT_FOUND,
                "参考作品不存在或不属于当前小说",
                false,
            )
        },
    )
}

pub fn list_sections(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
    import_id: &str,
    offset: i64,
    limit: i64,
) -> Result<ReferenceSectionPageDto, AppError> {
    validate_identity(novel_id, "novelId", 160)?;
    validate_identity(work_id, "workId", 160)?;
    validate_identity(import_id, "importId", 160)?;
    let (offset, limit) = normalize_section_page(offset, limit)?;
    let import = reference_library_repository::get_import(connection, novel_id, import_id)?
        .filter(|item| item.work_id == work_id)
        .ok_or_else(|| {
            AppError::new(
                codes::REFERENCE_IMPORT_NOT_FOUND,
                "参考导入版本不存在或不属于目标作品",
                false,
            )
        })?;
    reference_library_repository::list_section_metadata(
        connection, novel_id, work_id, &import.id, offset, limit,
    )
}

pub fn get_section_content(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
    import_id: &str,
    section_id: &str,
) -> Result<ReferenceSectionDto, AppError> {
    validate_identity(novel_id, "novelId", 160)?;
    validate_identity(work_id, "workId", 160)?;
    validate_identity(import_id, "importId", 160)?;
    validate_identity(section_id, "sectionId", 160)?;
    reference_library_repository::get_section(connection, novel_id, work_id, import_id, section_id)?
        .ok_or_else(|| {
            AppError::new(
                codes::REFERENCE_SCOPE_MISMATCH,
                "参考章节不存在或不属于指定版本",
                false,
            )
        })
}

pub fn commit_import(
    connection: &mut Connection,
    input: ImportReferenceWorkInput,
) -> Result<ImportReferenceWorkResultDto, AppError> {
    validate_identity(&input.operation_id, "operationId", 200)?;
    validate_identity(&input.novel_id, "novelId", 160)?;
    validate_analysis(&input.analysis)?;
    // Desktop imports are verified independently from the renderer-provided hash,
    // then verified again at the commit boundary to close the file-change window.
    let initial_source_fingerprint =
        verify_source_file_path(input.source_file_path.as_deref(), &input.analysis)?;
    let expected_request_hash = request_hash(&input);

    if input.duplicate_action == ReferenceDuplicateAction::Skip {
        let commit_source_fingerprint =
            verify_source_file_path(input.source_file_path.as_deref(), &input.analysis)?;
        if commit_source_fingerprint != initial_source_fingerprint {
            return Err(content_error("参考资料源文件在重复检查期间发生变化"));
        }
        let duplicate_id = input
            .duplicate_import_id
            .as_deref()
            .ok_or_else(|| input_error("跳过重复导入时必须指定已有版本"))?;
        let existing =
            reference_library_repository::get_import(connection, &input.novel_id, duplicate_id)?
                .filter(|item| item.source_hash == input.analysis.source_hash)
                .ok_or_else(|| {
                    AppError::new(
                        codes::REFERENCE_IMPORT_NOT_FOUND,
                        "指定的重复参考版本不存在或哈希不一致",
                        false,
                    )
                })?;
        return Ok(ImportReferenceWorkResultDto {
            action: ReferenceDuplicateAction::Skip,
            bundle: get_bundle(connection, &input.novel_id, &existing.work_id)?,
            created: false,
        });
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    require_novel(&transaction, &input.novel_id)?;

    if let Some((_, work_id, novel_id, actual_hash)) =
        reference_library_repository::replay_identity(&transaction, &input.operation_id)?
    {
        if novel_id != input.novel_id || actual_hash != expected_request_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "参考资料导入 operationId 已用于不同请求",
                false,
            )
            .with_context(None, Some(&input.operation_id)));
        }
        let bundle = get_bundle(&transaction, &input.novel_id, &work_id)?;
        let commit_source_fingerprint =
            verify_source_file_path(input.source_file_path.as_deref(), &input.analysis)?;
        if commit_source_fingerprint != initial_source_fingerprint {
            return Err(content_error("参考资料源文件在导入提交前发生变化"));
        }
        transaction.commit().map_err(AppError::database)?;
        return Ok(ImportReferenceWorkResultDto {
            action: input.duplicate_action,
            bundle,
            created: true,
        });
    }

    let now = Utc::now().to_rfc3339();
    let work_id = match input.duplicate_action {
        ReferenceDuplicateAction::CreateWork => {
            let title = input
                .title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.chars().count() <= 200)
                .ok_or_else(|| input_error("新建参考作品时必须提供有效标题"))?;
            let purpose = input
                .purpose
                .as_deref()
                .filter(|value| matches!(*value, "style" | "research" | "inspiration"))
                .ok_or_else(|| input_error("新建参考作品时必须提供有效用途"))?;
            let description = input
                .description
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if description
                .map(|value| value.chars().count() > 2000)
                .unwrap_or(false)
            {
                return Err(input_error("参考作品说明过长"));
            }
            let id = Uuid::new_v4().to_string();
            transaction
                .execute(
                    "INSERT INTO reference_works
                        (id, novel_id, title, purpose, description, revision, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
                    params![id, input.novel_id, title, purpose, description, now],
                )
                .map_err(AppError::database)?;
            id
        }
        ReferenceDuplicateAction::CreateVersion => {
            let id = input
                .work_id
                .as_deref()
                .ok_or_else(|| input_error("新增参考版本时必须指定参考作品"))?;
            if reference_library_repository::work_revision(&transaction, &input.novel_id, id)?
                .is_none()
            {
                return Err(AppError::new(
                    codes::REFERENCE_WORK_NOT_FOUND,
                    "目标参考作品不存在或不属于当前小说",
                    false,
                ));
            }
            id.to_string()
        }
        ReferenceDuplicateAction::Skip => unreachable!(),
    };

    let version: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(version_no), 0) + 1 FROM reference_imports
             WHERE reference_work_id = ?1 AND novel_id = ?2",
            params![work_id, input.novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE reference_imports SET is_current = 0
             WHERE reference_work_id = ?1 AND novel_id = ?2 AND is_current = 1",
            params![work_id, input.novel_id],
        )
        .map_err(AppError::database)?;

    let import_id = Uuid::new_v4().to_string();
    let (source_text, large_text_ref_id) =
        if input.analysis.text.len() >= large_text_repository::LARGE_TEXT_THRESHOLD_BYTES {
            let document_id = Uuid::new_v4().to_string();
            large_text_repository::insert_document_for_target(
                &transaction,
                &document_id,
                "reference_import",
                &import_id,
                "source_text",
                Some(&input.analysis.file_name),
                &input.analysis.text,
                &input.analysis.decoded_text_hash,
                &now,
            )?;
            (
                input
                    .analysis
                    .text
                    .chars()
                    .take(SOURCE_TEXT_PREVIEW_CHARS)
                    .collect::<String>(),
                Some(document_id),
            )
        } else {
            (input.analysis.text.clone(), None)
        };
    let warnings_json = serde_json::to_string(&input.analysis.warnings)
        .map_err(|_| input_error("参考资料警告元数据无法序列化"))?;
    let detected_encoding = if input.analysis.encoding_source == "user_override" {
        None
    } else {
        Some(input.analysis.encoding.as_str())
    };
    transaction
        .execute(
            "INSERT INTO reference_imports
                (id, reference_work_id, novel_id, version_no, is_current, operation_id,
                 request_hash, file_name, source_file_path, source_format, source_sha256,
                 source_byte_count, detected_encoding, selected_encoding, encoding_source,
                 decoded_text_sha256, decoded_char_count, decoded_utf8_byte_count, source_text,
                 large_text_ref_id, section_count, parser_version, section_plan_sha256,
                 warnings_json, imported_at)
             VALUES (?1,?2,?3,?4,1,?5,?6,?7,?8,'txt',?9,?10,?11,?12,?13,
                     ?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
            params![
                import_id,
                work_id,
                input.novel_id,
                version,
                input.operation_id,
                expected_request_hash,
                input.analysis.file_name,
                input.source_file_path,
                input.analysis.source_hash,
                input.analysis.source_byte_length,
                detected_encoding,
                input.analysis.encoding,
                input.analysis.encoding_source,
                input.analysis.decoded_text_hash,
                input.analysis.total_chars,
                input.analysis.decoded_utf8_byte_length,
                source_text,
                large_text_ref_id,
                input.analysis.sections.len() as i64,
                input.analysis.parser_version,
                input.analysis.section_plan_hash,
                warnings_json,
                now,
            ],
        )
        .map_err(AppError::database)?;

    for section in &input.analysis.sections {
        let title_lower = section.title.to_lowercase();
        let kind = if section.title == "前言" {
            "front_matter"
        } else if section.title.starts_with('第') || title_lower.starts_with("chapter") {
            "chapter"
        } else {
            "unstructured"
        };
        let section_id = Uuid::new_v4().to_string();
        let (section_content, section_large_text_ref_id) =
            if section.content.len() >= large_text_repository::LARGE_TEXT_THRESHOLD_BYTES {
                let document_id = Uuid::new_v4().to_string();
                large_text_repository::insert_document_for_target(
                    &transaction,
                    &document_id,
                    "reference_section",
                    &section_id,
                    "content",
                    Some(&section.title),
                    &section.content,
                    &section.content_hash,
                    &now,
                )?;
                (
                    section
                        .content
                        .chars()
                        .take(SECTION_TEXT_PREVIEW_CHARS)
                        .collect::<String>(),
                    Some(document_id),
                )
            } else {
                (section.content.clone(), None)
            };
        transaction
            .execute(
                "INSERT INTO reference_sections
                    (id, reference_import_id, reference_work_id, novel_id, order_index,
                     section_kind, title, content, large_text_ref_id, content_hash, char_count,
                     utf8_byte_count, source_start_utf16, source_end_utf16, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                params![
                    section_id,
                    import_id,
                    work_id,
                    input.novel_id,
                    section.order_index,
                    kind,
                    section.title,
                    section_content,
                    section_large_text_ref_id,
                    section.content_hash,
                    section.char_count,
                    section.content.len() as i64,
                    section.source_start_utf16,
                    section.source_end_utf16,
                    now,
                ],
            )
            .map_err(AppError::database)?;
    }
    if input.duplicate_action == ReferenceDuplicateAction::CreateVersion {
        transaction
            .execute(
                "UPDATE reference_works SET revision = revision + 1, updated_at = ?1
                 WHERE id = ?2 AND novel_id = ?3",
                params![now, work_id, input.novel_id],
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "UPDATE style_profiles
                 SET source_state = 'outdated', updated_at = ?1
                 WHERE novel_id = ?2 AND source_reference_work_id = ?3
                   AND source_reference_import_id IS NOT NULL
                   AND source_reference_import_id <> ?4",
                params![now, input.novel_id, work_id, import_id],
            )
            .map_err(AppError::database)?;
    }

    let commit_source_fingerprint =
        verify_source_file_path(input.source_file_path.as_deref(), &input.analysis)?;
    if commit_source_fingerprint != initial_source_fingerprint {
        return Err(content_error("参考资料源文件在导入提交前发生变化"));
    }
    transaction.commit().map_err(|error| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "参考资料导入提交结果未知，请使用原 operationId 重试",
            true,
        )
        .with_context(None, Some(&input.operation_id))
        .with_details(serde_json::json!({ "sqliteError": error.to_string() }))
    })?;
    Ok(ImportReferenceWorkResultDto {
        action: input.duplicate_action,
        bundle: get_bundle(connection, &input.novel_id, &work_id)?,
        created: true,
    })
}

pub fn activate_import(
    connection: &mut Connection,
    input: ActivateReferenceImportInput,
) -> Result<ReferenceWorkBundleDto, AppError> {
    validate_identity(&input.novel_id, "novelId", 160)?;
    validate_identity(&input.work_id, "workId", 160)?;
    validate_identity(&input.import_id, "importId", 160)?;
    if input.expected_revision < 1 {
        return Err(input_error("expectedRevision 无效"));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let revision =
        reference_library_repository::work_revision(&transaction, &input.novel_id, &input.work_id)?
            .ok_or_else(|| {
                AppError::new(
                    codes::REFERENCE_WORK_NOT_FOUND,
                    "参考作品不存在或不属于当前小说",
                    false,
                )
            })?;
    if revision != input.expected_revision {
        return Err(AppError::new(
            codes::REFERENCE_VERSION_CONFLICT,
            "参考作品已被其他操作更新",
            true,
        ));
    }
    let target =
        reference_library_repository::get_import(&transaction, &input.novel_id, &input.import_id)?
            .filter(|item| item.work_id == input.work_id)
            .ok_or_else(|| {
                AppError::new(
                    codes::REFERENCE_IMPORT_NOT_FOUND,
                    "参考导入版本不存在或不属于目标作品",
                    false,
                )
            })?;
    transaction
        .execute(
            "UPDATE reference_imports SET is_current = 0
             WHERE novel_id = ?1 AND reference_work_id = ?2 AND is_current = 1",
            params![input.novel_id, input.work_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE reference_imports SET is_current = 1
             WHERE novel_id = ?1 AND reference_work_id = ?2 AND id = ?3",
            params![input.novel_id, input.work_id, input.import_id],
        )
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE reference_works SET revision = revision + 1, updated_at = ?1
             WHERE novel_id = ?2 AND id = ?3 AND revision = ?4",
            params![now, input.novel_id, input.work_id, input.expected_revision],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE style_profiles SET source_state = CASE
                 WHEN source_reference_import_id = ?1 THEN 'available' ELSE 'outdated' END,
                 updated_at = ?2
             WHERE novel_id = ?3 AND source_reference_work_id = ?4",
            params![target.id, now, input.novel_id, input.work_id],
        )
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    get_bundle(connection, &input.novel_id, &input.work_id)
}

pub fn delete_work(
    connection: &mut Connection,
    input: DeleteReferenceWorkInput,
) -> Result<(), AppError> {
    validate_identity(&input.novel_id, "novelId", 160)?;
    validate_identity(&input.work_id, "workId", 160)?;
    if input.expected_revision < 1 {
        return Err(input_error("expectedRevision 无效"));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let Some(revision) =
        reference_library_repository::work_revision(&transaction, &input.novel_id, &input.work_id)?
    else {
        transaction.commit().map_err(AppError::database)?;
        return Ok(());
    };
    if revision != input.expected_revision {
        return Err(AppError::new(
            codes::REFERENCE_VERSION_CONFLICT,
            "参考作品已被其他操作更新",
            true,
        ));
    }
    let large_text_ids = reference_library_repository::current_large_text_ids(
        &transaction,
        &input.novel_id,
        &input.work_id,
    )?;
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE style_profiles
             SET source_reference_work_id = NULL, source_reference_import_id = NULL,
                 source_state = 'missing', updated_at = ?1
             WHERE novel_id = ?2 AND source_reference_work_id = ?3",
            params![now, input.novel_id, input.work_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "DELETE FROM reference_works WHERE novel_id = ?1 AND id = ?2 AND revision = ?3",
            params![input.novel_id, input.work_id, input.expected_revision],
        )
        .map_err(AppError::database)?;
    for document_id in large_text_ids {
        transaction
            .execute(
                "DELETE FROM large_text_documents WHERE id = ?1",
                params![document_id],
            )
            .map_err(AppError::database)?;
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::reference_library::{
        ImportReferenceWorkInput, ReferenceDuplicateAction, ReferenceFileAnalysisInput,
        ReferenceSectionInput,
    };
    use rusqlite::Connection;

    fn setup() -> Result<Connection, AppError> {
        let mut connection = Connection::open_in_memory().map_err(AppError::database)?;
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(AppError::database)?;
        crate::db::create_tables(&mut connection)?;
        connection
            .execute(
                "INSERT INTO novels (id, title, created_at, updated_at)
                 VALUES ('novel-1', '测试作品', '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z')",
                [],
            )
            .map_err(AppError::database)?;
        connection
            .execute(
                "INSERT INTO novels (id, title, created_at, updated_at)
                 VALUES ('novel-2', '另一作品', '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z')",
                [],
            )
            .map_err(AppError::database)?;
        Ok(connection)
    }

    fn analysis(text: &str) -> ReferenceFileAnalysisInput {
        let content_hash = large_text_repository::sha256(text);
        let section = ReferenceSectionInput {
            order_index: 1,
            title: "全文".to_string(),
            content: text.to_string(),
            content_hash: content_hash.clone(),
            char_count: text.chars().count() as i64,
            source_start_utf16: 0,
            source_end_utf16: text.encode_utf16().count() as i64,
        };
        let plan = vec![SectionPlanIdentity {
            order_index: section.order_index,
            title: &section.title,
            content_hash: &section.content_hash,
            char_count: section.char_count,
            source_start_utf16: section.source_start_utf16,
            source_end_utf16: section.source_end_utf16,
        }];
        let plan_json = serde_json::to_string(&plan).expect("section plan should serialize");
        ReferenceFileAnalysisInput {
            file_name: "reference.txt".to_string(),
            encoding: "utf-8".to_string(),
            encoding_source: "utf8_valid".to_string(),
            source_hash: "a".repeat(64),
            decoded_text_hash: content_hash,
            source_byte_length: text.len() as i64,
            decoded_utf8_byte_length: text.len() as i64,
            total_chars: text.chars().count() as i64,
            parser_version: "reference_txt_parser_v1".to_string(),
            section_plan_hash: large_text_repository::sha256(&plan_json),
            sections: vec![section],
            warnings: Vec::new(),
            text: text.to_string(),
        }
    }

    fn analysis_for_sections(parts: &[(&str, &str)]) -> ReferenceFileAnalysisInput {
        let mut text = String::new();
        let mut sections = Vec::with_capacity(parts.len());
        let mut utf16_offset = 0_i64;
        for (index, (title, content)) in parts.iter().enumerate() {
            let source_start_utf16 = utf16_offset;
            text.push_str(content);
            utf16_offset += content.encode_utf16().count() as i64;
            sections.push(ReferenceSectionInput {
                order_index: index as i64 + 1,
                title: (*title).to_string(),
                content: (*content).to_string(),
                content_hash: large_text_repository::sha256(content),
                char_count: content.chars().count() as i64,
                source_start_utf16,
                source_end_utf16: utf16_offset,
            });
        }
        let plan = sections
            .iter()
            .map(|section| SectionPlanIdentity {
                order_index: section.order_index,
                title: &section.title,
                content_hash: &section.content_hash,
                char_count: section.char_count,
                source_start_utf16: section.source_start_utf16,
                source_end_utf16: section.source_end_utf16,
            })
            .collect::<Vec<_>>();
        let plan_json = serde_json::to_string(&plan).expect("section plan should serialize");
        ReferenceFileAnalysisInput {
            file_name: "reference.txt".to_string(),
            encoding: "utf-8".to_string(),
            encoding_source: "utf8_valid".to_string(),
            source_hash: large_text_repository::sha256_bytes(text.as_bytes()),
            decoded_text_hash: large_text_repository::sha256(&text),
            source_byte_length: text.len() as i64,
            decoded_utf8_byte_length: text.len() as i64,
            total_chars: text.chars().count() as i64,
            parser_version: "reference_txt_parser_v1".to_string(),
            section_plan_hash: large_text_repository::sha256(&plan_json),
            sections,
            warnings: Vec::new(),
            text,
        }
    }

    #[test]
    fn validates_many_unicode_sections_without_rebuilding_the_source_index() {
        let owned_parts = (1..=2_000)
            .map(|index| {
                (
                    format!("第 {index} 章"),
                    format!("第 {index} 段🙂参考正文。\n"),
                )
            })
            .collect::<Vec<_>>();
        let borrowed_parts = owned_parts
            .iter()
            .map(|(title, content)| (title.as_str(), content.as_str()))
            .collect::<Vec<_>>();
        let analysis = analysis_for_sections(&borrowed_parts);

        validate_analysis(&analysis)
            .expect("many UTF-16 ranges should validate in one source pass");
    }

    #[test]
    fn applies_user_visible_limits_by_unicode_character_count(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let mut accepted = create_work_input("operation-unicode-limits", "参考正文");
        accepted.title = Some("题".repeat(200));
        accepted.description = Some("说明".repeat(1_000));
        let created = commit_import(&mut connection, accepted)?;
        assert_eq!(created.bundle.work.title.chars().count(), 200);
        assert_eq!(
            created
                .bundle
                .work
                .description
                .as_deref()
                .map(|value| value.chars().count()),
            Some(2_000)
        );

        let mut rejected = create_work_input("operation-unicode-too-long", "另一正文");
        rejected.title = Some("题".repeat(201));
        let error = commit_import(&mut connection, rejected).expect_err("title limit must close");
        assert_eq!(error.code, codes::REFERENCE_INPUT_INVALID);
        Ok(())
    }

    fn create_work_input(operation_id: &str, text: &str) -> ImportReferenceWorkInput {
        ImportReferenceWorkInput {
            operation_id: operation_id.to_string(),
            novel_id: "novel-1".to_string(),
            duplicate_action: ReferenceDuplicateAction::CreateWork,
            duplicate_import_id: None,
            work_id: None,
            title: Some("参考作品".to_string()),
            purpose: Some("style".to_string()),
            description: Some("分层分析来源".to_string()),
            source_file_path: None,
            analysis: analysis(text),
        }
    }

    #[test]
    fn imports_replay_and_explicit_duplicate_decisions_are_deterministic(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let input = create_work_input("operation-create-1", "第一段🙂正文。第二段正文。");
        let created = commit_import(&mut connection, input.clone())?;
        assert!(created.created);
        assert_eq!(created.bundle.work.revision, 1);
        assert_eq!(created.bundle.sections.len(), 1);
        assert_eq!(created.bundle.section_total, 1);
        assert_eq!(created.bundle.sections[0].content_storage, "inline");
        let section = get_section_content(
            &connection,
            "novel-1",
            &created.bundle.work.id,
            &created.bundle.work.active_import_id,
            &created.bundle.sections[0].id,
        )?;
        assert_eq!(section.content, "第一段🙂正文。第二段正文。");

        let replay = commit_import(&mut connection, input.clone())?;
        assert_eq!(replay.bundle.work.id, created.bundle.work.id);
        let import_count: i64 =
            connection.query_row("SELECT COUNT(*) FROM reference_imports", [], |row| {
                row.get(0)
            })?;
        assert_eq!(import_count, 1);

        let inspected = inspect_duplicates(
            &connection,
            InspectReferenceDuplicatesInput {
                novel_id: "novel-1".to_string(),
                source_hash: "a".repeat(64),
            },
        )?;
        assert_eq!(inspected.matches.len(), 1);
        let skipped = commit_import(
            &mut connection,
            ImportReferenceWorkInput {
                operation_id: "operation-skip-1".to_string(),
                duplicate_action: ReferenceDuplicateAction::Skip,
                duplicate_import_id: Some(created.bundle.work.active_import_id.clone()),
                ..input.clone()
            },
        )?;
        assert!(!skipped.created);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM reference_imports", [], |row| row
                .get::<_, i64>(0))?,
            1
        );

        let mut conflicting = input;
        conflicting.description = Some("不同的持久化说明".to_string());
        let error = commit_import(&mut connection, conflicting).expect_err("operation conflict");
        assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);
        Ok(())
    }

    #[test]
    fn versions_activation_and_source_state_follow_the_current_import(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let first = commit_import(
            &mut connection,
            create_work_input("operation-version-1", "第一版正文🙂"),
        )?;
        let work_id = first.bundle.work.id.clone();
        let first_import_id = first.bundle.work.active_import_id.clone();
        connection.execute(
            "INSERT INTO style_profiles
                (id, novel_id, name, source_type, source_reference_work_id,
                 source_reference_import_id, source_content_sha256, source_state,
                 created_at, updated_at)
             VALUES ('style-reference', 'novel-1', '画像', 'ai_analyzed', ?1, ?2, ?3,
                     'available', '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z')",
            params![
                work_id,
                first_import_id,
                first.bundle.work.active_source_hash
            ],
        )?;

        let mut second_input = create_work_input("operation-version-2", "第二版正文🙂");
        second_input.duplicate_action = ReferenceDuplicateAction::CreateVersion;
        second_input.work_id = Some(work_id.clone());
        second_input.title = None;
        second_input.purpose = None;
        let second = commit_import(&mut connection, second_input)?;
        assert_eq!(second.bundle.work.revision, 2);
        assert_eq!(second.bundle.imports.len(), 2);
        assert_eq!(
            second
                .bundle
                .imports
                .iter()
                .filter(|item| item.is_current)
                .count(),
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT source_state FROM style_profiles WHERE id = 'style-reference'",
                [],
                |row| row.get::<_, String>(0),
            )?,
            "outdated"
        );

        let activated = activate_import(
            &mut connection,
            ActivateReferenceImportInput {
                novel_id: "novel-1".to_string(),
                work_id: work_id.clone(),
                import_id: first_import_id.clone(),
                expected_revision: 2,
            },
        )?;
        assert_eq!(activated.work.revision, 3);
        assert_eq!(activated.work.active_import_id, first_import_id);
        assert_eq!(
            connection.query_row(
                "SELECT source_state FROM style_profiles WHERE id = 'style-reference'",
                [],
                |row| row.get::<_, String>(0),
            )?,
            "available"
        );

        let conflict = activate_import(
            &mut connection,
            ActivateReferenceImportInput {
                novel_id: "novel-1".to_string(),
                work_id,
                import_id: second.bundle.work.active_import_id,
                expected_revision: 2,
            },
        )
        .expect_err("stale revision must fail");
        assert_eq!(conflict.code, codes::REFERENCE_VERSION_CONFLICT);
        Ok(())
    }

    #[test]
    fn tampering_and_cross_novel_injection_leave_no_partial_rows(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let mut tampered = create_work_input("operation-tampered", "权威正文🙂");
        tampered.analysis.sections[0].content.push('改');
        let error = commit_import(&mut connection, tampered).expect_err("tamper must fail");
        assert_eq!(error.code, codes::REFERENCE_CONTENT_INVALID);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM reference_works", [], |row| row
                .get::<_, i64>(0))?,
            0
        );

        let first = commit_import(
            &mut connection,
            create_work_input("operation-scope-1", "作用域正文"),
        )?;
        let mut injected = create_work_input("operation-scope-2", "另一版本");
        injected.novel_id = "novel-2".to_string();
        injected.duplicate_action = ReferenceDuplicateAction::CreateVersion;
        injected.work_id = Some(first.bundle.work.id);
        injected.title = None;
        injected.purpose = None;
        let error =
            commit_import(&mut connection, injected).expect_err("scope injection must fail");
        assert_eq!(error.code, codes::REFERENCE_WORK_NOT_FOUND);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM reference_imports", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        Ok(())
    }

    #[test]
    fn bundle_defaults_to_metadata_paging_and_single_section_reads_full_content(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let mut input = create_work_input("operation-paged-sections", "placeholder");
        input.analysis = analysis_for_sections(&[
            ("第一章", "第一章正文🙂"),
            ("第二章", "Second section body"),
            ("第三章", "第三章收束"),
        ]);
        let created = commit_import(&mut connection, input)?;
        let work_id = created.bundle.work.id;
        let import_id = created.bundle.work.active_import_id;

        let bundle = get_bundle_page(&connection, "novel-1", &work_id, 1, 1)?;
        assert_eq!(bundle.section_total, 3);
        assert_eq!(bundle.section_offset, 1);
        assert_eq!(bundle.section_limit, 1);
        assert_eq!(bundle.sections.len(), 1);
        assert_eq!(bundle.sections[0].order_index, 2);

        let page = list_sections(&connection, "novel-1", &work_id, &import_id, 2, 1)?;
        assert_eq!((page.total, page.offset, page.limit), (3, 2, 1));
        assert_eq!(page.items[0].title, "第三章");

        let section = get_section_content(
            &connection,
            "novel-1",
            &work_id,
            &import_id,
            &bundle.sections[0].id,
        )?;
        assert_eq!(section.content, "Second section body");

        let legacy = get_legacy_bundle(&connection, "novel-1", &work_id)?;
        assert_eq!(legacy.sections.len(), 3);
        assert_eq!(legacy.sections[2].content, "第三章收束");
        Ok(())
    }

    #[test]
    fn large_reference_section_round_trips_through_verified_large_text(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let long_text = "长篇章节🙂\r\nASCII words\r\n".repeat(12_000);
        assert!(long_text.len() >= large_text_repository::LARGE_TEXT_THRESHOLD_BYTES);
        let created = commit_import(
            &mut connection,
            create_work_input("operation-large-section", &long_text),
        )?;
        let metadata = &created.bundle.sections[0];
        assert_eq!(metadata.content_storage, "large_text");
        let (inline_chars, document_id): (i64, String) = connection.query_row(
            "SELECT length(content), large_text_ref_id FROM reference_sections WHERE id = ?1",
            params![metadata.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert!(inline_chars <= SECTION_TEXT_PREVIEW_CHARS as i64);
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM large_text_documents
                 WHERE target_type IN ('reference_import', 'reference_section')",
                [],
                |row| row.get::<_, i64>(0),
            )?,
            2
        );

        let full = get_section_content(
            &connection,
            "novel-1",
            &created.bundle.work.id,
            &created.bundle.work.active_import_id,
            &metadata.id,
        )?;
        assert_eq!(full.content, long_text);
        assert_eq!(
            full.content_hash,
            large_text_repository::sha256(&full.content)
        );

        connection.execute(
            "UPDATE large_text_chunks SET content = content || 'tampered'
             WHERE document_id = ?1 AND chunk_index = 0",
            params![document_id],
        )?;
        let error = get_section_content(
            &connection,
            "novel-1",
            &created.bundle.work.id,
            &created.bundle.work.active_import_id,
            &metadata.id,
        )
        .expect_err("corrupt section chunks must fail closed");
        assert_eq!(error.code, codes::LARGE_TEXT_HASH_MISMATCH);
        Ok(())
    }

    #[test]
    fn desktop_source_path_is_hashed_again_before_import_commit(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let path =
            std::env::temp_dir().join(format!("ai-novel-reference-source-{}.txt", Uuid::new_v4()));
        let original = "source-one";
        let changed = "source-two";
        assert_eq!(original.len(), changed.len());
        std::fs::write(&path, original.as_bytes())?;

        let mut input = create_work_input("operation-source-file-valid", original);
        input.source_file_path = Some(path.to_string_lossy().into_owned());
        input.analysis.source_hash = large_text_repository::sha256_bytes(original.as_bytes());
        let created = commit_import(&mut connection, input.clone())?;
        assert_eq!(
            created.bundle.work.active_source_hash,
            input.analysis.source_hash
        );
        assert_eq!(
            created.bundle.imports[0].source_file_path.as_deref(),
            input.source_file_path.as_deref()
        );

        std::fs::write(&path, changed.as_bytes())?;
        input.operation_id = "operation-source-file-changed".to_string();
        input.title = Some("Changed source must fail".to_string());
        let error =
            commit_import(&mut connection, input).expect_err("path hash mismatch must fail");
        assert_eq!(error.code, codes::REFERENCE_CONTENT_INVALID);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM reference_works", [], |row| {
                row.get::<_, i64>(0)
            })?,
            1
        );
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn deletion_cascades_large_text_and_preserves_profile_as_missing(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let long_text = "长篇正文🙂".repeat(30_000);
        let created = commit_import(
            &mut connection,
            create_work_input("operation-large-1", &long_text),
        )?;
        let work_id = created.bundle.work.id.clone();
        connection.execute(
            "INSERT INTO style_profiles
                (id, novel_id, name, source_type, source_reference_work_id,
                 source_reference_import_id, source_content_sha256, source_state,
                 created_at, updated_at)
             VALUES ('style-large', 'novel-1', '画像', 'ai_analyzed', ?1, ?2, ?3,
                     'available', '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z')",
            params![
                work_id,
                created.bundle.work.active_import_id,
                created.bundle.work.active_source_hash
            ],
        )?;
        assert!(
            connection.query_row(
                "SELECT COUNT(*) FROM large_text_documents WHERE target_type = 'reference_import'",
                [],
                |row| row.get::<_, i64>(0),
            )? > 0
        );

        delete_work(
            &mut connection,
            DeleteReferenceWorkInput {
                novel_id: "novel-1".to_string(),
                work_id,
                expected_revision: 1,
            },
        )?;
        for table in ["reference_works", "reference_imports", "reference_sections"] {
            let count: i64 =
                connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })?;
            assert_eq!(count, 0, "{table} should be empty");
        }
        assert_eq!(
            connection.query_row(
                "SELECT source_state FROM style_profiles WHERE id = 'style-large'",
                [],
                |row| row.get::<_, String>(0),
            )?,
            "missing"
        );
        assert_eq!(
            connection.query_row(
                "SELECT source_reference_work_id IS NULL AND source_reference_import_id IS NULL
                 FROM style_profiles WHERE id = 'style-large'",
                [],
                |row| row.get::<_, i64>(0),
            )?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM large_text_documents WHERE target_type = 'reference_import'",
                [],
                |row| row.get::<_, i64>(0),
            )?,
            0
        );
        Ok(())
    }
}
