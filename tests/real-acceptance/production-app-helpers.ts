import { browser } from '@wdio/globals';
import { redactLogText } from '../../scripts/e2e/artifact-sanitizer.ts';
import {
  clickTestId,
  fillTestId,
  findTestIdByAttribute,
  navigateHash,
  waitForTestId,
} from '../e2e/helpers';
import { WRITING_SUBAGENT_FLAG_KEY } from './real-profile-env';

/**
 * Helpers shared by the production-binary carriers (real profile and fault injection).
 * They talk to the app through the production IPC bridge (`window.__TAURI_INVOKE__`) and
 * the production workbench UI; nothing here depends on the Cargo `e2e` feature.
 * Every value they return is already safe to persist as evidence: ids, statuses, counts,
 * lengths and hashes — never prompts, chapter text or credentials.
 */

interface InvokeResponse {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface NovelDto {
  id: string;
  title: string;
  totalWordCount?: number;
}

export interface ChapterDto {
  id: string;
  title: string;
  status?: string;
  wordCount?: number;
  targetWordCount?: number;
}

export interface BundleRun {
  runId: string;
  status: string;
  workerId?: string;
  chapterId?: string | null;
  error?: string | null;
  modelSnapshot?: {
    providerId?: string;
    modelId?: string;
    runtimeMode?: string;
  };
}

export interface BundleToolEvent {
  runId: string;
  toolName: string;
  status: string;
  durationMs?: number | null;
  error?: string | null;
}

export interface BundleArtifact {
  cardId: string;
  artifactId?: string | null;
  artifactType: string;
  status: string;
  content?: string | null;
}

export interface BundleTurn {
  role: string;
  content?: string | null;
}

export interface ConversationBundle {
  conversation: { conversationId: string; status: string };
  turns: BundleTurn[];
  runs: BundleRun[];
  toolEvents: BundleToolEvent[];
  artifacts: BundleArtifact[];
  decisions?: unknown[];
}

export interface ArtifactBundle {
  artifact: {
    artifactType: string;
    contentLength: number;
    contentHash: string;
    processingStatus: string;
    sourceNovelId: string;
    sourceChapterId?: string | null;
  };
  rawContent?: string;
  displayContent?: string;
}

export const TERMINAL_CONVERSATION_STATUSES = new Set(['waiting_user', 'failed', 'completed']);

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = (await browser.executeAsync(
    (name: string, input: Record<string, unknown>, done: (value: InvokeResponse) => void) => {
      const describe = (error: unknown): string => {
        if (typeof error === 'string') return error;
        if (error && typeof error === 'object') {
          try {
            return JSON.stringify(error);
          } catch {
            return String(error);
          }
        }
        return String(error);
      };
      const bridge = (
        window as unknown as {
          __TAURI_INVOKE__?: (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>;
        }
      ).__TAURI_INVOKE__;
      if (!bridge) {
        done({ ok: false, error: 'window.__TAURI_INVOKE__ is unavailable' });
        return;
      }
      Promise.resolve(bridge(name, input))
        .then((value) => done({ ok: true, value }))
        .catch((error: unknown) => done({ ok: false, error: describe(error) }));
    },
    command,
    args,
  )) as InvokeResponse;
  if (!response.ok) {
    throw new Error(`IPC ${command} failed: ${redactLogText(response.error ?? 'unknown error')}`);
  }
  return response.value as T;
}

export function sanitizeError(value: string | null | undefined): string | null {
  if (!value) return null;
  return redactLogText(value).slice(0, 300);
}

export function countCjkCharacters(text: string): number {
  let count = 0;
  for (const character of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(character)) count += 1;
  }
  return count;
}

export async function readConversationStatus(): Promise<string> {
  const badge = await browser.$('[data-testid="workbench-conversation-status"]');
  if (!(await badge.isExisting())) return '';
  return (await badge.getAttribute('data-status')) ?? '';
}

export async function readDomToolEvents(): Promise<Array<{ toolName: string; status: string }>> {
  const nodes = await browser.$$('[data-testid="workbench-tool-event"]');
  const events: Array<{ toolName: string; status: string }> = [];
  for (const node of nodes) {
    events.push({
      toolName: (await node.getAttribute('data-tool-name')) ?? '',
      status: (await node.getAttribute('data-status')) ?? '',
    });
  }
  return events;
}

export async function setWritingSubAgentFlag(enabled: boolean): Promise<void> {
  await browser.execute(
    (key, value) => {
      if (value) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    },
    WRITING_SUBAGENT_FLAG_KEY,
    enabled,
  );
}

export async function readWritingSubAgentFlag(): Promise<string | null> {
  return browser.execute((key) => localStorage.getItem(key), WRITING_SUBAGENT_FLAG_KEY);
}

export async function seedCoreAssets(novelId: string): Promise<void> {
  await invoke('save_world_setting', {
    id: null,
    input: {
      novelId,
      title: '苍穹大陆',
      content:
        '苍穹大陆宗门林立，青云宗坐落于连绵山脉之间，演武场是外门弟子每季试炼之地。灵气随季节涨落，雷雨之夜常有天象异变。',
      isActive: true,
    },
  });
  await invoke('save_rule_system', {
    id: null,
    input: {
      novelId,
      title: '修炼规则',
      category: null,
      content:
        '修为分炼气、筑基、金丹三境，每境九层。突破需要长期积累与代价，不能凭空掌握新的力量；灵力耗尽后需静养恢复。',
      forbiddenRules: '不得忽略伤势和疲劳；不得出现无来由的越级战胜。',
      isActive: true,
    },
  });
  await invoke('save_protagonist', {
    id: null,
    input: {
      novelId,
      name: '林辰',
      identity: '青云宗外门弟子',
      personality: '冷静坚韧，重情义，不轻易示弱',
      goal: '通过季度试炼，守护同伴并进入内门',
      specialAbility: '雷灵根，雨夜时灵力略有增幅',
      abilityLimits: '灵力总量有限，连续施展三次雷技后需要休息',
      forbiddenBehaviors: '不会为求胜牺牲同伴',
      currentState: '炼气七层，左肩带着旧伤',
    },
  });
}

export async function createFixtureChapter(input: {
  novelId: string;
  volumeId?: string | null;
  title: string;
  orderIndex: number;
  targetWordCount: number;
}): Promise<ChapterDto> {
  return invoke<ChapterDto>('create_chapter', {
    input: {
      novelId: input.novelId,
      volumeId: input.volumeId ?? null,
      title: input.title,
      outline:
        '季度试炼在演武场举行。林辰对上内门弟子赵擎，战至中途风雨骤起，天生异象，雷光贯顶。他在濒临落败时护住同伴苏晚，以雷灵根之力险胜半招，却因旧伤复发倒地。',
      goal: '交代试炼背景与主角处境，制造第一次天象异变的悬念。',
      targetWordCount: input.targetWordCount,
      orderIndex: input.orderIndex,
    },
  });
}

export async function waitForModelCatalog(): Promise<{ status: string; message: string }> {
  const control = await browser.$('label[for="workbench-new-task-model"]');
  await browser.waitUntil(
    async () => {
      const status = await control.getAttribute('data-model-status');
      return status !== null && status !== 'refreshing';
    },
    {
      timeout: 120_000,
      interval: 2_000,
      timeoutMsg: 'the Runtime model directory kept refreshing',
    },
  );
  const status = (await control.getAttribute('data-model-status')) ?? '';
  const notice = await browser.$('[data-testid="workbench-new-task-model-status"]');
  const message = (await notice.isExisting())
    ? redactLogText(await notice.getText()).slice(0, 300)
    : '';
  return { status, message };
}

/**
 * Opens the workbench for a novel, creates a chapter-bound task and starts it.
 * `knownConversationIds` lets callers that create several tasks in one session wait for
 * the header to switch to the *new* conversation instead of reading the previous one.
 */
export async function startChapterTaskThroughUi(input: {
  novelId: string;
  chapterId: string;
  goal: string;
  modelHint?: string;
  knownConversationIds?: ReadonlySet<string>;
}): Promise<{
  conversationId: string;
  catalog: { status: string; message: string };
  selectedModelKey: string;
}> {
  await navigateHash('#/novels');
  await navigateHash('#/');
  await waitForTestId('creative-workbench');
  await (await findTestIdByAttribute('workbench-project', 'data-novel-id', input.novelId)).click();
  await clickTestId('workbench-create-task');
  await fillTestId('workbench-new-task-goal', input.goal);
  await (
    await waitForTestId('workbench-new-task-chapter')
  ).selectByAttribute('value', input.chapterId);

  const modelSelect = await waitForTestId('workbench-new-task-model-select');
  let catalog = await waitForModelCatalog();
  if (catalog.status !== 'available') {
    const retry = await browser.$('[data-testid="workbench-new-task-model-status-retry"]');
    if (await retry.isExisting()) {
      await retry.click();
      catalog = await waitForModelCatalog();
    }
  }
  const hint = input.modelHint?.toLowerCase();
  let selectedModel = (await modelSelect.getValue()) ?? '';
  if (hint && !selectedModel.toLowerCase().includes(hint) && (await modelSelect.isEnabled())) {
    for (const option of await modelSelect.$$('option')) {
      const value = (await option.getAttribute('value')) ?? '';
      const disabled = await option.getAttribute('disabled');
      if (value.toLowerCase().includes(hint) && disabled === null) {
        await modelSelect.selectByAttribute('value', value);
        break;
      }
    }
    selectedModel = (await modelSelect.getValue()) ?? '';
  }
  if (catalog.status !== 'available') {
    throw new Error(`model directory is ${catalog.status}: ${catalog.message || '<no message>'}`);
  }

  const start = await waitForTestId('workbench-create-and-start');
  await start.waitForEnabled({ timeout: 60_000 });
  // The header keeps showing the previously selected conversation until the new one is
  // created; whatever it shows right now is by definition not the conversation we start.
  const known = new Set<string>(input.knownConversationIds ?? []);
  const currentHeader = await browser.$('[data-testid="workbench-task-header"]');
  if (await currentHeader.isExisting()) {
    const current = (await currentHeader.getAttribute('data-conversation-id')) ?? '';
    if (current) known.add(current);
  }
  await start.click();
  let conversationId = '';
  await browser.waitUntil(
    async () => {
      const header = await browser.$('[data-testid="workbench-task-header"]');
      if (!(await header.isExisting())) return false;
      const candidate = (await header.getAttribute('data-conversation-id')) ?? '';
      if (!candidate || known.has(candidate)) return false;
      conversationId = candidate;
      return true;
    },
    {
      timeout: 60_000,
      interval: 500,
      timeoutMsg: 'the task header never switched to the new conversation',
    },
  );
  await browser.waitUntil(
    async () => {
      const status = await readConversationStatus();
      return status !== '' && status !== 'idle';
    },
    {
      timeout: 60_000,
      interval: 1_000,
      timeoutMsg: 'the chapter_write turn never started',
    },
  );
  return { conversationId, catalog, selectedModelKey: selectedModel };
}

export async function waitForTerminalConversationStatus(input: {
  timeoutMs: number;
  label: string;
  onProgress?: (status: string, tools: Array<{ toolName: string; status: string }>) => void;
}): Promise<string> {
  let lastLogAt = 0;
  await browser.waitUntil(
    async () => {
      const status = await readConversationStatus();
      if (input.onProgress && Date.now() - lastLogAt >= 20_000) {
        lastLogAt = Date.now();
        input.onProgress(status, await readDomToolEvents());
      }
      return TERMINAL_CONVERSATION_STATUSES.has(status);
    },
    {
      timeout: input.timeoutMs,
      interval: 3_000,
      timeoutMsg: `${input.label}: the turn did not settle within ${input.timeoutMs} ms`,
    },
  );
  // Give the renderer-side integrity review a moment to append its assistant turn.
  await browser.pause(3_000);
  return readConversationStatus();
}

export interface SanitizedConversationEvidence {
  conversationStatus: string;
  runs: Array<{
    runId: string;
    status: string;
    chapterId: string | null;
    providerId: string | null;
    modelId: string | null;
    runtimeMode: string | null;
    error: string | null;
  }>;
  toolEvents: Array<{
    runId: string;
    toolName: string;
    status: string;
    durationMs: number | null;
    error: string | null;
  }>;
  runtimeProjectionEvents: string[];
  artifacts: Array<Record<string, unknown>>;
  turns: Array<{ role: string; contentLength: number; integrityNotice: boolean }>;
  decisionCount: number;
}

/** `dsh.*` rows are host projections of runtime session events, not model tool calls. */
export function isRuntimeProjection(toolName: string): boolean {
  return toolName.startsWith('dsh.');
}

export async function collectConversationEvidence(input: {
  conversationId: string;
  fixtureNovelId: string;
  fixtureChapterId: string;
  hardWordRange?: { minimum: number; maximum: number };
}): Promise<{ bundle: ConversationBundle; evidence: SanitizedConversationEvidence }> {
  const bundle = await invoke<ConversationBundle | null>('get_task_conversation', {
    conversationId: input.conversationId,
  });
  if (!bundle) throw new Error('get_task_conversation returned null');
  const artifacts: Array<Record<string, unknown>> = [];
  for (const card of bundle.artifacts) {
    const entry: Record<string, unknown> = {
      artifactType: card.artifactType,
      status: card.status,
      hasArtifactId: Boolean(card.artifactId),
    };
    if (card.artifactId) {
      try {
        const detail = await invoke<ArtifactBundle>('get_result_artifact', {
          input: { artifactId: card.artifactId },
        });
        const text = detail.displayContent ?? detail.rawContent ?? '';
        const cjkCharacterCount = countCjkCharacters(text);
        entry.processingStatus = detail.artifact.processingStatus;
        entry.contentLength = detail.artifact.contentLength;
        entry.contentHash = detail.artifact.contentHash;
        entry.cjkCharacterCount = cjkCharacterCount;
        if (input.hardWordRange) {
          entry.withinHardRangeByCjkCount =
            cjkCharacterCount >= input.hardWordRange.minimum &&
            cjkCharacterCount <= input.hardWordRange.maximum;
        }
        entry.boundToFixtureNovel = detail.artifact.sourceNovelId === input.fixtureNovelId;
        entry.boundToFixtureChapter = detail.artifact.sourceChapterId === input.fixtureChapterId;
      } catch (error) {
        entry.detailError = sanitizeError(error instanceof Error ? error.message : String(error));
      }
    }
    artifacts.push(entry);
  }
  const evidence: SanitizedConversationEvidence = {
    conversationStatus: bundle.conversation.status,
    runs: bundle.runs.map((run) => ({
      runId: run.runId,
      status: run.status,
      chapterId: run.chapterId ?? null,
      providerId: run.modelSnapshot?.providerId ?? null,
      modelId: run.modelSnapshot?.modelId ?? null,
      runtimeMode: run.modelSnapshot?.runtimeMode ?? null,
      error: sanitizeError(run.error),
    })),
    toolEvents: bundle.toolEvents.map((event) => ({
      runId: event.runId,
      toolName: event.toolName,
      status: event.status,
      durationMs: event.durationMs ?? null,
      error: sanitizeError(event.error),
    })),
    runtimeProjectionEvents: bundle.toolEvents
      .filter((event) => isRuntimeProjection(event.toolName))
      .map((event) => event.toolName),
    artifacts,
    turns: bundle.turns.map((turn) => ({
      role: turn.role,
      contentLength: turn.content?.length ?? 0,
      integrityNotice: turn.role === 'assistant' && (turn.content ?? '').includes('候选完整性检查'),
    })),
    decisionCount: bundle.decisions?.length ?? 0,
  };
  return { bundle, evidence };
}

export async function readChapterInvariants(input: {
  novelId: string;
  chapterId: string;
}): Promise<{
  chapterStatus: string | null;
  chapterWordCount: number | null;
  draftCount: number | null;
  novelTotalWordCount: number | null;
}> {
  const chapters = await invoke<ChapterDto[]>('get_chapters_by_novel_id', {
    novelId: input.novelId,
  });
  const chapter = chapters.find((item) => item.id === input.chapterId);
  const drafts = await invoke<unknown>('get_drafts_by_chapter_id', { chapterId: input.chapterId });
  const novel = await invoke<NovelDto | null>('get_novel_by_id', { id: input.novelId });
  return {
    chapterStatus: chapter?.status ?? null,
    chapterWordCount: chapter?.wordCount ?? null,
    draftCount: Array.isArray(drafts) ? drafts.length : null,
    novelTotalWordCount: novel?.totalWordCount ?? null,
  };
}
