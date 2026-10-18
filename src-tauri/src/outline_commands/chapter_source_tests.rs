use super::*;

fn fixture() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::create_tables(&mut conn).unwrap();
    conn.execute_batch(
        "INSERT INTO novels(id,title,created_at,updated_at) VALUES('n','源材料','now','now'),('other','另一部','now','now');
         INSERT INTO chapters(id,novel_id,title,order_index,status,outline,goal,target_word_count,created_at,updated_at)
         VALUES('c','n','保留章名',1,'planned','原章节材料','独立章节目标',3400,'now','now');",
    ).unwrap();
    conn
}

fn input(content: &str, new_version: bool) -> SaveChapterOutlineInput {
    SaveChapterOutlineInput {
        project_id: "n".into(),
        volume_outline_id: None,
        chapter_id: Some("c".into()),
        chapter_index: Some(1),
        title: "章纲版本".into(),
        content: content.into(),
        source_type: Some("manual".into()),
        context_snapshot: None,
        save_as_new_version: Some(new_version),
    }
}

fn activate(conn: &mut Connection, id: &str) -> Result<(), String> {
    set_active(
        conn,
        SetActiveChapterOutlineInput {
            id: id.into(),
            project_id: "n".into(),
        },
    )
}

fn chapter_source(conn: &Connection) -> String {
    conn.query_row("SELECT outline FROM chapters WHERE id='c'", [], |row| {
        row.get(0)
    })
    .unwrap()
}

fn assert_unrelated_chapter_fields(conn: &Connection) {
    let fields: (String, String, i64, String) = conn
        .query_row(
            "SELECT title,goal,target_word_count,status FROM chapters WHERE id='c'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        fields,
        (
            "保留章名".into(),
            "独立章节目标".into(),
            3400,
            "planned".into()
        )
    );
}

#[test]
fn chapter_source_adoption_switches_the_complete_projection_without_adopting_new_drafts() {
    let mut conn = fixture();
    let first = save(&mut conn, input("旧版章纲", true)).unwrap();
    let full = "新的完整章纲，禁止私自修复原信。\n".repeat(1_000);
    let second = save(&mut conn, input(&full, true)).unwrap();
    assert!(!first.is_active && !second.is_active);
    assert_eq!(chapter_source(&conn), "原章节材料");
    activate(&mut conn, &first.id).unwrap();
    assert_eq!(chapter_source(&conn), "旧版章纲");
    activate(&mut conn, &second.id).unwrap();
    assert_eq!(chapter_source(&conn), full);
    let active: String = conn.query_row(
        "SELECT id FROM chapter_outlines WHERE project_id='n' AND chapter_id='c' AND is_active=1",
        [], |row| row.get(0),
    ).unwrap();
    assert_eq!(active, second.id);
    activate(&mut conn, &first.id).unwrap();
    assert_eq!(chapter_source(&conn), "旧版章纲");
    assert_unrelated_chapter_fields(&conn);
}

#[test]
fn chapter_source_editing_the_active_version_syncs_but_saving_a_new_version_does_not() {
    let mut conn = fixture();
    let active = save(&mut conn, input("原采用章纲", true)).unwrap();
    activate(&mut conn, &active.id).unwrap();
    let edited = save(&mut conn, input("当前采用版已纠正", false)).unwrap();
    assert_eq!(edited.id, active.id);
    assert!(edited.is_active);
    assert_eq!(chapter_source(&conn), "当前采用版已纠正");
    let candidate = save(&mut conn, input("尚未采用的新版本", true)).unwrap();
    assert!(!candidate.is_active);
    assert_eq!(chapter_source(&conn), "当前采用版已纠正");
    assert_unrelated_chapter_fields(&conn);
}

#[test]
fn chapter_source_activation_rolls_back_both_active_flags_and_projection_on_write_failure() {
    let mut conn = fixture();
    let first = save(&mut conn, input("原采用章纲", true)).unwrap();
    let second = save(&mut conn, input("新章纲", true)).unwrap();
    activate(&mut conn, &first.id).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER reject_projection BEFORE UPDATE OF outline ON chapters
        BEGIN SELECT RAISE(ABORT,'injected source write failure'); END;",
    )
    .unwrap();
    assert!(activate(&mut conn, &second.id)
        .unwrap_err()
        .contains("injected source write failure"));
    assert_eq!(chapter_source(&conn), "原采用章纲");
    assert!(
        get_chapter_outline_by_id_internal(&conn, &first.id)
            .unwrap()
            .is_active
    );
    assert!(
        !get_chapter_outline_by_id_internal(&conn, &second.id)
            .unwrap()
            .is_active
    );
}

#[test]
fn chapter_source_edit_rolls_back_outline_content_when_projection_cannot_be_saved() {
    let mut conn = fixture();
    let first = save(&mut conn, input("原采用章纲", true)).unwrap();
    activate(&mut conn, &first.id).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER reject_projection BEFORE UPDATE OF outline ON chapters
        BEGIN SELECT RAISE(ABORT,'injected source write failure'); END;",
    )
    .unwrap();
    assert!(save(&mut conn, input("不能部分保存", false)).is_err());
    assert_eq!(chapter_source(&conn), "原采用章纲");
    assert_eq!(
        get_chapter_outline_by_id_internal(&conn, &first.id)
            .unwrap()
            .content,
        "原采用章纲"
    );
}

#[test]
fn chapter_source_rejects_foreign_or_deleted_owners_without_switching_an_outline() {
    let mut conn = fixture();
    let draft = save(&mut conn, input("待采用章纲", true)).unwrap();
    assert!(set_active(
        &mut conn,
        SetActiveChapterOutlineInput {
            id: draft.id.clone(),
            project_id: "other".into(),
        }
    )
    .is_err());
    assert_eq!(chapter_source(&conn), "原章节材料");
    conn.execute("UPDATE chapters SET deleted_at='deleted' WHERE id='c'", [])
        .unwrap();
    assert!(activate(&mut conn, &draft.id).is_err());
    assert!(save(&mut conn, input("删除后不得写入", false)).is_err());
    assert!(
        !get_chapter_outline_by_id_internal(&conn, &draft.id)
            .unwrap()
            .is_active
    );
    assert_eq!(chapter_source(&conn), "原章节材料");
}

#[test]
fn chapter_source_unbound_outline_cannot_update_an_arbitrary_chapter() {
    let mut conn = fixture();
    let mut unbound = input("未关联章节的大纲", true);
    unbound.chapter_id = None;
    let saved = save(&mut conn, unbound).unwrap();
    activate(&mut conn, &saved.id).unwrap();
    assert_eq!(chapter_source(&conn), "原章节材料");
    assert_unrelated_chapter_fields(&conn);
}
