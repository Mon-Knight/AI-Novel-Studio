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
    name: 'staged chapter planning and execution',
    match:
      /^src\/(?:types\/(?:chapterWritingWorkflow|chapterEngineering)\.|services\/generation\/chapterWriting(?:State|Workflow)|services\/ai\/(?:chapter(?:SceneOnlyPlan|SceneBeatPlan|BeatPlanPolicy|BeatState|PlanningCandidate)|mockChapterStagedResponses)|services\/ai\/compilation\/chapterPlanningCompilationDefinitions|services\/engineering\/chapterScenePlanNormalization|test\/(?:chapter-planning|chapter-writing)\/)/u,
    tests: [
      'src/test/chapter-planning/',
      'src/services/generation/chapterWritingWorkflow.test.ts',
      'src/services/generation/chapterWritingState.test.ts',
      'src/services/ai/chapterBeatStateService.test.ts',
      'src/services/ai/mockAiClient.test.ts',
      'src/services/engineering/chapterEngineeringService.test.ts',
      'src/services/ai/chapterScenePlanService.test.ts',
    ],
    safety: ['src/services/ai/aiCancellation.test.ts'],
    e2e: ['workbench-writing-smoke', 'generation-job-cancel'],
  },
  {
    name: 'native chapter workflow stages',
    match:
      /^(?:src-tauri\/src\/(?:(?:services|repositories)\/chapter_workflow_stage[^/]*|commands\/chapter_workflow_stages|migrations_chapter_workflow_stages)\.rs$|src\/types\/chapterWorkflowStage\.)/u,
    rustFull: true,
    e2e: ['workbench-writing-smoke', 'project-backup-boundary', 'generation-job-cancel'],
  },
  {
    name: 'chapter stage presentation',
    match:
      /^src\/(?:features\/workbench\/chapterStageProjection|pages\/Workbench\/WorkbenchChapterStageTree)/u,
    tests: [
      'src/features/workbench/chapterStageProjection.test.ts',
      'src/pages/Workbench/WorkbenchChapterStageTree.test.tsx',
    ],
    e2e: ['workbench-writing-smoke'],
  },
  {
    name: 'guarded character profile editing',
    match:
      /^(?:src-tauri\/src\/services\/character_profile_service|src\/(?:services\/characters\/character(?:Profile|Service)|features\/characters\/|components\/novel-card\/Character(?:LibraryCard|ProfileEditor|ProfileFields)|test\/components\/CharacterLibraryCard))/u,
    tests: [
      'src/services/characters/characterProfile.test.ts',
      'src/test/components/CharacterLibraryCard.test.tsx',
    ],
    rustFilters: ['services::character_profile_service::'],
    e2e: ['interaction-world-rules-repair'],
  },
  {
    name: 'guarded chapter details and adopted outline routing',
    match:
      /^(?:src-tauri\/src\/services\/chapter_details_service|src\/(?:services\/(?:chapters\/chapterDetails|database\/chapterRepository)|components\/outline\/(?:ChapterFormModal|OutlineManager(?:View)?)|pages\/OutlineEditor\/OutlineEditorPage|test\/components\/(?:ChapterFormModal|OutlineEditorRoute)))/u,
    tests: [
      'src/services/chapters/chapterDetails.test.ts',
      'src/test/components/ChapterFormModal.test.tsx',
      'src/test/components/OutlineEditorRoute.test.tsx',
      'src/components/outline/OutlineEditor.test.tsx',
      'src/test/components/ChapterSourceReview.test.tsx',
      'src/pages/NovelDetail/NovelDetailPage.test.tsx',
    ],
    rustFilters: ['services::chapter_details_service::', 'outline_commands::chapter_source::'],
    e2e: ['interaction-world-rules-repair', 'workbench-writing-smoke'],
  },
  {
    name: 'project task model inheritance',
    match:
      /^src\/(?:services\/conversation\/projectTaskModel|pages\/Workbench\/(?:WorkbenchTaskCreator|hooks\/useWorkbenchTaskCreator))/u,
    tests: [
      'src/services/conversation/projectTaskModel.test.ts',
      'src/pages/Workbench/hooks/useWorkbenchTaskCreator.test.tsx',
    ],
    safety: ['src/pages/Workbench/hooks/useWorkbenchTaskCreator.test.tsx'],
    e2e: ['workbench-task-directory', 'workbench-writing-smoke'],
  },
  {
    name: 'chapter summary source and editor handoff',
    match:
      /^src\/(?:services\/conversation\/chapter(?:WorkflowService|SummaryAttempt|SummaryOrchestration)|features\/(?:workbench\/useWorkbenchChapterHandoff|workspace\/useChapterSummaryWorkflow)|components\/(?:workspace\/ChapterSummary(?:WorkflowNotice|Details)|right-dock\/panels\/ChapterSummaryPanel)|pages\/(?:Workbench\/WorkbenchChapterSummaryStatus|WritingWorkspace\/WorkspaceSummaryDialogs)|test\/components\/ChapterSummaryWorkflowNotice)/u,
    tests: [
      'src/services/conversation/chapterWorkflowService.test.ts',
      'src/services/conversation/chapterSummaryAttempt.test.ts',
      'src/services/conversation/chapterSummaryOrchestration.test.ts',
      'src/features/workbench/useWorkbenchChapterHandoff.test.tsx',
      'src/test/components/ChapterSummaryWorkflowNotice.test.tsx',
      'src/test/critical-components/WritingWorkspaceViewBehavior.test.tsx',
    ],
    safety: [
      'src/services/conversation/chapterWorkflowService.test.ts',
      'src/features/workbench/useWorkbenchChapterHandoff.test.tsx',
    ],
    e2e: ['chapter-context-persistence', 'workbench-writing-smoke', 'candidate-review-apply'],
  },
  {
    name: 'bound artifact revision routing',
    match:
      /^src\/(?:services\/conversation\/(?:artifactRevisionRouting|taskGoalDirective|taskGoalRouting)|features\/workbench\/prepareLegacyWorkbenchSend|pages\/Workbench\/workbenchTaskRunnerSupport)/u,
    tests: [
      'src/services/conversation/taskGoalRouting.test.ts',
      'src/pages/Workbench/hooks/useWorkbenchTaskRunner.test.tsx',
    ],
    safety: [
      'src/services/conversation/artifactRevisionSourceService.test.ts',
      'src/services/dsh/taskSessionAdapter.test.ts',
      'src/services/conversation/workbenchRetryTarget.test.ts',
    ],
    e2e: ['interaction-world-rules-repair', 'workbench-writing-smoke'],
  },
  {
    name: 'persisted workbench retry recovery',
    match:
      /^src\/(?:features\/workbench\/prepareWorkbenchRetry|services\/conversation\/workbenchRetry(?:Recovery|Target))/u,
    tests: [
      'src/services/conversation/workbenchRetryRecovery.test.ts',
      'src/services/conversation/workbenchRetryTarget.test.ts',
      'src/pages/Workbench/hooks/useWorkbenchTaskRunner.test.tsx',
    ],
    safety: ['src/services/dsh/taskRetryRecovery.test.ts'],
    e2e: ['workbench-writing-smoke', 'generation-job-cancel'],
  },
  {
    name: 'chapter writing preference and target integration',
    match:
      /^src\/services\/conversation\/(?:taskWritingPreferences|taskWordTarget|chapterWordRangePolicy)/u,
    tests: [
      'src/services/conversation/chapterWordRangePolicy.test.ts',
      'src/test/components/WorkbenchWordPreview.test.tsx',
    ],
    safety: ['src/services/dsh/taskSessionAdapter.test.ts'],
    e2e: ['workbench-writing-smoke'],
  },
  {
    name: 'chapter source reconciliation',
    match:
      /^(?:src-tauri\/src\/services\/chapter_source_reference|src\/(?:services\/worldRules\/chapterSource|features\/workspace\/useChapterSourceReview|components\/workspace\/(?:ChapterSourceReview|chapter-source-review)|test\/components\/ChapterSourceReview))/u,
    tests: ['src/services/worldRules/', 'src/test/components/ChapterSourceReview.test.tsx'],
    rustFilters: [
      'services::chapter_source_reference::',
      'services::world_setting_service::',
      'services::world_rule_governance::',
    ],
    e2e: ['interaction-world-rules-repair', 'workbench-writing-smoke'],
  },
  {
    name: 'grounded chapter summaries',
    match:
      /^(?:src-tauri\/src\/services\/(?:summary_grounding|summary_coverage|structured_summary_grounding|structured_summary_apply|structured_summary_character_reference_tests)|prompts\/chapter_summary_grounding\.md|tests\/fixtures\/chapter-summary-grounding\.json|src\/(?:services\/ai\/chapterSummary(?:Grounding|PromptContract)|pages\/Workbench\/SummaryGroundingReview|test\/components\/SummaryGroundingReview))/u,
    tests: [
      'src/services/ai/chapterSummaryGrounding.test.ts',
      'src/test/components/SummaryGroundingReview.test.tsx',
    ],
    rustFilters: [
      'services::summary_grounding::',
      'services::summary_coverage::',
      'services::structured_artifact_apply_service::',
    ],
    e2e: ['chapter-context-persistence', 'workbench-writing-smoke'],
  },
  {
    name: 'verified manuscript export',
    match:
      /^src\/(?:services\/export\/|utils\/chapterHeading|components\/novel-card\/ExportCard|pages\/ImportExport\/|test\/export\/)/u,
    tests: ['src/test/export/'],
    e2e: ['project-backup-boundary'],
  },
  {
    name: 'chapter word range preview',
    match:
      /^src\/(?:features\/workbench\/useWorkbenchWordPreview|test\/components\/WorkbenchWordPreview)/u,
    tests: [
      'src/test/components/WorkbenchWordPreview.test.tsx',
      'src/services/conversation/chapterWordRangePolicy.test.ts',
      'src/pages/Workbench/WorkbenchComposer.test.tsx',
    ],
    e2e: ['workbench-writing-smoke'],
  },
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
    name: 'isolated writing fault carrier',
    match:
      /^(?:scripts\/e2e\/run-writing-fault-injection|tests\/real-acceptance\/(?:wdio\.fault-injection|writing-subagent-fault|production-carrier|production-app-helpers|real-profile-env))/u,
    tests: [
      'scripts/e2e/run-writing-fault-injection.test.',
      'tests/real-acceptance/writing-subagent-fault-evidence.test.',
      'scripts/dsh/mock-workbench-upstream.test.',
    ],
    safety: [
      'scripts/e2e/run-writing-fault-injection.test.mjs',
      'tests/real-acceptance/writing-subagent-fault-evidence.test.ts',
      'scripts/dsh/mock-workbench-upstream.test.mjs',
    ],
    faultInjection: true,
    reason: 'Production desktop with isolated profile and loopback model; no cloud credentials.',
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
    name: 'R4 opt-in canonical carrier',
    match: /^tests\/real-acceptance\/r4-canonical-read-carrier\.mjs$/u,
    tests: ['scripts/dsh/test-agent-runtime-real.test.'],
    reason:
      'Exercise credential, identity, real send budget and evidence boundaries offline; cloud execution stays explicit opt-in.',
  },
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
      /^(?:scripts\/dsh\/|contracts\/|src-tauri\/gateway\/|src-tauri\/shared\/memory_(?:lexical_retrieval|lexical_scope|comparison_corpus)\.rs$|src-tauri\/src\/services\/memory_(?:lexical_retrieval_tests|retrieval_apply)\.rs$|src-tauri\/src\/(?:task_runtime|services\/dsh\/)|src\/services\/(?:dsh|capabilities|agent-tools)\/)/u,
    tests: [
      'scripts/dsh/',
      'src/services/dsh/',
      'src/services/capabilities/',
      'src/services/agent-tools/',
    ],
    rustFull: true,
    faultInjection: true,
    e2e: ['conversational-workbench', 'workbench-writing-smoke', 'domain-facade-sqlite'],
  },
  {
    name: 'world rule and revision native authority',
    match:
      /^src-tauri\/(?:shared\/world_rule_fingerprint\.rs$|src\/services\/(?:world_rule[^/]*|world_setting_service|setting_suggestion[^/]*|structured_rule_apply_receipt|structured_artifact_rule_governance_tests|chapter_revision[^/]*)\.rs$|src\/commands\/(?:world|setting_suggestions)\.rs$)/u,
    rustFull: true,
    e2e: [
      'interaction-world-rules-repair',
      'workbench-writing-smoke',
      'story-assets-transaction',
      'project-backup-boundary',
    ],
  },
  {
    name: 'native startup guard tests',
    match: /^src-tauri\/src\/main_startup_tests\.rs$/u,
    rustFilters: ['startup_tests::'],
    e2e: ['app-start'],
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
      /^src-tauri\/src\/(?:migrations|db(?:\.|\/)|main\.|lib\.|runtime\.|e2e|(?:services|repositories|domain)\/mod\.|services\/(?:content_transaction|structured_artifact_apply))/u,
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
    faultInjection: true,
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
      /^src-tauri\/src\/(?:large_text_save|services\/draft_service|repositories\/(?:draft|large_text)_repository(?:_tests)?|commands\/drafts)\.rs$/u,
    rustFilters: [
      'services::draft_service::',
      'large_text_save::',
      'repositories::large_text_repository::',
      'commands::tests::',
    ],
    e2e: ['workbench-writing-smoke', 'large-text-save'],
  },
  {
    name: 'native conversation projections',
    match: /^src-tauri\/src\/(?:repositories\/conversation_[^/]+|commands\/conversations)\.rs$/u,
    rustFilters: ['repositories::conversation_repository::', 'services::conversation_service::'],
    e2e: ['workbench-task-directory', 'candidate-review-apply'],
  },
  ...nativeServiceOwners.map((name) => ({
    name: `native ${name}`,
    match: new RegExp(
      `^src-tauri/src/(?:services/${name}_service(?:_tests)?(?:\\.rs|/[^/]+\\.rs)|repositories/${name}_repository\\.rs)$`,
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
    name: 'native project repository',
    match: /^src-tauri\/src\/repositories\/novel_repository\.rs$/u,
    rustFilters: ['services::project_service::'],
    e2e: ['project-create-open', 'project-backup-boundary'],
  },
  {
    name: 'native legacy context migration',
    match:
      /^src-tauri\/src\/(?:services\/legacy_migration_service|repositories\/character_state_repository)\.rs$/u,
    rustFilters: ['commands::tests::legacy_', 'services::chapter_summary_service::'],
    e2e: ['chapter-context-persistence'],
  },
  {
    name: 'native task fact helpers',
    match: /^src-tauri\/src\/services\/ai_task_(?:creation|rule_snapshot_tests)\.rs$/u,
    rustFilters: ['services::ai_task_service::'],
    e2e: ['generation-job-cancel', 'workbench-writing-smoke'],
  },
  {
    name: 'native structured setting application',
    match: /^src-tauri\/src\/services\/structured_setting_apply(?:_tests)?\.rs$/u,
    rustFull: true,
    e2e: ['story-assets-transaction', 'interaction-world-rules-repair'],
  },
  {
    name: 'world rule schema and persistence',
    match:
      /^src\/(?:services\/worldRules\/|services\/database\/settingRepository(?:\.|\/)|types\/(?:worldRules|setting)\.|features\/settingSuggestions\/)/u,
    tests: [
      'src/services/worldRules/',
      'src/services/settingSuggestions/',
      'src/pages/NovelDetail/',
      'src/pages/SettingSuggestions/',
    ],
    rustFull: true,
    e2e: ['interaction-world-rules-repair', 'story-assets-transaction', 'workbench-writing-smoke'],
  },
  {
    name: 'workbench interaction and candidate continuity',
    match:
      /^src\/(?:pages\/Workbench\/(?:Workbench(?:Composer|TemplateControls|ModelSelect|SidePanel|MessageStream|Turn|RuleChangeReview)|hooks\/useWorkbench(?:ArtifactFocus|PresentationScroll|Artifacts|Conversations|TaskRunner|Compression|ComposerDisclosure|SidePanelAccessibility))|features\/workbench\/workbenchPresentation|services\/conversation\/(?:artifactRevision|browserChapterReviewBaseline|structuredRuleGovernance)|store\/workbenchDraftStore|types\/artifactRevision|components\/layout\/(?:AppShell|FrameBar)|styles\/(?:app-shell|workbench))/u,
    tests: [
      'src/pages/Workbench/',
      'src/features/workbench/',
      'src/services/conversation/',
      'src/test/components/WritingShell.test.tsx',
    ],
    e2e: ['interaction-world-rules-repair', 'workbench-writing-smoke'],
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
      'src/services/outlines/',
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
    name: 'outline version editor',
    match: /^src\/components\/outline\/OutlineEditor(?:View)?(?:\.test)?\.tsx$/u,
    tests: ['src/components/outline/OutlineEditor.test.tsx'],
    e2e: ['story-assets-transaction'],
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
  /^(?:docs\/|reports\/|\.github\/(?:skills|instructions|checklists|prompts|workflows-docs)\/|\.cursor\/rules\/)/u.test(
    file,
  ) ||
  /^(?:AGENTS|README|CHANGELOG|LICENSE|CONTRIBUTING)(?:\.|$)/u.test(file) ||
  ['.github/copilot-instructions.md', '.github/pull_request_template.md'].includes(file);

export const isVersionDocument = (file) =>
  /(?:CHANGELOG\.md|version-roadmap\.md|git-workflow\.md|release-history\.md|version\.(?:ts|json))$/u.test(
    file,
  );
