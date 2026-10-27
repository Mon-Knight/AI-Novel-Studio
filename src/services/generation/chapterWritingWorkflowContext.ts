import type { SceneBeat, ScenePlanItem } from '../../types/chapterEngineering';
import type {
  ChapterWritingFourFields,
  ChapterWritingWorkflowCheckpoint,
  SceneBeatPlan,
} from '../../types/chapterWritingWorkflow';
import { canonicalHash, sha256 } from '../ai/compilation/canonical';
import { renderActualBeatState } from './chapterWritingState';

export function acceptedWorkflowProse(checkpoint: ChapterWritingWorkflowCheckpoint): string {
  return checkpoint.prose.map((record) => record.text).join('\n\n');
}

/** The effective entry is derived only from validated candidate records, never scene.result. */
export function actualSceneEntry(
  checkpoint: ChapterWritingWorkflowCheckpoint,
  scene: ScenePlanItem,
): string {
  const scenes = checkpoint.scenePlan?.scenes ?? [];
  const sceneIndex = scenes.findIndex((item) => item.id === scene.id);
  const precedingIds = new Set(scenes.slice(0, sceneIndex).map((item) => item.id));
  const preceding = checkpoint.prose.filter((item) => precedingIds.has(item.sceneId));
  return preceding.length
    ? [
        '前场实际变化按正文顺序列出；后续变化可能改变早先状态，不得把计划补成事实：',
        ...preceding.map(
          (record) =>
            `${record.sceneId} / ${record.beatId}\n${renderActualBeatState(record.actualState)}`,
        ),
      ].join('\n\n')
    : '本章尚无前场实际结果。请依据冻结的已采用前文进入本场；场景计划不代表已经发生。';
}

export async function sceneBeatPlanHash(
  scene: ScenePlanItem,
  plan: Omit<SceneBeatPlan, 'planHash'>,
): Promise<string> {
  return canonicalHash({
    schemaVersion: 1,
    scene,
    sourceContextHash: plan.sourceContextHash,
    previousTextHash: plan.previousTextHash,
    inputStateHash: plan.inputStateHash,
    beats: plan.beats,
  });
}

export async function sceneBeatPlanSources(
  sourceContext: string,
  previousText: string,
  actualEntryState: string,
): Promise<Pick<SceneBeatPlan, 'sourceContextHash' | 'previousTextHash' | 'inputStateHash'>> {
  const [sourceContextHash, previousTextHash, inputStateHash] = await Promise.all([
    sha256(sourceContext),
    sha256(previousText),
    sha256(actualEntryState),
  ]);
  return { sourceContextHash, previousTextHash, inputStateHash };
}

export function buildWorkflowBeatFields(input: {
  checkpoint: ChapterWritingWorkflowCheckpoint;
  sourceContext: string;
  chapterConstraints: readonly string[];
  scene: ScenePlanItem;
  plan: SceneBeatPlan;
  beat: SceneBeat;
}): ChapterWritingFourFields {
  const { checkpoint, scene, beat, plan } = input;
  const last = checkpoint.prose[checkpoint.prose.length - 1];
  const scenes = checkpoint.scenePlan?.scenes ?? [];
  const sceneIndex = scenes.findIndex((item) => item.id === scene.id);
  const laterScenes = scenes.slice(sceneIndex + 1);
  const laterBeats = plan.beats.filter((item) => item.order > beat.order);
  return {
    context: [
      '冻结章节资料（已采用前文和正式规则是基线）：',
      input.sourceContext,
      `当前 Scene ${scene.sceneNo}：${scene.title}`,
      `本场规划入口（仅为计划，不得当作实际结果）：${scene.contextCapsule ?? '未另行指定'}`,
      '前场实际入口：',
      actualSceneEntry(checkpoint, scene),
      '上一 Beat 的实际记录：',
      renderActualBeatState(last?.actualState),
      beat.startState ? `当前 Beat 计划入口（须与实际正文核对）：${beat.startState}` : '',
      '本次候选此前已通过校验的正文（尚未正式采用，不得复述）：',
      acceptedWorkflowProse(checkpoint) || '本章尚无候选正文。',
    ]
      .filter(Boolean)
      .join('\n\n'),
    goal: beat.stateChange?.trim() || beat.text,
    beat: beat.text,
    constraints: [
      ...input.chapterConstraints,
      ...(scene.constraints ?? []),
      scene.location ? `当前场景地点：${scene.location}` : '',
      scene.characters.length ? `当前在场人物：${scene.characters.join('、')}` : '',
      '只输出当前一个 Beat 的连续小说正文；不输出提纲、解释或状态 JSON。',
      '已采用事实、世界规则和信息边界不可被本次计划或临时状态静默改写。',
      '视角人物只能使用有来源的已知信息；未确认内容必须保留不确定性。',
      ...laterBeats.map((item) => `不得提前完成后续 Beat：${item.text}`),
      ...laterScenes.map((item) => `不得提前完成后续 Scene ${item.sceneNo} 的目标：${item.goal}`),
      laterBeats.length === 0 && scene.expectedEndState
        ? `本场预期结束状态（是目标，不是既成事实）：${scene.expectedEndState}`
        : '',
      laterBeats.length === 0 && scene.transition
        ? `本场结束时仅推进至转场边界：${scene.transition}`
        : '',
      '在当前 Beat 的变化完成处自然收束，不追加后续事件。',
    ].filter(Boolean),
  };
}
