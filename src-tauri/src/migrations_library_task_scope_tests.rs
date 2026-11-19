use super::*;

fn before_042() -> Connection {
    let mut c=Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;
      CREATE TABLE novels(id TEXT PRIMARY KEY,title TEXT,deleted_at TEXT);
      CREATE TABLE chapters(id TEXT PRIMARY KEY,novel_id TEXT,deleted_at TEXT);
      CREATE TABLE chapter_drafts(id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,chapter_id TEXT NOT NULL,content TEXT NOT NULL,version_no INTEGER NOT NULL,large_text_ref_id TEXT);
      INSERT INTO novels VALUES('project-a','offline fixture',NULL);").unwrap();
    for migration in super::super::migrations()
        .iter()
        .filter(|m| m.id != MIGRATION_ID && m.id != "043_host_terminal_native_facts")
    {
        if migration.id==super::super::cross_task_lineage::MIGRATION_ID {
            super::super::with_foreign_keys_disabled(&mut c,|conn|super::super::apply_one_migration(conn,migration)).unwrap();
        } else {super::super::apply_one_migration(&mut c,migration).unwrap();}
    }
    c.execute("INSERT INTO task_conversations(conversation_id,novel_id,title,status,created_at,updated_at) VALUES('legacy-task','project-a','Existing project task','idle','before','before')",[]).unwrap();
    c
}

#[test]
fn library_scope_042_preserves_existing_facts_dependents_and_foreign_keys() {
    let mut c=before_042();
    let old_columns=TABLES.map(|t|columns(&c,t).unwrap());
    let before=TABLES.iter().zip(&old_columns).map(|(t,cols)|fingerprint(&c,t,cols).unwrap()).collect::<Vec<_>>();
    let ledger=super::super::list_applied(&c).unwrap();
    super::super::run_migrations(&mut c).unwrap();
    for ((table,cols),original) in TABLES.iter().zip(&old_columns).zip(before) {assert_eq!(fingerprint(&c,table,cols).unwrap(),original);}
    assert_eq!(&super::super::list_applied(&c).unwrap()[..ledger.len()],ledger.as_slice());
    assert_eq!(c.query_row("PRAGMA foreign_keys",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(c.query_row("SELECT scope_type FROM task_conversations WHERE conversation_id='legacy-task'",[],|r|r.get::<_,String>(0)).unwrap(),"novel");
    for trigger in ["trg_ai_tasks_immutable_identity","trg_result_artifacts_immutable_content","trg_task_authorizations_scope","trg_conversation_artifact_cards_projection_insert"] {
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?1",[trigger],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    let completed=super::super::list_applied(&c).unwrap();
    super::super::run_migrations(&mut c).unwrap();
    assert_eq!(super::super::list_applied(&c).unwrap(),completed);
}

#[test]
fn library_scope_042_rolls_back_missing_guard_and_never_loosens_old_novel_rows() {
    let mut c=before_042();
    c.execute("DROP TRIGGER trg_task_authorizations_scope",[]).unwrap();
    let cols=columns(&c,"task_conversations").unwrap();
    let before=fingerprint(&c,"task_conversations",&cols).unwrap();
    assert!(super::super::run_migrations(&mut c).is_err());
    assert_eq!(fingerprint(&c,"task_conversations",&cols).unwrap(),before);
    assert!(!columns(&c,"task_conversations").unwrap().contains(&"source_snapshot_json".into()));
    assert_eq!(c.query_row("PRAGMA foreign_keys",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    assert!(c.execute("INSERT INTO task_conversations(conversation_id,novel_id,title,created_at,updated_at) VALUES('bad',NULL,'bad','now','now')",[]).is_err());
}
