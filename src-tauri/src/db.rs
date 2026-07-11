use once_cell::sync::OnceCell;
use rusqlite::{Connection, Result as SqliteResult};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

pub fn get_data_dir() -> PathBuf {
    let mut dir = dirs_next().unwrap_or_else(|| {
        let mut fallback = PathBuf::from(".");
        fallback.push("data");
        fallback
    });
    dir.push("AI Novel Studio");
    dir
}

pub fn get_database_path() -> PathBuf {
    get_data_dir().join("ai-novel-studio.db")
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

    let db_path = get_database_path();
    let mut connection = Connection::open(&db_path).expect("Failed to open database");

    connection
        .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .expect("Failed to set pragmas");

    create_tables(&mut connection).expect("Failed to create tables");

    DB.set(Mutex::new(connection))
        .expect("Database already initialized");

    println!("Database initialized at: {:?}", db_path);
}

pub fn get_connection() -> &'static Mutex<Connection> {
    DB.get().expect("Database not initialized")
}

fn create_tables(conn: &mut Connection) -> Result<(), crate::errors::AppError> {
    create_base_tables(conn)?;
    run_migrations(conn)?;
    create_indexes(conn)?;
    crate::outline_commands::create_outline_tables(conn)?;
    crate::migrations::run_migrations(conn)?;
    Ok(())
}

fn create_base_tables(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS novels (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            subtitle TEXT,
            genre TEXT,
            description TEXT,
            outline TEXT NOT NULL DEFAULT '',
            protagonist_mode TEXT NOT NULL DEFAULT 'single',
            protagonists_json TEXT NOT NULL DEFAULT '[]',
            dual_protagonist_relation_json TEXT NOT NULL DEFAULT '{}',
            main_character TEXT NOT NULL DEFAULT '',
            protagonist_ability TEXT NOT NULL DEFAULT '',
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

        CREATE TABLE IF NOT EXISTS chapter_engineering_states (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            volume_id TEXT,
            chapter_id TEXT NOT NULL,
            chapter_card_json TEXT NOT NULL DEFAULT '{}',
            scene_plan_json TEXT NOT NULL DEFAULT '[]',
            generation_constraints_json TEXT NOT NULL DEFAULT '{}',
            quality_rules_json TEXT NOT NULL DEFAULT '{}',
            draft_version INTEGER NOT NULL DEFAULT 1,
            active_version INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            activated_at TEXT,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (volume_id) REFERENCES volumes(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id)
        );

        CREATE INDEX IF NOT EXISTS idx_chapter_engineering_states_chapter_id
            ON chapter_engineering_states(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_chapter_engineering_states_status
            ON chapter_engineering_states(chapter_id, status);

        CREATE TABLE IF NOT EXISTS chapter_generation_snapshots (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            volume_id TEXT,
            chapter_id TEXT NOT NULL,
            engineering_state_id TEXT,
            style_profile_id TEXT,
            output_profile_id TEXT,
            compiled_context_json TEXT NOT NULL DEFAULT '{}',
            compiled_prompt_text TEXT NOT NULL DEFAULT '',
            prompt_summary TEXT NOT NULL DEFAULT '',
            context_hash TEXT NOT NULL DEFAULT '',
            sources_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (volume_id) REFERENCES volumes(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id),
            FOREIGN KEY (engineering_state_id) REFERENCES chapter_engineering_states(id)
        );

        CREATE INDEX IF NOT EXISTS idx_chapter_generation_snapshots_chapter_id
            ON chapter_generation_snapshots(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_chapter_generation_snapshots_context_hash
            ON chapter_generation_snapshots(context_hash);

        CREATE TABLE IF NOT EXISTS generation_jobs (
            id TEXT PRIMARY KEY,
            world_id TEXT,
            novel_id TEXT NOT NULL,
            volume_id TEXT,
            chapter_id TEXT NOT NULL,
            job_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            current_step TEXT,
            progress_percent INTEGER NOT NULL DEFAULT 0,
            provider TEXT,
            model_name TEXT,
            input_token_estimate INTEGER,
            output_token_estimate INTEGER,
            actual_input_tokens INTEGER,
            actual_output_tokens INTEGER,
            cost_estimate REAL,
            error_code TEXT,
            error_message TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (volume_id) REFERENCES volumes(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id)
        );

        CREATE INDEX IF NOT EXISTS idx_generation_jobs_chapter_id
            ON generation_jobs(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_generation_jobs_status
            ON generation_jobs(status);

        CREATE TABLE IF NOT EXISTS generation_step_results (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            step_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            input_snapshot_json TEXT,
            output_json TEXT,
            output_text TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (job_id) REFERENCES generation_jobs(id)
        );

        CREATE INDEX IF NOT EXISTS idx_generation_step_results_job_id
            ON generation_step_results(job_id);

        CREATE TABLE IF NOT EXISTS ai_task_records (
            id TEXT PRIMARY KEY,
            novel_id TEXT,
            chapter_id TEXT,
            task_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            runtime_mode TEXT,
            provider TEXT,
            model_name TEXT,
            prompt_template_id TEXT,
            input_summary TEXT,
            prompt_snapshot TEXT,
            result_text TEXT,
            result_json TEXT,
            error_message TEXT,
            token_input INTEGER,
            token_output INTEGER,
            token_total INTEGER,
            duration_ms INTEGER,
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
            role_type TEXT NOT NULL DEFAULT 'supporting',
            gender TEXT,
            identity TEXT,
            description TEXT,
            faction TEXT,
            relation_to_protagonist TEXT,
            goal TEXT,
            goals TEXT,
            background TEXT,
            ability TEXT,
            personality TEXT,
            constraints TEXT,
            behavior_limits TEXT,
            forbidden_behaviors TEXT,
            relationship_notes TEXT,
            first_appearance_chapter_id TEXT,
            current_state TEXT,
            source TEXT NOT NULL DEFAULT 'manual',
            source_type TEXT NOT NULL DEFAULT 'manual',
            is_protagonist INTEGER NOT NULL DEFAULT 0,
            protagonist_key TEXT,
            protagonist_label TEXT,
            protagonist_order INTEGER NOT NULL DEFAULT 0,
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
            content_hash TEXT,
            content_length INTEGER,
            checked_at TEXT,
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

        CREATE TABLE IF NOT EXISTS quality_fix_runs (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            source_draft_id TEXT NOT NULL,
            source_draft_version INTEGER NOT NULL DEFAULT 0,
            target_draft_id TEXT,
            target_draft_version INTEGER,
            source_content_hash TEXT,
            target_content_hash TEXT,
            before_report_id TEXT,
            after_report_id TEXT,
            before_score INTEGER,
            after_score INTEGER,
            before_pending_count INTEGER NOT NULL DEFAULT 0,
            after_pending_count INTEGER,
            before_serious_count INTEGER NOT NULL DEFAULT 0,
            after_serious_count INTEGER,
            fixed_issue_ids TEXT,
            new_issue_ids TEXT,
            mode TEXT NOT NULL DEFAULT 'conservative',
            status TEXT NOT NULL DEFAULT 'pending',
            model TEXT,
            revision_summary TEXT,
            changed_ranges_json TEXT,
            used_context_ids TEXT,
            skipped_context_ids TEXT,
            warnings TEXT,
            failure_reason TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id),
            FOREIGN KEY (chapter_id) REFERENCES chapters(id)
        );
        CREATE INDEX IF NOT EXISTS idx_quality_fix_runs_chapter_id ON quality_fix_runs(chapter_id);

        CREATE TABLE IF NOT EXISTS context_read_logs (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            task_type TEXT NOT NULL,
            chapter_id TEXT,
            volume_id TEXT,
            used_context_ids TEXT,
            skipped_context_ids TEXT,
            warnings TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_context_read_logs_novel_id ON context_read_logs(novel_id);
        CREATE INDEX IF NOT EXISTS idx_context_read_logs_task_type ON context_read_logs(task_type);
        ",
    )?;
    Ok(())
}

fn run_migrations(conn: &Connection) -> SqliteResult<()> {
    ensure_novel_columns(conn)?;
    migrate_chapters_table(conn)?;
    ensure_ai_task_record_columns(conn)?;
    ensure_large_text_ref_columns(conn)?;
    migrate_chapter_engineering_states_table(conn)?;
    migrate_chapter_generation_snapshots_table(conn)?;
    migrate_generation_jobs_table(conn)?;
    migrate_characters_table(conn)?;
    migrate_chapter_characters_table(conn)?;
    migrate_quality_check_tables(conn)?;
    migrate_chapter_summaries_table(conn)?;
    migrate_context_records_table(conn)?;
    Ok(())
}

fn create_indexes(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_characters_protagonist
        ON characters(novel_id, is_protagonist);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_protagonist_key
        ON characters(novel_id, protagonist_key)
        WHERE protagonist_key IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_characters_unique
        ON chapter_characters(chapter_id, character_id);
        ",
    )?;
    Ok(())
}

fn table_columns(conn: &Connection, table_name: &str) -> SqliteResult<Vec<String>> {
    let quoted_table_name = table_name.replace('"', "\"\"");
    let columns = conn
        .prepare(&format!("PRAGMA table_info(\"{}\")", quoted_table_name))?
        .query_map(rusqlite::params![], |row| row.get::<_, String>(1))?
        .collect::<SqliteResult<Vec<String>>>()?;
    Ok(columns)
}

fn column_exists(conn: &Connection, table_name: &str, column_name: &str) -> SqliteResult<bool> {
    let columns = table_columns(conn, table_name)?;
    Ok(columns.iter().any(|column| column == column_name))
}

fn ensure_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    column_def: &str,
) -> SqliteResult<()> {
    if !column_exists(conn, table_name, column_name)? {
        let quoted_table_name = table_name.replace('"', "\"\"");
        let quoted_column_name = column_name.replace('"', "\"\"");
        let sql = format!(
            "ALTER TABLE \"{}\" ADD COLUMN \"{}\" {}",
            quoted_table_name, quoted_column_name, column_def
        );
        conn.execute(&sql, [])?;
    }
    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    alter_sql: &str,
) -> SqliteResult<()> {
    if !column_exists(conn, table_name, column_name)? {
        conn.execute(alter_sql, [])?;
    }
    Ok(())
}

fn ensure_novel_columns(conn: &Connection) -> SqliteResult<()> {
    add_column_if_missing(
        conn,
        "novels",
        "outline",
        "ALTER TABLE novels ADD COLUMN outline TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        conn,
        "novels",
        "protagonist_mode",
        "ALTER TABLE novels ADD COLUMN protagonist_mode TEXT NOT NULL DEFAULT 'single'",
    )?;
    add_column_if_missing(
        conn,
        "novels",
        "protagonists_json",
        "ALTER TABLE novels ADD COLUMN protagonists_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    add_column_if_missing(
        conn,
        "novels",
        "dual_protagonist_relation_json",
        "ALTER TABLE novels ADD COLUMN dual_protagonist_relation_json TEXT NOT NULL DEFAULT '{}'",
    )?;
    add_column_if_missing(
        conn,
        "novels",
        "main_character",
        "ALTER TABLE novels ADD COLUMN main_character TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        conn,
        "novels",
        "protagonist_ability",
        "ALTER TABLE novels ADD COLUMN protagonist_ability TEXT NOT NULL DEFAULT ''",
    )?;
    Ok(())
}

fn migrate_chapters_table(conn: &Connection) -> SqliteResult<()> {
    let now = chrono::Utc::now().to_rfc3339();

    ensure_column(conn, "chapters", "volume_id", "TEXT")?;
    ensure_column(conn, "chapters", "outline", "TEXT")?;
    ensure_column(conn, "chapters", "goal", "TEXT")?;
    ensure_column(
        conn,
        "chapters",
        "order_index",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "chapters",
        "status",
        "TEXT NOT NULL DEFAULT 'not_started'",
    )?;
    ensure_column(conn, "chapters", "adopted_draft_id", "TEXT")?;
    ensure_column(conn, "chapters", "word_count", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "chapters", "target_word_count", "INTEGER")?;
    ensure_column(conn, "chapters", "created_at", "TEXT")?;
    ensure_column(conn, "chapters", "updated_at", "TEXT")?;
    ensure_column(conn, "chapters", "deleted_at", "TEXT")?;

    conn.execute(
        "UPDATE chapters SET order_index = 0 WHERE order_index IS NULL",
        [],
    )?;
    conn.execute(
        "UPDATE chapters SET status = 'not_started' WHERE status IS NULL OR TRIM(status) = ''",
        [],
    )?;
    conn.execute(
        "UPDATE chapters SET word_count = 0 WHERE word_count IS NULL",
        [],
    )?;
    conn.execute(
        "UPDATE chapters SET created_at = ?1 WHERE created_at IS NULL OR TRIM(created_at) = ''",
        rusqlite::params![&now],
    )?;
    conn.execute(
        "UPDATE chapters SET updated_at = ?1 WHERE updated_at IS NULL OR TRIM(updated_at) = ''",
        rusqlite::params![&now],
    )?;

    Ok(())
}

fn ensure_ai_task_record_columns(conn: &Connection) -> SqliteResult<()> {
    let columns = table_columns(conn, "ai_task_records")?;
    let has_column = |name: &str| columns.iter().any(|column| column == name);

    if !has_column("runtime_mode") {
        conn.execute(
            "ALTER TABLE ai_task_records ADD COLUMN runtime_mode TEXT",
            [],
        )?;
    }
    if !has_column("provider") {
        conn.execute("ALTER TABLE ai_task_records ADD COLUMN provider TEXT", [])?;
    }
    if !has_column("token_total") {
        conn.execute(
            "ALTER TABLE ai_task_records ADD COLUMN token_total INTEGER",
            [],
        )?;
    }
    if !has_column("duration_ms") {
        conn.execute(
            "ALTER TABLE ai_task_records ADD COLUMN duration_ms INTEGER",
            [],
        )?;
    }

    Ok(())
}

fn migrate_characters_table(conn: &Connection) -> SqliteResult<()> {
    let now = chrono::Utc::now().to_rfc3339();

    ensure_column(
        conn,
        "characters",
        "is_protagonist",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "characters",
        "role_type",
        "TEXT NOT NULL DEFAULT 'supporting'",
    )?;
    ensure_column(conn, "characters", "gender", "TEXT")?;
    ensure_column(conn, "characters", "identity", "TEXT")?;
    ensure_column(conn, "characters", "description", "TEXT")?;
    ensure_column(conn, "characters", "background", "TEXT")?;
    ensure_column(conn, "characters", "ability", "TEXT")?;
    ensure_column(conn, "characters", "personality", "TEXT")?;
    ensure_column(conn, "characters", "goals", "TEXT")?;
    ensure_column(conn, "characters", "constraints", "TEXT")?;
    ensure_column(conn, "characters", "relationship_notes", "TEXT")?;
    ensure_column(conn, "characters", "protagonist_key", "TEXT")?;
    ensure_column(conn, "characters", "protagonist_label", "TEXT")?;
    ensure_column(
        conn,
        "characters",
        "protagonist_order",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "characters",
        "source_type",
        "TEXT NOT NULL DEFAULT 'manual'",
    )?;
    ensure_column(conn, "characters", "updated_at", "TEXT")?;

    ensure_column(conn, "characters", "faction", "TEXT")?;
    ensure_column(conn, "characters", "relation_to_protagonist", "TEXT")?;
    ensure_column(conn, "characters", "goal", "TEXT")?;
    ensure_column(conn, "characters", "behavior_limits", "TEXT")?;
    ensure_column(conn, "characters", "forbidden_behaviors", "TEXT")?;
    ensure_column(conn, "characters", "first_appearance_chapter_id", "TEXT")?;
    ensure_column(conn, "characters", "current_state", "TEXT")?;
    ensure_column(
        conn,
        "characters",
        "source",
        "TEXT NOT NULL DEFAULT 'manual'",
    )?;
    ensure_column(
        conn,
        "characters",
        "is_active",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(conn, "characters", "created_at", "TEXT")?;

    conn.execute(
        "UPDATE characters SET is_protagonist = 0 WHERE is_protagonist IS NULL",
        [],
    )?;
    conn.execute(
        "UPDATE characters SET role_type = 'supporting' WHERE role_type IS NULL OR TRIM(role_type) = ''",
        [],
    )?;
    conn.execute(
        "UPDATE characters SET source = 'manual' WHERE source IS NULL OR TRIM(source) = ''",
        [],
    )?;
    conn.execute(
        "UPDATE characters SET source_type = 'manual' WHERE source_type IS NULL OR TRIM(source_type) = ''",
        [],
    )?;
    conn.execute(
        "UPDATE characters SET is_active = 1 WHERE is_active IS NULL",
        [],
    )?;
    conn.execute(
        "UPDATE characters SET created_at = ?1 WHERE created_at IS NULL OR TRIM(created_at) = ''",
        rusqlite::params![&now],
    )?;
    conn.execute(
        "UPDATE characters SET updated_at = ?1 WHERE updated_at IS NULL OR TRIM(updated_at) = ''",
        rusqlite::params![&now],
    )?;
    Ok(())
}

fn migrate_chapter_characters_table(conn: &Connection) -> SqliteResult<()> {
    let now = chrono::Utc::now().to_rfc3339();

    ensure_column(conn, "chapter_characters", "novel_id", "TEXT")?;
    ensure_column(conn, "chapter_characters", "chapter_id", "TEXT")?;
    ensure_column(conn, "chapter_characters", "character_id", "TEXT")?;
    ensure_column(conn, "chapter_characters", "character_name", "TEXT")?;
    ensure_column(
        conn,
        "chapter_characters",
        "role_in_chapter",
        "TEXT NOT NULL DEFAULT 'supporting'",
    )?;
    ensure_column(
        conn,
        "chapter_characters",
        "must_appear",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(conn, "chapter_characters", "note", "TEXT")?;
    ensure_column(conn, "chapter_characters", "created_at", "TEXT")?;
    ensure_column(conn, "chapter_characters", "updated_at", "TEXT")?;

    conn.execute(
        "UPDATE chapter_characters SET role_in_chapter = 'supporting' WHERE role_in_chapter IS NULL OR TRIM(role_in_chapter) = ''",
        [],
    )?;
    conn.execute(
        "UPDATE chapter_characters SET must_appear = 0 WHERE must_appear IS NULL",
        [],
    )?;
    conn.execute(
        "UPDATE chapter_characters SET created_at = ?1 WHERE created_at IS NULL OR TRIM(created_at) = ''",
        rusqlite::params![&now],
    )?;
    conn.execute(
        "UPDATE chapter_characters SET updated_at = ?1 WHERE updated_at IS NULL OR TRIM(updated_at) = ''",
        rusqlite::params![&now],
    )?;
    conn.execute(
        "DELETE FROM chapter_characters
         WHERE chapter_id IS NOT NULL
           AND character_id IS NOT NULL
           AND rowid NOT IN (
             SELECT MIN(rowid)
             FROM chapter_characters
             WHERE chapter_id IS NOT NULL AND character_id IS NOT NULL
             GROUP BY chapter_id, character_id
           )",
        [],
    )?;

    Ok(())
}

fn migrate_quality_check_tables(conn: &Connection) -> SqliteResult<()> {
    let now = chrono::Utc::now().to_rfc3339();

    // quality_check_reports: add draft_version, model columns
    ensure_column(conn, "quality_check_reports", "draft_version", "INTEGER")?;
    ensure_column(conn, "quality_check_reports", "model", "TEXT")?;
    ensure_column(conn, "quality_check_reports", "content_hash", "TEXT")?;
    ensure_column(conn, "quality_check_reports", "content_length", "INTEGER")?;
    ensure_column(conn, "quality_check_reports", "checked_at", "TEXT")?;

    // quality_check_items: migrate from is_resolved boolean to status enum
    // Step 1: add new columns
    ensure_column(conn, "quality_check_items", "status", "TEXT NOT NULL DEFAULT 'pending'")?;
    ensure_column(conn, "quality_check_items", "issue_key", "TEXT")?;
    ensure_column(conn, "quality_check_items", "resolution_note", "TEXT")?;
    ensure_column(conn, "quality_check_items", "resolved_at", "TEXT")?;
    ensure_column(conn, "quality_check_items", "paragraph_index", "INTEGER")?;
    ensure_column(conn, "quality_check_items", "category", "TEXT")?;
    ensure_column(conn, "quality_check_items", "quote", "TEXT")?;

    // Step 2: migrate existing is_resolved data to status
    conn.execute(
        "UPDATE quality_check_items SET status = 'resolved', resolved_at = ?1 WHERE is_resolved = 1 AND (status IS NULL OR status = 'pending')",
        rusqlite::params![&now],
    )?;
    conn.execute(
        "UPDATE quality_check_items SET status = 'pending' WHERE status IS NULL OR TRIM(status) = ''",
        [],
    )?;

    // Step 3: populate issue_key for existing items if empty
    conn.execute(
        "UPDATE quality_check_items SET issue_key = id WHERE issue_key IS NULL OR TRIM(issue_key) = ''",
        [],
    )?;

    // Step 4: create index for issue_key
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_quality_check_items_issue_key ON quality_check_items(issue_key);
         CREATE INDEX IF NOT EXISTS idx_quality_check_items_status ON quality_check_items(status);
         CREATE INDEX IF NOT EXISTS idx_quality_check_items_chapter_id_status ON quality_check_items(chapter_id, status);",
    )?;

    Ok(())
}

fn migrate_chapter_summaries_table(conn: &Connection) -> SqliteResult<()> {
    ensure_column(conn, "chapter_summaries", "volume_id", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "enabled", "INTEGER NOT NULL DEFAULT 1")?;
    ensure_column(conn, "chapter_summaries", "content_hash", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "draft_version", "INTEGER")?;
    ensure_column(conn, "chapter_summaries", "is_expired", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "chapter_summaries", "validation_status", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "validation_result", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "core_events", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "protagonist_state_change", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "important_character_changes", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "setting_changes", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "new_locations", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "new_items_or_abilities", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "foreshadowing", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "unresolved_questions", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "facts_must_remember", "TEXT")?;
    ensure_column(conn, "chapter_summaries", "next_chapter_hook", "TEXT")?;
    // 初始化 enabled 默认值
    conn.execute(
        "UPDATE chapter_summaries SET enabled = 1 WHERE enabled IS NULL",
        [],
    )?;
    conn.execute(
        "UPDATE chapter_summaries SET is_expired = 0 WHERE is_expired IS NULL",
        [],
    )?;
    Ok(())
}

fn migrate_context_records_table(conn: &Connection) -> SqliteResult<()> {
    ensure_column(conn, "context_records", "volume_id", "TEXT")?;
    ensure_column(conn, "context_records", "is_expired", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "context_records", "content_hash", "TEXT")?;
    ensure_column(conn, "context_records", "draft_version", "INTEGER")?;
    conn.execute(
        "UPDATE context_records SET is_expired = 0 WHERE is_expired IS NULL",
        [],
    )?;
    Ok(())
}

fn ensure_large_text_ref_columns(conn: &Connection) -> SqliteResult<()> {
    add_column_if_missing(
        conn,
        "chapter_drafts",
        "large_text_ref_id",
        "ALTER TABLE chapter_drafts ADD COLUMN large_text_ref_id TEXT",
    )?;
    add_column_if_missing(
        conn,
        "chapter_summaries",
        "large_text_ref_id",
        "ALTER TABLE chapter_summaries ADD COLUMN large_text_ref_id TEXT",
    )?;
    add_column_if_missing(
        conn,
        "context_records",
        "large_text_ref_id",
        "ALTER TABLE context_records ADD COLUMN large_text_ref_id TEXT",
    )?;
    add_column_if_missing(
        conn,
        "style_profiles",
        "large_text_ref_id",
        "ALTER TABLE style_profiles ADD COLUMN large_text_ref_id TEXT",
    )?;
    add_column_if_missing(
        conn,
        "output_profiles",
        "large_text_ref_id",
        "ALTER TABLE output_profiles ADD COLUMN large_text_ref_id TEXT",
    )?;
    add_column_if_missing(
        conn,
        "world_settings",
        "large_text_ref_id",
        "ALTER TABLE world_settings ADD COLUMN large_text_ref_id TEXT",
    )?;
    add_column_if_missing(
        conn,
        "rule_systems",
        "large_text_ref_id",
        "ALTER TABLE rule_systems ADD COLUMN large_text_ref_id TEXT",
    )?;
    Ok(())
}

fn migrate_chapter_engineering_states_table(conn: &Connection) -> SqliteResult<()> {
    ensure_column(conn, "chapter_engineering_states", "novel_id", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "chapter_engineering_states", "volume_id", "TEXT")?;
    ensure_column(conn, "chapter_engineering_states", "chapter_id", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(
        conn,
        "chapter_engineering_states",
        "chapter_card_json",
        "TEXT NOT NULL DEFAULT '{}'",
    )?;
    ensure_column(
        conn,
        "chapter_engineering_states",
        "scene_plan_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "chapter_engineering_states",
        "generation_constraints_json",
        "TEXT NOT NULL DEFAULT '{}'",
    )?;
    ensure_column(
        conn,
        "chapter_engineering_states",
        "quality_rules_json",
        "TEXT NOT NULL DEFAULT '{}'",
    )?;
    ensure_column(
        conn,
        "chapter_engineering_states",
        "draft_version",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(
        conn,
        "chapter_engineering_states",
        "active_version",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "chapter_engineering_states",
        "status",
        "TEXT NOT NULL DEFAULT 'draft'",
    )?;
    ensure_column(conn, "chapter_engineering_states", "created_at", "TEXT")?;
    ensure_column(conn, "chapter_engineering_states", "updated_at", "TEXT")?;
    ensure_column(conn, "chapter_engineering_states", "activated_at", "TEXT")?;
    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_chapter_engineering_states_chapter_id
            ON chapter_engineering_states(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_chapter_engineering_states_status
            ON chapter_engineering_states(chapter_id, status);
        ",
    )?;
    Ok(())
}

fn migrate_chapter_generation_snapshots_table(conn: &Connection) -> SqliteResult<()> {
    ensure_column(conn, "chapter_generation_snapshots", "novel_id", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "chapter_generation_snapshots", "volume_id", "TEXT")?;
    ensure_column(conn, "chapter_generation_snapshots", "chapter_id", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "chapter_generation_snapshots", "engineering_state_id", "TEXT")?;
    ensure_column(conn, "chapter_generation_snapshots", "style_profile_id", "TEXT")?;
    ensure_column(conn, "chapter_generation_snapshots", "output_profile_id", "TEXT")?;
    ensure_column(
        conn,
        "chapter_generation_snapshots",
        "compiled_context_json",
        "TEXT NOT NULL DEFAULT '{}'",
    )?;
    ensure_column(
        conn,
        "chapter_generation_snapshots",
        "compiled_prompt_text",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        conn,
        "chapter_generation_snapshots",
        "prompt_summary",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        conn,
        "chapter_generation_snapshots",
        "context_hash",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        conn,
        "chapter_generation_snapshots",
        "sources_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(conn, "chapter_generation_snapshots", "created_at", "TEXT")?;
    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_chapter_generation_snapshots_chapter_id
            ON chapter_generation_snapshots(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_chapter_generation_snapshots_context_hash
            ON chapter_generation_snapshots(context_hash);
        ",
    )?;
    Ok(())
}

fn migrate_generation_jobs_table(conn: &Connection) -> SqliteResult<()> {
    ensure_column(conn, "generation_jobs", "world_id", "TEXT")?;
    ensure_column(conn, "generation_jobs", "novel_id", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "generation_jobs", "volume_id", "TEXT")?;
    ensure_column(conn, "generation_jobs", "chapter_id", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "generation_jobs", "job_type", "TEXT NOT NULL DEFAULT 'chapter_generation_mock'")?;
    ensure_column(conn, "generation_jobs", "status", "TEXT NOT NULL DEFAULT 'pending'")?;
    ensure_column(conn, "generation_jobs", "current_step", "TEXT")?;
    ensure_column(conn, "generation_jobs", "progress_percent", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "generation_jobs", "provider", "TEXT")?;
    ensure_column(conn, "generation_jobs", "model_name", "TEXT")?;
    ensure_column(conn, "generation_jobs", "input_token_estimate", "INTEGER")?;
    ensure_column(conn, "generation_jobs", "output_token_estimate", "INTEGER")?;
    ensure_column(conn, "generation_jobs", "actual_input_tokens", "INTEGER")?;
    ensure_column(conn, "generation_jobs", "actual_output_tokens", "INTEGER")?;
    ensure_column(conn, "generation_jobs", "cost_estimate", "REAL")?;
    ensure_column(conn, "generation_jobs", "error_code", "TEXT")?;
    ensure_column(conn, "generation_jobs", "error_message", "TEXT")?;
    ensure_column(conn, "generation_jobs", "retry_count", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "generation_jobs", "created_at", "TEXT")?;
    ensure_column(conn, "generation_jobs", "started_at", "TEXT")?;
    ensure_column(conn, "generation_jobs", "finished_at", "TEXT")?;

    ensure_column(conn, "generation_step_results", "job_id", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "generation_step_results", "step_name", "TEXT NOT NULL DEFAULT 'preflight'")?;
    ensure_column(conn, "generation_step_results", "status", "TEXT NOT NULL DEFAULT 'pending'")?;
    ensure_column(conn, "generation_step_results", "input_snapshot_json", "TEXT")?;
    ensure_column(conn, "generation_step_results", "output_json", "TEXT")?;
    ensure_column(conn, "generation_step_results", "output_text", "TEXT")?;
    ensure_column(conn, "generation_step_results", "error_message", "TEXT")?;
    ensure_column(conn, "generation_step_results", "created_at", "TEXT")?;
    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_generation_jobs_chapter_id
            ON generation_jobs(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_generation_jobs_status
            ON generation_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_generation_step_results_job_id
            ON generation_step_results(job_id);
        ",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db20_empty_database_initializes_complete_m1_ledger(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        create_tables(&mut conn)?;
        let migration_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(migration_count, 11);
        let last_migration: String = conn.query_row(
            "SELECT migration_id FROM schema_migrations ORDER BY migration_id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(last_migration, "011_artifact_validation_issues");
        Ok(())
    }

    #[test]
    fn migrates_legacy_characters_table_before_protagonist_index(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            CREATE TABLE characters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                name TEXT NOT NULL
            );

            INSERT INTO characters (id, novel_id, name)
            VALUES ('legacy-character', 'legacy-novel', 'Legacy Hero');
            ",
        )?;

        create_tables(&mut conn)?;

        for column in [
            "is_protagonist",
            "role_type",
            "gender",
            "identity",
            "description",
            "background",
            "ability",
            "personality",
            "goals",
            "constraints",
            "relationship_notes",
            "source_type",
            "updated_at",
        ] {
            assert!(column_exists(&conn, "characters", column)?);
        }

        let index_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_characters_protagonist'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(index_count, 1);

        let migrated_values: (i64, String, String, i64) = conn.query_row(
            "SELECT is_protagonist, role_type, source_type, is_active FROM characters WHERE id = 'legacy-character'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        assert_eq!(
            migrated_values,
            (0, "supporting".to_string(), "manual".to_string(), 1)
        );

        let timestamps: (String, String) = conn.query_row(
            "SELECT created_at, updated_at FROM characters WHERE id = 'legacy-character'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert!(!timestamps.0.is_empty());
        assert!(!timestamps.1.is_empty());

        create_tables(&mut conn)?;
        Ok(())
    }
}
