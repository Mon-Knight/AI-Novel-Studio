import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/database/novelRepository', () => ({ novelRepository: { getById: vi.fn() } }));
vi.mock('../../services/database/settingRepository', () => ({ settingRepository: {
  getWorldSettings: vi.fn(), getRuleSystems: vi.fn(),
} }));
vi.mock('../../services/database/protagonistRepository', () => ({ protagonistRepository: { getByNovelId: vi.fn() } }));
vi.mock('../../services/database/volumeRepository', () => ({ volumeRepository: { getByNovelId: vi.fn() } }));
vi.mock('../../services/database/chapterRepository', () => ({ chapterRepository: { getByNovelId: vi.fn() } }));
vi.mock('../../services/ai-tasks/creativeIntentService', () => ({ creativeIntentService: { getLatest: vi.fn() } }));

import { novelRepository } from '../../services/database/novelRepository';
import { settingRepository } from '../../services/database/settingRepository';
import { protagonistRepository } from '../../services/database/protagonistRepository';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { creativeIntentService } from '../../services/ai-tasks/creativeIntentService';
import { buildCoCreationContext } from '../../features/co-creation/contextBuilder';
import { selectCurrentStage } from '../../features/co-creation/stageMachine';
import type { CoCreationMessage, CoCreationSession } from '../../types/coCreation';
import type { CoCreationDraftRevision } from '../../types/coCreation';

const session: CoCreationSession = {
  sessionId: 'session-a', novelId: 'novel-a', title: 'AI 共创', status: 'active',
  currentStage: 'protagonist', stageProgress: [], objectContext: { novelId: 'novel-a', chapterId: 'chapter-a' },
  dataRevision: 1, dataHash: 'state-hash', createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

function messages(): CoCreationMessage[] {
  return Array.from({ length: 10 }, (_, index) => ({
    messageId: `message-${index + 1}`, sessionId: 'session-a', sequenceNo: index + 1,
    role: index % 2 ? 'assistant' as const : 'user' as const, status: 'completed' as const,
    content: `content-${index + 1}`, contentHash: `hash-${index + 1}`, contentLength: 8,
    operationId: `op-${index + 1}`, requestHash: `request-${index + 1}`, createdAt: '2026-01-01',
  }));
}

describe('co-creation context builder', () => {
  beforeEach(() => {
    vi.mocked(novelRepository.getById).mockResolvedValue({
      id: 'novel-a', title: '测试作品', genre: '奇幻', description: '记忆交易故事', outline: '',
      protagonistMode: 'single', protagonists: [{
        id: 'p1', label: 'primary', name: '林默', gender: '', identity: '边城医师', personality: '',
        goal: '救回妹妹', motivation: '', ability: '读取记忆', limitation: '会遗忘自己', background: '', arc: '', notes: '',
      }], dualProtagonistRelation: {} as never, status: 'draft', totalWordCount: 0, totalWords: 0,
      targetWords: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01', volumes: [],
    });
    vi.mocked(settingRepository.getWorldSettings).mockResolvedValue([]);
    vi.mocked(settingRepository.getRuleSystems).mockResolvedValue([]);
    vi.mocked(protagonistRepository.getByNovelId).mockResolvedValue(null);
    vi.mocked(volumeRepository.getByNovelId).mockResolvedValue([{ id: 'volume-a', novelId: 'novel-a', title: '第一卷' } as never]);
    vi.mocked(chapterRepository.getByNovelId).mockResolvedValue([{ id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a', title: '第一章' } as never]);
    vi.mocked(creativeIntentService.getLatest).mockResolvedValue(null);
  });

  it('uses formal data first and only includes the recent message window', async () => {
    const activeDraft: CoCreationDraftRevision = {
      draftRevisionId: 'draft-a', sessionId: 'session-a', stage: 'protagonist', revisionNo: 1,
      schemaVersion: 1,
      payload: { fields: { 'protagonist.identity': { value: '草案中的错误身份', state: 'user_confirmed' } } },
      contentHash: 'draft-hash', origin: 'author_edit', operationId: 'draft-op', requestHash: 'draft-request',
      createdAt: '2026-01-01',
    };
    const context = await buildCoCreationContext({ session, messages: messages(), activeDraft });
    expect(context.priorityOrder[0]).toBe('formal_project_data');
    expect(context.recentMessages).toHaveLength(8);
    expect(context.recentMessages[0].messageId).toBe('message-3');
    expect(context.knownFields['protagonist.identity']).toEqual({ value: '边城医师', state: 'user_confirmed' });
  });

  it('reads structured-page changes on the next context build', async () => {
    const before = await buildCoCreationContext({ session, messages: [] });
    vi.mocked(novelRepository.getById).mockResolvedValueOnce({
      ...before.canonical.novel,
      protagonistMode: 'single', protagonists: [], dualProtagonistRelation: {} as never,
      status: 'draft', totalWordCount: 0, totalWords: 0, targetWords: 0, createdAt: '2026-01-01', volumes: [],
      genre: '科幻', updatedAt: '2026-01-02',
    } as never);
    const after = await buildCoCreationContext({ session, messages: [] });
    expect(after.canonical.novel.genre).toBe('科幻');
    expect(after.canonicalDataHash).not.toBe(before.canonicalDataHash);
  });

  it('maps formal intent, setting, rule, and protagonist data to every minimum field', async () => {
    vi.mocked(creativeIntentService.getLatest).mockResolvedValue({
      taskId: 'intent-task',
      idempotentReplay: false,
      intent: {
        schemaVersion: 1, intentId: 'intent-a', novelId: 'novel-a', revision: 1, status: 'frozen',
        createdAt: '2026-01-01', frozenAt: '2026-01-01', contentHash: 'intent-hash',
        statements: [{
          statementId: 'goal-a', kind: 'goal', knowledgeClass: 'author_explicit',
          value: '写一部讨论记忆与身份的成长故事', confidence: 1, evidence: [],
          confirmation: { status: 'confirmed', confirmedBy: 'author', confirmedAt: '2026-01-01' },
          statementHash: 'goal-hash',
        }, {
          statementId: 'preference-a', kind: 'preference', knowledgeClass: 'inferred_preference',
          value: '悬疑、克制且有希望', confidence: 0.9,
          evidence: [{ evidenceId: 'evidence-a', sourceType: 'author_input' }],
          confirmation: { status: 'confirmed', confirmedBy: 'author', confirmedAt: '2026-01-01' },
          statementHash: 'preference-hash',
        }],
      },
    } as never);
    vi.mocked(settingRepository.getWorldSettings).mockResolvedValue([{
      id: 'world-a', novelId: 'novel-a', title: '雾港城邦', content: '记忆可以交易的港口城邦。',
      structuredJson: JSON.stringify({ era: '近未来', primary_location: '雾港', socialStructure: '行会联邦' }),
      isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-02',
    }]);
    vi.mocked(settingRepository.getRuleSystems).mockResolvedValue([{
      id: 'rule-a', novelId: 'novel-a', title: '记忆交易', category: 'other', content: '以记忆换取力量。',
      forbiddenRules: '不得复活死者',
      structuredJson: JSON.stringify({ coreMechanism: '燃烧记忆换取回声', cost: '永久遗忘一段经历', boundary: '不能逆转死亡' }),
      isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-02',
    }]);
    vi.mocked(novelRepository.getById).mockResolvedValueOnce({
      id: 'novel-a', title: '测试作品', genre: '奇幻', description: '记忆交易故事', outline: '',
      protagonistMode: 'single', protagonists: [{
        id: 'p1', label: 'primary', name: '林默', gender: '', identity: '边城医师', personality: '',
        goal: '救回妹妹', motivation: '', ability: '读取记忆', limitation: '会遗忘自己', background: '',
        arc: '从逃避过去到主动揭开主线真相', notes: '',
      }], dualProtagonistRelation: {} as never, status: 'draft', totalWordCount: 0, totalWords: 0,
      targetWords: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01', volumes: [],
    });

    const context = await buildCoCreationContext({ session, messages: [] });

    expect(context.knownFields['creativeIntent.primaryGoal']?.value)
      .toBe('写一部讨论记忆与身份的成长故事');
    expect(context.knownFields['creativeIntent.readerExperience']?.value).toBe('悬疑、克制且有希望');
    expect(context.knownFields['worldSetting.era']?.value).toBe('近未来');
    expect(context.knownFields['worldSetting.primaryLocation']?.value).toBe('雾港');
    expect(context.knownFields['worldSetting.socialStructure']?.value).toBe('行会联邦');
    expect(context.knownFields['ruleSystem.coreMechanism']?.value).toBe('燃烧记忆换取回声');
    expect(context.knownFields['ruleSystem.cost']?.value).toBe('永久遗忘一段经历');
    expect(context.knownFields['ruleSystem.boundary']?.value).toBe('不能逆转死亡');
    expect(context.knownFields['protagonist.mainlineRelation']?.value)
      .toBe('从逃避过去到主动揭开主线真相');
    expect(selectCurrentStage(context.knownFields)).toBe('core_conflict');
  });

  it('uses existing free-form setting and rule canon as a stage baseline', async () => {
    vi.mocked(settingRepository.getWorldSettings).mockResolvedValue([{
      id: 'world-a', novelId: 'novel-a', title: '旧都', content: '故事发生在被行会统治的灾后旧都。',
      isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }]);
    vi.mocked(settingRepository.getRuleSystems).mockResolvedValue([{
      id: 'rule-a', novelId: 'novel-a', title: '回声术', content: '施术者燃烧记忆借用旧神回声，死亡不可逆。',
      isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }]);

    const context = await buildCoCreationContext({ session, messages: [] });

    expect(context.knownFields['worldSetting.era']?.value).toContain('灾后旧都');
    expect(context.knownFields['worldSetting.primaryLocation']?.value).toContain('灾后旧都');
    expect(context.knownFields['worldSetting.socialStructure']?.value).toContain('行会统治');
    expect(context.knownFields['ruleSystem.coreMechanism']?.value).toContain('燃烧记忆');
    expect(context.knownFields['ruleSystem.cost']?.value).toContain('燃烧记忆');
    expect(context.knownFields['ruleSystem.boundary']?.value).toContain('死亡不可逆');
  });

  it('keeps a semantic undo tombstone out of the active AI context', async () => {
    vi.mocked(creativeIntentService.getLatest).mockResolvedValue({
      taskId: 'undo-intent-task', idempotentReplay: false,
      intent: {
        schemaVersion: 1, intentId: 'undo-intent', novelId: 'novel-a', revision: 2,
        status: 'frozen', createdAt: '2026-01-02', frozenAt: '2026-01-02', contentHash: 'undo-hash',
        statements: [{
          statementId: 'co-creation-undo-plan-a', kind: 'constraint',
          knowledgeClass: 'requires_confirmation',
          value: { reverted: true, forwardPlanId: 'plan-a' }, confidence: 1,
          evidence: [{ evidenceId: 'evidence-undo', sourceType: 'project_document' }],
          confirmation: { status: 'rejected', confirmedBy: 'author', confirmedAt: '2026-01-02' },
          statementHash: 'undo-statement-hash',
        }],
      },
    } as never);

    const context = await buildCoCreationContext({ session, messages: [] });

    expect(context.canonical.creativeIntent).toBeNull();
    expect(context.sourceManifest.some((item) => item.sourceType === 'creative_intent')).toBe(false);
    expect(context.knownFields['creativeIntent.primaryGoal']).toBeUndefined();
  });

  it('rejects a forged chapter scope', async () => {
    await expect(buildCoCreationContext({
      session: { ...session, objectContext: { novelId: 'novel-a', chapterId: 'other-chapter' } },
      messages: [],
    })).rejects.toThrow('章节不属于该作品');
  });
});
