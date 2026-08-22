import type { ScenePlanItem } from '../../../types/chapterEngineering';
import type { ChapterGenerationExecutionInput } from '../chapterGenerationExecutionService';
import {
  type OrchestratedScene,
  MAX_LOCAL_CHAPTER_BEATS,
  MAX_LOCAL_SCENE_BEATS,
  MIN_LOCAL_CHAPTER_BEATS,
  positiveNumber,
  stringList,
  stringValue,
} from './types';

export function scenePlanFromInput(input: ChapterGenerationExecutionInput): OrchestratedScene[] {
  const raw = input.taskInput.scenePlan;
  if (Array.isArray(raw)) {
    const scenes = raw
      .map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const scene = value as Partial<ScenePlanItem>;
        const beats = Array.isArray(scene.beats)
          ? scene.beats
              .map((beat, beatIndex) => {
                if (!beat || typeof beat !== 'object' || Array.isArray(beat)) return null;
                const text = stringValue((beat as { text?: unknown }).text);
                return text
                  ? {
                      order: Math.max(
                        1,
                        Math.round(Number((beat as { order?: unknown }).order) || beatIndex + 1),
                      ),
                      text,
                      required: (beat as { required?: unknown }).required !== false,
                    }
                  : null;
              })
              .filter(
                (beat): beat is { order: number; text: string; required: boolean } => beat !== null,
              )
              .sort((left, right) => left.order - right.order)
              .map((beat, beatIndex) => ({ ...beat, order: beatIndex + 1 }))
          : [];
        return {
          sceneNo: Math.max(1, Math.round(Number(scene.sceneNo) || index + 1)),
          title: stringValue(scene.title) || '场景 ' + (index + 1),
          location: stringValue(scene.location),
          characters: stringList(scene.characters),
          goal: stringValue(scene.goal),
          conflict: stringValue(scene.conflict),
          beats,
          result: stringValue(scene.result),
          transition: stringValue(scene.transition),
          contextCapsule: stringValue(scene.contextCapsule),
          constraints: stringList(scene.constraints),
          expectedEndState: stringValue(scene.expectedEndState),
          targetCharacters: positiveNumber(scene.targetCharacters),
        };
      })
      .filter((scene): scene is OrchestratedScene => scene !== null)
      .sort((left, right) => left.sceneNo - right.sceneNo)
      .map((scene, index) => ({ ...scene, sceneNo: index + 1 }));
    if (scenes.length) return scenes;
  }

  const fallbackBeats = stringList(input.taskInput.sceneBeats);
  return [
    {
      sceneNo: 1,
      title: stringValue(input.taskInput.sceneTitle) || '场景 1',
      location: '',
      characters: [],
      goal: stringValue(input.taskInput.sceneGoal) || '推进当前章节的核心目标。',
      conflict: '',
      beats: (fallbackBeats.length ? fallbackBeats : ['完成当前场景的核心事件推进。']).map(
        (text, index) => ({
          order: index + 1,
          text,
          required: true,
        }),
      ),
      result: '',
      transition: '',
      contextCapsule: '',
      constraints: [],
      expectedEndState: '',
      targetCharacters: positiveNumber(input.taskInput.targetWordCount),
    },
  ];
}

/**
 * The trained local contract is one request per Beat. A 2,000–3,000 character
 * chapter therefore uses a compact 3–5 Beat plan, with no Scene containing
 * more than three Beats.
 */
export function validateLocalGenerationPlan(
  scenes: ReadonlyArray<Pick<OrchestratedScene, 'sceneNo' | 'beats'>>,
): void {
  const invalid = scenes.filter(
    (scene) => scene.beats.length < 1 || scene.beats.length > MAX_LOCAL_SCENE_BEATS,
  );
  if (invalid.length > 0) {
    throw new Error(
      `每个 Scene 必须包含 1–${MAX_LOCAL_SCENE_BEATS} 个 Beat；` +
        `当前异常场景：${invalid.map((scene) => `Scene ${scene.sceneNo}（${scene.beats.length} 个）`).join('、')}。`,
    );
  }
  const total = scenes.reduce((sum, scene) => sum + scene.beats.length, 0);
  if (total < MIN_LOCAL_CHAPTER_BEATS || total > MAX_LOCAL_CHAPTER_BEATS) {
    throw new Error(
      `整章必须包含 ${MIN_LOCAL_CHAPTER_BEATS}–${MAX_LOCAL_CHAPTER_BEATS} 个 Beat，且每个 Beat 单独调用本地模型；` +
        `当前共 ${total} 个。请返回 Scene/Beat 候选编辑后再生成。`,
    );
  }
}
