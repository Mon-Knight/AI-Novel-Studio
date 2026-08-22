import type { ChapterGenerationExecutionInput } from '../chapterGenerationExecutionService';
import {
  type OrchestratedScene,
  CONTINUATION_CONTEXT_TAIL_CHARS,
  stringList,
  stringValue,
} from './types';

export function compact(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length <= maxLength ? text : '[前文已压缩]\n' + text.slice(-maxLength);
}

export function compactHeadAndTail(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  const marker = '\n[中段已压缩]\n';
  const side = Math.max(1, Math.floor((maxLength - marker.length) / 2));
  return text.slice(0, side) + marker + text.slice(-side);
}

export function immediateBeatContext(
  input: ChapterGenerationExecutionInput,
  scene: OrchestratedScene,
  beat: OrchestratedScene['beats'][number],
  previous: { scene: OrchestratedScene; beatOrder: number; text: string } | undefined,
  acceptedChapterPrefix: string,
): string {
  if (!previous) {
    const frozenChapterContext = input.request.messages
      .map((message) => message.content)
      .join('\n\n');
    return [
      scene.contextCapsule ? '当前场景状态：\n' + compact(scene.contextCapsule, 700) : '',
      '冻结章节上下文（头尾压缩，必须保持人物身份和既有事实）：\n' +
        compactHeadAndTail(
          stringValue(input.taskInput.sceneContext) || frozenChapterContext,
          1_500,
        ),
      `当前 Scene ${scene.sceneNo}：${scene.title}`,
      `当前 Beat ${beat.order}：${beat.text}`,
    ].join('\n\n');
  }
  return [
    `上一生成单元：Scene ${previous.scene.sceneNo} / Beat ${previous.beatOrder}`,
    '本章此前已接受正文（只用于保持事实和衔接，不得复述）：\n' +
      compact(acceptedChapterPrefix || previous.text, 1_800),
    previous.scene.sceneNo !== scene.sceneNo && previous.scene.result
      ? '上一场景结果：' + previous.scene.result
      : '',
    previous.scene.sceneNo !== scene.sceneNo && previous.scene.transition
      ? '原定转场：' + previous.scene.transition
      : '',
    '当前场景：' + scene.title,
    `当前 Beat ${beat.order}：${beat.text}`,
    scene.location ? '当前地点：' + scene.location : '',
    scene.characters.length ? '当前角色：' + scene.characters.join('、') : '',
    scene.conflict ? '当前冲突：' + scene.conflict : '',
    '只承接上一 Beat 已经发生的事实，不回写或重述已有正文。',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function sceneConstraints(
  input: ChapterGenerationExecutionInput,
  scene: OrchestratedScene,
  beat: OrchestratedScene['beats'][number],
  previous: { scene: OrchestratedScene; beatOrder: number; text: string } | undefined,
  isLastBeatInScene: boolean,
): string[] {
  const constraints = stringList(input.taskInput.sceneConstraints);
  return [
    ...constraints,
    ...scene.constraints,
    scene.location ? '当前地点：' + scene.location : '',
    scene.characters.length ? '当前角色：' + scene.characters.join('、') : '',
    scene.conflict ? '当前冲突：' + scene.conflict : '',
    previous
      ? `承接上一生成单元 Scene ${previous.scene.sceneNo} / Beat ${previous.beatOrder} 的结尾状态。`
      : '',
    `当前只完成 Beat ${beat.order}：${beat.text}`,
    isLastBeatInScene && scene.transition ? '本 Beat 结束后仅推进至：' + scene.transition : '',
    isLastBeatInScene && scene.expectedEndState
      ? '本 Beat 完成时达到：' + scene.expectedEndState
      : '',
    isLastBeatInScene ? '' : '不得提前完成当前 Scene 的最终结果或转场。',
    '只输出当前一个 Beat 的连续正文，不提前写入后续 Beat 或收束整章。',
  ].filter(Boolean);
}

export function continuationSceneContext(previousText: string): string {
  return [
    '这是同一 Scene 的截断续写。下方只提供已写入草稿的结尾锚点，禁止复述锚点或返回 Scene 开头。',
    '续写锚点（禁止重复）：\n' + compact(previousText, CONTINUATION_CONTEXT_TAIL_CHARS),
    '第一句必须是锚点之后的新动作、新对白或新叙述；只输出新增正文，不要重新介绍人物、规则、目标或已发生事件。',
  ].join('\n\n');
}

export function validationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '上一版生成单元未通过校验。';
}

export function retrySceneTaskInput(
  taskInput: Record<string, unknown>,
  scene: OrchestratedScene,
  baseConstraints: string[],
  validationError: unknown,
  pendingSceneBeatsFn: (sceneText: string, scene: OrchestratedScene) => string[],
): Record<string, unknown> {
  const missingBeats = pendingSceneBeatsFn('', scene);
  return {
    ...taskInput,
    sceneGoal: '完整重写当前 Beat，修复校验指出的问题后在 Beat 边界自然收束。',
    sceneBeats: scene.beats.length
      ? scene.beats.map((beat) => beat.text)
      : stringList(taskInput.sceneBeats),
    sceneConstraints: [
      ...baseConstraints,
      `上一版生成单元未通过校验：${validationErrorMessage(validationError)}`,
      missingBeats.length
        ? `重点确保以下有序 Beat 在正文中清楚发生：${missingBeats.join('；')}`
        : '',
      '这是当前 Beat 的最后一次本地重写机会；只输出完整、连贯、可直接替换上一版的正文。',
      '不要解释修复过程，不要输出提纲、JSON、思考过程或校验结果。',
    ].filter(Boolean),
  };
}
