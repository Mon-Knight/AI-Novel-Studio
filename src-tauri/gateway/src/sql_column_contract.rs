//! Column-name drift guard between gateway SQL and app repositories.
//!
//! This does not unify queries or extract a crate. Filters, LIMIT, and ORDER BY
//! may differ on purpose (DSH projection vs full DTO).

#[cfg(test)]
mod tests {
    fn assert_columns_in(source: &str, label: &str, columns: &[&str]) {
        for column in columns {
            assert!(
                source.contains(*column),
                "{label} is missing column `{column}`"
            );
        }
    }

    #[test]
    fn sql_column_contract_matches_app_sources() {
        let gateway = include_str!("tools.rs");
        let novels = include_str!("../../src/repositories/novel_repository.rs");
        let worlds = include_str!("../../src/repositories/world_setting_repository.rs");
        let chapters = include_str!("../../src/repositories/chapter_repository.rs");
        let engineering = include_str!("../../src/repositories/chapter_engineering_repository.rs");
        let character_states = include_str!("../../src/repositories/character_state_repository.rs");
        let styles = include_str!("../../src/repositories/style_profile_repository.rs");
        let large_text = include_str!("../../src/repositories/large_text_repository.rs");
        let memory = include_str!("../../src/services/memory_service.rs");

        assert_columns_in(
            gateway,
            "gateway tools.rs",
            &[
                "is_active",
                "chapter_card_json",
                "state_summary",
                "content_sha256",
                "chunk_sha256",
            ],
        );
        assert_columns_in(
            novels,
            "novel_repository.rs",
            &["id", "title", "deleted_at"],
        );
        assert_columns_in(
            worlds,
            "world_setting_repository.rs",
            &["is_active", "updated_at"],
        );
        assert_columns_in(
            chapters,
            "chapter_repository.rs",
            &["order_index", "adopted_draft_id"],
        );
        assert_columns_in(
            engineering,
            "chapter_engineering_repository.rs",
            &["chapter_card_json", "scene_plan_json"],
        );
        assert_columns_in(
            character_states,
            "character_state_repository.rs",
            &["state_summary", "relationship_changes", "knowledge_state"],
        );
        assert_columns_in(
            styles,
            "style_profile_repository.rs",
            &["is_active", "source_type", "updated_at"],
        );
        assert_columns_in(
            large_text,
            "large_text_repository.rs",
            &["content_sha256", "chunk_sha256", "chunk_index"],
        );
        assert!(
            gateway.contains("ROW_NUMBER()") && memory.contains("ROW_NUMBER()"),
            "chapter_sequence_index ROW_NUMBER fragment must stay in gateway and memory_service"
        );
        assert!(gateway.contains("ability") && gateway.contains("constraints"));
    }
}
