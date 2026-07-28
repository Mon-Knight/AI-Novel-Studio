use crate::db::get_connection;
use crate::domain::reference_library::{
    ActivateReferenceImportInput, DeleteReferenceWorkInput, ImportReferenceWorkInput,
    ImportReferenceWorkResultDto, InspectReferenceDuplicateResultDto,
    InspectReferenceDuplicatesInput, LegacyReferenceWorkBundleDto, ReferenceSectionDto,
    ReferenceSectionPageDto, ReferenceWorkBundleDto, ReferenceWorkDto,
};
use crate::errors::AppError;
use crate::services::reference_library_service;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListReferenceWorksInput {
    pub novel_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetReferenceWorkBundleInput {
    pub novel_id: String,
    pub work_id: String,
    pub section_offset: Option<i64>,
    pub section_limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListReferenceSectionsInput {
    pub novel_id: String,
    pub work_id: String,
    pub import_id: String,
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetReferenceSectionContentInput {
    pub novel_id: String,
    pub work_id: String,
    pub import_id: String,
    pub section_id: String,
}

#[tauri::command]
pub fn inspect_reference_duplicates(
    input: InspectReferenceDuplicatesInput,
) -> Result<InspectReferenceDuplicateResultDto, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    reference_library_service::inspect_duplicates(&connection, input)
}

#[tauri::command]
pub fn commit_reference_import(
    input: ImportReferenceWorkInput,
) -> Result<ImportReferenceWorkResultDto, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    reference_library_service::commit_import(&mut connection, input)
}

#[tauri::command]
pub fn list_reference_works(
    input: ListReferenceWorksInput,
) -> Result<Vec<ReferenceWorkDto>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    reference_library_service::list_works(&connection, &input.novel_id)
}

#[tauri::command]
pub fn get_reference_work_bundle(
    input: GetReferenceWorkBundleInput,
) -> Result<ReferenceWorkBundleDto, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    reference_library_service::get_bundle_page(
        &connection,
        &input.novel_id,
        &input.work_id,
        input.section_offset.unwrap_or(0),
        input
            .section_limit
            .unwrap_or(reference_library_service::DEFAULT_REFERENCE_SECTION_PAGE_SIZE),
    )
}

/// Explicit compatibility endpoint for callers that still require every section body.
/// New callers should page metadata and fetch one section body at a time.
#[tauri::command]
pub fn get_reference_work_bundle_legacy(
    input: GetReferenceWorkBundleInput,
) -> Result<LegacyReferenceWorkBundleDto, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    reference_library_service::get_legacy_bundle(&connection, &input.novel_id, &input.work_id)
}

#[tauri::command]
pub fn list_reference_sections(
    input: ListReferenceSectionsInput,
) -> Result<ReferenceSectionPageDto, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    reference_library_service::list_sections(
        &connection,
        &input.novel_id,
        &input.work_id,
        &input.import_id,
        input.offset.unwrap_or(0),
        input
            .limit
            .unwrap_or(reference_library_service::DEFAULT_REFERENCE_SECTION_PAGE_SIZE),
    )
}

#[tauri::command]
pub fn get_reference_section_content(
    input: GetReferenceSectionContentInput,
) -> Result<ReferenceSectionDto, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    reference_library_service::get_section_content(
        &connection,
        &input.novel_id,
        &input.work_id,
        &input.import_id,
        &input.section_id,
    )
}

#[tauri::command]
pub fn activate_reference_import(
    input: ActivateReferenceImportInput,
) -> Result<ReferenceWorkBundleDto, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    reference_library_service::activate_import(&mut connection, input)
}

#[tauri::command]
pub fn delete_reference_work(input: DeleteReferenceWorkInput) -> Result<(), AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    reference_library_service::delete_work(&mut connection, input)
}
