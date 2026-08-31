import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferRequiredProtagonistNames,
  isLegacyConservativeProtagonistBinding,
  reconcileChapterProtagonistRequirements,
} from './contextBuilder';

test('infers a single protagonist from chapter role and goal evidence', () => {
  const protagonist = [{ name: '林砚', goal: '查明旧案真相', isPrimary: true }];

  assert.deepEqual(
    inferRequiredProtagonistNames({
      chapterOutline: '主角整理遗物时发现指向旧厂的异常编号。',
      protagonists: protagonist,
    }),
    ['林砚'],
  );
  assert.deepEqual(
    inferRequiredProtagonistNames({
      chapterGoal: '查明旧案真相',
      protagonists: protagonist,
    }),
    ['林砚'],
  );
});

test('keeps multi-protagonist inference scoped to explicit evidence', () => {
  const protagonists = [
    { name: '林砚', goal: '查明旧案真相', isPrimary: true },
    { name: '周临', goal: '保护证人', isPrimary: false },
  ];

  assert.deepEqual(
    inferRequiredProtagonistNames({
      chapterOutline: '周临护送证人离开封锁区。',
      protagonists,
    }),
    ['周临'],
  );
  assert.deepEqual(
    inferRequiredProtagonistNames({
      chapterOutline: '主角进入旧厂核对编号。',
      protagonists,
    }),
    ['林砚'],
  );
  assert.deepEqual(
    inferRequiredProtagonistNames({
      chapterOutline: '档案馆夜班记录突然消失。',
      protagonists,
    }),
    [],
  );
});

test('repairs legacy hidden bindings and synthesizes missing bindings only from chapter evidence', () => {
  const protagonist = {
    characterId: 'character-lin-yan',
    name: '林砚',
    goal: '查明旧案真相',
    isPrimary: true,
  };
  const hidden = {
    id: 'binding-legacy',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    characterId: protagonist.characterId,
    name: protagonist.name,
    roleInChapter: 'hidden',
    roleType: 'protagonist',
    mustAppear: false,
    isProtagonist: true,
    note: '主角已建立，但章纲未明确直接出场；仅保留幕后关联',
  };

  assert.equal(isLegacyConservativeProtagonistBinding(hidden), true);

  const repaired = reconcileChapterProtagonistRequirements({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    contexts: [hidden],
    protagonists: [protagonist],
    requiredNames: new Set(['林砚']),
  });
  assert.equal(repaired[0].roleInChapter, 'main');
  assert.equal(repaired[0].mustAppear, true);

  const synthesized = reconcileChapterProtagonistRequirements({
    novelId: 'novel-1',
    chapterId: 'chapter-2',
    contexts: [],
    protagonists: [protagonist],
    requiredNames: new Set(['林砚']),
  });
  assert.equal(synthesized.length, 1);
  assert.equal(synthesized[0].roleInChapter, 'main');
  assert.equal(synthesized[0].mustAppear, true);

  const unchanged = reconcileChapterProtagonistRequirements({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    contexts: [hidden],
    protagonists: [protagonist],
    requiredNames: new Set(),
  });
  assert.equal(unchanged[0].roleInChapter, 'hidden');
  assert.equal(unchanged[0].mustAppear, false);
});
