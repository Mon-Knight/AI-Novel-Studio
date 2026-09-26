import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { browser, expect } from '@wdio/globals';
import {
  startMockWorkbenchUpstream,
  type MockWorkbenchRequestSummary,
  type MockWorkbenchUpstream,
} from '../../scripts/dsh/mock-workbench-upstream.mjs';
import {
  clickTestId,
  fillTestId,
  findTestIdByAttribute,
  navigateHash,
  waitForTestId,
} from '../e2e/helpers';
import {
  collectConversationEvidence,
  createFixtureChapter,
  invoke,
  isRuntimeProjection,
  readChapterInvariants,
  readConversationStatus,
  readDomToolEvents,
  seedCoreAssets,
  setWritingSubAgentFlag,
  startChapterTaskThroughUi,
  waitForTerminalConversationStatus,
  type ChapterDto,
  type ConversationBundle,
  type NovelDto,
  type SanitizedConversationEvidence,
} from './production-app-helpers';
import {
  AI_SETTINGS_STORAGE_KEY,
  FAULT_INJECTION_ENV,
  WRITING_SUBAGENT_ALLOWLIST,
  WRITING_SUBAGENT_CANDIDATE_TOOL,
  WRITING_SUBAGENT_READ_TOOLS,
} from './real-profile-env';

/**
 * Writing SubAgent gate E-4b: negative and recovery drills for `chapter_write` through the
 * production stack (desktop binary, DSH runtime carrier, gateway, Rust host, workbench UI)
 * with a deterministic loopback upstream standing in for the model. Each scenario keeps the
 * same invariant as E-4a: a candidate-only turn never writes formal chapter facts.
 *
 *   S1 forbidden tool     the model calls `expand_settings`, which the chapter_write allowlist
 *                         never exposes → rejected, no candidate, no writes.
 *   S2 cross novel        generate_chapter carries another book's ids → rejected, no candidate,
 *                         the foreign chapter stays untouched.
 *   S3a transient failure one completion fails with HTTP 500 → the transport retries on its own,
 *                         the turn still ends with exactly one candidate.
 *   S3b persistent failure every completion fails with HTTP 500 → the run fails closed with no
 *                         candidate; a retry while still broken also fails, and only a later
 *                         retry after the upstream recovers succeeds.
 *   S5 word range         the candidate is far below the host's hard minimum → the E-1 length gate
 *                         rejects it before any artifact exists.
 *   S6 task word setting  a local conversation turn sets 3200 words; after reloading, a separate
 *                         write request uses that range without changing the chapter's 1000-word target.
 *   S7 length repaired    a 3586-word candidate exceeds the 3000-word target's ceiling; the next
 *                         deterministic candidate is valid after one automatic repair.
 *   S4 restart recovery   the candidate completion hangs, the app process is killed mid-run,
 *                         the restarted app marks the run interrupted and a retry succeeds.
 */

const MODEL_NAME = 'mock-workbench-fault-injection';
const TARGET_WORD_COUNT = 1000;
const CONVERSATION_TARGET_WORD_COUNT = 3200;
const REPAIR_TARGET_WORD_COUNT = 3000;
const REPAIR_HARD_WORD_RANGE = { minimum: 2400, maximum: 3450 };
// Independent expected values: do not import the production policy under test.
const CONVERSATION_HARD_WORD_RANGE = { minimum: 2560, maximum: 3680 };
const CANDIDATE_PARAGRAPHS = [
  '演武场上风雨骤起，林辰握紧长剑，雷光自云层深处劈落。赵擎的攻势逼至眼前，他侧身让过半寸，护住身后的苏晚。',
  '雷灵根在雨夜中隐隐发热，他以最后一道雷技险胜半招，随即左肩旧伤复发，单膝跪倒在湿透的青石上。',
  '看台上的长老们面面相觑，没有人记得青云宗的季度试炼何时出现过这样的天象，钟声在雨幕里显得格外遥远。',
  '苏晚扶住他的手臂，低声说不必再撑了，林辰却摇头，他知道这一夜之后，外门弟子的名字将不再只是名字。',
];
function cjkLength(text: string): number {
  let count = 0;
  for (const character of text) {
    if (/[\u3400-\u4dbf\u4e00-\u9fff]/u.test(character)) count += 1;
  }
  return count;
}
/** ~1000 CJK characters so the host's hard range (800–1150) accepts the scripted candidate. */
function buildCandidateText(targetCjk: number): string {
  const paragraphs: string[] = [];
  let total = 0;
  for (let index = 0; total < targetCjk; index += 1) {
    const paragraph = CANDIDATE_PARAGRAPHS[index % CANDIDATE_PARAGRAPHS.length];
    paragraphs.push(paragraph);
    total += cjkLength(paragraph);
  }
  return paragraphs.join('\n\n');
}
const CANDIDATE_TEXT = buildCandidateText(TARGET_WORD_COUNT);
/** Two paragraphs (~100 CJK characters): far below the 800-character hard minimum. */
const SHORT_CANDIDATE_TEXT = CANDIDATE_PARAGRAPHS.slice(0, 2).join('\n\n');

interface ScenarioRecord {
  name: string;
  chapterId?: string;
  conversationId?: string;
  verdict: 'PASS' | 'FAIL' | 'INCOMPLETE';
  failures: string[];
  mockRequests?: Array<
    Pick<
      MockWorkbenchRequestSummary,
      | 'sequence'
      | 'phase'
      | 'outcome'
      | 'requestedToolNames'
      | 'userRetryNotice'
      | 'candidateCallNumber'
      | 'candidateTextLength'
    >
  >;
  conversation?: SanitizedConversationEvidence;
  invariants?: Record<string, unknown>;
  notes?: Record<string, unknown>;
}

interface ProcessRow {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
  CommandLine: string | null;
}

const FIXTURE_CHAPTER_TITLES = [
  '越权工具试炼',
  '跨书候选试炼',
  '上游瞬时失败试炼',
  '上游持续失败试炼',
  '字数越界候选试炼',
  '重启恢复试炼',
  '对话字数设置试炼',
  '超长候选修正试炼',
] as const;

/**
 * Deliberately does not name the chapter: since migration 038 every run persists its frozen
 * `chapterId`, so a retry must resolve its target from the failed run itself (GAP-18) even
 * when neither the goal text nor any tool projection identifies the chapter.
 */
function goalFor(_chapterTitle: string): string {
  return '生成本章正文，描写演武场激战与天生异象';
}

function listProcesses(): ProcessRow[] {
  const script =
    'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Json -Compress';
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(output) as ProcessRow | ProcessRow[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function descendantsOf(rows: ProcessRow[], rootPid: number): ProcessRow[] {
  const byParent = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const list = byParent.get(row.ParentProcessId) ?? [];
    list.push(row);
    byParent.set(row.ParentProcessId, list);
  }
  const found: ProcessRow[] = [];
  const queue = [rootPid];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.ProcessId)) continue;
      seen.add(child.ProcessId);
      found.push(child);
      queue.push(child.ProcessId);
    }
  }
  return found;
}

function killProcess(pid: number): void {
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    /* already gone */
  }
}

const ORPHAN_IMAGE_NAMES = new Set(['node.exe', 'novel-domain-gateway.exe']);

function killIsolatedOrphans(profileRoot: string): number {
  const marker = profileRoot.toLowerCase();
  let killed = 0;
  for (const row of listProcesses()) {
    if (
      ORPHAN_IMAGE_NAMES.has(row.Name.toLowerCase()) &&
      (row.CommandLine ?? '').toLowerCase().includes(marker)
    ) {
      killProcess(row.ProcessId);
      killed += 1;
    }
  }
  return killed;
}

async function openConversationThroughUi(novelId: string, conversationId: string): Promise<void> {
  await navigateHash('#/novels');
  await navigateHash('#/');
  await waitForTestId('creative-workbench');
  await (await findTestIdByAttribute('workbench-project', 'data-novel-id', novelId)).click();
  await (
    await findTestIdByAttribute('workbench-task', 'data-conversation-id', conversationId)
  ).click();
  await findTestIdByAttribute('workbench-task-header', 'data-conversation-id', conversationId);
}

interface RetryAttempt {
  attempt: number;
  runCountBefore: number;
  runCountAfter: number;
  composerError: string | null;
  statusAfterClick: string;
}

async function readComposerError(): Promise<string | null> {
  const node = await browser.$('[data-testid="workbench-composer-error"]');
  if (!(await node.isExisting())) return null;
  const text = (await node.getText()).trim();
  return text ? text.slice(0, 300) : null;
}

async function countRuns(conversationId: string): Promise<number> {
  const bundle = await invoke<{ runs: unknown[] } | null>('get_task_conversation', {
    conversationId,
  });
  return bundle?.runs.length ?? 0;
}

/**
 * Clicks "retry" on the latest failed run and waits until the host records a new run.
 * The workbench refuses a retry while it still believes the Runtime owns the conversation
 * ("仍在运行 / 仍由 Runtime 执行 / 正在准备"); those refusals are transient right after a
 * failure, so the helper re-clicks a few times and keeps every attempt as evidence.
 */
async function retryLatestRun(conversationId: string): Promise<RetryAttempt[]> {
  const attempts: RetryAttempt[] = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const runCountBefore = await countRuns(conversationId);
    const retry = await waitForTestId('workbench-retry-turn');
    await retry.waitForEnabled({ timeout: 30_000 });
    await retry.click();
    let runCountAfter = runCountBefore;
    let composerError: string | null = null;
    try {
      await browser.waitUntil(
        async () => {
          runCountAfter = await countRuns(conversationId);
          if (runCountAfter > runCountBefore) return true;
          composerError = await readComposerError();
          return composerError !== null;
        },
        { timeout: 20_000, interval: 1_000 },
      );
    } catch {
      /* neither a run nor an error surfaced within the window; retry below */
    }
    const statusAfterClick = await readConversationStatus();
    attempts.push({ attempt, runCountBefore, runCountAfter, composerError, statusAfterClick });
    if (runCountAfter > runCountBefore) return attempts;
    if (composerError && !/仍在运行|仍由 Runtime|正在准备/u.test(composerError)) {
      throw new Error(`retry was refused: ${composerError}`);
    }
    await browser.pause(5_000);
  }
  throw new Error(
    `retry never produced a new run: ${JSON.stringify(attempts[attempts.length - 1] ?? null)}`,
  );
}

describe('Writing SubAgent fault-injection acceptance (E-4b)', () => {
  const artifactRoot = process.env[FAULT_INJECTION_ENV.artifacts] ?? '';
  const profileRoot = path.join(artifactRoot, 'profile');
  const turnTimeoutMs = Number(
    process.env[FAULT_INJECTION_ENV.turnTimeoutMs] ?? String(6 * 60_000),
  );
  const startedAt = new Date();
  const scenarios: ScenarioRecord[] = [];
  const evidence: Record<string, unknown> = {
    schemaVersion: 1,
    gate: 'writing-subagent-E4b',
    runId: process.env[FAULT_INJECTION_ENV.runId] ?? null,
    startedAt: startedAt.toISOString(),
    carrier: 'production-app-isolated-profile+loopback-mock-upstream',
    allowlist: [...WRITING_SUBAGENT_ALLOWLIST],
    scenarios,
    verdict: 'INCOMPLETE',
  };
  let mock: MockWorkbenchUpstream | undefined;
  let novelId = '';
  let foreignNovelId = '';
  let foreignChapterId = '';
  const chapters: ChapterDto[] = [];
  const knownConversationIds = new Set<string>();
  const EXPECTED_SCENARIOS = 8;

  const persistEvidence = () => {
    if (!artifactRoot) return;
    fs.mkdirSync(artifactRoot, { recursive: true });
    evidence.finishedAt = new Date().toISOString();
    evidence.durationMs = Date.now() - startedAt.getTime();
    evidence.mockRequestCount = mock?.snapshot().requestCount ?? null;
    fs.writeFileSync(
      path.join(artifactRoot, 'writing-subagent-fault-injection.json'),
      JSON.stringify(evidence, null, 2),
      'utf8',
    );
  };

  const mockRequestsSince = (sequence: number) =>
    (mock?.snapshot().requests ?? [])
      .filter((request) => request.sequence > sequence)
      .map((request) => ({
        sequence: request.sequence,
        phase: request.phase,
        outcome: request.outcome,
        requestedToolNames: request.requestedToolNames,
        userRetryNotice: request.userRetryNotice,
        candidateCallNumber: request.candidateCallNumber,
        candidateTextLength: request.candidateTextLength,
      }));

  const record = (scenario: ScenarioRecord) => {
    scenario.verdict = scenario.failures.length === 0 ? 'PASS' : 'FAIL';
    scenarios.push(scenario);
    persistEvidence();
    expect(scenario.failures).toEqual([]);
  };

  before(async () => {
    if (!artifactRoot) throw new Error(`${FAULT_INJECTION_ENV.artifacts} is required.`);
    mock = await startMockWorkbenchUpstream({
      mode: 'normal',
      candidateText: CANDIDATE_TEXT,
    });
    evidence.mockUpstream = {
      host: mock.host,
      port: mock.port,
      configuredEndpointPath: new URL(`${mock.chatCompletionsUrl}/`).pathname,
    };

    await waitForTestId('app-shell');
    // The isolated profile starts empty: point the API runtime at the loopback mock. Loopback
    // endpoints need no credential, so nothing is typed into the vault.
    await browser.execute(
      (key, settings) => {
        localStorage.setItem(key, JSON.stringify(settings));
      },
      AI_SETTINGS_STORAGE_KEY,
      {
        runtimeMode: 'api',
        provider: 'openai_compatible',
        // Exercise pasted full endpoints through both model preflight and DSH proxy routing.
        baseUrl: `${mock.chatCompletionsUrl}/`,
        apiKey: '',
        modelName: MODEL_NAME,
        temperature: 0.7,
        maxTokens: 8000,
        timeoutSeconds: 120,
      },
    );
    await setWritingSubAgentFlag(true);
    await browser.execute(() => window.location.reload());
    await waitForTestId('app-shell');

    const novel = await invoke<NovelDto>('create_novel', {
      input: {
        title: 'Writing SubAgent E-4b 故障注入',
        genre: '玄幻',
        description: '隔离配置内的固定作品，仅用于 Writing SubAgent 负例与恢复验收。',
        targetWordCount: 60000,
      },
    });
    novelId = novel.id;
    await seedCoreAssets(novelId);
    const volume = await invoke<{ id: string }>('create_volume', {
      input: { novelId, title: '第一卷 试炼', orderIndex: 0 },
    });
    for (const [index, title] of FIXTURE_CHAPTER_TITLES.entries()) {
      chapters.push(
        await createFixtureChapter({
          novelId,
          volumeId: volume.id,
          title,
          orderIndex: index,
          targetWordCount: index === 7 ? REPAIR_TARGET_WORD_COUNT : TARGET_WORD_COUNT,
        }),
      );
    }
    const foreign = await invoke<NovelDto>('create_novel', {
      input: {
        title: 'Writing SubAgent E-4b 另一部作品',
        genre: '玄幻',
        description: '跨书负例的目标作品；任何候选都不得落到这里。',
        targetWordCount: 60000,
      },
    });
    foreignNovelId = foreign.id;
    await seedCoreAssets(foreignNovelId);
    const foreignVolume = await invoke<{ id: string }>('create_volume', {
      input: { novelId: foreignNovelId, title: '第一卷', orderIndex: 0 },
    });
    foreignChapterId = (
      await createFixtureChapter({
        novelId: foreignNovelId,
        volumeId: foreignVolume.id,
        title: '第一章 不该被写到的章节',
        orderIndex: 0,
        targetWordCount: TARGET_WORD_COUNT,
      })
    ).id;
    evidence.fixture = {
      novelId,
      chapterIds: chapters.map((chapter) => chapter.id),
      foreignNovelId,
      foreignChapterId,
      targetWordCount: TARGET_WORD_COUNT,
      repairChapterTargetWordCount: REPAIR_TARGET_WORD_COUNT,
    };
    mock.configure({ novelId, foreignNovelId, foreignChapterId });
    persistEvidence();
  });

  after(async () => {
    try {
      await setWritingSubAgentFlag(false);
    } catch {
      /* the session may already be gone */
    }
    if (evidence.verdict !== 'PASS') {
      try {
        await browser.saveScreenshot(path.join(artifactRoot, 'final-state.png'));
      } catch {
        /* best effort */
      }
    }
    evidence.verdict =
      scenarios.length === EXPECTED_SCENARIOS &&
      scenarios.every((scenario) => scenario.verdict === 'PASS')
        ? 'PASS'
        : 'FAIL';
    evidence.mockSnapshot = mock?.snapshot() ?? null;
    persistEvidence();
    await mock?.close();
    // eslint-disable-next-line no-console -- the evidence path is the operator's hand-off.
    console.log(
      `[FAULT INJECTION] evidence written to ${path.join(artifactRoot, 'writing-subagent-fault-injection.json')}`,
    );
  });

  async function runScenarioTurn(input: {
    scenario: ScenarioRecord;
    chapterId: string;
    goal?: string;
    waitForRuntimeIdle?: boolean;
  }): Promise<{
    conversationId: string;
    conversation: SanitizedConversationEvidence;
    invariants: Awaited<ReturnType<typeof readChapterInvariants>>;
  }> {
    const chapter = chapters.find((item) => item.id === input.chapterId);
    if (!chapter) throw new Error(`fixture chapter ${input.chapterId} is unknown`);
    const started = await startChapterTaskThroughUi({
      novelId,
      chapterId: input.chapterId,
      goal: input.goal ?? goalFor(chapter.title),
      knownConversationIds,
    });
    knownConversationIds.add(started.conversationId);
    input.scenario.conversationId = started.conversationId;
    input.scenario.notes = {
      ...input.scenario.notes,
      modelCatalog: started.catalog,
      selectedModelKey: started.selectedModelKey,
    };
    if (input.waitForRuntimeIdle) {
      // Failed intermediate runs are evidence, not the end of an automatic length repair.
      await browser.waitUntil(
        async () => {
          const runtime = await invoke<{ status: string } | null>('dsh_get_task_runtime_status', {
            conversationId: started.conversationId,
          });
          return runtime?.status === 'idle';
        },
        {
          timeout: turnTimeoutMs,
          interval: 500,
          timeoutMsg: `${input.scenario.name}: the runtime did not finish its repair budget`,
        },
      );
    }
    await waitForTerminalConversationStatus({
      timeoutMs: turnTimeoutMs,
      label: input.scenario.name,
    });
    const { evidence: conversation } = await collectConversationEvidence({
      conversationId: started.conversationId,
      fixtureNovelId: novelId,
      fixtureChapterId: input.chapterId,
    });
    const invariants = await readChapterInvariants({ novelId, chapterId: input.chapterId });
    return { conversationId: started.conversationId, conversation, invariants };
  }

  function assertNoFormalWrites(
    scenario: ScenarioRecord,
    invariants: Awaited<ReturnType<typeof readChapterInvariants>>,
    expectedTargetWordCount = TARGET_WORD_COUNT,
  ): void {
    if (invariants.chapterWordCount !== 0) {
      scenario.failures.push(`formal chapter word count became ${invariants.chapterWordCount}`);
    }
    if (invariants.draftCount !== 0) {
      scenario.failures.push(`turn created ${invariants.draftCount} chapter draft(s)`);
    }
    if (invariants.novelTotalWordCount !== 0) {
      scenario.failures.push(`formal novel word count became ${invariants.novelTotalWordCount}`);
    }
    if (invariants.chapterTargetWordCount !== expectedTargetWordCount) {
      scenario.failures.push(`formal chapter target became ${invariants.chapterTargetWordCount}`);
    }
  }

  function assertNoChapterCandidate(
    scenario: ScenarioRecord,
    conversation: SanitizedConversationEvidence,
  ): void {
    const candidates = conversation.artifacts.filter(
      (artifact) => artifact.artifactType === 'chapter_text',
    );
    if (candidates.length > 0) {
      scenario.failures.push(`${candidates.length} chapter_text artifact(s) were persisted`);
    }
    if (conversation.conversationStatus !== 'failed') {
      scenario.failures.push(
        `conversation ended in ${conversation.conversationStatus}, expected failed`,
      );
    }
    const lastRun = conversation.runs[conversation.runs.length - 1];
    if (lastRun?.status !== 'failed') {
      scenario.failures.push(`last run status ${lastRun?.status ?? '<none>'}, expected failed`);
    }
  }

  it('S1 rejects an over-privileged tool call and persists nothing', async () => {
    const scenario: ScenarioRecord = {
      name: 'forbidden-tool',
      verdict: 'INCOMPLETE',
      failures: [],
    };
    const chapterId = chapters[0].id;
    scenario.chapterId = chapterId;
    const before = mock!.snapshot().requestCount;
    mock!.configure({ mode: 'forbidden-tool', chapterId });
    const worldSettingsBefore = await invoke<unknown[]>('get_world_settings', { novelId });

    const { conversation, invariants } = await runScenarioTurn({ scenario, chapterId });
    const worldSettingsAfter = await invoke<unknown[]>('get_world_settings', { novelId });
    scenario.mockRequests = mockRequestsSince(before);
    scenario.conversation = conversation;
    scenario.invariants = {
      ...invariants,
      worldSettingsBefore: worldSettingsBefore.length,
      worldSettingsAfter: worldSettingsAfter.length,
    };

    const forbiddenSucceeded = conversation.toolEvents.some(
      (event) =>
        !isRuntimeProjection(event.toolName) &&
        event.toolName === 'expand_settings' &&
        event.status === 'succeeded',
    );
    if (forbiddenSucceeded)
      scenario.failures.push('expand_settings succeeded inside a chapter_write turn');
    const outside = conversation.toolEvents.filter(
      (event) =>
        !isRuntimeProjection(event.toolName) &&
        !WRITING_SUBAGENT_ALLOWLIST.has(event.toolName) &&
        event.status === 'succeeded',
    );
    if (outside.length > 0) {
      scenario.failures.push(
        `tools outside the allowlist succeeded: ${outside.map((event) => event.toolName).join(',')}`,
      );
    }
    if (!scenario.mockRequests.some((request) => request.phase === 'forbidden-tool')) {
      scenario.failures.push('the mock never emitted the forbidden tool call');
    }
    if (worldSettingsAfter.length !== worldSettingsBefore.length) {
      scenario.failures.push('world settings changed during a chapter_write turn');
    }
    assertNoChapterCandidate(scenario, conversation);
    assertNoFormalWrites(scenario, invariants);
    record(scenario);
  });

  it('S2 rejects a candidate that targets another book and leaves that book untouched', async () => {
    const scenario: ScenarioRecord = { name: 'cross-novel', verdict: 'INCOMPLETE', failures: [] };
    const chapterId = chapters[1].id;
    scenario.chapterId = chapterId;
    const before = mock!.snapshot().requestCount;
    mock!.configure({ mode: 'cross-novel', chapterId });

    const { conversation, invariants } = await runScenarioTurn({ scenario, chapterId });
    const foreignInvariants = await readChapterInvariants({
      novelId: foreignNovelId,
      chapterId: foreignChapterId,
    });
    scenario.mockRequests = mockRequestsSince(before);
    scenario.conversation = conversation;
    scenario.invariants = { ...invariants, foreign: foreignInvariants };

    if (!scenario.mockRequests.some((request) => request.phase === 'generate-chapter')) {
      scenario.failures.push('the mock never submitted the cross-novel candidate');
    }
    if (
      conversation.toolEvents.some(
        (event) =>
          event.toolName === WRITING_SUBAGENT_CANDIDATE_TOOL && event.status === 'succeeded',
      )
    ) {
      scenario.failures.push('generate_chapter succeeded with foreign ids');
    }
    if (conversation.artifacts.some((artifact) => artifact.boundToFixtureNovel === false)) {
      scenario.failures.push('an artifact was bound to a novel other than the fixture');
    }
    if (foreignInvariants.draftCount !== 0 || foreignInvariants.chapterWordCount !== 0) {
      scenario.failures.push('the foreign chapter gained drafts or words');
    }
    assertNoChapterCandidate(scenario, conversation);
    assertNoFormalWrites(scenario, invariants);
    record(scenario);
  });

  /** GAP-18: every run of the conversation carries the frozen chapter id. */
  function assertRunsBoundToChapter(
    scenario: ScenarioRecord,
    conversation: SanitizedConversationEvidence,
    chapterId: string,
  ): void {
    const unbound = conversation.runs.filter((run) => run.chapterId !== chapterId);
    if (unbound.length > 0) {
      scenario.failures.push(
        `${unbound.length} run(s) are not bound to the fixture chapter: ${unbound
          .map((run) => run.chapterId ?? '<none>')
          .join(',')}`,
      );
    }
  }

  /**
   * GAP-19: the retried run's first model request must carry the host's retry notice, and
   * no request of the original run may carry it.
   */
  function assertRetryNoticeOnlyOnRetriedRun(
    scenario: ScenarioRecord,
    mockRequests: Array<
      Pick<MockWorkbenchRequestSummary, 'sequence' | 'phase' | 'outcome' | 'userRetryNotice'>
    >,
    retryStartSequence: number,
  ): void {
    const modelRequests = mockRequests.filter(
      (request) => request.phase !== 'model-tool-attestation',
    );
    const before = modelRequests.filter((request) => request.sequence <= retryStartSequence);
    const after = modelRequests.filter((request) => request.sequence > retryStartSequence);
    if (before.some((request) => request.userRetryNotice)) {
      scenario.failures.push('the original run already carried the user-retry notice');
    }
    if (after.length === 0 || !after.every((request) => request.userRetryNotice)) {
      scenario.failures.push(
        'the retried run did not carry the user-retry notice on every request',
      );
    }
  }

  function assertSingleReviewOnlyCandidate(
    scenario: ScenarioRecord,
    conversation: SanitizedConversationEvidence,
  ): void {
    if (conversation.conversationStatus !== 'waiting_user') {
      scenario.failures.push(
        `conversation ended in ${conversation.conversationStatus}, expected waiting_user`,
      );
    }
    const lastRun = conversation.runs[conversation.runs.length - 1];
    if (lastRun?.status !== 'completed') {
      scenario.failures.push(`final run status ${lastRun?.status ?? '<none>'}, expected completed`);
    }
    const candidates = conversation.artifacts.filter(
      (artifact) => artifact.artifactType === 'chapter_text' && artifact.status === 'candidate',
    );
    if (candidates.length !== 1) {
      scenario.failures.push(`expected exactly one candidate, found ${candidates.length}`);
    }
    if (candidates.some((artifact) => artifact.boundToFixtureChapter === false)) {
      scenario.failures.push('the candidate is bound to a different chapter');
    }
    if (
      !WRITING_SUBAGENT_READ_TOOLS.every((tool) =>
        conversation.toolEvents.some(
          (event) => event.toolName === tool && event.status === 'succeeded',
        ),
      )
    ) {
      scenario.failures.push('not every read tool succeeded on the completed run');
    }
  }

  it('S3a absorbs one transient upstream failure and still ends with exactly one candidate', async () => {
    const scenario: ScenarioRecord = {
      name: 'upstream-error-transient',
      verdict: 'INCOMPLETE',
      failures: [],
    };
    const chapterId = chapters[2].id;
    scenario.chapterId = chapterId;
    const before = mock!.snapshot().requestCount;
    mock!.configure({ mode: 'upstream-error-once', chapterId });

    const { conversation, invariants } = await runScenarioTurn({ scenario, chapterId });
    scenario.mockRequests = mockRequestsSince(before);
    scenario.conversation = conversation;
    scenario.invariants = { ...invariants };

    if (mock!.snapshot().injectedUpstreamFailures !== 1) {
      scenario.failures.push('the injected upstream failure was not consumed exactly once');
    }
    if (!scenario.mockRequests.some((request) => request.outcome === 'injected_failure')) {
      scenario.failures.push('no request hit the injected failure');
    }
    if (conversation.runs.length !== 1) {
      scenario.failures.push(
        `expected the transport retry to stay inside one run, found ${conversation.runs.length}`,
      );
    }
    assertSingleReviewOnlyCandidate(scenario, conversation);
    assertNoFormalWrites(scenario, invariants);
    record(scenario);
  });

  it('S3b keeps a retry failed while the upstream is broken and recovers only after repair', async () => {
    const scenario: ScenarioRecord = {
      name: 'upstream-error-persistent-retry',
      verdict: 'INCOMPLETE',
      failures: [],
    };
    const chapterId = chapters[3].id;
    scenario.chapterId = chapterId;
    const before = mock!.snapshot().requestCount;
    mock!.configure({ mode: 'upstream-error', chapterId });

    const failed = await runScenarioTurn({ scenario, chapterId });
    const failedRun = failed.conversation.runs[failed.conversation.runs.length - 1];
    const notes: Record<string, unknown> = {
      ...scenario.notes,
      failedRunStatus: failedRun?.status ?? null,
      failedRunError: failedRun?.error ?? null,
      injectedFailuresBeforeRecovery: mock!.snapshot().injectedUpstreamFailures,
    };
    scenario.notes = notes;
    if (failed.conversation.conversationStatus !== 'failed' || failedRun?.status !== 'failed') {
      scenario.failures.push(
        `persistent upstream failure ended in ${failed.conversation.conversationStatus}/${failedRun?.status ?? '<none>'}, expected failed/failed`,
      );
    }
    if (failed.conversation.artifacts.length > 0) {
      scenario.failures.push('a failed run persisted an artifact');
    }
    assertNoFormalWrites(scenario, failed.invariants);
    notes.originalFailure = failed.conversation;
    notes.originalInvariants = failed.invariants;
    if (failed.conversation.runs.length !== 1) {
      scenario.failures.push('the initial failed request created more than one run');
    }

    // A click must not turn a still-broken connection into a success or silently fall back.
    // Leave the upstream in persistent-error mode for this first explicit retry.
    const retryStartSequence = mock!.snapshot().requestCount;
    notes.stillBrokenRetryAttempts = await retryLatestRun(failed.conversationId);
    await waitForTerminalConversationStatus({
      timeoutMs: turnTimeoutMs,
      label: 'upstream-error-retry-still-broken',
    });
    const stillBroken = await collectConversationEvidence({
      conversationId: failed.conversationId,
      fixtureNovelId: novelId,
      fixtureChapterId: chapterId,
    });
    const stillBrokenInvariants = await readChapterInvariants({ novelId, chapterId });
    const stillBrokenRequests = mockRequestsSince(retryStartSequence);
    notes.stillBrokenConversation = stillBroken.evidence;
    notes.stillBrokenInvariants = stillBrokenInvariants;
    if (stillBroken.evidence.runs.length !== 2) {
      scenario.failures.push(
        `expected 2 failed runs before upstream recovery, found ${stillBroken.evidence.runs.length}`,
      );
    }
    if (!stillBrokenRequests.some((request) => request.outcome === 'injected_failure')) {
      scenario.failures.push('the still-broken retry never reached the failing upstream');
    }
    if (stillBroken.evidence.artifacts.length > 0) {
      scenario.failures.push('the still-broken retry persisted an artifact');
    }
    assertNoChapterCandidate(scenario, stillBroken.evidence);
    assertRunsBoundToChapter(scenario, stillBroken.evidence, chapterId);
    assertNoFormalWrites(scenario, stillBrokenInvariants);

    mock!.configure({ mode: 'normal', chapterId });
    notes.recoveryStartSequence = mock!.snapshot().requestCount;
    notes.retryAttempts = await retryLatestRun(failed.conversationId);
    await waitForTerminalConversationStatus({
      timeoutMs: turnTimeoutMs,
      label: 'upstream-error-persistent-retry',
    });
    const recovered = await collectConversationEvidence({
      conversationId: failed.conversationId,
      fixtureNovelId: novelId,
      fixtureChapterId: chapterId,
    });
    const invariants = await readChapterInvariants({ novelId, chapterId });
    scenario.mockRequests = mockRequestsSince(before);
    scenario.conversation = recovered.evidence;
    scenario.invariants = { ...invariants };

    if (recovered.evidence.runs.length !== 3) {
      scenario.failures.push(
        `expected 3 runs (failed + failed retry + recovered retry), found ${recovered.evidence.runs.length}`,
      );
    }
    if (recovered.evidence.runs.slice(0, 2).some((run) => run.status !== 'failed')) {
      scenario.failures.push('upstream recovery rewrote a previously failed run as successful');
    }
    assertRunsBoundToChapter(scenario, recovered.evidence, chapterId);
    assertRetryNoticeOnlyOnRetriedRun(scenario, scenario.mockRequests, retryStartSequence);
    assertSingleReviewOnlyCandidate(scenario, recovered.evidence);
    assertNoFormalWrites(scenario, invariants);
    record(scenario);
  });
  it('S5 rejects persistent short candidates after exactly three attempts without creating artifacts', async () => {
    const scenario: ScenarioRecord = {
      name: 'word-range-rejected',
      verdict: 'INCOMPLETE',
      failures: [],
    };
    const chapterId = chapters[4].id;
    scenario.chapterId = chapterId;
    const before = mock!.snapshot().requestCount;
    mock!.configure({ mode: 'normal', chapterId, candidateText: SHORT_CANDIDATE_TEXT });
    try {
      const { conversation, invariants } = await runScenarioTurn({
        scenario,
        chapterId,
        waitForRuntimeIdle: true,
      });
      scenario.mockRequests = mockRequestsSince(before);
      scenario.conversation = conversation;
      scenario.invariants = { ...invariants };
      const candidateRequests = scenario.mockRequests.filter(
        (request) => request.phase === 'generate-chapter',
      );
      const candidateEvents = conversation.toolEvents.filter(
        (event) => event.toolName === WRITING_SUBAGENT_CANDIDATE_TOOL,
      );
      const lengthRejectedRuns = conversation.runs.filter(
        (run) =>
          run.status === 'failed' && /DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED/u.test(run.error ?? ''),
      );
      scenario.notes = {
        ...scenario.notes,
        scriptedCandidateCjkLength: cjkLength(SHORT_CANDIDATE_TEXT),
        expectedCandidateAttempts: 3,
        candidateRequestCount: candidateRequests.length,
        candidateToolEventCount: candidateEvents.length,
        lengthRejectedRunCount: lengthRejectedRuns.length,
      };

      if (candidateRequests.length !== 3 || candidateEvents.length !== 3) {
        scenario.failures.push(
          `expected exactly 3 candidate attempts, got ${candidateRequests.length} requests and ${candidateEvents.length} tool events`,
        );
      }
      if (conversation.runs.length !== 3 || lengthRejectedRuns.length !== 3) {
        scenario.failures.push(
          `expected 3 length-rejected runs (initial + 2 repairs), got ${conversation.runs.length} runs and ${lengthRejectedRuns.length} length rejections`,
        );
      }
      if (
        lengthRejectedRuns.some(
          (run) => candidateEvents.filter((event) => event.runId === run.runId).length !== 1,
        )
      ) {
        scenario.failures.push(
          'each length-rejected run must retain exactly one candidate attempt',
        );
      }
      assertRunsBoundToChapter(scenario, conversation, chapterId);
      const lastRun = conversation.runs[conversation.runs.length - 1];
      if (!/DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED/u.test(lastRun?.error ?? '')) {
        scenario.failures.push(
          `run error does not name the length gate: ${lastRun?.error ?? '<none>'}`,
        );
      }
      assertNoChapterCandidate(scenario, conversation);
      assertNoFormalWrites(scenario, invariants);
      record(scenario);
    } finally {
      mock!.configure({ candidateText: CANDIDATE_TEXT });
    }
  });

  it('S6 persists a task-local 3200-word setting across reload and applies it to a later write', async () => {
    const scenario: ScenarioRecord = {
      name: 'conversation-word-target-persisted',
      verdict: 'INCOMPLETE',
      failures: [],
    };
    const chapterId = chapters[6].id;
    scenario.chapterId = chapterId;
    const before = mock!.snapshot().requestCount;
    const settingGoal = '本任务目标字数设为3200字';
    const candidateText = buildCandidateText(CONVERSATION_TARGET_WORD_COUNT);
    mock!.configure({ mode: 'normal', chapterId, candidateText });
    try {
      const setting = await runScenarioTurn({ scenario, chapterId, goal: settingGoal });
      const settingRequests = mockRequestsSince(before);
      // Opening the task creator can refresh the model catalog before the local command.
      // Keep those attestation probes visible; only chapter/tool completions must be zero.
      const settingCompletionRequests = settingRequests.filter(
        (request) => request.phase !== 'model-tool-attestation',
      );
      const settingRun = setting.conversation.runs[0];
      if (
        setting.conversation.runs.length !== 1 ||
        settingRun?.providerId !== 'ans-local' ||
        settingRun?.status !== 'completed'
      ) {
        scenario.failures.push('the word-setting command did not complete as one ans-local run');
      }
      if (settingCompletionRequests.length !== 0) {
        scenario.failures.push(
          'the local word-setting command unexpectedly requested a completion',
        );
      }
      if (setting.conversation.artifacts.length !== 0) {
        scenario.failures.push('the word-setting command unexpectedly created an artifact');
      }
      assertNoFormalWrites(scenario, setting.invariants);
      await findTestIdByAttribute('workbench-turn', 'data-role', 'assistant');

      // Reload the WebView, then re-open the same task: an in-memory-only setting is not enough.
      await browser.execute(() => window.location.reload());
      await waitForTestId('app-shell');
      await openConversationThroughUi(novelId, setting.conversationId);
      const persisted = await invoke<ConversationBundle>('get_task_conversation', {
        conversationId: setting.conversationId,
      });
      const settingPersisted = persisted.turns.some(
        (turn) => turn.role === 'user' && turn.content === settingGoal,
      );
      // Persist only numeric receipt facts, never user turns, instructions or generated prose.
      const expectedReceipt = [
        CONVERSATION_TARGET_WORD_COUNT,
        CONVERSATION_HARD_WORD_RANGE.minimum,
        CONVERSATION_HARD_WORD_RANGE.maximum,
      ];
      const receiptMatchesRange = persisted.turns.some((turn) => {
        if (turn.role !== 'assistant') return false;
        const numbers = (turn.content?.match(/[0-9]+/gu) ?? []).map(Number);
        return expectedReceipt.every((value, index) => numbers[index] === value);
      });
      scenario.notes = {
        ...scenario.notes,
        chapterTargetWordCount: TARGET_WORD_COUNT,
        taskTargetWordCount: CONVERSATION_TARGET_WORD_COUNT,
        expectedHardWordRange: CONVERSATION_HARD_WORD_RANGE,
        scriptedCandidateCjkLength: cjkLength(candidateText),
        localSetting: setting.conversation,
        localSettingInvariants: setting.invariants,
        settingUpstreamRequestCount: settingRequests.length,
        settingAttestationRequestCount: settingRequests.length - settingCompletionRequests.length,
        settingCompletionRequestCount: settingCompletionRequests.length,
        settingPersistedAfterReload: settingPersisted,
        receiptMatchesRange,
      };
      if (!settingPersisted) scenario.failures.push('the task word setting did not survive reload');
      if (!receiptMatchesRange) {
        scenario.failures.push('the local receipt did not report target 3200 and range 2560-3680');
      }

      // No number in this follow-up: only the earlier persisted user turn can supply 3200.
      const runsBeforeWrite = await countRuns(setting.conversationId);
      await fillTestId('workbench-composer-input', goalFor(chapters[6].title));
      const send = await waitForTestId('workbench-send-task');
      await send.waitForEnabled({ timeout: 30_000 });
      await clickTestId('workbench-send-task');
      await browser.waitUntil(
        async () => (await countRuns(setting.conversationId)) > runsBeforeWrite,
        { timeout: 60_000, interval: 500, timeoutMsg: 'the follow-up write did not create a run' },
      );
      await waitForTerminalConversationStatus({
        timeoutMs: turnTimeoutMs,
        label: 'conversation-word-target-persisted',
      });
      const written = await collectConversationEvidence({
        conversationId: setting.conversationId,
        fixtureNovelId: novelId,
        fixtureChapterId: chapterId,
        hardWordRange: CONVERSATION_HARD_WORD_RANGE,
      });
      const invariants = await readChapterInvariants({ novelId, chapterId });
      scenario.mockRequests = mockRequestsSince(before);
      scenario.conversation = written.evidence;
      scenario.invariants = { ...invariants };
      if (written.evidence.runs.length !== 2) {
        scenario.failures.push('expected exactly one local setting run and one API write run');
      }
      const writeRun = written.evidence.runs[written.evidence.runs.length - 1];
      if (writeRun?.runtimeMode !== 'api' || writeRun.modelId !== MODEL_NAME) {
        scenario.failures.push('the follow-up write did not use the configured API model');
      }
      const candidates = written.evidence.artifacts.filter(
        (artifact) => artifact.artifactType === 'chapter_text',
      );
      if (
        candidates.some(
          (artifact) =>
            artifact.withinHardRangeByCjkCount !== true || artifact.processingStatus !== 'valid',
        )
      ) {
        scenario.failures.push(
          'a candidate failed the independently expected 2560-3680 word range',
        );
      }
      assertSingleReviewOnlyCandidate(scenario, written.evidence);
      assertRunsBoundToChapter(scenario, written.evidence, chapterId);
      assertNoFormalWrites(scenario, invariants);
      record(scenario);
    } finally {
      mock!.configure({ mode: 'normal', candidateText: CANDIDATE_TEXT });
    }
  });

  it('S7 repairs an oversized 3000-target candidate once and produces exactly one valid artifact', async () => {
    const scenario: ScenarioRecord = {
      name: 'word-range-oversized-then-repaired',
      verdict: 'INCOMPLETE',
      failures: [],
    };
    const chapterId = chapters[7].id;
    scenario.chapterId = chapterId;
    const before = mock!.snapshot().requestCount;
    const oversized = buildCandidateText(3586);
    const repaired = buildCandidateText(REPAIR_TARGET_WORD_COUNT);
    mock!.configure({ mode: 'normal', chapterId, candidateTexts: [oversized, repaired] });
    try {
      const result = await runScenarioTurn({ scenario, chapterId, waitForRuntimeIdle: true });
      const { evidence: conversation } = await collectConversationEvidence({
        conversationId: result.conversationId,
        fixtureNovelId: novelId,
        fixtureChapterId: chapterId,
        hardWordRange: REPAIR_HARD_WORD_RANGE,
      });
      scenario.mockRequests = mockRequestsSince(before);
      scenario.conversation = conversation;
      scenario.invariants = { ...result.invariants };
      const candidateRequests = scenario.mockRequests.filter(
        (request) => request.phase === 'generate-chapter',
      );
      const candidateEvents = conversation.toolEvents.filter(
        (event) => event.toolName === WRITING_SUBAGENT_CANDIDATE_TOOL,
      );
      const candidates = conversation.artifacts.filter(
        (artifact) => artifact.artifactType === 'chapter_text',
      );
      scenario.notes = {
        ...scenario.notes,
        chapterTargetWordCount: REPAIR_TARGET_WORD_COUNT,
        expectedHardWordRange: REPAIR_HARD_WORD_RANGE,
        scriptedCandidateCjkLengths: [cjkLength(oversized), cjkLength(repaired)],
        candidateRequestCount: candidateRequests.length,
        candidateToolEventCount: candidateEvents.length,
        runtimeCandidateCallCount: mock!.snapshot().candidateCalls,
      };
      if (cjkLength(oversized) <= REPAIR_HARD_WORD_RANGE.maximum) {
        scenario.failures.push('the first fixture candidate did not exceed the hard maximum');
      }
      if (candidateRequests.length !== 2 || candidateEvents.length !== 2) {
        scenario.failures.push('expected exactly two candidate requests and two tool events');
      }
      if (candidateRequests.some((request, index) => request.candidateCallNumber !== index + 1)) {
        scenario.failures.push('the deterministic candidate sequence was not consumed in order');
      }
      const firstRun = conversation.runs[0];
      const finalRun = conversation.runs[conversation.runs.length - 1];
      if (
        conversation.runs.length !== 2 ||
        firstRun?.status !== 'failed' ||
        !/DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED/u.test(firstRun?.error ?? '') ||
        finalRun?.status !== 'completed'
      ) {
        scenario.failures.push(
          'expected one preserved length failure followed by one successful repair',
        );
      }
      if (
        conversation.runs.some(
          (run) =>
            run.runtimeMode !== 'api' ||
            run.modelId !== MODEL_NAME ||
            candidateEvents.filter((event) => event.runId === run.runId).length !== 1,
        )
      ) {
        scenario.failures.push(
          'repair changed the frozen API model or candidate attempt ownership',
        );
      }
      if (
        !WRITING_SUBAGENT_READ_TOOLS.every((tool) =>
          conversation.toolEvents.some(
            (event) =>
              event.runId === finalRun?.runId &&
              event.toolName === tool &&
              event.status === 'succeeded',
          ),
        )
      ) {
        scenario.failures.push('the repair run did not repeat every required context read');
      }
      if (
        candidates.length !== 1 ||
        candidates[0].processingStatus !== 'valid' ||
        candidates[0].withinHardRangeByCjkCount !== true ||
        candidates[0].cjkCharacterCount !== cjkLength(repaired)
      ) {
        scenario.failures.push(
          'the successful repair did not persist only the second valid candidate',
        );
      }
      assertSingleReviewOnlyCandidate(scenario, conversation);
      assertRunsBoundToChapter(scenario, conversation, chapterId);
      assertNoFormalWrites(scenario, result.invariants, REPAIR_TARGET_WORD_COUNT);
      record(scenario);
    } finally {
      mock!.configure({ mode: 'normal', candidateTexts: [], candidateText: CANDIDATE_TEXT });
    }
  });

  it('S4 survives a hard process kill mid-run: the restarted app fails the run closed and a retry succeeds', async () => {
    const scenario: ScenarioRecord = {
      name: 'restart-recovery',
      verdict: 'INCOMPLETE',
      failures: [],
    };
    const chapterId = chapters[5].id;
    scenario.chapterId = chapterId;
    const before = mock!.snapshot().requestCount;
    mock!.configure({ mode: 'hold-generate', chapterId });
    const driverPid = Number(process.env[FAULT_INJECTION_ENV.driverPid] ?? '0');
    if (!driverPid)
      throw new Error(`${FAULT_INJECTION_ENV.driverPid} is required for the restart drill.`);

    const started = await startChapterTaskThroughUi({
      novelId,
      chapterId,
      goal: goalFor(chapters[5].title),
      knownConversationIds,
    });
    knownConversationIds.add(started.conversationId);
    scenario.conversationId = started.conversationId;
    // Wait until the reads are done and the candidate completion is parked inside the mock.
    await browser.waitUntil(
      async () =>
        mock!
          .snapshot()
          .requests.some(
            (request) =>
              request.sequence > before &&
              request.phase === 'hold-generate' &&
              request.outcome === 'streaming',
          ),
      {
        timeout: 120_000,
        interval: 1_000,
        timeoutMsg: 'the candidate completion was never parked',
      },
    );
    const toolsBeforeKill = await readDomToolEvents();
    const statusBeforeKill = await readConversationStatus();

    const appProcesses = descendantsOf(listProcesses(), driverPid).filter(
      (row) => row.Name.toLowerCase() === 'ai novel studio.exe',
    );
    if (appProcesses.length === 0)
      throw new Error('could not locate the driver-launched app process');
    for (const row of appProcesses) killProcess(row.ProcessId);
    const notes: Record<string, unknown> = {
      ...scenario.notes,
      statusBeforeKill,
      toolsBeforeKill,
      killedAppProcesses: appProcesses.length,
    };
    scenario.notes = notes;
    // The held request must observe the client disconnect once the host dies.
    await browser.waitUntil(
      async () =>
        !mock!
          .snapshot()
          .requests.some(
            (request) => request.phase === 'hold-generate' && request.outcome === 'streaming',
          ),
      {
        timeout: 60_000,
        interval: 1_000,
        timeoutMsg: 'the parked completion never saw the disconnect',
      },
    );
    // Any worker that outlived the host must not be able to finish the turn on its own.
    notes.orphansKilled = killIsolatedOrphans(profileRoot);

    await browser.reloadSession();
    await waitForTestId('app-shell');
    // The restarted host reconciles orphaned runs on startup and announces them once.
    const recoveryDialog = await browser.$('[data-testid="conversation-recovery-dialog"]');
    try {
      await recoveryDialog.waitForExist({ timeout: 30_000 });
    } catch {
      /* the dialog is asserted below through the recovered run state, not its presence */
    }
    if (await recoveryDialog.isExisting()) {
      notes.startupRecoveryDialog = {
        recoveredRuns: await recoveryDialog.getAttribute('data-recovered-runs'),
        recoveryStatus: await recoveryDialog.getAttribute('data-recovery-status'),
      };
      const dismiss = await browser.$('[data-testid="conversation-recovery-dismiss"]');
      if (await dismiss.isExisting()) await dismiss.click();
      await recoveryDialog.waitForExist({ timeout: 30_000, reverse: true });
    } else {
      notes.startupRecoveryDialog = null;
    }
    await openConversationThroughUi(novelId, started.conversationId);
    await browser.waitUntil(async () => (await readConversationStatus()) === 'failed', {
      timeout: 60_000,
      interval: 1_000,
      timeoutMsg: 'the interrupted run was not reconciled to failed after restart',
    });
    const interrupted = await collectConversationEvidence({
      conversationId: started.conversationId,
      fixtureNovelId: novelId,
      fixtureChapterId: chapterId,
    });
    const interruptedRun = interrupted.evidence.runs[interrupted.evidence.runs.length - 1];
    notes.interruptedRun = interruptedRun ?? null;
    if (interruptedRun?.status !== 'failed') {
      scenario.failures.push(
        `interrupted run status ${interruptedRun?.status ?? '<none>'}, expected failed`,
      );
    }
    if (!/中断|interrupt/u.test(interruptedRun?.error ?? '')) {
      scenario.failures.push('the interrupted run error does not name the interruption');
    }
    if (interrupted.evidence.artifacts.length > 0) {
      scenario.failures.push('the interrupted run persisted an artifact');
    }
    assertNoFormalWrites(scenario, await readChapterInvariants({ novelId, chapterId }));

    mock!.configure({ mode: 'normal', chapterId });
    const retryStartSequence = mock!.snapshot().requestCount;
    notes.retryAttempts = await retryLatestRun(started.conversationId);
    await waitForTerminalConversationStatus({
      timeoutMs: turnTimeoutMs,
      label: 'restart-recovery',
    });
    const recovered = await collectConversationEvidence({
      conversationId: started.conversationId,
      fixtureNovelId: novelId,
      fixtureChapterId: chapterId,
    });
    const invariants = await readChapterInvariants({ novelId, chapterId });
    scenario.mockRequests = mockRequestsSince(before);
    scenario.conversation = recovered.evidence;
    scenario.invariants = { ...invariants };

    if (recovered.evidence.conversationStatus !== 'waiting_user') {
      scenario.failures.push(
        `conversation ended in ${recovered.evidence.conversationStatus}, expected waiting_user`,
      );
    }
    const lastRun = recovered.evidence.runs[recovered.evidence.runs.length - 1];
    if (lastRun?.status !== 'completed') {
      scenario.failures.push(
        `retried run status ${lastRun?.status ?? '<none>'}, expected completed`,
      );
    }
    if (recovered.evidence.runs.length !== 2) {
      scenario.failures.push(
        `expected 2 runs (interrupted + retry), found ${recovered.evidence.runs.length}`,
      );
    }
    const candidates = recovered.evidence.artifacts.filter(
      (artifact) => artifact.artifactType === 'chapter_text' && artifact.status === 'candidate',
    );
    if (candidates.length !== 1)
      scenario.failures.push(`expected exactly one candidate, found ${candidates.length}`);
    if (candidates.some((artifact) => artifact.boundToFixtureChapter === false)) {
      scenario.failures.push('the candidate is bound to a different chapter');
    }
    assertRunsBoundToChapter(scenario, recovered.evidence, chapterId);
    assertRetryNoticeOnlyOnRetriedRun(scenario, scenario.mockRequests, retryStartSequence);
    assertNoFormalWrites(scenario, invariants);
    record(scenario);
  });
});
