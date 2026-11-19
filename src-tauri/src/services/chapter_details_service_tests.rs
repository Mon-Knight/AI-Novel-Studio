use super::*;

fn setup() -> (Connection, SaveChapterDetailsInput) {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::create_tables(&mut conn).unwrap();
    conn.execute_batch("INSERT INTO novels(id,title,created_at,updated_at) VALUES('n','作品','before','before'),('other','另一作品','before','before');
      INSERT INTO volumes(id,novel_id,title,created_at,updated_at) VALUES('v','n','第一卷','before','before'),('other-v','other','另一卷','before','before');
      INSERT INTO chapters(id,novel_id,volume_id,title,outline,goal,order_index,status,word_count,target_word_count,created_at,updated_at) VALUES('c','n','v','章节','正式采用章纲','旧目标',2,'adopted',3200,3400,'created','before');").unwrap();
    let baseline = find_by_id(&conn, "c").unwrap().unwrap();
    (
        conn,
        SaveChapterDetailsInput {
            baseline,
            patch: ChapterDetailsPatch {
                goal: Some("新目标".into()),
                ..Default::default()
            },
        },
    )
}

fn snapshot(conn: &Connection) -> String {
    serde_json::to_string(&find_by_id(conn, "c").unwrap()).unwrap()
}

#[test]
fn goal_only_patch_retains_adopted_outline_and_every_other_field() {
    let (mut conn, input) = setup();
    let before = input.baseline.clone();
    let saved = save_chapter_details(&mut conn, input).unwrap();
    assert_eq!(saved.goal.as_deref(), Some("新目标"));
    let mut expected = before;
    expected.goal = saved.goal.clone();
    expected.updated_at = saved.updated_at.clone();
    assert!(same_baseline(&saved, &expected));
    assert_ne!(saved.updated_at, "before");
}

#[test]
fn adopted_outline_change_is_rejected_even_when_timestamp_did_not_change() {
    let (mut conn, input) = setup();
    conn.execute(
        "UPDATE chapters SET outline='另入口新采用章纲' WHERE id='c'",
        [],
    )
    .unwrap();
    let before = snapshot(&conn);
    assert!(save_chapter_details(&mut conn, input)
        .unwrap_err()
        .starts_with("CHAPTER_DETAILS_CONFLICT"));
    assert_eq!(snapshot(&conn), before);
}

#[test]
fn other_metadata_or_updated_at_change_cannot_be_overwritten() {
    for mutation in [
        "updated_at='new'",
        "title='他处新标题'",
        "status='summarized'",
        "word_count=4000",
        "goal='其他目标'",
    ] {
        let (mut conn, input) = setup();
        conn.execute(&format!("UPDATE chapters SET {mutation} WHERE id='c'"), [])
            .unwrap();
        let before = snapshot(&conn);
        assert!(save_chapter_details(&mut conn, input)
            .unwrap_err()
            .starts_with("CHAPTER_DETAILS_CONFLICT"));
        assert_eq!(snapshot(&conn), before);
    }
}

#[test]
fn wrong_project_deleted_project_or_deleted_chapter_fail_closed() {
    for kind in ["wrong-project", "deleted-project", "deleted-chapter"] {
        let (mut conn, mut input) = setup();
        match kind {
            "wrong-project" => input.baseline.novel_id = "other".into(),
            "deleted-project" => {
                conn.execute("UPDATE novels SET deleted_at='gone' WHERE id='n'", [])
                    .unwrap();
            }
            _ => {
                conn.execute("UPDATE chapters SET deleted_at='gone' WHERE id='c'", [])
                    .unwrap();
            }
        }
        let before = snapshot(&conn);
        assert!(save_chapter_details(&mut conn, input)
            .unwrap_err()
            .starts_with("CHAPTER_DETAILS_CONFLICT"));
        assert_eq!(snapshot(&conn), before);
    }
}

#[test]
fn clear_volume_goal_and_target_explicitly_without_touching_outline() {
    let (mut conn, mut input) = setup();
    input.patch.volume_id = Some(String::new());
    input.patch.goal = Some(String::new());
    input.patch.target_word_count = Some(0);
    let saved = save_chapter_details(&mut conn, input).unwrap();
    assert_eq!(saved.volume_id, None);
    assert_eq!(saved.goal.as_deref(), Some(""));
    assert_eq!(saved.target_word_count, None);
    assert_eq!(saved.outline.as_deref(), Some("正式采用章纲"));
}

#[test]
fn cross_project_or_removed_volume_is_rejected() {
    for volume in ["other-v", "removed"] {
        let (mut conn, mut input) = setup();
        input.patch.volume_id = Some(volume.into());
        let before = snapshot(&conn);
        assert!(save_chapter_details(&mut conn, input)
            .unwrap_err()
            .starts_with("CHAPTER_DETAILS_INVALID"));
        assert_eq!(snapshot(&conn), before);
    }
}

#[test]
fn invalid_patch_fields_and_outdated_readback_are_rejected() {
    assert!(serde_json::from_value::<ChapterDetailsPatch>(
        serde_json::json!({"outline":"不允许经资料接口改章纲"})
    )
    .is_err());
    let (mut conn, mut input) = setup();
    input.patch.status = Some("unknown".into());
    let before = snapshot(&conn);
    assert!(save_chapter_details(&mut conn, input)
        .unwrap_err()
        .starts_with("CHAPTER_DETAILS_INVALID"));
    assert_eq!(snapshot(&conn), before);
    let (mut conn, input) = setup();
    conn.execute_batch("CREATE TRIGGER sabotage AFTER UPDATE OF goal ON chapters BEGIN UPDATE chapters SET outline='异常改动' WHERE id=NEW.id; END;").unwrap();
    let before = snapshot(&conn);
    assert!(save_chapter_details(&mut conn, input)
        .unwrap_err()
        .starts_with("CHAPTER_DETAILS_CONFLICT"));
    assert_eq!(snapshot(&conn), before);
}
