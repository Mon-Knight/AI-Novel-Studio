use super::*;

fn entry(key: &str, value: &str) -> LegacyStorageEntry {
    LegacyStorageEntry {
        key: key.to_string(),
        value: value.to_string(),
    }
}

fn temporary_data_dir() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "ai-novel-studio-legacy-storage-test-{}-{}",
        std::process::id(),
        time::OffsetDateTime::now_utc().unix_timestamp_nanos()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn accepts_only_bounded_application_storage_keys() {
    assert!(validate_entries(&[entry("ai_novel_studio_theme_preference", "dark")]).is_ok());
    assert_eq!(
        validate_entries(&[entry("foreign_key", "value")]).unwrap_err(),
        "legacy_local_storage_key_not_allowed"
    );
    assert_eq!(
        validate_entries(&[
            entry("ai_novel_studio_theme_preference", "dark"),
            entry("ai_novel_studio_theme_preference", "light")
        ])
        .unwrap_err(),
        "legacy_local_storage_duplicate_key"
    );
    assert_eq!(
        validate_entries(&[LegacyStorageEntry {
            key: "ai_novel_studio_large".to_string(),
            value: "x".repeat(MAX_VALUE_BYTES + 1),
        }])
        .unwrap_err(),
        "legacy_local_storage_value_too_large"
    );
}

#[test]
fn state_stages_values_then_writes_completion_marker_after_main_commits() {
    let data_dir = temporary_data_dir();
    let state = LegacyStorageMigrationState::new(data_dir.clone());
    assert!(state.requires_probe());
    assert_eq!(state.snapshot().phase, "probing");

    state
        .stage(vec![entry("ai_novel_studio_update_channel_v1", "beta")])
        .unwrap();
    let snapshot = state.snapshot();
    assert_eq!(snapshot.phase, "ready");
    assert_eq!(snapshot.entries.len(), 1);
    assert!(!state.probe_status().applied);

    state.complete(1).unwrap();
    assert!(state.probe_status().applied);
    assert!(completion_path(&data_dir).is_file());
    let marker: CompletionMarker =
        serde_json::from_slice(&fs::read(completion_path(&data_dir)).unwrap()).unwrap();
    assert_eq!(marker.schema_version, 1);
    assert_eq!(marker.migrated_entries, 1);
    assert_eq!(marker.source_origin, LEGACY_STORAGE_ORIGIN);
    assert!(!LegacyStorageMigrationState::new(data_dir).requires_probe());
}

#[test]
fn empty_probe_is_a_completed_migration_without_blocking_startup() {
    let data_dir = temporary_data_dir();
    let state = LegacyStorageMigrationState::new(data_dir.clone());
    state.stage(Vec::new()).unwrap();
    assert_eq!(state.snapshot().phase, "complete");
    assert!(state.probe_status().applied);
    assert!(completion_path(&data_dir).is_file());
}
