import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { SettingSuggestionRecord } from '../../types/settingSuggestion';

const fixtures = vi.hoisted(() => ({
  local: new Map<string, unknown>(),
  desktop: false,
  snapshot: { novelId: 'n', fingerprint: 'initial', sources: [] },
  record: null as SettingSuggestionRecord | null,
  rules: [] as Array<Record<string, unknown>>,
  chapters: [] as Array<Record<string, unknown>>,
  draft: null as Record<string, unknown> | null,
  generate: vi.fn(),
  invoke: vi.fn(),
  saveWorld: vi.fn(),
  saveRule: vi.fn(),
  createCharacter: vi.fn(),
}));
vi.mock('../database/db', () => ({
  getDbMode: () => (fixtures.desktop ? 'tauri' : 'localstorage'),
  lsGet: (key: string) => fixtures.local.get(key) ?? null,
  lsSet: (key: string, value: unknown) => fixtures.local.set(key, value),
  nowISO: () => 't',
  generateId: () => 'id',
  dbCall: fixtures.invoke,
}));
vi.mock('../ai/aiClient', () => ({
  createAiClient: () => ({ generate: fixtures.generate }),
  aiSettingsService: { getSettings: () => ({ runtimeMode: 'mock' }) },
}));
vi.mock('../ai/aiTaskService', () => ({
  aiTaskService: { create: async () => ({ id: 'task' }), markSucceeded: vi.fn() },
}));
vi.mock('../ai/aiTaskCancellation', () => ({
  bindAiTaskCancellation: () => () => undefined,
  settleAiTaskError: vi.fn(),
}));
vi.mock('../database/novelRepository', () => ({
  novelRepository: { getById: async () => ({ id: 'n', title: 'Novel' }) },
}));
vi.mock('../database/settingRepository', () => ({
  settingRepository: {
    getWorldSettings: async () => [],
    getRuleSystems: async () => fixtures.rules,
    getWorldRuleSetSnapshot: async () => fixtures.snapshot,
    saveWorldSetting: fixtures.saveWorld,
    saveRuleSystem: fixtures.saveRule,
  },
}));
vi.mock('../characters/characterService', () => ({
  characterService: { getByNovelId: async () => [], create: fixtures.createCharacter },
}));
vi.mock('../conversation/browserChapterReviewBaseline', () => ({
  expireBrowserChapterReviewAuthorizations: vi.fn(),
}));
vi.mock('../database/chapterRepository', () => ({
  chapterRepository: { getByNovelId: async () => fixtures.chapters },
}));
vi.mock('../database/draftVersionService', () => ({
  draftVersionService: { getById: async () => fixtures.draft },
}));
import {
  settingSuggestionService,
  SETTING_SUGGESTIONS_SQLITE_MIGRATION_KEY,
} from './settingSuggestionService';

const generation = {
  novelId: 'n',
  suggestionType: 'rule' as const,
  worldType: '',
  referenceStyle: '',
  count: 1,
  includeWorldSettings: false,
  includeExistingAssets: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  fixtures.local.clear();
  fixtures.desktop = true;
  fixtures.snapshot = { novelId: 'n', fingerprint: 'initial', sources: [] };
  fixtures.local.set(SETTING_SUGGESTIONS_SQLITE_MIGRATION_KEY, true);
  fixtures.rules = [];
  fixtures.chapters = [];
  fixtures.draft = null;
  fixtures.record = {
    id: 'candidate',
    novelId: 'n',
    suggestionType: 'character',
    item: { name: 'A' },
    status: 'pending',
    worldType: '',
    referenceStyle: '',
    prompt: 'p',
    resultJson: '{}',
    createdAt: 't',
    updatedAt: 't',
  };
  fixtures.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_setting_suggestion') return fixtures.record;
    if (command === 'get_world_rule_set_snapshot') return fixtures.snapshot;
    if (command === 'adopt_setting_suggestion')
      return {
        record: {
          ...fixtures.record,
          status: 'adopted',
          adoptedTargetId: 'formal',
          adoptedTargetType: 'character',
        },
        targetId: 'formal',
        targetType: 'character',
        replayed: false,
      };
    throw new Error('Unexpected native command: ' + command);
  });
});

describe('legacy suggestion native routing and rule evidence', () => {
  it('uses one native atomic adoption command rather than a target write plus decision', async () => {
    await settingSuggestionService.adopt('candidate', { name: 'Author edited' });
    expect(fixtures.invoke).toHaveBeenCalledWith(
      'adopt_setting_suggestion',
      expect.objectContaining({
        input: expect.objectContaining({
          id: 'candidate',
          novelId: 'n',
          actor: 'user',
          editedItem: { name: 'Author edited' },
          expectedCandidateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          authorizedItemHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(fixtures.invoke.mock.calls.some(([name]) => name === 'decide_setting_suggestion')).toBe(
      false,
    );
    expect(fixtures.createCharacter).not.toHaveBeenCalled();
    expect(fixtures.saveWorld).not.toHaveBeenCalled();
    expect(fixtures.saveRule).not.toHaveBeenCalled();
  });
  it('does not truncate forbidden rules after 1800 characters and includes adopted evidence even when optional world hints are off', async () => {
    fixtures.rules = [
      {
        id: 'r',
        title: 'Law',
        content: 'x'.repeat(2000),
        forbiddenRules: 'EXACT_FORBIDDEN_TAIL',
        structuredJson: '{"legacy":true}',
        isActive: true,
      },
    ];
    fixtures.chapters = [{ id: 'chapter', title: 'Canon chapter', adoptedDraftId: 'draft' }];
    fixtures.draft = {
      id: 'draft',
      novelId: 'n',
      isAdopted: true,
      versionNo: 2,
      content: 'ADOPTED_EVIDENCE',
      contentState: { status: 'ready' },
    };
    const prompt = await settingSuggestionService._private.buildPrompt(generation);
    expect(prompt).toContain('EXACT_FORBIDDEN_TAIL');
    expect(prompt).toContain('ADOPTED_EVIDENCE');
    expect(prompt).toContain('draft');
    expect(prompt).toContain('不确定性');
    fixtures.draft = { ...fixtures.draft, contentState: { status: 'unavailable' } };
    await expect(settingSuggestionService._private.buildPrompt(generation)).rejects.toThrow(
      '证据不可用',
    );
  });
  it('refuses to save model-returned candidates against a rule set changed during the request', async () => {
    fixtures.generate.mockImplementation(async () => {
      fixtures.snapshot = { novelId: 'n', fingerprint: 'changed', sources: [] };
      return { text: '{"items":[{"name":"new law","content":"cost"}]}' };
    });
    await expect(settingSuggestionService.generate(generation)).rejects.toThrow(
      'RULE_SET_BASE_CONFLICT',
    );
    expect(fixtures.invoke.mock.calls.some(([name]) => name === 'save_setting_suggestions')).toBe(
      false,
    );
  });
});
