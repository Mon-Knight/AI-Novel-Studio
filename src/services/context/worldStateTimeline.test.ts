import assert from 'node:assert/strict';
import test from 'node:test';

import type { Chapter } from '../../types/chapter';
import type { ChapterSummary } from '../../types/chapterSummary';
import type { ContextRecord } from '../../types/context';
import type { Volume } from '../../types/volume';
import { buildPersistedWorldStateTimeline } from './worldStateTimeline';

const NOVEL_ID = 'novel-world-state';
const CREATED_AT = '2026-08-29T00:00:00.000Z';

function volume(id: string, volumeNumber: number): Volume {
  return {
    id,
    novelId: NOVEL_ID,
    title: `卷${volumeNumber}`,
    volumeNumber,
    orderIndex: volumeNumber - 1,
    sortOrder: volumeNumber - 1,
    status: 'writing',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function chapter(id: string, chapterNumber: number, volumeId = 'volume-1'): Chapter {
  return {
    id,
    novelId: NOVEL_ID,
    volumeId,
    title: `章${chapterNumber}`,
    chapterNumber,
    orderIndex: chapterNumber - 1,
    sortOrder: chapterNumber - 1,
    outline: '',
    goal: '',
    status: 'summarized',
    wordCount: 0,
    currentWords: 0,
    targetWords: 0,
    drafts: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function summary(chapterId: string, text: string): ChapterSummary {
  return {
    id: `summary-${chapterId}`,
    novelId: NOVEL_ID,
    chapterId,
    adoptedDraftId: `draft-${chapterId}`,
    summary: text,
    enabled: true,
    isExpired: false,
    validationStatus: 'passed',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function contextRecord(
  id: string,
  chapterId: string,
  content: string,
  contextType: ContextRecord['contextType'] = 'plot_progress',
): ContextRecord {
  return {
    id,
    novelId: NOVEL_ID,
    chapterId,
    contextType,
    title: id,
    content,
    importance: 5,
    isActive: true,
    isExpired: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

test('persisted world-state timeline includes only adopted facts before the target chapter', () => {
  const chapters = [chapter('chapter-1', 1), chapter('chapter-2', 2), chapter('chapter-3', 3)];
  const first = {
    ...summary('chapter-1', 'Story Day 1 夜间，北门封条保持完整。'),
    coreEvents: ['林见微记录北门倒计时'],
    settingChanges: ['档案馆北门进入封锁状态'],
    newLocations: ['旧档案馆北门'],
    factsMustRemember: ['封条编号为 A-17'],
  };
  const second = {
    ...summary('chapter-2', 'Story Day 2 六时，封条按计划拆除。'),
    resolvedForeshadows: ['北门倒计时'],
    unresolvedQuestions: ['谁修改了门禁日志'],
  };
  const current = summary('chapter-3', '不得回灌的当前章终态');

  const timeline = buildPersistedWorldStateTimeline({
    orderedChapters: chapters,
    volumes: [volume('volume-1', 1)],
    targetChapterId: 'chapter-3',
    summaries: [current, second, first],
    contextRecords: [
      contextRecord('rule-before', 'chapter-1', '北门封锁期间只有值班员可进入', 'rule'),
      contextRecord('progress-before', 'chapter-2', '门禁日志已被调包'),
      contextRecord('progress-current', 'chapter-3', '不得回灌的当前章记录'),
    ],
  });

  assert.ok(timeline);
  assert.equal(timeline.latestChapterId, 'chapter-2');
  assert.equal(timeline.chapterCount, 2);
  assert.deepEqual(timeline.sourceSummaryIds, ['summary-chapter-1', 'summary-chapter-2']);
  assert.deepEqual(timeline.sourceContextRecordIds, ['rule-before', 'progress-before']);
  assert.match(timeline.content, /第1章《章1》[\s\S]*第2章《章2》/);
  assert.match(timeline.content, /Story Day 1 夜间/);
  assert.match(timeline.content, /档案馆北门进入封锁状态/);
  assert.match(timeline.content, /封条编号为 A-17/);
  assert.match(timeline.content, /Story Day 2 六时/);
  assert.match(timeline.content, /谁修改了门禁日志/);
  assert.match(timeline.content, /门禁日志已被调包/);
  assert.doesNotMatch(timeline.content, /不得回灌的当前章/);
});

test('timeline ignores disabled, expired and validation-failed persisted facts', () => {
  const disabled = { ...summary('chapter-1', '停用事实'), enabled: false };
  const expired = { ...summary('chapter-1', '过期事实'), isExpired: true };
  const failed = { ...summary('chapter-1', '校验失败事实'), validationStatus: 'failed' as const };
  const inactiveRecord = {
    ...contextRecord('inactive', 'chapter-1', '停用 ContextRecord'),
    isActive: false,
  };

  const timeline = buildPersistedWorldStateTimeline({
    orderedChapters: [chapter('chapter-1', 1), chapter('chapter-2', 2)],
    volumes: [volume('volume-1', 1)],
    targetChapterId: 'chapter-2',
    summaries: [disabled, expired, failed],
    contextRecords: [inactiveRecord],
  });

  assert.equal(timeline, undefined);
});

test('first chapter never receives a synthetic world-state timeline', () => {
  const timeline = buildPersistedWorldStateTimeline({
    orderedChapters: [chapter('chapter-1', 1), chapter('chapter-2', 2)],
    volumes: [volume('volume-1', 1)],
    targetChapterId: 'chapter-1',
    summaries: [summary('chapter-1', '当前章旧总结'), summary('chapter-2', '未来章总结')],
    contextRecords: [],
  });

  assert.equal(timeline, undefined);
});
