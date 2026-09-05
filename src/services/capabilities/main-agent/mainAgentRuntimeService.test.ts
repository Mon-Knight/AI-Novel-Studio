import assert from 'node:assert/strict';
import test from 'node:test';

import { chapterRepository } from '../../database/chapterRepository';
import { novelRepository } from '../../database/novelRepository';
import { volumeRepository } from '../../database/volumeRepository';
import { settingRepository } from '../../database/settingRepository';
import { protagonistRepository } from '../../database/protagonistRepository';
import { draftVersionService } from '../../database/draftVersionService';
import { putLocalMemoryDocument } from '../../memory/adoptedDraftMemory';
import {
  extractSearchQuery,
  formatPrompt,
  mainAgentRuntimeService,
  sanitizeErrorMessage,
  selectInitialToolCalls,
} from './mainAgentRuntimeService';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function installStorage(): void {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  for (const key of [
    'ai_novel_studio_novels',
    'ai_novel_studio_volumes',
    'ai_novel_studio_chapters',
    'ai_novel_studio_world_settings',
    'ai_novel_studio_rule_systems',
    'ai_novel_studio_protagonists',
    'ai_novel_studio_memory_documents',
    'ai_novel_studio_draft_versions',
  ]) {
    storage.setItem(key, '[]');
  }
}

function restoreStorage(): void {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

async function setupFixture() {
  const novelA = await novelRepository.create({
    title: '星际迷途：深空回响',
    description: '人类勘探船边缘星系探索的科幻史诗。',
    genre: '科幻',
  });
  const novelB = await novelRepository.create({
    title: '隔离作品B',
    description: '跨作品测试隔离目标',
    genre: '悬疑',
  });
  const volumeA = await volumeRepository.create({
    novelId: novelA.id,
    title: '第一卷 寂静之星',
    summary: '勘探船抵达未知星区，发现古代文明遗迹。',
  });
  const chapterA = await chapterRepository.create({
    novelId: novelA.id,
    volumeId: volumeA.id,
    title: '第一章 遗落信号',
    outline: '探测到来自无人生存星球的高频脉冲信号。',
    goal: '定位信号源并决定是否派遣登舰小队。',
    targetWordCount: 3000,
  });

  await settingRepository.saveWorldSetting(null, {
    novelId: novelA.id,
    title: '跃迁引擎法则',
    content: '跃迁过程不可中断，空间扭曲点存在时间膨胀效应。',
  });

  await protagonistRepository.save(null, {
    novelId: novelA.id,
    name: '林恩舰长',
    identity: '远征勘探舰指挥官',
    goal: '保护船员安全并破解深空信号起源',
    specialAbility: '敏锐的危机直觉',
  });

  putLocalMemoryDocument({
    documentId: `memory-${novelA.id}`,
    novelId: novelA.id,
    sourceType: 'adopted_draft',
    sourceId: `draft-${chapterA.id}`,
    sourceVersion: 1,
    sourceHash: 'a'.repeat(64),
    adoptedDraftId: `draft-${chapterA.id}`,
    chapterId: chapterA.id,
    metadata: { fixture: true },
    chunks: [
      {
        id: `chunk-${novelA.id}`,
        ordinal: 0,
        text: '三年前失联的先驱者号曾在该星域留下加密航行日志。',
        tokenCount: 20,
        importance: 0.95,
        entityKeys: ['先驱者号', '航行日志'],
        metadata: { fixture: true },
        contentHash: 'b'.repeat(64),
      },
    ],
  });

  return { novelA, novelB, volumeA, chapterA };
}

test('1. Forward Loop: executes with canonical tools, outputs creative advice, and preserves durationMs', async () => {
  installStorage();
  try {
    const { novelA, chapterA } = await setupFixture();

    const result = await mainAgentRuntimeService.executeMainAgentTurn({
      novelId: novelA.id,
      chapterId: chapterA.id,
      userGoal: '读取当前作品与章节上下文，给出下一步创作建议',
    });

    assert.equal(result.ok, true, 'Turn execution should succeed');
    assert.ok(result.toolCalls.length >= 1, 'At least one Canonical Tool call occurred');

    const canonicalToolNames = ['novel.read', 'context.read', 'structure.read', 'memory.search'];
    const canonicalToolIdentities = [
      'novel.read@1',
      'context.read@1',
      'structure.read@1',
      'memory.search@1',
    ];

    const hasCanonicalCall = result.toolCalls.some(
      (c) =>
        canonicalToolNames.includes(c.name) || (c.tool && canonicalToolIdentities.includes(c.tool)),
    );
    assert.ok(hasCanonicalCall, 'Tool calls must include Canonical Tools');

    assert.ok(result.finalMessage.length > 0, 'Result has non-empty finalMessage');
    assert.match(
      result.finalMessage,
      /(建议|创作|冲突|设定|上下文)/,
      'Final message contains meaningful creative suggestions',
    );

    for (const call of result.toolCalls) {
      assert.equal(call.status, 'completed');
      assert.ok(
        typeof call.durationMs === 'number' && call.durationMs >= 0,
        'Tool calls must have valid durationMs',
      );
    }
  } finally {
    restoreStorage();
  }
});

test('2. Read-only Invariant: execution does not mutate chapters, adopted drafts, or word counts', async () => {
  installStorage();
  try {
    const { novelA, chapterA } = await setupFixture();

    const novelsBefore = await novelRepository.getAll();
    const chaptersBefore = await chapterRepository.getByNovelId(novelA.id);
    const draftsBefore = await draftVersionService.getByChapterId(chapterA.id);
    const chapterBefore = await chapterRepository.getById(chapterA.id);
    const targetWordsBefore = chapterBefore?.targetWordCount;
    const actualWordsBefore = chapterBefore?.wordCount;

    const result = await mainAgentRuntimeService.executeMainAgentTurn({
      novelId: novelA.id,
      chapterId: chapterA.id,
      userGoal: '读取当前作品与章节上下文，给出下一步创作建议',
    });

    assert.equal(result.ok, true);

    const novelsAfter = await novelRepository.getAll();
    const chaptersAfter = await chapterRepository.getByNovelId(novelA.id);
    const draftsAfter = await draftVersionService.getByChapterId(chapterA.id);
    const chapterAfter = await chapterRepository.getById(chapterA.id);

    assert.equal(novelsAfter.length, novelsBefore.length, 'No novels were created');
    assert.equal(chaptersAfter.length, chaptersBefore.length, 'No chapters were created');
    assert.equal(draftsAfter.length, draftsBefore.length, 'No drafts were adopted or created');
    assert.equal(chapterAfter?.targetWordCount, targetWordsBefore, 'Target word count unchanged');
    assert.equal(chapterAfter?.wordCount, actualWordsBefore, 'Actual word count unchanged');
  } finally {
    restoreStorage();
  }
});

test('3. Security & Fail-Closed Negative Gates: invalid args, scope mismatch, unreleased tool, cancellation', async () => {
  installStorage();
  try {
    const { novelA, novelB } = await setupFixture();

    // 3.1 Empty novelId -> rejects with INVALID_ARGUMENT
    const emptyNovelRes = await mainAgentRuntimeService.executeMainAgentTurn({
      novelId: '',
      userGoal: '给出创作建议',
    });
    assert.equal(emptyNovelRes.ok, false);
    assert.equal(emptyNovelRes.errorCode, 'INVALID_ARGUMENT');
    assert.match(emptyNovelRes.error ?? '', /INVALID_ARGUMENT/);

    // 3.2 Empty userGoal -> rejects with INVALID_ARGUMENT
    const emptyGoalRes = await mainAgentRuntimeService.executeMainAgentTurn({
      novelId: novelA.id,
      userGoal: '   ',
    });
    assert.equal(emptyGoalRes.ok, false);
    assert.equal(emptyGoalRes.errorCode, 'INVALID_ARGUMENT');
    assert.match(emptyGoalRes.error ?? '', /INVALID_ARGUMENT/);

    // 3.3 Scope mismatch: agent attempting to pass novelId of another novel -> tool call fails with SCOPE_MISMATCH
    let scopeRan = false;
    const scopeMismatchRes = await mainAgentRuntimeService.executeMainAgentTurn({
      novelId: novelA.id,
      userGoal: '跨作品非法访问',
      executor: async () => {
        if (scopeRan) return { text: '停止调用' };
        scopeRan = true;
        return {
          toolCalls: [
            {
              name: 'novel.read',
              version: '1',
              argumentsJson: { novelId: novelB.id },
            },
          ],
        };
      },
    });
    assert.equal(scopeMismatchRes.toolCalls.length, 1);
    const scopeCall = scopeMismatchRes.toolCalls[0];
    assert.equal(scopeCall.status, 'failed');
    const scopeCode =
      scopeCall.error?.code ?? (scopeCall.result as { error?: { code?: string } })?.error?.code;
    assert.equal(scopeCode, 'SCOPE_MISMATCH');

    // 3.4 Unreleased tool: agent attempting to call an unexposed tool (e.g. 'draft.read')
    // -> tool call fails with PERMISSION_DENIED / 尚未向 Main Agent 放行
    let draftRan = false;
    const unreleasedDraftRes = await mainAgentRuntimeService.executeMainAgentTurn({
      novelId: novelA.id,
      userGoal: '尝试调用未放行工具 draft.read',
      executor: async () => {
        if (draftRan) return { text: '停止调用' };
        draftRan = true;
        return {
          toolCalls: [
            {
              name: 'draft.read',
              version: '1',
              argumentsJson: { novelId: novelA.id },
            },
          ],
        };
      },
    });
    assert.equal(unreleasedDraftRes.toolCalls.length, 1);
    const draftCall = unreleasedDraftRes.toolCalls[0];
    assert.equal(draftCall.status, 'failed');
    const draftErrorCode =
      draftCall.error?.code ?? (draftCall.result as { error?: { code?: string } })?.error?.code;
    assert.equal(draftErrorCode, 'PERMISSION_DENIED');
    const draftErrorMsg =
      draftCall.error?.message ??
      (draftCall.result as { error?: { message?: string } })?.error?.message ??
      '';
    assert.match(draftErrorMsg, /尚未向 Main Agent 放行/);

    // 3.4b Unreleased tool: agent attempting to call writing.generate
    let writingRan = false;
    const unreleasedWritingRes = await mainAgentRuntimeService.executeMainAgentTurn({
      novelId: novelA.id,
      userGoal: '尝试调用未放行工具 writing.generate',
      executor: async () => {
        if (writingRan) return { text: '停止调用' };
        writingRan = true;
        return {
          toolCalls: [
            {
              name: 'writing.generate',
              version: '1',
              argumentsJson: { novelId: novelA.id },
            },
          ],
        };
      },
    });
    assert.equal(unreleasedWritingRes.toolCalls.length, 1);
    const writingCall = unreleasedWritingRes.toolCalls[0];
    assert.equal(writingCall.status, 'failed');
    const writingErrorCode =
      writingCall.error?.code ?? (writingCall.result as { error?: { code?: string } })?.error?.code;
    assert.equal(writingErrorCode, 'PERMISSION_DENIED');
    const writingErrorMsg =
      writingCall.error?.message ??
      (writingCall.result as { error?: { message?: string } })?.error?.message ??
      '';
    assert.match(writingErrorMsg, /尚未向 Main Agent 放行/);

    // 3.5 Cancellation: AbortSignal aborted before execution -> terminates with UPSTREAM_FAILURE
    const preAbortController = new AbortController();
    preAbortController.abort();
    const preAbortedRes = await mainAgentRuntimeService.executeMainAgentTurn({
      novelId: novelA.id,
      userGoal: '预先取消测试',
      signal: preAbortController.signal,
    });
    assert.equal(preAbortedRes.ok, false);
    assert.equal(preAbortedRes.errorCode, 'UPSTREAM_FAILURE');
    assert.match(preAbortedRes.error ?? '', /UPSTREAM_FAILURE/);

    // 3.5b Cancellation: AbortSignal aborted during execution -> terminates with UPSTREAM_FAILURE
    let midRan = false;
    const midAbortController = new AbortController();
    const midAbortedRes = await mainAgentRuntimeService.executeMainAgentTurn({
      novelId: novelA.id,
      userGoal: '中途取消测试',
      signal: midAbortController.signal,
      executor: async () => {
        if (midRan) return { text: '停止调用' };
        midRan = true;
        midAbortController.abort();
        return {
          toolCalls: [
            {
              name: 'novel.read',
              version: '1',
              argumentsJson: { novelId: novelA.id },
            },
          ],
        };
      },
    });
    assert.equal(midAbortedRes.ok, false);
    assert.equal(midAbortedRes.errorCode, 'UPSTREAM_FAILURE');
    assert.match(midAbortedRes.error ?? '', /UPSTREAM_FAILURE/);
  } finally {
    restoreStorage();
  }
});

test('4. Multi-step Execution: custom executor records tool calls in order and returns advice', async () => {
  installStorage();
  try {
    const { novelA, chapterA } = await setupFixture();

    let stepCount = 0;
    const multiStepRes = await mainAgentRuntimeService.executeMainAgentTurn({
      novelId: novelA.id,
      chapterId: chapterA.id,
      userGoal: '进行多步骤分析并输出剧情推进建议',
      executor: async (prompt) => {
        stepCount += 1;
        if (stepCount === 1) {
          return {
            toolCalls: [
              {
                name: 'novel.read',
                version: '1',
                argumentsJson: { novelId: novelA.id },
              },
            ],
          };
        }
        if (stepCount === 2) {
          assert.match(prompt, /novel\.read@1/);
          return {
            toolCalls: [
              {
                name: 'context.read',
                version: '1',
                argumentsJson: { novelId: novelA.id, chapterId: chapterA.id },
              },
            ],
          };
        }
        assert.match(prompt, /context\.read@1/);
        return {
          text: '多步骤规划完成：已确认作品世界观与第一章大纲，建议在后续场景中安排登舰小队遭遇磁场异常。',
        };
      },
    });

    assert.equal(multiStepRes.ok, true);
    assert.equal(multiStepRes.toolCalls.length, 2, 'Two tool calls must be recorded');
    assert.equal(multiStepRes.toolCalls[0].name, 'novel.read', 'First tool call is novel.read');
    assert.equal(multiStepRes.toolCalls[0].status, 'completed');
    assert.equal(
      multiStepRes.toolCalls[1].name,
      'context.read',
      'Second tool call is context.read',
    );
    assert.equal(multiStepRes.toolCalls[1].status, 'completed');
    assert.match(multiStepRes.finalMessage, /登舰小队遭遇磁场异常/);
  } finally {
    restoreStorage();
  }
});

test('5. Utility & Prompt Formatting: sanitize credentials, extract keywords, select tools', () => {
  const errorWithKey = new Error('Request failed with sk-1234567890abcdef12345678');
  assert.equal(sanitizeErrorMessage(errorWithKey), 'Request failed with sk-[REDACTED]');

  const errorWithBearer = 'Unauthorized: Bearer eyJhbGciOiJIUzI1NiJ9.test';
  assert.match(sanitizeErrorMessage(errorWithBearer), /Bearer \[REDACTED\]/);

  const errorWithQuery =
    'Connection failure at https://api.example.com?api_key=secretKey123&foo=bar';
  assert.match(sanitizeErrorMessage(errorWithQuery), /api_key=\[REDACTED\]/);

  assert.equal(extractSearchQuery('请帮我搜索关于先驱者号航行日志的记忆'), '先驱者号航行日志');

  const available = new Set([
    'novel.read@1',
    'structure.read@1',
    'context.read@1',
    'memory.search@1',
  ]);

  assert.deepEqual(selectInitialToolCalls('你好', 'nov-1', 'ch-1', available), []);

  const fullCalls = selectInitialToolCalls(
    '读取当前作品与章节上下文，给出下一步创作建议。',
    'nov-1',
    'ch-1',
    available,
  );
  assert.equal(fullCalls.length, 3);
  assert.deepEqual(
    fullCalls.map((c) => c.name),
    ['novel.read', 'structure.read', 'context.read'],
  );

  const prompt = formatPrompt(
    {
      conversationId: 'c-1',
      novelId: 'nov-1',
      chapterId: 'ch-1',
      userGoal: '推进剧情',
    },
    [
      {
        name: 'novel.read',
        version: '1',
        invocationId: 'inv-1',
        argumentsJson: { novelId: 'nov-1' },
        result: { ok: true },
        status: 'completed',
        durationMs: 12,
      },
    ],
  );
  assert.match(prompt, /novel\.read@1/);
  assert.match(prompt, /SUCCESS/);
});
