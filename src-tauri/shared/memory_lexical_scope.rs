use rusqlite::types::{ToSql, ToSqlOutput, Value};
use rusqlite::{params_from_iter, Connection};

pub struct Scope<'a> {
    pub novel_id: &'a str,
    pub chapter_id: Option<&'a str>,
    pub chapter_start: Option<i64>,
    pub chapter_end: Option<i64>,
    pub temporal_chapter: Option<i64>,
    pub source_types: &'a [String],
    pub min_importance: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct ScopedChunk {
    pub id: String,
    pub chapter_id: String,
    pub ordinal: i64,
    pub text: String,
    pub importance: f64,
    pub chapter_order_index: Option<i64>,
    pub entity_keys_json: String,
    pub metadata_json: String,
    pub source_type: String,
    pub source_id: String,
    pub source_version: i64,
}

enum Bind {
    Text(String),
    Integer(i64),
    Real(f64),
    Null,
}

impl ToSql for Bind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        match self {
            Bind::Text(value) => value.to_sql(),
            Bind::Integer(value) => value.to_sql(),
            Bind::Real(value) => value.to_sql(),
            Bind::Null => Ok(ToSqlOutput::Owned(Value::Null)),
        }
    }
}

const CHUNK_COLUMNS: &str = "\
m.id, m.chapter_id, m.ordinal, m.text, m.importance, m.chapter_order_index, \
m.entity_keys_json, m.metadata_json, d.source_type, d.source_id, d.source_version";

pub fn fts_available(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'memory_chunks_fts'
             )",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value == 1)
        .map_err(|error| error.to_string())
}

pub fn scoped_chunks(
    connection: &Connection,
    scope: &Scope<'_>,
    limit: i64,
    text_query: Option<&str>,
    fts_phrase: Option<&str>,
) -> Result<Vec<ScopedChunk>, String> {
    let (sql, binds) = match (text_query, fts_phrase) {
        (None, Some(phrase)) => fts_query(scope, phrase, limit),
        (Some(query), None) => substring_query(scope, query, limit),
        _ => return Err("lexical scope requires exactly one matcher".to_string()),
    };
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params_from_iter(binds.iter()), map_chunk)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn fts_query(scope: &Scope<'_>, phrase: &str, limit: i64) -> (String, Vec<Bind>) {
    let mut binds = vec![Bind::Text(phrase.to_string())];
    let filters = push_scope(&mut binds, scope);
    binds.push(Bind::Integer(limit));
    (
        format!(
            "SELECT {CHUNK_COLUMNS}
             FROM memory_chunks_fts
             JOIN memory_chunks m
               ON m.id = memory_chunks_fts.chunk_id
              AND m.novel_id = memory_chunks_fts.novel_id
             JOIN memory_documents d
               ON d.id = m.document_id AND d.novel_id = m.novel_id
             WHERE memory_chunks_fts MATCH ?
               AND {filters}
             ORDER BY bm25(memory_chunks_fts), memory_chunks_fts.chunk_id ASC
             LIMIT ?"
        ),
        binds,
    )
}

fn substring_query(scope: &Scope<'_>, query: &str, limit: i64) -> (String, Vec<Bind>) {
    let mut binds = Vec::new();
    let filters = push_scope(&mut binds, scope);
    binds.push(Bind::Text(query.to_string()));
    binds.push(Bind::Integer(limit));
    (
        format!(
            "SELECT {CHUNK_COLUMNS}
             FROM memory_chunks m
             JOIN memory_documents d
               ON d.id = m.document_id AND d.novel_id = m.novel_id
             WHERE {filters}
               AND instr(lower(m.text), lower(?)) > 0
             ORDER BY m.importance DESC, COALESCE(m.chapter_order_index, -1) DESC,
                      d.updated_at DESC, m.ordinal ASC, m.id ASC
             LIMIT ?"
        ),
        binds,
    )
}

fn push_scope(binds: &mut Vec<Bind>, scope: &Scope<'_>) -> String {
    let mut sql = String::from(
        "m.novel_id = ?
         AND d.status = 'active'
         AND (? IS NULL OR m.chapter_id = ?)
         AND (? IS NULL OR m.chapter_order_index >= ?)
         AND (? IS NULL OR m.chapter_order_index <= ?)
         AND (? IS NULL OR m.importance >= ?)
         AND (? IS NULL OR (
            (m.temporal_start_chapter IS NULL OR m.temporal_start_chapter <= ?)
            AND (m.temporal_end_chapter IS NULL OR m.temporal_end_chapter >= ?)
         ))",
    );
    binds.push(Bind::Text(scope.novel_id.to_string()));
    push_pair_text(binds, scope.chapter_id);
    push_pair_i64(binds, scope.chapter_start);
    push_pair_i64(binds, scope.chapter_end);
    push_pair_f64(binds, scope.min_importance);
    push_temporal(binds, scope.temporal_chapter);
    if !scope.source_types.is_empty() {
        sql.push_str(" AND d.source_type IN (");
        for (index, source) in scope.source_types.iter().enumerate() {
            if index > 0 {
                sql.push(',');
            }
            sql.push('?');
            binds.push(Bind::Text(source.clone()));
        }
        sql.push(')');
    }
    sql
}

fn push_pair_text(binds: &mut Vec<Bind>, value: Option<&str>) {
    match value {
        Some(value) => {
            binds.push(Bind::Text(value.to_string()));
            binds.push(Bind::Text(value.to_string()));
        }
        None => {
            binds.push(Bind::Null);
            binds.push(Bind::Null);
        }
    }
}

fn push_pair_i64(binds: &mut Vec<Bind>, value: Option<i64>) {
    match value {
        Some(value) => {
            binds.push(Bind::Integer(value));
            binds.push(Bind::Integer(value));
        }
        None => {
            binds.push(Bind::Null);
            binds.push(Bind::Null);
        }
    }
}

fn push_pair_f64(binds: &mut Vec<Bind>, value: Option<f64>) {
    match value {
        Some(value) => {
            binds.push(Bind::Real(value));
            binds.push(Bind::Real(value));
        }
        None => {
            binds.push(Bind::Null);
            binds.push(Bind::Null);
        }
    }
}

fn push_temporal(binds: &mut Vec<Bind>, value: Option<i64>) {
    match value {
        Some(value) => {
            binds.push(Bind::Integer(value));
            binds.push(Bind::Integer(value));
            binds.push(Bind::Integer(value));
        }
        None => {
            binds.push(Bind::Null);
            binds.push(Bind::Null);
            binds.push(Bind::Null);
        }
    }
}

fn map_chunk(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScopedChunk> {
    Ok(ScopedChunk {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        ordinal: row.get(2)?,
        text: row.get(3)?,
        importance: row.get(4)?,
        chapter_order_index: row.get(5)?,
        entity_keys_json: row.get(6)?,
        metadata_json: row.get(7)?,
        source_type: row.get(8)?,
        source_id: row.get(9)?,
        source_version: row.get(10)?,
    })
}
