// Change-to-behavior ownership. First match wins; adjacent tests take precedence
// over a module's fallback test roots. Safety tests and desktop journeys are additive.
// A new domain must declare an owner here instead of falling back to test:all.
const nativeServiceOwners = [
  'agent_plan',
  'ai_task',
  'ai_task_record',
  'ai_request_policy',
  'artifact',
  'autonomous_scheduler',
  'autonomous_story',
  'chapter',
  'chapter_context_bundle',
  'chapter_engineering',
  'chapter_event',
  'chapter_summary',
  'character_asset',
  'context_record',
  'conversation',
  'generation_job',
  'memory',
  'multi_agent',
  'placement',
  'project',
  'quality_check',
  'recovery',
  'reference_library',
  'style_profile',
  'volume',
  'world_setting',
];

// package.json is also a script registry. A command edit does not imply a native
// dependency or installer change. Compare only this manifest, never all sources.
export function packageScope(before, after) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  const changedScripts = [
    ...new Set([...Object.keys(before.scripts ?? {}), ...Object.keys(after.scripts ?? {})]),
  ].filter((key) => before.scripts?.[key] !== after.scripts?.[key]);
  const dependencies = keys.some(
    (key) => !['scripts', 'version', 'name', 'private', 'description'].includes(key),
  );
  const packaging = changedScripts.some((key) => /^(?:tauri|dsh:assets|package:)/u.test(key));
  return {
    name: 'package manifest fields',
    metadataOnly: keys.every((key) => ['version', 'name', 'private', 'description'].includes(key)),
    docs: true,
    version: keys.includes('version'),
    coverage: dependencies || changedScripts.length > 0,
    production: dependencies || packaging,
    desktopFull: dependencies || packaging || changedScripts.some((key) => /^test:e2e/u.test(key)),
    reason: `Changed manifest fields: ${keys.join(', ') || 'format only'}`,
  };
}

export const verificationScopes = [
  {
    name: 'verification infrastructure',
    match:
      /^(?:scripts\/quality\/(?:verify-change|verification-scopes|test-ownership|run-coverage)|vitest.*config|scripts\/check-critical-component-coverage)/u,
    tests: ['scripts/quality/'],
    coverage: true,
  },
  {
    name: 'CI verification graph',
    match: /^\.github\/workflows\//u,
    coverage: true,
    rustFull: true,
    desktopFull: true,
    production: true,
    version: true,
    docs: true,
  },
  {
    name: 'frontend dependencies and build configuration',
    match: /^(?:package(?:-lock)?\.json$|tsconfig|vite\.config)/u,
    coverage: true,
    desktopFull: true,
    production: true,
    version: true,
  },
  {
    name: 'release tooling',
    match:
      /^(?:scripts\/release\/|scripts\/package-windows|scripts\/agent-workflow\/(?:release_workflow|verify_project))/u,
    tests: ['scripts/release/', 'scripts/quality/'],
    docs: true,
    version: true,
  },
  {
    name: 'development tooling',
    match:
      /^(?:scripts\/agent-workflow\/|scripts\/quality\/|\.github\/(?:dependabot|action)|\.husky\/|\.eslint|\.prettier|\.lint)/u,
    tests: ['scripts/quality/'],
    docs: true,
  },
  {
    name: 'workspace compatibility surface',
    match: /^src\/(?:types\/rightSidebar|components\/right-dock\/RightToolbar)/u,
    tests: [
      'src/types/rightSidebar.test.',
      'src/test/critical-components/WritingWorkspaceViewBehavior.test.',
    ],
    e2e: ['workbench-writing-smoke', 'candidate-review-apply'],
  },
  {
    name: 'desktop harness',
    match: /^(?:scripts\/e2e\/|tests\/e2e\/|src\/services\/tauri\/e2e)/u,
    tests: [
      'scripts/e2e/',
      'src/services/tauri/',
      'src/test/critical-components/',
      'src/components/right-dock/RightToolbar',
    ],
    desktopFull: true,
  },
  { name: 'browser harness', match: /^tests\/browser\//u, browser: true },
  {
    name: 'opt-in live harness',
    match: /^tests\/real-acceptance\//u,
    tests: [
      'scripts/e2e/real-conversation',
      'scripts/e2e/live-condition',
      'scripts/e2e/continuous-task-surface',
    ],
    reason: 'Live calls require separate authorization; validate the harness offline.',
  },
  {
    name: 'DSH and Canonical',
    match:
      /^(?:scripts\/dsh\/|contracts\/|src-tauri\/gateway\/|src-tauri\/src\/(?:task_runtime|services\/dsh\/)|src\/services\/(?:dsh|capabilities|agent-tools)\/)/u,
    tests: [
      'scripts/dsh/',
      'src/services/dsh/',
      'src/services/capabilities/',
      'src/services/agent-tools/',
    ],
    rustFull: true,
    e2e: ['conversational-workbench', 'workbench-writing-smoke', 'domain-facade-sqlite'],
  },
  {
    name: 'native packaging',
    // rust-toolchain.toml selects the compiler for every native build, so it
    // carries the same blast radius as Cargo.toml and the packaging config.
    match:
      /^(?:rust-toolchain\.toml$|src-tauri\/(?:Cargo\.|tauri\.conf|build\.rs|resources\/|icons\/|capabilities\/))/u,
    rustFull: true,
    desktopFull: true,
    production: true,
    version: true,
  },
  {
    name: 'SQLite and native shared state',
    match:
      /^src-tauri\/src\/(?:migrations|db\.|main\.|lib\.|runtime\.|e2e|(?:services|repositories|domain)\/mod\.|services\/(?:content_transaction|structured_artifact_apply))/u,
    rustFull: true,
    e2e: [
      'workbench-writing-smoke',
      'large-text-save',
      'story-assets-transaction',
      'project-backup-boundary',
    ],
  },
  {
    name: 'project backup',
    match: /^(?:src-tauri\/src\/project_backup|src\/services\/backup\/)/u,
    tests: ['src/services/backup/'],
    rustFilters: ['project_backup_'],
    e2e: ['project-backup-boundary'],
  },
  {
    name: 'writing subagent contract',
    match: /^src\/services\/agents\//u,
    tests: ['src/services/agents/'],
  },
  {
    name: 'TXT import transaction',
    match:
      /^(?:src-tauri\/src\/services\/txt_import_service\.rs|src\/services\/import\/|src\/components\/import\/ImportTxtDialog)/u,
    tests: ['src/services/import/'],
    rustFilters: ['services::txt_import_service::'],
    e2e: ['txt-import-atomic'],
  },
  {
    name: 'native draft persistence',
    match:
      /^src-tauri\/src\/(?:large_text_save|services\/draft_service|repositories\/(?:draft|large_text)_repository|commands\/drafts)\.rs$/u,
    rustFilters: ['services::draft_service::', 'large_text_save::', 'commands::tests::'],
    e2e: ['workbench-writing-smoke', 'large-text-save'],
  },
  ...nativeServiceOwners.map((name) => ({
    name: `native ${name}`,
    match: new RegExp(
      `^src-tauri/src/(?:services/${name}_service(?:_tests)?|repositories/${name}_repository)\\.rs$`,
      'u',
    ),
    rustFilters: [`services::${name}_service::`],
    e2e: ['workbench-writing-smoke'],
  })),
  {
    name: 'native IPC boundary',
    match: /^src-tauri\/src\/(?:commands(?:\.rs|\/)|outline_commands|domain\/)/u,
    rustFilters: ['commands::tests::'],
    e2e: ['workbench-writing-smoke', 'story-assets-transaction'],
  },
  {
    name: 'native AI boundary',
    match: /^src-tauri\/src\/(?:ai\.rs|services\/ai_fact_security\.rs)$/u,
    rustFilters: ['ai::tests::', 'services::ai_fact_security::'],
    e2e: ['generation-job-cancel'],
  },
  ...['session_credentials', 'errors', 'system_accent', 'crash_reports'].map((name) => ({
    name: `native ${name}`,
    match: new RegExp(`^src-tauri/src/${name}\\.rs$`, 'u'),
    rustFilters: [`${name}::tests::`],
    e2e: ['app-start'],
  })),
  {
    name: 'native window state',
    match: /^src-tauri\/src\/window_state\.rs$/u,
    e2e: ['app-start'],
  },
  {
    name: 'task directory',
    match: /(?:workbenchTaskDirectory|conversationDirectory|conversationPagination)/u,
    tests: ['src/services/conversation/', 'src/pages/Workbench/'],
    e2e: ['workbench-task-directory'],
  },
  {
    name: 'workbench',
    match: /^src\/(?:pages\/Workbench\/|features\/workbench\/|services\/conversation\/)/u,
    tests: ['src/services/conversation/', 'src/pages/Workbench/', 'src/features/workbench/'],
    e2e: ['workbench-writing-smoke', 'conversational-workbench'],
  },
  {
    name: 'editor and formal writes',
    match:
      /^src\/(?:pages\/WritingWorkspace\/|components\/workspace\/|features\/(?:workspace|chapters)\/|services\/(?:database|workspace|chapters|content-transactions)\/)/u,
    tests: [
      'src/features/workspace/',
      'src/test/workspace-reliability/',
      'src/test/workspace-recovery/',
      'src/test/critical-components/WritingWorkspace',
    ],
    safety: ['src/features/workspace/documentSafety.test.mjs'],
    e2e: ['chapter-save', 'leave-guard', 'workbench-writing-smoke'],
  },
  {
    name: 'AI generation and cancellation',
    match:
      /^src\/(?:services\/(?:ai|ai-tasks|generation|quality|engineering|multi-agent|agent|agent-planner|autonomous-creation|placements|feedback)\/|features\/(?:agent|agent-planner|quality)\/|components\/right-dock\/)/u,
    tests: [
      'src/services/ai/',
      'src/services/generation/',
      'src/features/quality/',
      'src/test/components/',
    ],
    safety: ['src/services/ai/aiCancellation.test.ts'],
    e2e: ['workbench-writing-smoke', 'generation-job-cancel'],
  },
  {
    name: 'context and story assets',
    match:
      /^(?:prompts\/|src\/prompts\/|src\/services\/(?:memory|context|prompt|characters|outlines|references|settingSuggestions)\/|src\/features\/assets\/)/u,
    tests: [
      'src/services/memory/',
      'src/services/context/',
      'src/services/prompt/',
      'src/test/story-assets/',
    ],
    e2e: ['chapter-context-persistence', 'story-assets-transaction'],
  },
  {
    name: 'project and import/export',
    match: /^src\/(?:services\/(?:novels|export|import)\/|features\/novels\/)/u,
    tests: ['src/services/backup/', 'src/test/project-create/', 'src/test/project-edit/'],
    e2e: ['project-create-open', 'project-edit-save', 'project-backup-boundary'],
  },
  {
    name: 'shell and startup',
    match: /^src\/(?:App\.|main\.|services\/(?:startup|tauri|update)\/)/u,
    tests: ['src/services/startup/', 'src/services/tauri/', 'src/services/update/'],
    e2e: ['app-start', 'workbench-writing-smoke'],
  },
  {
    name: 'settings and presentation services',
    match: /^src\/(?:services\/(?:styles|theme|templates|observability)\/|features\/styles\/)/u,
    tests: ['src/services/styles/', 'src/services/observability/', 'src/store/themeStore'],
    e2e: ['app-start'],
  },
  {
    name: 'product pages',
    match:
      /^src\/pages\/(?:AiTasks|Assets|AutonomousPlanning|ComingSoon|Home|ImportExport|NotFound|NovelDetail|OutlineEditor|ReferenceLibrary|Settings|SettingSuggestions|StoryAssets|StyleProfiles|Templates)\//u,
    tests: ['src/test/critical-components/', 'src/test/story-assets/'],
    e2e: ['project-create-open', 'story-assets-transaction', 'workbench-writing-smoke'],
  },
  {
    name: 'shared UI',
    match: /^(?:src\/(?:components|styles|assets)\/|public\/|index\.html$|src\/.*\.css$)/u,
    tests: ['src/test/components/', 'src/test/critical-components/'],
    e2e: ['app-start', 'workbench-writing-smoke'],
  },
  {
    name: 'shared state and primitives',
    match: /^src\/(?:store|types|utils|hooks|constants|config)\//u,
    tests: ['src/store/', 'src/utils/', 'src/hooks/'],
  },
  { name: 'test fixtures', match: /^src\/test\//u, tests: ['src/test/'] },
  {
    name: 'offline engineering tools',
    match: /^scripts\/(?:models|benchmark|performance|analysis|maintenance)\//u,
    tests: ['scripts/models/', 'scripts/benchmark/', 'scripts/performance/'],
  },
];

export const isDocumentation = (file) =>
  /^(?:docs\/|\.github\/(?:skills|instructions|checklists|prompts|workflows-docs)\/|\.cursor\/rules\/)/u.test(
    file,
  ) ||
  /^(?:AGENTS|README|CHANGELOG|LICENSE|CONTRIBUTING)(?:\.|$)/u.test(file) ||
  ['.github/copilot-instructions.md', '.github/pull_request_template.md'].includes(file);

export const isVersionDocument = (file) =>
  /(?:CHANGELOG\.md|version-roadmap\.md|git-workflow\.md|release-history\.md|version\.(?:ts|json))$/u.test(
    file,
  );
