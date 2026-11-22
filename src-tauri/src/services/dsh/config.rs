//! Static Runtime Registry composition metadata for the pure-Rust native runtime.
//!
//! Preserves the read-only `当前插件` composition catalog without bundling or
//! unpacking any external Node.js DSH runtime payload.

#[derive(Debug, Clone, Copy)]
pub struct RuntimeCompositionSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: &'static str,
    pub capabilities: &'static [&'static str],
}

pub const WORKBENCH_COMPOSITION: &[RuntimeCompositionSpec] = &[
    RuntimeCompositionSpec {
        id: "sdk-jsonrpc-server",
        name: "ANS Task Runtime Adapter",
        kind: "runtime",
        capabilities: &[
            "initialize",
            "persistent-session",
            "resume",
            "scoped-cancel",
        ],
    },
    RuntimeCompositionSpec {
        id: "llm-deepseek",
        name: "DeepSeek Provider",
        kind: "model",
        capabilities: &["provider-directory", "model-directory", "streaming"],
    },
    RuntimeCompositionSpec {
        id: "agent-spine",
        name: "Harness Agent Spine",
        kind: "runtime",
        capabilities: &["agent", "turn", "step", "tool-pipeline"],
    },
    RuntimeCompositionSpec {
        id: "sessions",
        name: "Session Persistence",
        kind: "storage",
        capabilities: &["append-only-events", "flush", "resume"],
    },
    RuntimeCompositionSpec {
        id: "token-meter",
        name: "Token Meter",
        kind: "runtime",
        capabilities: &["usage-metering"],
    },
    RuntimeCompositionSpec {
        id: "compaction-basic",
        name: "Session Compaction",
        kind: "runtime",
        capabilities: &["session-compaction", "auto-compact"],
    },
    RuntimeCompositionSpec {
        id: "mcp-novel",
        name: "Novel MCP Gateway",
        kind: "tool",
        capabilities: &[
            "scoped-tool-registry",
            "read-only-context",
            "candidate-generation",
        ],
    },
];
