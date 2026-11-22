use once_cell::sync::OnceCell;
use rusqlite::{params_from_iter, types::Value, Connection};

use crate::errors::AppError;

struct SeedTable {
    name: String,
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
}

struct SchemaTemplate {
    table_ddl: Vec<String>,
    post_seed_ddl: Vec<String>,
    seed_tables: Vec<SeedTable>,
}

static SCHEMA_TEMPLATE: OnceCell<SchemaTemplate> = OnceCell::new();

struct ForeignKeysGuard<'a> {
    conn: &'a mut Connection,
    restore: bool,
}

impl Drop for ForeignKeysGuard<'_> {
    fn drop(&mut self) {
        if self.restore {
            let _ = self.conn.execute_batch("PRAGMA foreign_keys=ON;");
        }
    }
}

fn quote_identifier(identifier: &str) -> String {
    identifier.replace('"', "\"\"")
}

fn is_fts_shadow_name(name: &str, virtual_tables: &[String]) -> bool {
    const SHADOW_SUFFIXES: [&str; 5] = ["_data", "_idx", "_content", "_docsize", "_config"];
    virtual_tables.iter().any(|vtable| {
        SHADOW_SUFFIXES
            .iter()
            .any(|suffix| name == format!("{vtable}{suffix}"))
    })
}

fn build_schema_template() -> Result<SchemaTemplate, AppError> {
    let mut ref_conn = Connection::open_in_memory().map_err(AppError::database)?;
    ref_conn
        .execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(AppError::database)?;
    super::create_tables_uncached(&mut ref_conn)?;

    let mut vtable_stmt = ref_conn
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'
             ORDER BY rowid",
        )
        .map_err(AppError::database)?;
    let virtual_tables = vtable_stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;

    let mut ddl_stmt = ref_conn
        .prepare(
            "SELECT type, name, sql FROM sqlite_master
             WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
             ORDER BY CASE
                 WHEN type = 'table' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%' THEN 0
                 WHEN type = 'table' THEN 1
                 WHEN type = 'view' THEN 2
                 WHEN type = 'index' THEN 3
                 WHEN type = 'trigger' THEN 4
                 ELSE 5
             END, rowid",
        )
        .map_err(AppError::database)?;
    let ddl_rows = ddl_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;

    let mut table_ddl = Vec::new();
    let mut post_seed_ddl = Vec::new();
    let mut regular_tables = Vec::new();
    for (object_type, name, sql) in ddl_rows {
        if is_fts_shadow_name(&name, &virtual_tables) {
            continue;
        }
        if object_type == "table" {
            if !virtual_tables.iter().any(|vt| vt == &name) {
                regular_tables.push(name);
            }
            table_ddl.push(sql);
        } else {
            post_seed_ddl.push(sql);
        }
    }

    let mut seed_tables = Vec::new();
    for table_name in regular_tables {
        let quoted = quote_identifier(&table_name);
        let count: i64 = ref_conn
            .query_row(&format!("SELECT COUNT(*) FROM \"{quoted}\""), [], |row| {
                row.get(0)
            })
            .map_err(AppError::database)?;
        if count == 0 {
            continue;
        }
        let mut select_stmt = ref_conn
            .prepare(&format!("SELECT * FROM \"{quoted}\""))
            .map_err(AppError::database)?;
        let columns: Vec<String> = select_stmt
            .column_names()
            .into_iter()
            .map(ToString::to_string)
            .collect();
        let col_count = columns.len();
        let rows = select_stmt
            .query_map([], |row| {
                let mut values = Vec::with_capacity(col_count);
                for index in 0..col_count {
                    values.push(row.get::<_, Value>(index)?);
                }
                Ok(values)
            })
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        seed_tables.push(SeedTable {
            name: table_name,
            columns,
            rows,
        });
    }

    Ok(SchemaTemplate {
        table_ddl,
        post_seed_ddl,
        seed_tables,
    })
}

pub(crate) fn create_tables_cached(conn: &mut Connection) -> Result<(), AppError> {
    let existing_objects: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if existing_objects > 0 {
        return super::create_tables_uncached(conn);
    }

    let template = SCHEMA_TEMPLATE.get_or_try_init(build_schema_template)?;
    let previous_fk: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .map_err(AppError::database)?;
    if previous_fk != 0 {
        conn.execute_batch("PRAGMA foreign_keys=OFF;")
            .map_err(AppError::database)?;
    }
    let mut fk_guard = ForeignKeysGuard {
        conn,
        restore: previous_fk != 0,
    };

    {
        let tx = fk_guard.conn.transaction().map_err(AppError::database)?;
        for sql in &template.table_ddl {
            tx.execute(sql, []).map_err(AppError::database)?;
        }
        for seed in &template.seed_tables {
            let quoted_table = quote_identifier(&seed.name);
            let cols = seed
                .columns
                .iter()
                .map(|col| format!("\"{}\"", quote_identifier(col)))
                .collect::<Vec<_>>()
                .join(", ");
            let placeholders = (1..=seed.columns.len())
                .map(|idx| format!("?{idx}"))
                .collect::<Vec<_>>()
                .join(", ");
            let insert_sql =
                format!("INSERT INTO \"{quoted_table}\" ({cols}) VALUES ({placeholders})");
            let mut stmt = tx.prepare(&insert_sql).map_err(AppError::database)?;
            for row in &seed.rows {
                stmt.execute(params_from_iter(row.iter()))
                    .map_err(AppError::database)?;
            }
        }
        for sql in &template.post_seed_ddl {
            tx.execute(sql, []).map_err(AppError::database)?;
        }
        tx.commit().map_err(AppError::database)?;
    }

    if fk_guard.restore {
        fk_guard.restore = false;
        fk_guard
            .conn
            .execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(AppError::database)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn master_objects(conn: &Connection) -> Vec<(String, String, String, Option<String>)> {
        let mut stmt = conn
            .prepare(
                "SELECT type, name, tbl_name, sql FROM sqlite_master
                 WHERE name NOT LIKE 'sqlite_%'
                 ORDER BY type, name, tbl_name",
            )
            .expect("prepare sqlite_master");
        stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .expect("query sqlite_master")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect sqlite_master")
    }

    #[test]
    fn cached_schema_template_matches_uncached_create_tables_exactly() {
        let mut uncached = Connection::open_in_memory().expect("open uncached");
        uncached
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable fk uncached");
        super::super::create_tables_uncached(&mut uncached).expect("create_tables_uncached");

        let mut cached = Connection::open_in_memory().expect("open cached");
        cached
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable fk cached");
        super::create_tables_cached(&mut cached).expect("create_tables_cached");

        assert_eq!(master_objects(&cached), master_objects(&uncached));
        let fk_after: i64 = cached
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .expect("read fk");
        assert_eq!(fk_after, 1);

        let load_rows = |conn: &Connection, sql: &str| -> Vec<(String, String)> {
            let mut stmt = conn.prepare(sql).expect("prepare rows");
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("query rows")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect rows")
        };
        assert_eq!(
            load_rows(
                &cached,
                "SELECT migration_id, checksum FROM schema_migrations ORDER BY migration_id"
            ),
            load_rows(
                &uncached,
                "SELECT migration_id, checksum FROM schema_migrations ORDER BY migration_id"
            ),
        );
        assert_eq!(
            load_rows(&cached, "SELECT id, name FROM style_profiles ORDER BY id"),
            load_rows(&uncached, "SELECT id, name FROM style_profiles ORDER BY id"),
        );

        // Re-running create_tables on an already populated DB falls back cleanly and stays idempotent.
        super::super::create_tables(&mut cached).expect("idempotent re-entry");
        assert_eq!(master_objects(&cached), master_objects(&uncached));
    }
}
