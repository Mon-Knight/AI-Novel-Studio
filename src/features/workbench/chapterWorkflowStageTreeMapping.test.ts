import { describe, expect, it } from 'vitest';
import type { ChapterWorkflowStageView } from '../../types/chapterWorkflowStage';
import { projectChapterStageTree } from './chapterStageProjection';
import {
  buildChapterStagePlanMapping,
  chapterCandidateEvidenceFromCard,
  chapterCandidateEvidenceFromCards,
  mapChapterWorkflowStagesToTree,
  type ChapterCandidateEvidence,
  type ChapterStageTreeMappingScope,
} from './chapterWorkflowStageTreeMapping';

const HASH = 'a'.repeat(64);
const SCOPE: ChapterStageTreeMappingScope = {
  novelId: 'novel-1',
  chapterId: 'chapter-1',
  conversationId: 'conversation-1',
  workflowId: 'turn-1',
};

function stage(overrides: Partial<ChapterWorkflowStageView> = {}): ChapterWorkflowStageView {
  return {
    stageId: 'stage-1',
    workflowId: 'turn-1',
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    runId: 'run-1',
    stageKey: 'beat_write:scene-a:beat-a1',
    stageKind: 'beat_write',
    sceneId: 'scene-a',
    beatId: 'beat-a1',
    planVersion: 2,
    modelSnapshotHash: HASH,
    contextHash: HASH,
    baseHash: HASH,
    inputHash: HASH,
    planHash: HASH,
    status: 'succeeded',
    attempt: 1,
    revision: 2,
    resultHash: HASH,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:01.000Z',
    ...overrides,
  };
}

type EvidenceOverrides = Partial<Omit<ChapterCandidateEvidence, 'processingStatus'>> & {
  readonly processingStatus?: string;
};

function evidence(overrides: EvidenceOverrides = {}): ChapterCandidateEvidence {
  return {
    cardId: 'card-1',
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    runId: 'run-1',
    artifactId: 'artifact-1',
    artifactType: 'chapter_text',
    processingStatus: 'valid',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    ...overrides,
  } as ChapterCandidateEvidence;
}

function plan() {
  return buildChapterStagePlanMapping([
    {
      id: 'scene-a',
      sceneNo: 1,
      title: '城门',
      beats: [
        { id: 'beat-a2', order: 2 },
        { id: 'beat-a1', order: 1 },
      ],
    },
    { id: 'scene-b', sceneNo: 2, title: '客栈', beats: [{ id: 'beat-b1', order: 1 }] },
  ]);
}

describe('chapterWorkflowStageTreeMapping', () => {
  it('maps native kinds and orders scenes/beats only through the explicit plan mapping', () => {
    const rows = mapChapterWorkflowStagesToTree(
      [
        stage({ stageId: 'plan', stageKind: 'scene_plan', sceneId: undefined, beatId: undefined }),
        stage({ stageId: 'plan-a', stageKind: 'beat_plan', sceneId: 'scene-a', beatId: undefined }),
        stage({ stageId: 'write-a2', stageKey: 'scene:9/beat:9', beatId: 'beat-a2' }),
        stage({ stageId: 'write-a1', beatId: 'beat-a1', stageKey: 'unrelated' }),
        stage({ stageId: 'state-a1', stageKind: 'beat_state', beatId: 'beat-a1' }),
        stage({
          stageId: 'close-b',
          stageKind: 'scene_close',
          sceneId: 'scene-b',
          beatId: undefined,
        }),
      ],
      { scope: SCOPE, plan: plan() },
    );

    expect(rows.find((row) => row.stageId === 'plan')?.kind).toBe('scene_plan');
    expect(rows.find((row) => row.stageId === 'plan-a')).toMatchObject({
      kind: 'beat_plan',
      sceneId: 'scene-a',
      sceneNo: 1,
    });
    expect(rows.find((row) => row.stageId === 'write-a1')).toMatchObject({
      kind: 'beat_prose',
      sceneId: 'scene-a',
      sceneNo: 1,
      beatId: 'beat-a1',
      beatOrder: 1,
    });
    expect(rows.find((row) => row.stageId === 'write-a1')?.stageId).not.toBe('beat-a1');
    expect(rows.find((row) => row.stageId === 'write-a2')).toMatchObject({ beatOrder: 2 });
    expect(rows.find((row) => row.stageId === 'state-a1')?.kind).toBe('scene_state');
    expect(rows.find((row) => row.stageId === 'close-b')).toMatchObject({
      kind: 'scene_complete',
      sceneNo: 2,
    });

    const projection = projectChapterStageTree(rows);
    expect(projection.scenes.map((scene) => scene.sceneNo)).toEqual([1, 2]);
    expect(projection.scenes[0].beats.map((beat) => beat.beatOrder)).toEqual([1, 2]);
    expect(projection.unscoped).toEqual([]);
  });

  it('never guesses hierarchy for unknown Scene/Beat IDs and keeps those rows unscoped', () => {
    const rows = mapChapterWorkflowStagesToTree(
      [
        stage({ stageId: 'unknown-scene', sceneId: 'scene-x', beatId: 'beat-a1' }),
        stage({ stageId: 'unknown-beat', sceneId: 'scene-a', beatId: 'beat-x' }),
        stage({
          stageId: 'missing-scene',
          stageKind: 'beat_state',
          sceneId: undefined,
          beatId: 'beat-a1',
        }),
      ],
      { scope: SCOPE, plan: plan() },
    );

    for (const row of rows) {
      expect('sceneId' in row).toBe(false);
      expect('sceneNo' in row).toBe(false);
      expect('beatId' in row).toBe(false);
      expect('beatOrder' in row).toBe(false);
    }
    const projection = projectChapterStageTree(rows);
    expect(projection.scenes).toEqual([]);
    expect(projection.unscoped.map((row) => row.stageId)).toEqual([
      'missing-scene',
      'unknown-beat',
      'unknown-scene',
    ]);
  });

  it('leaves every scoped row unscoped when no explicit plan mapping is supplied', () => {
    const rows = mapChapterWorkflowStagesToTree([stage()], { scope: SCOPE });
    expect(rows).toHaveLength(1);
    expect('sceneId' in rows[0]).toBe(false);
    expect(projectChapterStageTree(rows).unscoped).toHaveLength(1);
  });

  it('maps native statuses, including interrupted recovery failures', () => {
    const rows = mapChapterWorkflowStagesToTree(
      [
        stage({ stageId: 'pending', stageKind: 'scene_plan', status: 'pending' }),
        stage({ stageId: 'running', stageKind: 'scene_plan', status: 'running' }),
        stage({ stageId: 'succeeded', stageKind: 'scene_plan', status: 'succeeded' }),
        stage({ stageId: 'failed', stageKind: 'scene_plan', status: 'failed', errorCode: 'X' }),
        stage({
          stageId: 'interrupted',
          stageKind: 'scene_plan',
          status: 'failed',
          errorCode: 'WORKFLOW_INTERRUPTED',
        }),
        stage({ stageId: 'cancelled', stageKind: 'scene_plan', status: 'cancelled' }),
      ],
      { scope: SCOPE },
    );

    expect(rows.map((row) => [row.stageId, row.status])).toEqual([
      ['pending', 'pending'],
      ['running', 'running'],
      ['succeeded', 'completed'],
      ['failed', 'failed'],
      ['interrupted', 'interrupted'],
      ['cancelled', 'cancelled'],
    ]);
    expect(rows[2].persistence).toBe('sqlite');
  });

  it('defaults intermediate verified artifacts and result documents to run anchors, never artifact anchors', () => {
    const rows = mapChapterWorkflowStagesToTree(
      [
        stage({
          stageId: 'with-document',
          stageKind: 'scene_plan',
          resultDocumentId: 'doc-1',
          verifiedArtifactId: undefined,
        }),
        stage({
          stageId: 'with-unpublished-artifact',
          stageKind: 'scene_plan',
          verifiedArtifactId: 'artifact-beat-intermediate',
          resultDocumentId: 'doc-2',
        }),
      ],
      { scope: SCOPE },
    );

    expect(rows.map((row) => row.anchor)).toEqual([
      { kind: 'run', id: 'run-1' },
      { kind: 'run', id: 'run-1' },
    ]);
    expect(rows[0].anchor?.id).not.toBe('doc-1');
    expect(rows[1].anchor?.id).not.toBe('artifact-beat-intermediate');
  });

  it('uses an artifact anchor only for an explicitly existing card mapping, with id=cardId', () => {
    const card = evidence({ artifactId: 'artifact-plan', cardId: 'card-plan' });
    const rows = mapChapterWorkflowStagesToTree(
      [stage({ stageId: 'plan', stageKind: 'scene_plan', verifiedArtifactId: 'artifact-plan' })],
      { scope: SCOPE, candidateEvidence: [card] },
    );

    expect(rows.find((row) => row.stageId === 'plan')?.anchor).toEqual({
      kind: 'artifact',
      id: 'card-plan',
    });
    const candidate = rows.find((row) => row.kind === 'chapter_candidate');
    expect(candidate?.anchor).toEqual({ kind: 'artifact', id: 'card-plan' });
    expect(candidate?.anchor?.id).not.toBe('artifact-plan');
  });

  it('never completes a chapter candidate from chapter_assemble success alone', () => {
    const rows = mapChapterWorkflowStagesToTree(
      [
        stage({
          stageId: 'assemble',
          stageKind: 'chapter_assemble',
          sceneId: undefined,
          beatId: undefined,
        }),
      ],
      { scope: SCOPE },
    );
    expect(rows).toEqual([]);
    expect(projectChapterStageTree(rows).chapterCandidate).toEqual([]);
  });

  it('completes a candidate only for a valid chapter_text card in the full current scope', () => {
    const rows = mapChapterWorkflowStagesToTree(
      [
        stage({
          stageId: 'assemble',
          stageKind: 'chapter_assemble',
          sceneId: undefined,
          beatId: undefined,
        }),
      ],
      { scope: SCOPE, candidateEvidence: [evidence()] },
    );

    const candidate = rows.find((row) => row.kind === 'chapter_candidate');
    expect(candidate).toMatchObject({
      status: 'completed',
      persistence: 'sqlite',
      anchor: { kind: 'artifact', id: 'card-1' },
    });
    expect(candidate?.stageId).toContain('card-1');
    expect(projectChapterStageTree(rows).chapterCandidate.map((row) => row.status)).toEqual([
      'completed',
    ]);
  });

  const rejectedEvidence: Array<[string, ChapterCandidateEvidence]> = [
    ['another novel', evidence({ novelId: 'novel-2' })],
    ['another chapter', evidence({ chapterId: 'chapter-2' })],
    ['another conversation', evidence({ conversationId: 'conversation-2' })],
    ['another turn/workflow', evidence({ turnId: 'turn-2' })],
    ['unproven run filter', evidence({ runId: 'run-2' })],
    ['not valid', evidence({ processingStatus: 'invalid' })],
  ];

  it.each(rejectedEvidence)('does not complete this tree from %s evidence', (_label, item) => {
    const scope = _label === 'unproven run filter' ? { ...SCOPE, runId: 'run-1' } : SCOPE;
    const rows = mapChapterWorkflowStagesToTree([], { scope, candidateEvidence: [item] });
    expect(rows).toEqual([]);
  });

  it('requires full conversation/workflow evidence scope before showing a candidate', () => {
    const noConversation = mapChapterWorkflowStagesToTree([], {
      scope: { novelId: 'novel-1', chapterId: 'chapter-1', workflowId: 'turn-1' },
      candidateEvidence: [evidence()],
    });
    const noWorkflow = mapChapterWorkflowStagesToTree([], {
      scope: { novelId: 'novel-1', chapterId: 'chapter-1', conversationId: 'conversation-1' },
      candidateEvidence: [evidence()],
    });
    expect(noConversation).toEqual([]);
    expect(noWorkflow).toEqual([]);
  });

  it('accepts only fully scoped valid chapter_text cards as candidate evidence', () => {
    const card = {
      cardId: 'card-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      runId: 'run-1',
      artifactId: 'artifact-1',
      artifactType: 'chapter_text',
      artifactEvidence: {
        sourceNovelId: 'novel-1',
        sourceChapterId: 'chapter-1',
        processingStatus: 'valid_with_warnings',
      },
    };
    expect(chapterCandidateEvidenceFromCard(card)).toEqual({
      cardId: 'card-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      runId: 'run-1',
      artifactId: 'artifact-1',
      artifactType: 'chapter_text',
      processingStatus: 'valid_with_warnings',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
    });
    expect(chapterCandidateEvidenceFromCard({ ...card, cardId: undefined })).toBeUndefined();
    expect(chapterCandidateEvidenceFromCard({ ...card, turnId: undefined })).toBeUndefined();
    expect(chapterCandidateEvidenceFromCard({ ...card, artifactType: 'outline' })).toBeUndefined();
    expect(
      chapterCandidateEvidenceFromCard({
        ...card,
        artifactEvidence: { ...card.artifactEvidence, processingStatus: 'invalid' },
      }),
    ).toBeUndefined();
    expect(
      chapterCandidateEvidenceFromCards([
        card,
        { ...card, cardId: undefined },
        { ...card, artifactEvidence: undefined },
      ]),
    ).toHaveLength(1);
  });
});

describe('buildChapterStagePlanMapping', () => {
  it('rejects duplicate or non-positive explicit Scene/Beat identity', () => {
    expect(() =>
      buildChapterStagePlanMapping([
        { id: 'scene-a', sceneNo: 1 },
        { id: 'scene-a', sceneNo: 2 },
      ]),
    ).toThrow(/Scene ID 重复/u);
    expect(() =>
      buildChapterStagePlanMapping([
        { id: 'scene-a', sceneNo: 1 },
        { id: 'scene-b', sceneNo: 1 },
      ]),
    ).toThrow(/Scene 序号 1/u);
    expect(() => buildChapterStagePlanMapping([{ id: 'scene-a', sceneNo: 0 }])).toThrow(
      /sceneNo 必须是正整数/u,
    );
    expect(() =>
      buildChapterStagePlanMapping([
        {
          id: 'scene-a',
          sceneNo: 1,
          beats: [
            { id: 'beat-1', order: 1 },
            { id: 'beat-1', order: 2 },
          ],
        },
      ]),
    ).toThrow(/Beat ID 重复/u);
    expect(() =>
      buildChapterStagePlanMapping([
        {
          id: 'scene-a',
          sceneNo: 1,
          beats: [
            { id: 'beat-1', order: 1 },
            { id: 'beat-2', order: 1 },
          ],
        },
      ]),
    ).toThrow(/Beat 序号 1/u);
  });

  it('merges explicit Beat plans only for known Scenes', () => {
    const mapping = buildChapterStagePlanMapping(
      [{ id: 'scene-a', sceneNo: 1 }],
      [{ sceneId: 'scene-a', beats: [{ id: 'beat-1', order: 1 }] }],
    );
    expect(mapping.beats).toEqual([{ sceneId: 'scene-a', beatId: 'beat-1', beatOrder: 1 }]);

    expect(() =>
      buildChapterStagePlanMapping(
        [{ id: 'scene-a', sceneNo: 1 }],
        [{ sceneId: 'scene-x', beats: [] }],
      ),
    ).toThrow(/未知 Scene/u);
  });
});
