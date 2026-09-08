import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { browser, expect } from '@wdio/globals';
import {
  startMockWorkbenchUpstream,
  type MockWorkbenchRequestSummary,
  type MockWorkbenchUpstream,
} from '../../scripts/dsh/mock-workbench-upstream.mjs';
import { findTestIdByAttribute, navigateHash, waitForTestId } from '../e2e/helpers';
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
 *                         candidate; once the upstream recovers an explicit retry succeeds.
 *   S5 word range         the candidate is far below the host's hard minimum → the E-1 length gate
 *                         rejects it before any artifact exists.
 *   S4 restart recovery   the candidate completion hangs, the app process is killed mid-run,
 *                         the restarted app marks the run interrupted and a retry succeeds.
 */

const MODEL_NAME = 'mock-workbench-fault-injection';
const TARGET_WORD_COUNT = 1000;
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
      'sequence' | 'phase' | 'outcome' | 'requestedToolNames' | 'userRetryNotice'
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
  const EXPECTED_SCENARIOS = 6;

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
    evidence.mockUpstream = { host: mock.host, port: mock.port };

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
        baseUrl: mock.upstreamBaseUrl,
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
          targetWordCount: TARGET_WORD_COUNT,
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

  async function runScenarioTurn(input: { scenario: ScenarioRecord; chapterId: string }): Promise<{
    conversationId: string;
    conversation: SanitizedConversationEvidence;
    invariants: Awaited<ReturnType<typeof readChapterInvariants>>;
  }> {
    const chapter = chapters.find((item) => item.id === input.chapterId);
    if (!chapter) throw new Error(`fixture chapter ${input.chapterId} is unknown`);
    const started = await startChapterTaskThroughUi({
      novelId,
      chapterId: input.chapterId,
      goal: goalFor(chapter.title),
      knownConversationIds,
    });
    knownConversationIds.add(started.conversationId);
    input.scenario.conversationId = started.conversationId;
    input.scenario.notes = {
      ...input.scenario.notes,
      modelCatalog: started.catalog,
      selectedModelKey: started.selectedModelKey,
    };
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
  ): void {
    if (invariants.chapterWordCount !== 0) {
      scenario.failures.push(`formal chapter word count became ${invariants.chapterWordCount}`);
    }
    if (invariants.draftCount !== 0) {
      scenario.failures.push(`turn created ${invariants.draftCount} chapter draft(s)`);
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

  it('S3b fails closed on a persistent upstream failure and recovers through an explicit retry', async () => {
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

    mock!.configure({ mode: 'normal', chapterId });
    const retryStartSequence = mock!.snapshot().requestCount;
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

    if (recovered.evidence.runs.length !== 2) {
      scenario.failures.push(
        `expected 2 runs (failed + retry), found ${recovered.evidence.runs.length}`,
      );
    }
    assertRunsBoundToChapter(scenario, recovered.evidence, chapterId);
    assertRetryNoticeOnlyOnRetriedRun(scenario, scenario.mockRequests, retryStartSequence);
    assertSingleReviewOnlyCandidate(scenario, recovered.evidence);
    assertNoFormalWrites(scenario, invariants);
    record(scenario);
  });
  it('S5 rejects a candidate outside the host word range before it becomes an artifact', async () => {
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
      const { conversation, invariants } = await runScenarioTurn({ scenario, chapterId });
      scenario.mockRequests = mockRequestsSince(before);
      scenario.conversation = conversation;
      scenario.invariants = { ...invariants };
      scenario.notes = {
        ...scenario.notes,
        scriptedCandidateCjkLength: cjkLength(SHORT_CANDIDATE_TEXT),
      };

      if (!scenario.mockRequests.some((request) => request.phase === 'generate-chapter')) {
        scenario.failures.push('the mock never submitted the short candidate');
      }
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
