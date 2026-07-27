#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemorySourceType {
    ChapterSummary,
    ContextRecord,
    CharacterState,
}

impl MemorySourceType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ChapterSummary => "chapter_summary",
            Self::ContextRecord => "context_record",
            Self::CharacterState => "character_state",
        }
    }
}

pub const MEMORY_CONTRACT_VERSION: &str = "memory_snapshot_v1";
pub const MEMORY_KIND: &str = "chapter_continuity";
pub const MEMORY_COMPILER_ID: &str = "structured_memory_compiler_v1";
pub const MEMORY_COMPILER_VERSION: i64 = 1;

