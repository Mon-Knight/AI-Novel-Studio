use once_cell::sync::OnceCell;
use rusqlite::{Connection, Result as SqliteResult};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

fn get_data_dir() -> PathBuf {
    let mut dir = dirs_next().unwrap_or_else(|| {
        let mut fallback = PathBuf::from(".");
        fallback.push("data");
        fallback
    });
    dir.push("AI Novel Studio");
    dir
}

fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var("APPDATA")
                    .ok()
                    .map(|p| PathBuf::from(p).join("..").join("Local"))
            })
    }
    #[cfg(not(target_os = "windows"))]
    {
        dirs::data_local_dir()
    }
}

pub fn init_database() {
    let data_dir = get_data_dir();
    fs::create_dir_all(&data_dir).expect("Failed to create data directory");

    let db_path = data_dir.join("ai-novel-studio.db");
    let connection = Connection::open(&db_path).expect("Failed to open database");

    connection
        .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .expect("Failed to set pragmas");

    create_tables(&connection).expect("Failed to create tables");

    DB.set(Mutex::new(connection))
        .expect("Database already initialized");

    println!("Database initialized at: {:?}", db_path);
}

pub fn get_connection() -> &'static Mutex<Connection> {
    DB.get().expect("Database not initialized")
}

fn create_tables(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS novels (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            subtitle TEXT,
            genre TEXT,
            description TEXT,
            cover_path TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            current_volume_id TEXT,
            current_chapter_id TEXT,
            total_word_count INTEGER NOT NULL DEFAULT 0,
            target_word_count INTEGER,
            last_opened_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS world_settings (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            structured_json TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id)
        );

        CREATE TABLE IF NOT EXISTS rule_systems (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            title TEXT NOT NULL,
            category TEXT,
            content TEXT NOT NULL DEFAULT '',
            forbidden_rules TEXT,
            structured_json TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id)
        );

        CREATE TABLE IF NOT EXISTS protagonists (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            name TEXT NOT NULL,
            identity TEXT,
            personality TEXT,
            goal TEXT,
            special_ability TEXT,
            ability_limits TEXT,
            forbidden_behaviors TEXT,
            current_state TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            value_type TEXT NOT NULL DEFAULT 'string',
            category TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS volumes (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            goal TEXT,
            main_conflict TEXT,
            order_index INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'planned',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            FOREIGN KEY (novel_id) REFERENCES novels(id)
        );

        CREATE TABLE IF NOT EXISTS chapters (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            volume_id TEXT,
            title TEXT NOT NULL,
            outline TEXT,
            goal TEXT,
            order_index INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'not_started',
            adopted_draft_id TEXT,
            word_count INTEGER NOT NULL DEFAULT 0,
            target_word_count INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (volume_id) REFERENCES volumes(id)
        );

        CREATE INDEX IF NOT EXISTS idx_volumes_novel_id ON volumes(novel_id);
        CREATE INDEX IF NOT EXISTS idx_chapters_novel_id ON chapters(novel_id);
        CREATE INDEX IF NOT EXISTS idx_chapters_volume_id ON chapters(volume_id);

        CREATE TABLE IF NOT EXISTS chapter_drafts (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            title TEXT,
            content TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'manual_placeholder',
            version_no INTEGER NOT NULL DEFAULT 1,
            word_count INTEGER NOT NULL DEFAULT 0,
            is_adopted INTEGER NOT NULL DEFAULT 0,
            ai_task_id TEXT,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id),
            FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
        );

        CREATE INDEX IF NOT EXISTS idx_chapter_drafts_chapter_id ON chapter_drafts(chapter_id);

        CREATE TABLE IF NOT EXISTS ai_task_records (
            id TEXT PRIMARY KEY,
            novel_id TEXT,
            chapter_id TEXT,
            task_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            model_name TEXT,
            prompt_template_id TEXT,
            input_summary TEXT,
            prompt_snapshot TEXT,
            result_text TEXT,
            result_json TEXT,
            error_message TEXT,
            token_input INTEGER,
            token_output INTEGER,
            started_at TEXT,
            finished_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id)
        );

        CREATE INDEX IF NOT EXISTS idx_ai_task_records_novel_id ON ai_task_records(novel_id);
        CREATE INDEX IF NOT EXISTS idx_ai_task_records_chapter_id ON ai_task_records(chapter_id);

        CREATE TABLE IF NOT EXISTS style_profiles (
            id TEXT PRIMARY KEY,
            novel_id TEXT,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'manual',
            source_asset_id TEXT,
            narrative_perspective TEXT,
            tone TEXT,
            pace TEXT,
            sentence_style TEXT,
            dialogue_ratio REAL,
            description_ratio REAL,
            psychological_ratio REAL,
            battle_style TEXT,
            battle_intensity TEXT,
            emotion_tendency TEXT,
            chapter_ending TEXT,
            forbidden_styles TEXT,
            style_summary TEXT,
            raw_config_json TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id)
        );

        CREATE TABLE IF NOT EXISTS output_profiles (
            id TEXT PRIMARY KEY,
            novel_id TEXT,
            name TEXT NOT NULL,
            target_word_count INTEGER,
            min_word_count INTEGER,
            max_word_count INTEGER,
            pace_level TEXT,
            dialogue_ratio REAL,
            description_ratio REAL,
            battle_intensity TEXT,
            emotion_tendency TEXT,
            ending_hook_required INTEGER NOT NULL DEFAULT 0,
            extra_requirements TEXT,
            forbidden_items TEXT,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id)
        );

        CREATE TABLE IF NOT EXISTS imported_assets (
            id TEXT PRIMARY KEY,
            novel_id TEXT,
            file_name TEXT NOT NULL,
            file_path TEXT,
            file_type TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            content_preview TEXT,
            parsed_json TEXT,
            related_style_profile_id TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id)
        );

        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            name TEXT NOT NULL,
            role_type TEXT,
            identity TEXT,
            faction TEXT,
            relation_to_protagonist TEXT,
            goal TEXT,
            personality TEXT,
            behavior_limits TEXT,
            forbidden_behaviors TEXT,
            first_appearance_chapter_id TEXT,
            current_state TEXT,
            source TEXT NOT NULL DEFAULT 'manual',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id)
        );
        CREATE INDEX IF NOT EXISTS idx_characters_novel_id ON characters(novel_id);

        CREATE TABLE IF NOT EXISTS character_states (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            character_id TEXT NOT NULL,
            chapter_id TEXT,
            state_summary TEXT NOT NULL DEFAULT '',
            relationship_changes TEXT,
            goal_changes TEXT,
            location TEXT,
            health_state TEXT,
            knowledge_state TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (character_id) REFERENCES characters(id)
        );
        CREATE INDEX IF NOT EXISTS idx_character_states_character_id ON character_states(character_id);

        CREATE TABLE IF NOT EXISTS chapter_characters (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            character_id TEXT NOT NULL,
            character_name TEXT,
            role_in_chapter TEXT NOT NULL DEFAULT 'supporting',
            must_appear INTEGER NOT NULL DEFAULT 0,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id),
            FOREIGN KEY (character_id) REFERENCES characters(id)
        );
        CREATE INDEX IF NOT EXISTS idx_chapter_characters_chapter_id ON chapter_characters(chapter_id);

        CREATE TABLE IF NOT EXISTS chapter_events (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            involved_character_ids TEXT,
            impact TEXT,
            risk TEXT,
            status TEXT NOT NULL DEFAULT 'candidate',
            source TEXT NOT NULL DEFAULT 'manual',
            ai_task_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id)
        );
        CREATE INDEX IF NOT EXISTS idx_chapter_events_chapter_id ON chapter_events(chapter_id);

        CREATE TABLE IF NOT EXISTS chapter_summaries (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            adopted_draft_id TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            key_events TEXT,
            character_changes TEXT,
            relationship_changes TEXT,
            new_foreshadows TEXT,
            resolved_foreshadows TEXT,
            next_chapter_hints TEXT,
            ai_task_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id),
            FOREIGN KEY (adopted_draft_id) REFERENCES chapter_drafts(id)
        );
        CREATE INDEX IF NOT EXISTS idx_chapter_summaries_novel_id ON chapter_summaries(novel_id);
        CREATE INDEX IF NOT EXISTS idx_chapter_summaries_chapter_id ON chapter_summaries(chapter_id);

        CREATE TABLE IF NOT EXISTS context_records (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            chapter_id TEXT,
            context_type TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            importance INTEGER NOT NULL DEFAULT 3,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id)
        );
        CREATE INDEX IF NOT EXISTS idx_context_records_novel_id ON context_records(novel_id);
        CREATE INDEX IF NOT EXISTS idx_context_records_chapter_id ON context_records(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_context_records_type ON context_records(context_type);
        CREATE INDEX IF NOT EXISTS idx_context_records_active ON context_records(is_active);

        CREATE TABLE IF NOT EXISTS quality_check_reports (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            draft_id TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'current_draft',
            status TEXT NOT NULL DEFAULT 'pending',
            overall_score INTEGER,
            summary TEXT,
            ai_task_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id),
            FOREIGN KEY (draft_id) REFERENCES chapter_drafts(id),
            FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
        );
        CREATE INDEX IF NOT EXISTS idx_quality_check_reports_chapter_id ON quality_check_reports(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_quality_check_reports_draft_id ON quality_check_reports(draft_id);

        CREATE TABLE IF NOT EXISTS quality_check_items (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL,
            novel_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            draft_id TEXT NOT NULL,
            issue_type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'medium',
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            evidence TEXT,
            suggestion TEXT,
            start_offset INTEGER,
            end_offset INTEGER,
            is_resolved INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (report_id) REFERENCES quality_check_reports(id),
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id),
            FOREIGN KEY (draft_id) REFERENCES chapter_drafts(id)
        );
        CREATE INDEX IF NOT EXISTS idx_quality_check_items_report_id ON quality_check_items(report_id);
        CREATE INDEX IF NOT EXISTS idx_quality_check_items_issue_type ON quality_check_items(issue_type);
        CREATE INDEX IF NOT EXISTS idx_quality_check_items_severity ON quality_check_items(severity);

        CREATE TABLE IF NOT EXISTS polish_records (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            source_draft_id TEXT NOT NULL,
            result_draft_id TEXT,
            mode TEXT NOT NULL,
            instruction TEXT,
            ai_task_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id),
            FOREIGN KEY (source_draft_id) REFERENCES chapter_drafts(id),
            FOREIGN KEY (result_draft_id) REFERENCES chapter_drafts(id),
            FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
        );
        CREATE INDEX IF NOT EXISTS idx_polish_records_chapter_id ON polish_records(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_polish_records_source_draft_id ON polish_records(source_draft_id);
        ",
    )?;
    Ok(())
}
