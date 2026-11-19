use super::*;

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn seed_e2e_legacy_local_storage(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
) -> Result<(), String> {
    ensure_window_label(&window, "main")?;
    if !crate::runtime::is_e2e_enabled() {
        return Err("legacy_local_storage_e2e_only".to_string());
    }
    state.reset_e2e_seed();
    state
        .inner
        .e2e_seed_requested
        .store(true, Ordering::Release);
    Ok(())
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn take_e2e_legacy_storage_seed_request(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
) -> Result<bool, String> {
    ensure_window_label(&window, LEGACY_STORAGE_MIGRATION_WINDOW_LABEL)?;
    Ok(state.inner.e2e_seed_requested.swap(false, Ordering::AcqRel))
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn finish_e2e_legacy_storage_seed(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
) -> Result<(), String> {
    ensure_window_label(&window, LEGACY_STORAGE_MIGRATION_WINDOW_LABEL)?;
    state
        .inner
        .e2e_seed_completed
        .store(true, Ordering::Release);
    Ok(())
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn get_e2e_legacy_storage_seed_state(
    state: State<'_, LegacyStorageMigrationState>,
) -> Result<bool, String> {
    Ok(state.inner.e2e_seed_completed.load(Ordering::Acquire))
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn probe_e2e_legacy_local_storage(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
) -> Result<(), String> {
    ensure_window_label(&window, "main")?;
    if !crate::runtime::is_e2e_enabled() {
        return Err("legacy_local_storage_e2e_only".to_string());
    }
    state.reset_e2e_probe();
    state
        .inner
        .e2e_probe_requested
        .store(true, Ordering::Release);
    Ok(())
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn take_e2e_legacy_storage_probe_request(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
) -> Result<bool, String> {
    ensure_window_label(&window, LEGACY_STORAGE_MIGRATION_WINDOW_LABEL)?;
    Ok(state
        .inner
        .e2e_probe_requested
        .swap(false, Ordering::AcqRel))
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn finish_e2e_legacy_storage_probe(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
    entries: Vec<LegacyStorageEntry>,
) -> Result<(), String> {
    ensure_window_label(&window, LEGACY_STORAGE_MIGRATION_WINDOW_LABEL)?;
    *state
        .inner
        .e2e_probe_entries
        .lock()
        .map_err(|_| "legacy_local_storage_probe_state_poisoned".to_string())? = Some(entries);
    Ok(())
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn get_e2e_legacy_storage_probe_entries(
    state: State<'_, LegacyStorageMigrationState>,
) -> Result<Option<Vec<LegacyStorageEntry>>, String> {
    state
        .inner
        .e2e_probe_entries
        .lock()
        .map_err(|_| "legacy_local_storage_probe_state_poisoned".to_string())
        .map(|value| value.clone())
}
