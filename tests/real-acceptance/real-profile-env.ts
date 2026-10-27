/**
 * Environment contract shared by the real-profile carrier (wdio.real-profile.conf.ts)
 * and its spec. Kept dependency-free so the spec never has to import the launcher
 * configuration (which spawns tauri-driver at load time in the launcher process).
 */
export const REAL_PROFILE_ENV = {
  enabled: 'AI_NOVEL_STUDIO_REAL_PROFILE',
  app: 'AI_NOVEL_STUDIO_REAL_PROFILE_APP',
  runId: 'AI_NOVEL_STUDIO_REAL_PROFILE_RUN_ID',
  artifacts: 'AI_NOVEL_STUDIO_REAL_PROFILE_ARTIFACTS',
  driverPort: 'AI_NOVEL_STUDIO_REAL_PROFILE_DRIVER_PORT',
  modelHint: 'AI_NOVEL_STUDIO_REAL_PROFILE_MODEL_HINT',
  targetWordCount: 'AI_NOVEL_STUDIO_REAL_PROFILE_TARGET_WORDS',
  turnTimeoutMs: 'AI_NOVEL_STUDIO_REAL_PROFILE_TURN_TIMEOUT_MS',
} as const;

/**
 * Fault-injection carrier: production binary, isolated profile (redirected LOCALAPPDATA /
 * APPDATA / WebView2 folder), loopback scripted upstream. No operator data is touched.
 */
export const FAULT_INJECTION_ENV = {
  enabled: 'AI_NOVEL_STUDIO_FAULT_INJECTION',
  app: 'AI_NOVEL_STUDIO_FAULT_INJECTION_APP',
  runId: 'AI_NOVEL_STUDIO_FAULT_INJECTION_RUN_ID',
  artifacts: 'AI_NOVEL_STUDIO_FAULT_INJECTION_ARTIFACTS',
  driverPort: 'AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PORT',
  driverPid: 'AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PID',
  dshRuntimeRoot: 'AI_NOVEL_STUDIO_FAULT_INJECTION_DSH_RUNTIME_ROOT',
  turnTimeoutMs: 'AI_NOVEL_STUDIO_FAULT_INJECTION_TURN_TIMEOUT_MS',
} as const;

export const AI_SETTINGS_STORAGE_KEY = 'ai_novel_studio_ai_settings';

export const WRITING_SUBAGENT_FLAG_KEY = 'ai_novel_studio_writing_subagent_dsh';

export const WRITING_SUBAGENT_READ_TOOLS = [
  'novel.read_context',
  'chapter.read_outline',
  'get_character_states',
  'search_memory',
] as const;

export const WRITING_SUBAGENT_CANDIDATE_TOOL = 'generate_chapter';

export const WRITING_SUBAGENT_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  ...WRITING_SUBAGENT_READ_TOOLS,
  WRITING_SUBAGENT_CANDIDATE_TOOL,
]);

/** Mirrors resolveChapterWordRange's hard bounds (80%–115%) used by the DSH turn. */
export function hardChapterWordRange(target: number): { minimum: number; maximum: number } {
  return {
    minimum: Math.max(1, Math.floor((target * 80) / 100)),
    maximum: Math.max(1, Math.floor((target * 115) / 100)),
  };
}
