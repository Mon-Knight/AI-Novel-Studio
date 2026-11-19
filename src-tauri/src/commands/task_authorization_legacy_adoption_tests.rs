// Existing adoption metadata regression, extracted without changing its test path or assertions.
    #[test]
    fn adopt_chapter_draft_updates_pointer_and_chapter_metadata(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "editing")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "旧正文", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "新的正式正文", false)?;

        let adopted = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")?;

        assert_eq!(adopted.id, "draft-new");
        assert_eq!(adopted.chapter_id, "chapter-a");
        assert!(adopted.is_adopted);
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 0);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 1);
        let adopted_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chapter_drafts WHERE chapter_id = 'chapter-a' AND is_adopted = 1",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(adopted_count, 1);
        let chapter = get_test_chapter_state(&conn, "chapter-a")?;
        assert_eq!(chapter.0.as_deref(), Some("draft-new"));
        assert_eq!(chapter.1, count_words("新的正式正文"));
        assert_eq!(chapter.2, "adopted");
        assert_ne!(chapter.3, "before");
        Ok(())
    }
