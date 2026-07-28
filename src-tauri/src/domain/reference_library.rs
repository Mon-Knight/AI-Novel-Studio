use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceWorkDto {
    pub id: String,
    pub novel_id: String,
    pub title: String,
    pub purpose: String,
    pub description: Option<String>,
    pub active_import_id: String,
    pub active_source_hash: String,
    pub revision: i64,
    pub source_status: String,
    pub section_count: i64,
    pub total_chars: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceImportDto {
    pub id: String,
    pub work_id: String,
    pub novel_id: String,
    pub version: i64,
    pub is_current: bool,
    pub operation_id: String,
    pub file_name: String,
    pub source_file_path: Option<String>,
    pub file_type: String,
    pub encoding: String,
    pub detected_encoding: Option<String>,
    pub encoding_source: String,
    pub source_hash: String,
    pub decoded_text_hash: String,
    pub source_byte_length: i64,
    pub decoded_utf8_byte_length: i64,
    pub total_chars: i64,
    pub section_count: i64,
    pub parser_version: String,
    pub section_plan_hash: String,
    pub warnings: Vec<String>,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSectionDto {
    pub id: String,
    pub import_id: String,
    pub work_id: String,
    pub novel_id: String,
    pub order_index: i64,
    pub title: String,
    pub content: String,
    pub content_hash: String,
    pub char_count: i64,
    pub source_start_utf16: i64,
    pub source_end_utf16: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSectionMetadataDto {
    pub id: String,
    pub import_id: String,
    pub work_id: String,
    pub novel_id: String,
    pub order_index: i64,
    pub title: String,
    pub content_hash: String,
    pub char_count: i64,
    pub utf8_byte_length: i64,
    pub source_start_utf16: i64,
    pub source_end_utf16: i64,
    pub content_storage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSectionPageDto {
    pub items: Vec<ReferenceSectionMetadataDto>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceWorkBundleDto {
    pub work: ReferenceWorkDto,
    pub imports: Vec<ReferenceImportDto>,
    pub sections: Vec<ReferenceSectionMetadataDto>,
    pub section_total: i64,
    pub section_offset: i64,
    pub section_limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyReferenceWorkBundleDto {
    pub work: ReferenceWorkDto,
    pub imports: Vec<ReferenceImportDto>,
    pub sections: Vec<ReferenceSectionDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceDuplicateMatchDto {
    pub work_id: String,
    pub work_title: String,
    pub import_id: String,
    pub import_version: i64,
    pub is_current: bool,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InspectReferenceDuplicateResultDto {
    pub novel_id: String,
    pub source_hash: String,
    pub matches: Vec<ReferenceDuplicateMatchDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectReferenceDuplicatesInput {
    pub novel_id: String,
    pub source_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSectionInput {
    pub order_index: i64,
    pub title: String,
    pub content: String,
    pub content_hash: String,
    pub char_count: i64,
    pub source_start_utf16: i64,
    pub source_end_utf16: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceFileAnalysisInput {
    pub file_name: String,
    pub encoding: String,
    pub encoding_source: String,
    pub source_hash: String,
    pub decoded_text_hash: String,
    pub source_byte_length: i64,
    pub decoded_utf8_byte_length: i64,
    pub total_chars: i64,
    pub parser_version: String,
    pub section_plan_hash: String,
    pub sections: Vec<ReferenceSectionInput>,
    pub warnings: Vec<String>,
    pub text: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceDuplicateAction {
    Skip,
    CreateWork,
    CreateVersion,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReferenceWorkInput {
    pub operation_id: String,
    pub novel_id: String,
    pub duplicate_action: ReferenceDuplicateAction,
    pub duplicate_import_id: Option<String>,
    pub work_id: Option<String>,
    pub title: Option<String>,
    pub purpose: Option<String>,
    pub description: Option<String>,
    pub source_file_path: Option<String>,
    pub analysis: ReferenceFileAnalysisInput,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReferenceWorkResultDto {
    pub action: ReferenceDuplicateAction,
    pub bundle: ReferenceWorkBundleDto,
    pub created: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateReferenceImportInput {
    pub novel_id: String,
    pub work_id: String,
    pub import_id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReferenceWorkInput {
    pub novel_id: String,
    pub work_id: String,
    pub expected_revision: i64,
}
