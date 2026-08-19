use crate::domain::reference_library::{
    LegacyReferenceWorkBundleDto, ReferenceDuplicateMatchDto, ReferenceImportDto,
    ReferenceSectionDto, ReferenceSectionMetadataDto, ReferenceSectionPageDto,
    ReferenceWorkBundleDto, ReferenceWorkDto,
};
use crate::errors::AppError;
use crate::repositories::large_text_repository;
use rusqlite::{params, Connection, OptionalExtension, Row};

const WORK_SELECT: &str = "SELECT w.id, w.novel_id, w.title, w.purpose, w.description,
            i.id, i.source_sha256, w.revision, i.section_count,
            i.decoded_char_count, w.created_at, w.updated_at
     FROM reference_works w
     INNER JOIN reference_imports i
       ON i.reference_work_id = w.id AND i.novel_id = w.novel_id AND i.is_current = 1";

fn map_work(row: &Row<'_>) -> rusqlite::Result<ReferenceWorkDto> {
    Ok(ReferenceWorkDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        title: row.get(2)?,
        purpose: row.get(3)?,
        description: row.get(4)?,
        active_import_id: row.get(5)?,
        active_source_hash: row.get(6)?,
        revision: row.get(7)?,
        source_status: "available".to_string(),
        section_count: row.get(8)?,
        total_chars: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn map_import(row: &Row<'_>) -> rusqlite::Result<ReferenceImportDto> {
    let warnings_json: String = row.get(21)?;
    let warnings = serde_json::from_str::<Vec<String>>(&warnings_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            warnings_json.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    Ok(ReferenceImportDto {
        id: row.get(0)?,
        work_id: row.get(1)?,
        novel_id: row.get(2)?,
        version: row.get(3)?,
        is_current: row.get::<_, i64>(4)? == 1,
        operation_id: row.get(5)?,
        file_name: row.get(6)?,
        source_file_path: row.get(7)?,
        file_type: row.get(8)?,
        detected_encoding: row.get(9)?,
        encoding: row.get(10)?,
        encoding_source: row.get(11)?,
        source_hash: row.get(12)?,
        decoded_text_hash: row.get(13)?,
        source_byte_length: row.get(14)?,
        decoded_utf8_byte_length: row.get(15)?,
        total_chars: row.get(16)?,
        section_count: row.get(17)?,
        parser_version: row.get(18)?,
        section_plan_hash: row.get(19)?,
        imported_at: row.get(20)?,
        warnings,
    })
}

const IMPORT_SELECT: &str =
    "SELECT id, reference_work_id, novel_id, version_no, is_current, operation_id,
            file_name, source_file_path, source_format, detected_encoding, selected_encoding,
            encoding_source,
            source_sha256, decoded_text_sha256, source_byte_count, decoded_utf8_byte_count,
            decoded_char_count, section_count, parser_version, section_plan_sha256,
            imported_at, warnings_json
     FROM reference_imports";

fn map_section_metadata(row: &Row<'_>) -> rusqlite::Result<ReferenceSectionMetadataDto> {
    Ok(ReferenceSectionMetadataDto {
        id: row.get(0)?,
        import_id: row.get(1)?,
        work_id: row.get(2)?,
        novel_id: row.get(3)?,
        order_index: row.get(4)?,
        title: row.get(5)?,
        content_hash: row.get(6)?,
        char_count: row.get(7)?,
        utf8_byte_length: row.get(8)?,
        source_start_utf16: row.get(9)?,
        source_end_utf16: row.get(10)?,
        content_storage: if row.get::<_, Option<String>>(11)?.is_some() {
            "large_text".to_string()
        } else {
            "inline".to_string()
        },
    })
}

pub fn list_works(
    connection: &Connection,
    novel_id: &str,
) -> Result<Vec<ReferenceWorkDto>, AppError> {
    let sql = format!("{WORK_SELECT} WHERE w.novel_id = ?1 ORDER BY w.updated_at DESC, w.id DESC");
    connection
        .prepare(&sql)
        .map_err(AppError::database)?
        .query_map(params![novel_id], map_work)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

pub fn get_work(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
) -> Result<Option<ReferenceWorkDto>, AppError> {
    let sql = format!("{WORK_SELECT} WHERE w.novel_id = ?1 AND w.id = ?2");
    connection
        .query_row(&sql, params![novel_id, work_id], map_work)
        .optional()
        .map_err(AppError::database)
}

pub fn list_imports(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
) -> Result<Vec<ReferenceImportDto>, AppError> {
    let sql = format!(
        "{IMPORT_SELECT} WHERE novel_id = ?1 AND reference_work_id = ?2 ORDER BY version_no DESC"
    );
    connection
        .prepare(&sql)
        .map_err(AppError::database)?
        .query_map(params![novel_id, work_id], map_import)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

pub fn get_import(
    connection: &Connection,
    novel_id: &str,
    import_id: &str,
) -> Result<Option<ReferenceImportDto>, AppError> {
    let sql = format!("{IMPORT_SELECT} WHERE novel_id = ?1 AND id = ?2");
    connection
        .query_row(&sql, params![novel_id, import_id], map_import)
        .optional()
        .map_err(AppError::database)
}

pub fn list_sections(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
    import_id: &str,
) -> Result<Vec<ReferenceSectionDto>, AppError> {
    let page = list_section_metadata(connection, novel_id, work_id, import_id, 0, i64::MAX)?;
    page.items
        .into_iter()
        .map(|section| {
            get_section(connection, novel_id, work_id, import_id, &section.id)?.ok_or_else(|| {
                AppError::new(
                    crate::errors::codes::REFERENCE_CONTENT_INVALID,
                    "参考章节读取期间发生变化",
                    true,
                )
            })
        })
        .collect()
}

pub fn list_section_metadata(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
    import_id: &str,
    offset: i64,
    limit: i64,
) -> Result<ReferenceSectionPageDto, AppError> {
    let total = connection
        .query_row(
            "SELECT COUNT(*) FROM reference_sections
             WHERE novel_id = ?1 AND reference_work_id = ?2 AND reference_import_id = ?3",
            params![novel_id, work_id, import_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(AppError::database)?;
    let items = connection
        .prepare(
            "SELECT id, reference_import_id, reference_work_id, novel_id, order_index,
                    title, content_hash, char_count, utf8_byte_count,
                    source_start_utf16, source_end_utf16, large_text_ref_id
             FROM reference_sections
             WHERE novel_id = ?1 AND reference_work_id = ?2 AND reference_import_id = ?3
             ORDER BY order_index ASC
             LIMIT ?4 OFFSET ?5",
        )
        .map_err(AppError::database)?
        .query_map(
            params![novel_id, work_id, import_id, limit, offset],
            map_section_metadata,
        )
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(ReferenceSectionPageDto {
        items,
        total,
        offset,
        limit,
    })
}

pub fn get_section(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
    import_id: &str,
    section_id: &str,
) -> Result<Option<ReferenceSectionDto>, AppError> {
    let row = connection
        .query_row(
            "SELECT id, reference_import_id, reference_work_id, novel_id, order_index,
                    title, content, large_text_ref_id, content_hash, char_count,
                    utf8_byte_count, source_start_utf16, source_end_utf16
             FROM reference_sections
             WHERE novel_id = ?1 AND reference_work_id = ?2
               AND reference_import_id = ?3 AND id = ?4",
            params![novel_id, work_id, import_id, section_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, i64>(12)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((
        id,
        import_id,
        work_id,
        novel_id,
        order_index,
        title,
        inline_content,
        large_text_ref_id,
        content_hash,
        char_count,
        utf8_byte_count,
        source_start_utf16,
        source_end_utf16,
    )) = row
    else {
        return Ok(None);
    };
    let content = if let Some(document_id) = large_text_ref_id {
        large_text_repository::validate_document_target(
            connection,
            &document_id,
            "reference_section",
            &id,
            "content",
        )?;
        large_text_repository::read_verified_document(connection, &document_id)?.content
    } else {
        inline_content
    };
    if large_text_repository::sha256(&content) != content_hash
        || content.chars().count() as i64 != char_count
        || content.len() as i64 != utf8_byte_count
    {
        return Err(AppError::new(
            crate::errors::codes::LARGE_TEXT_HASH_MISMATCH,
            "参考章节正文完整性校验失败",
            false,
        ));
    }
    Ok(Some(ReferenceSectionDto {
        id,
        import_id,
        work_id,
        novel_id,
        order_index,
        title,
        content,
        content_hash,
        char_count,
        source_start_utf16,
        source_end_utf16,
    }))
}

pub fn get_bundle(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
    section_offset: i64,
    section_limit: i64,
) -> Result<Option<ReferenceWorkBundleDto>, AppError> {
    let Some(work) = get_work(connection, novel_id, work_id)? else {
        return Ok(None);
    };
    let imports = list_imports(connection, novel_id, work_id)?;
    let section_page = list_section_metadata(
        connection,
        novel_id,
        work_id,
        &work.active_import_id,
        section_offset,
        section_limit,
    )?;
    Ok(Some(ReferenceWorkBundleDto {
        work,
        imports,
        sections: section_page.items,
        section_total: section_page.total,
        section_offset: section_page.offset,
        section_limit: section_page.limit,
    }))
}

pub fn get_legacy_bundle(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
) -> Result<Option<LegacyReferenceWorkBundleDto>, AppError> {
    let Some(work) = get_work(connection, novel_id, work_id)? else {
        return Ok(None);
    };
    let imports = list_imports(connection, novel_id, work_id)?;
    let sections = list_sections(connection, novel_id, work_id, &work.active_import_id)?;
    Ok(Some(LegacyReferenceWorkBundleDto {
        work,
        imports,
        sections,
    }))
}

pub fn inspect_duplicates(
    connection: &Connection,
    novel_id: &str,
    source_hash: &str,
) -> Result<Vec<ReferenceDuplicateMatchDto>, AppError> {
    connection
        .prepare(
            "SELECT w.id, w.title, i.id, i.version_no, i.is_current, i.imported_at
             FROM reference_imports i
             INNER JOIN reference_works w
               ON w.id = i.reference_work_id AND w.novel_id = i.novel_id
             WHERE i.novel_id = ?1 AND i.source_sha256 = ?2
             ORDER BY i.imported_at DESC, i.id DESC",
        )
        .map_err(AppError::database)?
        .query_map(params![novel_id, source_hash], |row| {
            Ok(ReferenceDuplicateMatchDto {
                work_id: row.get(0)?,
                work_title: row.get(1)?,
                import_id: row.get(2)?,
                import_version: row.get(3)?,
                is_current: row.get::<_, i64>(4)? == 1,
                imported_at: row.get(5)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

pub fn replay_identity(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<(String, String, String, String)>, AppError> {
    connection
        .query_row(
            "SELECT id, reference_work_id, novel_id, request_hash
             FROM reference_imports WHERE operation_id = ?1",
            params![operation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(AppError::database)
}

pub fn work_revision(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
) -> Result<Option<i64>, AppError> {
    connection
        .query_row(
            "SELECT revision FROM reference_works WHERE novel_id = ?1 AND id = ?2",
            params![novel_id, work_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)
}

pub fn current_large_text_ids(
    connection: &Connection,
    novel_id: &str,
    work_id: &str,
) -> Result<Vec<String>, AppError> {
    let import_ids = connection
        .prepare(
            "SELECT large_text_ref_id FROM reference_imports
             WHERE novel_id = ?1 AND reference_work_id = ?2 AND large_text_ref_id IS NOT NULL",
        )
        .map_err(AppError::database)?
        .query_map(params![novel_id, work_id], |row| row.get::<_, String>(0))
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    let section_ids = connection
        .prepare(
            "SELECT large_text_ref_id FROM reference_sections
             WHERE novel_id = ?1 AND reference_work_id = ?2 AND large_text_ref_id IS NOT NULL",
        )
        .map_err(AppError::database)?
        .query_map(params![novel_id, work_id], |row| row.get::<_, String>(0))
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(import_ids.into_iter().chain(section_ids).collect())
}
