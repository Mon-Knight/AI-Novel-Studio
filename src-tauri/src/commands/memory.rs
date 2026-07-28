use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::memory_service::{self, *};

#[tauri::command]
pub fn put_memory_document(
    input: PutMemoryDocumentInput,
) -> Result<PutMemoryDocumentOutput, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    memory_service::put_document(&mut connection, input)
}

#[tauri::command]
pub fn put_memory_embeddings(
    input: PutMemoryEmbeddingsInput,
) -> Result<PutMemoryEmbeddingsOutput, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    memory_service::put_embeddings(&mut connection, input)
}

#[tauri::command]
pub fn retrieve_memory(input: RetrieveMemoryInput) -> Result<RetrieveMemoryOutput, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    memory_service::retrieve(&mut connection, input)
}

#[tauri::command]
pub fn list_memory_documents(
    input: ListMemoryDocumentsInput,
) -> Result<MemoryDocumentPage, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    memory_service::list_documents(&connection, input)
}

#[tauri::command]
pub fn invalidate_memory_document(
    input: InvalidateMemoryDocumentInput,
) -> Result<InvalidateMemoryDocumentOutput, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    memory_service::invalidate_document(&mut connection, input)
}
