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
        ",
    )?;
    Ok(())
}
