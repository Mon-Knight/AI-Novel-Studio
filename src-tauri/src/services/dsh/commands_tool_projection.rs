//! Public capability names projected from the actual loaded task registry.
pub(super) fn canonical_workbench_tool(value: &str) -> Option<&'static str> {
    match value {
        "domain.submit_candidate" | "mcp__novel__domain.submit_candidate" => {
            Some("domain.submit_candidate")
        }
        "submit_chapter_stage" | "mcp__novel__submit_chapter_stage" => Some("submit_chapter_stage"),
        "novel.read_context" | "mcp__novel__novel.read_context" => Some("novel.read_context"),
        "chapter.read_outline" | "mcp__novel__chapter.read_outline" => Some("chapter.read_outline"),
        "get_character_states" | "mcp__novel__get_character_states" => Some("get_character_states"),
        "search_memory" | "mcp__novel__search_memory" => Some("search_memory"),
        "generate_chapter" | "mcp__novel__generate_chapter" => Some("generate_chapter"),
        "generate_outline" | "mcp__novel__generate_outline" => Some("generate_outline"),
        "generate_characters" | "mcp__novel__generate_characters" => Some("generate_characters"),
        "suggest_events" | "mcp__novel__suggest_events" => Some("suggest_events"),
        "expand_settings" | "mcp__novel__expand_settings" => Some("expand_settings"),
        "polish_chapter" | "mcp__novel__polish_chapter" => Some("polish_chapter"),
        "check_quality" | "mcp__novel__check_quality" => Some("check_quality"),
        "summarize_chapter" | "mcp__novel__summarize_chapter" => Some("summarize_chapter"),
        value if value.starts_with("mcp__novel__novel_read_context_") => Some("novel.read_context"),
        value if value.starts_with("mcp__novel__chapter_read_outline_") => {
            Some("chapter.read_outline")
        }
        value if value.starts_with("mcp__novel__get_character_states_") => {
            Some("get_character_states")
        }
        _ => None,
    }
}
