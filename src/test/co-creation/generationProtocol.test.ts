import { describe, expect, it } from 'vitest';
import {
  assertCoCreationGenerationRequestIntegrity,
  buildChapterPlanFromDraft,
  createCoCreationGenerationRequest,
  readCoCreationGenerationRecords,
  resolveChapterGenerationHandoffPrefill,
  writeCoCreationGenerationRecord,
} from '../../features/co-creation/generationProtocol';

const base = {
  requestId: 'request-a',
  novelId: 'novel-a',
  sessionId: 'session-a',
  baseContextHash: 'context-hash',
  baseDataRevision: 7,
  createdAt: '2026-07-14T00:00:00.000Z',
};

describe('co-creation generation request protocol', () => {
  it('creates a stable, integrity-checked operation for an allowed request', async () => {
    const first = await createCoCreationGenerationRequest({
      ...base,
      kind: 'chapter_outlines',
      volumeId: 'volume-a',
      chapterCount: 6,
      compiledInputHash: 'compiled-input-hash',
      additionalInstruction: '加强中段节奏',
    });
    const replay = await createCoCreationGenerationRequest({
      ...base,
      kind: 'chapter_outlines',
      volumeId: 'volume-a',
      chapterCount: 6,
      compiledInputHash: 'compiled-input-hash',
      additionalInstruction: '加强中段节奏',
    });
    expect(replay.operationId).toBe(first.operationId);
    expect(replay.requestHash).toBe(first.requestHash);
    await expect(assertCoCreationGenerationRequestIntegrity(first)).resolves.toBeUndefined();
    await expect(assertCoCreationGenerationRequestIntegrity({ ...first, chapterCount: 7 }))
      .rejects.toThrow('requestHash');
  });

  it('fails closed for unsupported scope, excessive count, credentials, and missing chapter plan', async () => {
    await expect(createCoCreationGenerationRequest({
      ...base, kind: 'master_outline', volumeId: 'volume-a',
    })).rejects.toThrow('作品总纲请求');
    await expect(createCoCreationGenerationRequest({
      ...base, kind: 'chapter_outlines', volumeId: 'volume-a', chapterCount: 21,
    })).rejects.toThrow('1 到 20');
    await expect(createCoCreationGenerationRequest({
      ...base, kind: 'volume_outline', volumeId: 'volume-a', additionalInstruction: 'api_key=secret-value',
    })).rejects.toThrow('凭据');
    await expect(createCoCreationGenerationRequest({
      ...base, kind: 'volume_outline', volumeId: 'volume-a', additionalInstruction: 'token=secret-value',
    })).rejects.toThrow('凭据');
    await expect(createCoCreationGenerationRequest({
      ...base, kind: 'chapter_generation_handoff', chapterId: 'chapter-a',
    })).rejects.toThrow('非空章节计划');
    await expect(createCoCreationGenerationRequest({
      ...base, kind: 'master_outline', sourceDraftRevisionId: 'draft-a',
    })).rejects.toThrow('必须同时提供');
    await expect(createCoCreationGenerationRequest({
      ...base, kind: 'master_outline', createdAt: 'not-a-time',
    })).rejects.toThrow('有效时间');
  });

  it('preserves generation records alongside ordinary draft fields', async () => {
    const request = await createCoCreationGenerationRequest({
      ...base,
      kind: 'chapter_generation_handoff',
      chapterId: 'chapter-a',
      chapterPlan: '目标：找回记忆',
    });
    const payload = writeCoCreationGenerationRecord({
      fields: { 'chapterPlan.goal': { value: '找回记忆', state: 'user_confirmed' } },
      lastTurn: { intent: 'generate_chapter' },
    }, {
      request,
      status: 'prepared',
      updatedAt: request.createdAt,
    });
    expect(payload.fields).toBeDefined();
    expect(payload.lastTurn).toEqual({ intent: 'generate_chapter' });
    expect(readCoCreationGenerationRecords(payload)).toHaveLength(1);
    expect(buildChapterPlanFromDraft(payload)).toBe('本章目标：找回记忆');
    expect(buildChapterPlanFromDraft({
      fields: {
        'chapterPlan.goal': { value: '作者确认目标', state: 'user_confirmed' },
        'chapterPlan.conflict': { value: 'AI 未确认冲突', state: 'ai_suggested' },
        'chapterPlan.outcome': { value: '临时结局', state: 'temporary_assumption' },
      },
    })).toBe('本章目标：作者确认目标');
  });

  it('prefills only the exact workspace chapter and never starts generation itself', () => {
    const handoff = {
      receiptType: 'chapter_generation_handoff' as const,
      handoffId: 'handoff-a', requestId: 'request-a', requestHash: 'request-hash',
      novelId: 'novel-a', volumeId: 'volume-a', chapterId: 'chapter-a',
      chapterPlan: '本章目标：进入遗迹', targetWordCount: 4200,
      baseContextHash: 'context-hash', createdAt: '2026-07-14T00:00:00.000Z',
    };
    expect(resolveChapterGenerationHandoffPrefill(handoff, 'novel-a', {
      id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a',
    })).toEqual({ instruction: '本章目标：进入遗迹', targetWordCount: 4200 });
    expect(() => resolveChapterGenerationHandoffPrefill(handoff, 'novel-a', {
      id: 'chapter-b', novelId: 'novel-a', volumeId: 'volume-a',
    })).toThrow('目标不一致');
  });
});
