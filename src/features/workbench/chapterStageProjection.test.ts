import { describe, expect, it } from 'vitest';
import {
  projectChapterStageTree,
  type ChapterStage,
  type ChapterStagePersistence,
} from './chapterStageProjection';

function recorded(
  stage: Omit<ChapterStage, 'persistence'> & { persistence?: ChapterStagePersistence },
): ChapterStage {
  return { ...stage, persistence: stage.persistence ?? 'sqlite' };
}

describe('chapterStageProjection', () => {
  it('projects fixed stages, explicit scenes, ordered beats and the final candidate', () => {
    const projection = projectChapterStageTree(
      [
        {
          stageId: 'candidate',
          kind: 'chapter_candidate',
          status: 'pending',
          anchor: { kind: 'artifact', id: 'artifact-candidate' },
        },
        {
          stageId: 'scene-plan',
          kind: 'scene_plan',
          status: 'completed',
        },
        {
          stageId: 'materials',
          kind: 'chapter_materials',
          status: 'completed',
        },
        recorded({
          stageId: 'scene-b-beat-1',
          kind: 'beat_prose',
          status: 'completed',
          sceneId: 'scene-b',
          sceneNo: 2,
          beatId: 'beat-b1',
          beatOrder: 1,
        }),
        recorded({
          stageId: 'scene-a',
          kind: 'scene',
          title: '城门盘查',
          sceneId: 'scene-a',
          sceneNo: 1,
          status: 'completed',
        }),
        recorded({
          stageId: 'scene-a-plan',
          kind: 'beat_plan',
          sceneId: 'scene-a',
          sceneNo: 1,
          status: 'completed',
        }),
        recorded({
          stageId: 'scene-a-beat-2',
          kind: 'beat_prose',
          sceneId: 'scene-a',
          sceneNo: 1,
          beatId: 'beat-a2',
          beatOrder: 2,
          status: 'completed',
        }),
        recorded({
          stageId: 'scene-a-beat-1',
          kind: 'beat_prose',
          sceneId: 'scene-a',
          sceneNo: 1,
          beatId: 'beat-a1',
          beatOrder: 1,
          status: 'completed',
        }),
        recorded({
          stageId: 'scene-a-state',
          kind: 'scene_state',
          sceneId: 'scene-a',
          sceneNo: 1,
          status: 'completed',
        }),
        recorded({
          stageId: 'scene-a-complete',
          kind: 'scene_complete',
          sceneId: 'scene-a',
          sceneNo: 1,
          status: 'completed',
        }),
      ],
      [{ sceneId: 'scene-c', sceneNo: 3, title: '客栈接头' }],
    );

    expect(projection.chapterMaterials.map((row) => row.label)).toEqual(['章节资料准备']);
    expect(projection.scenePlan.map((row) => row.label)).toEqual(['Scene 规划']);
    expect(projection.chapterCandidate.map((row) => row.label)).toEqual(['完整章节候选']);
    expect(projection.scenes.map((scene) => scene.sceneNo)).toEqual([1, 2, 3]);
    expect(projection.scenes[0]).toMatchObject({
      sceneId: 'scene-a',
      title: '城门盘查',
      future: false,
      status: 'completed',
      beatsPlanned: true,
    });
    expect(projection.scenes[0].beats.map((beat) => beat.beatOrder)).toEqual([1, 2]);
    expect(projection.scenes[2]).toMatchObject({
      sceneId: 'scene-c',
      sceneNo: 3,
      title: '客栈接头',
      future: true,
      status: 'pending',
      beatsPlanned: false,
      beats: [],
    });
    expect(projection.persistence).toBe('sqlite');
  });

  it('never infers scene or beat identity from titles, order, or missing fields', () => {
    const projection = projectChapterStageTree([
      recorded({
        stageId: 'orphan',
        kind: 'beat_prose',
        title: 'Scene 1 · Beat 1',
        status: 'completed',
        beatOrder: 1,
      }),
      recorded({
        stageId: 'scene-a-beat',
        kind: 'beat_prose',
        sceneId: 'scene-a',
        sceneNo: 4,
        beatId: 'beat-a',
        beatOrder: 2,
        title: '正文',
        status: 'completed',
      }),
      recorded({
        stageId: 'scene-b-beat',
        kind: 'beat_prose',
        sceneId: 'scene-b',
        sceneNo: 1,
        beatId: 'beat-b',
        beatOrder: 1,
        title: '正文',
        status: 'completed',
      }),
    ]);

    expect(projection.scenes.map((scene) => scene.sceneId)).toEqual(['scene-b', 'scene-a']);
    expect(projection.scenes.map((scene) => scene.sceneNo)).toEqual([1, 4]);
    expect(projection.scenes[1].beats.map((beat) => beat.beatOrder)).toEqual([2]);
    expect(projection.unscoped.map((row) => row.stageId)).toEqual(['orphan']);
  });

  it('uses the latest attempt for a beat while retaining the failed attempt as history', () => {
    const projection = projectChapterStageTree([
      recorded({
        stageId: 'beat-1-attempt-1',
        kind: 'beat_prose',
        sceneId: 'scene-a',
        sceneNo: 1,
        beatId: 'beat-a1',
        beatOrder: 1,
        attempt: 1,
        status: 'failed',
      }),
      recorded({
        stageId: 'beat-1-attempt-2',
        kind: 'beat_prose',
        sceneId: 'scene-a',
        sceneNo: 1,
        beatId: 'beat-a1',
        beatOrder: 1,
        attempt: 2,
        status: 'completed',
      }),
    ]);

    expect(projection.scenes[0].beats).toHaveLength(1);
    expect(projection.scenes[0].beats[0].status).toBe('completed');
    expect(projection.scenes[0].beats[0].prose.map((row) => row.status)).toEqual([
      'failed',
      'completed',
    ]);
    expect(projection.scenes[0].status).toBe('partial');
    expect(projection.defaultExpandedSceneIds).toEqual([]);
  });

  it('defaults only running or failed scene branches to expanded', () => {
    const projection = projectChapterStageTree([
      recorded({
        stageId: 'scene-running',
        kind: 'beat_prose',
        sceneId: 'scene-running',
        sceneNo: 1,
        beatId: 'beat-running',
        beatOrder: 1,
        status: 'running',
      }),
      recorded({
        stageId: 'scene-failed',
        kind: 'scene_state',
        sceneId: 'scene-failed',
        sceneNo: 2,
        status: 'failed',
      }),
      recorded({
        stageId: 'scene-cancelled',
        kind: 'scene_complete',
        sceneId: 'scene-cancelled',
        sceneNo: 3,
        status: 'cancelled',
      }),
      recorded({
        stageId: 'scene-interrupted',
        kind: 'scene_complete',
        sceneId: 'scene-interrupted',
        sceneNo: 4,
        status: 'interrupted',
      }),
      recorded({
        stageId: 'scene-completed',
        kind: 'scene_complete',
        sceneId: 'scene-completed',
        sceneNo: 5,
        status: 'completed',
      }),
    ]);

    expect(projection.defaultExpandedSceneIds).toEqual(['scene-running', 'scene-failed']);
  });

  it('never renders a completed label without persistence evidence as completed', () => {
    const projection = projectChapterStageTree([
      { stageId: 'materials', kind: 'chapter_materials', status: 'completed' },
      {
        stageId: 'browser-plan',
        kind: 'scene_plan',
        status: 'completed',
        persistence: 'browser',
      },
      {
        stageId: 'sqlite-plan',
        kind: 'scene_plan',
        status: 'completed',
        persistence: 'sqlite',
      },
    ]);

    expect(projection.chapterMaterials[0].status).toBe('not_recorded');
    expect(projection.chapterMaterials[0].persistence).toBe('none');
    expect(projection.scenePlan.map((row) => row.status)).toEqual(['completed', 'completed']);
    expect(projection.persistence).toBe('mixed');
  });

  it('keeps a future scene unplanned until explicit stage records arrive', () => {
    const future = [{ sceneId: 'scene-future', sceneNo: 2, title: '尚未到达' }];
    const before = projectChapterStageTree([], future);
    expect(before.scenes[0]).toMatchObject({
      future: true,
      status: 'pending',
      beatsPlanned: false,
      beats: [],
      beatPlanRows: [],
    });
    expect(before.persistence).toBe('none');

    const after = projectChapterStageTree(
      [
        recorded({
          stageId: 'scene-future-beat-plan',
          kind: 'beat_plan',
          sceneId: 'scene-future',
          sceneNo: 2,
          status: 'running',
        }),
      ],
      future,
    );
    expect(after.scenes[0]).toMatchObject({
      future: false,
      status: 'running',
      beatsPlanned: true,
    });
    expect(after.defaultExpandedSceneIds).toEqual(['scene-future']);
  });
});
