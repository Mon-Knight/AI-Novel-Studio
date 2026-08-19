import type {
  AutonomousChapterPlan,
  AutonomousCharacterPlan,
  AutonomousConflictThread,
  AutonomousPacingPhase,
  AutonomousPacingPoint,
  AutonomousStoryArc,
  AutonomousStoryBible,
  AutonomousStoryBrief,
  AutonomousStoryPlan,
  AutonomousVolumePlan,
  AutonomousWorldElement,
  PacingMode,
  WorldElementType,
} from '../../types/autonomousCreation';

const MAX_PLAN_JSON_LENGTH = 2_000_000;

export interface PlotFoundationProposal {
  storyBible: AutonomousStoryBible;
  arcs: Array<Pick<AutonomousStoryArc, 'title' | 'goal' | 'turningPoint' | 'climax' | 'outcome'>>;
  volumes: Array<Pick<AutonomousVolumePlan, 'title' | 'summary' | 'goal' | 'mainConflict'>>;
}

export interface CharacterProposal {
  name: string;
  role: AutonomousCharacterPlan['role'];
  identity: string;
  faction?: string;
  relationToProtagonist?: string;
  personality: string;
  coreNeed: string;
  flaw: string;
  initialState: string;
  desiredEndState: string;
  behaviorLimits: string[];
  forbiddenBehaviors: string[];
  beats: Array<{
    chapterNumber: number;
    stage: string;
    change: string;
    relationshipShift?: string;
    knowledgeGain?: string;
  }>;
}

export interface WorldElementProposal {
  type: WorldElementType;
  name: string;
  summary: string;
  firstChapter: number;
  dependencies: string[];
  constraints: string[];
}

export interface ConflictProposal {
  title: string;
  type: AutonomousConflictThread['type'];
  participants: string[];
  stakes: string;
  summary: string;
  introducedChapter: number;
  escalationChapters: number[];
  climaxChapter: number;
  resolutionChapter: number;
}

export interface PacingPhaseProposal {
  title: string;
  mode: PacingMode;
  tensionStart: number;
  tensionEnd: number;
  purpose: string;
}

export interface ChapterProposal {
  chapterNumber: number;
  title: string;
  outline: string;
  goal: string;
  endingHook: string;
  focusCharacters?: string[];
  conflictTitles?: string[];
  worldElementNames?: string[];
}

export interface PlanShape {
  arcCount: number;
  volumeCount: number;
}

type IdFactory = () => string;

function assertText(value: string, label: string, min = 1, max = 10_000): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length < min || normalized.length > max) {
    throw new Error(`${label}长度必须在 ${min} 到 ${max} 个字符之间。`);
  }
  return normalized;
}

function assertInteger(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label}必须是 ${min} 到 ${max} 之间的整数。`);
  }
  return value;
}

function assertRatio(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label}必须在 0 到 100 之间。`);
  }
  return Math.round(value);
}

function uniqueStrings(values: string[], label: string, max = 50): string[] {
  if (!Array.isArray(values) || values.length > max) throw new Error(`${label}格式无效。`);
  const normalized = values.map((value) => assertText(value, label, 1, 300));
  return [...new Set(normalized)];
}

function ranges(total: number, count: number): Array<{ start: number; end: number }> {
  const base = Math.floor(total / count);
  const remainder = total % count;
  let cursor = 1;
  return Array.from({ length: count }, (_, index) => {
    const size = base + (index < remainder ? 1 : 0);
    const range = { start: cursor, end: cursor + size - 1 };
    cursor = range.end + 1;
    return range;
  });
}

function overlaps(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function normalizeNameList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function validateStoryBrief(brief: AutonomousStoryBrief): AutonomousStoryBrief {
  if (!brief || typeof brief !== 'object') throw new Error('小说创意不能为空。');
  return {
    premise: assertText(brief.premise, '核心创意', 20, 5_000),
    genre: assertText(brief.genre, '题材', 1, 80),
    targetChapterCount: assertInteger(brief.targetChapterCount, '目标章节数', 12, 500),
    targetWordsPerChapter: assertInteger(brief.targetWordsPerChapter, '每章目标字数', 500, 10_000),
    readerPromise: assertText(brief.readerPromise, '读者承诺', 4, 1_000),
    endingPreference: assertText(brief.endingPreference, '结局方向', 2, 1_000),
    constraints: uniqueStrings(brief.constraints ?? [], '创作约束', 30),
  };
}

export function derivePlanShape(targetChapterCount: number): PlanShape {
  // Continuation plans may only need a short tail after the existing book.
  assertInteger(targetChapterCount, '目标章节数', 1, 500);
  return {
    arcCount: Math.max(3, Math.min(8, Math.ceil(targetChapterCount / 60))),
    volumeCount: Math.max(1, Math.min(24, Math.ceil(targetChapterCount / 30))),
  };
}

export function buildFoundation(
  brief: AutonomousStoryBrief,
  proposal: PlotFoundationProposal,
  createId: IdFactory,
): {
  storyBible: AutonomousStoryBible;
  arcs: AutonomousStoryArc[];
  volumes: AutonomousVolumePlan[];
} {
  const shape = derivePlanShape(brief.targetChapterCount);
  if (proposal.arcs.length !== shape.arcCount) {
    throw new Error(`Plot Planner 必须返回 ${shape.arcCount} 个故事弧。`);
  }
  if (proposal.volumes.length !== shape.volumeCount) {
    throw new Error(`Plot Planner 必须返回 ${shape.volumeCount} 个分卷。`);
  }

  const storyBible: AutonomousStoryBible = {
    title: assertText(proposal.storyBible.title, '作品名', 1, 120),
    logline: assertText(proposal.storyBible.logline, '故事梗概', 10, 1_000),
    themes: uniqueStrings(proposal.storyBible.themes, '主题', 12),
    protagonistPromise: assertText(proposal.storyBible.protagonistPromise, '主角承诺', 4, 1_000),
    centralQuestion: assertText(proposal.storyBible.centralQuestion, '核心问题', 4, 1_000),
    endingVision: assertText(proposal.storyBible.endingVision, '结局愿景', 4, 1_000),
    narrativeRules: uniqueStrings(proposal.storyBible.narrativeRules, '叙事规则', 30),
  };

  const arcRanges = ranges(brief.targetChapterCount, shape.arcCount);
  const arcs = proposal.arcs.map((item, index): AutonomousStoryArc => ({
    id: createId(),
    index,
    title: assertText(item.title, '故事弧标题', 1, 120),
    chapterStart: arcRanges[index].start,
    chapterEnd: arcRanges[index].end,
    goal: assertText(item.goal, '故事弧目标', 4, 1_000),
    turningPoint: assertText(item.turningPoint, '故事弧转折', 4, 1_000),
    climax: assertText(item.climax, '故事弧高潮', 4, 1_000),
    outcome: assertText(item.outcome, '故事弧结果', 4, 1_000),
  }));

  const volumeRanges = ranges(brief.targetChapterCount, shape.volumeCount);
  const volumes = proposal.volumes.map((item, index): AutonomousVolumePlan => {
    const range = volumeRanges[index];
    return {
      id: createId(),
      index,
      title: assertText(item.title, '分卷标题', 1, 120),
      chapterStart: range.start,
      chapterEnd: range.end,
      summary: assertText(item.summary, '分卷简介', 10, 2_000),
      goal: assertText(item.goal, '分卷目标', 4, 1_000),
      mainConflict: assertText(item.mainConflict, '分卷矛盾', 4, 1_000),
      arcIds: arcs
        .filter((arc) => overlaps(range, { start: arc.chapterStart, end: arc.chapterEnd }))
        .map((arc) => arc.id),
    };
  });

  return { storyBible, arcs, volumes };
}

export function buildCharacters(
  targetChapterCount: number,
  proposals: CharacterProposal[],
  createId: IdFactory,
): AutonomousCharacterPlan[] {
  if (!Array.isArray(proposals) || proposals.length < 3 || proposals.length > 24) {
    throw new Error('Character Evolution Agent 必须返回 3 到 24 个角色。');
  }
  const names = new Set<string>();
  const characters = proposals.map((item): AutonomousCharacterPlan => {
    const name = assertText(item.name, '角色名', 1, 80);
    if (names.has(name)) throw new Error(`角色名重复：${name}`);
    names.add(name);
    const characterId = createId();
    const beats = (item.beats ?? [])
      .map((beat) => ({
        id: createId(),
        characterId,
        chapterNumber: assertInteger(beat.chapterNumber, '人物成长节点章节', 1, targetChapterCount),
        stage: assertText(beat.stage, '人物成长阶段', 1, 120),
        change: assertText(beat.change, '人物变化', 4, 1_000),
        relationshipShift: beat.relationshipShift?.trim() || undefined,
        knowledgeGain: beat.knowledgeGain?.trim() || undefined,
      }))
      .sort((left, right) => left.chapterNumber - right.chapterNumber);
    if (beats.length < 2 || beats.length > 30)
      throw new Error(`${name} 必须包含 2 到 30 个人物成长节点。`);
    return {
      id: characterId,
      name,
      role: item.role,
      identity: assertText(item.identity, '角色身份', 1, 500),
      faction: item.faction?.trim() || undefined,
      relationToProtagonist: item.relationToProtagonist?.trim() || undefined,
      personality: assertText(item.personality, '角色性格', 2, 1_000),
      coreNeed: assertText(item.coreNeed, '角色核心需求', 2, 1_000),
      flaw: assertText(item.flaw, '角色缺陷', 2, 1_000),
      initialState: assertText(item.initialState, '角色初始状态', 2, 1_000),
      desiredEndState: assertText(item.desiredEndState, '角色终局状态', 2, 1_000),
      behaviorLimits: uniqueStrings(item.behaviorLimits ?? [], '角色行为边界', 20),
      forbiddenBehaviors: uniqueStrings(item.forbiddenBehaviors ?? [], '角色禁止行为', 20),
      beats,
    };
  });
  if (!characters.some((item) => item.role === 'protagonist')) {
    throw new Error('Character Evolution Agent 必须返回至少一个主角。');
  }
  return characters;
}

export function buildWorldElements(
  targetChapterCount: number,
  proposals: WorldElementProposal[],
  createId: IdFactory,
): AutonomousWorldElement[] {
  if (!Array.isArray(proposals) || proposals.length < 3 || proposals.length > 120) {
    throw new Error('World Builder Agent 必须返回 3 到 120 个世界元素。');
  }
  const names = new Set<string>();
  return proposals
    .map((item) => {
      const name = assertText(item.name, '世界元素名称', 1, 120);
      if (names.has(name)) throw new Error(`世界元素名称重复：${name}`);
      names.add(name);
      return {
        id: createId(),
        type: item.type,
        name,
        summary: assertText(item.summary, '世界元素说明', 4, 2_000),
        firstChapter: assertInteger(
          item.firstChapter,
          '世界元素首次出现章节',
          1,
          targetChapterCount,
        ),
        dependencies: uniqueStrings(item.dependencies ?? [], '世界元素依赖', 20),
        constraints: uniqueStrings(item.constraints ?? [], '世界元素约束', 30),
      };
    })
    .sort(
      (left, right) =>
        left.firstChapter - right.firstChapter || left.name.localeCompare(right.name),
    );
}

export function buildConflicts(
  targetChapterCount: number,
  proposals: ConflictProposal[],
  createId: IdFactory,
): AutonomousConflictThread[] {
  if (!Array.isArray(proposals) || proposals.length < 2 || proposals.length > 40) {
    throw new Error('Conflict Generator Agent 必须返回 2 到 40 条冲突线程。');
  }
  const titles = new Set<string>();
  return proposals.map((item) => {
    const title = assertText(item.title, '冲突标题', 1, 120);
    if (titles.has(title)) throw new Error(`冲突标题重复：${title}`);
    titles.add(title);
    const introducedChapter = assertInteger(
      item.introducedChapter,
      '冲突引入章节',
      1,
      targetChapterCount,
    );
    const climaxChapter = assertInteger(
      item.climaxChapter,
      '冲突高潮章节',
      introducedChapter,
      targetChapterCount,
    );
    const resolutionChapter = assertInteger(
      item.resolutionChapter,
      '冲突解决章节',
      climaxChapter,
      targetChapterCount,
    );
    const escalationChapters = [
      ...new Set(
        (item.escalationChapters ?? []).map((chapter) =>
          assertInteger(chapter, '冲突升级章节', introducedChapter, climaxChapter),
        ),
      ),
    ].sort((left, right) => left - right);
    if (escalationChapters.length === 0) throw new Error(`${title} 至少需要一个升级节点。`);
    return {
      id: createId(),
      title,
      type: item.type,
      participants: uniqueStrings(item.participants ?? [], '冲突参与者', 20),
      stakes: assertText(item.stakes, '冲突代价', 4, 1_000),
      summary: assertText(item.summary, '冲突说明', 4, 1_000),
      introducedChapter,
      escalationChapters,
      climaxChapter,
      resolutionChapter,
    };
  });
}

function pacingRatios(mode: PacingMode): { dialogue: number; description: number } {
  if (mode === 'pressure' || mode === 'climax') return { dialogue: 0.4, description: 0.25 };
  if (mode === 'recovery' || mode === 'resolution') return { dialogue: 0.3, description: 0.45 };
  return { dialogue: 0.35, description: 0.35 };
}

export function buildPacing(
  arcs: AutonomousStoryArc[],
  proposals: PacingPhaseProposal[],
  createId: IdFactory,
): { phases: AutonomousPacingPhase[]; curve: AutonomousPacingPoint[] } {
  if (proposals.length !== arcs.length) {
    throw new Error(`Pacing Controller Agent 必须返回 ${arcs.length} 个节奏阶段。`);
  }
  const phases = proposals.map((item, index): AutonomousPacingPhase => ({
    id: createId(),
    title: assertText(item.title, '节奏阶段标题', 1, 120),
    chapterStart: arcs[index].chapterStart,
    chapterEnd: arcs[index].chapterEnd,
    mode: item.mode,
    tensionStart: assertRatio(item.tensionStart, '阶段起始张力'),
    tensionEnd: assertRatio(item.tensionEnd, '阶段结束张力'),
    purpose: assertText(item.purpose, '节奏阶段目的', 4, 1_000),
  }));
  const curve = phases.flatMap((phase): AutonomousPacingPoint[] => {
    const span = Math.max(1, phase.chapterEnd - phase.chapterStart);
    const ratios = pacingRatios(phase.mode);
    return Array.from({ length: phase.chapterEnd - phase.chapterStart + 1 }, (_, offset) => {
      const chapterNumber = phase.chapterStart + offset;
      const progress = offset / span;
      const tension = Math.round(
        phase.tensionStart + (phase.tensionEnd - phase.tensionStart) * progress,
      );
      return {
        chapterNumber,
        phaseId: phase.id,
        mode: phase.mode,
        tension,
        dialogueRatio: ratios.dialogue,
        descriptionRatio: ratios.description,
        cliffhanger: chapterNumber === phase.chapterEnd || tension >= 80 || chapterNumber % 5 === 0,
      };
    });
  });
  return { phases, curve };
}

function resolveNamedIds<T extends { id: string }>(
  names: string[] | undefined,
  items: T[],
  getName: (item: T) => string,
): string[] {
  const lookup = new Map(items.map((item) => [getName(item), item.id]));
  return normalizeNameList(names)
    .map((name) => lookup.get(name))
    .filter((id): id is string => Boolean(id));
}

export function buildChapterBatch(input: {
  brief: AutonomousStoryBrief;
  volume: AutonomousVolumePlan;
  arcs: AutonomousStoryArc[];
  characters: AutonomousCharacterPlan[];
  worldElements: AutonomousWorldElement[];
  conflicts: AutonomousConflictThread[];
  pacingCurve: AutonomousPacingPoint[];
  proposals: ChapterProposal[];
  createId: IdFactory;
}): AutonomousChapterPlan[] {
  const expectedNumbers = Array.from(
    { length: input.volume.chapterEnd - input.volume.chapterStart + 1 },
    (_, index) => input.volume.chapterStart + index,
  );
  if (input.proposals.length !== expectedNumbers.length) {
    throw new Error(`${input.volume.title} 必须返回 ${expectedNumbers.length} 个章节计划。`);
  }
  const proposalNumbers = input.proposals.map((item) => item.chapterNumber);
  if (proposalNumbers.some((value, index) => value !== expectedNumbers[index])) {
    throw new Error(`${input.volume.title} 的章节编号必须连续且与分卷范围一致。`);
  }

  const protagonists = input.characters
    .filter((item) => item.role === 'protagonist')
    .map((item) => item.id);
  return input.proposals.map((proposal): AutonomousChapterPlan => {
    const chapterNumber = proposal.chapterNumber;
    const arc = input.arcs.find(
      (item) => chapterNumber >= item.chapterStart && chapterNumber <= item.chapterEnd,
    );
    const pacing = input.pacingCurve.find((item) => item.chapterNumber === chapterNumber);
    if (!arc || !pacing) throw new Error(`第 ${chapterNumber} 章缺少故事弧或节奏点。`);

    const activeConflicts = input.conflicts.filter(
      (item) => chapterNumber >= item.introducedChapter && chapterNumber <= item.resolutionChapter,
    );
    const namedConflictIds = resolveNamedIds(
      proposal.conflictTitles,
      input.conflicts,
      (item) => item.title,
    );
    const conflictThreadIds = [
      ...new Set([
        ...namedConflictIds,
        ...activeConflicts
          .filter(
            (item) =>
              item.introducedChapter === chapterNumber ||
              item.escalationChapters.includes(chapterNumber) ||
              item.climaxChapter === chapterNumber ||
              item.resolutionChapter === chapterNumber,
          )
          .map((item) => item.id),
      ]),
    ];
    if (conflictThreadIds.length === 0 && activeConflicts[0])
      conflictThreadIds.push(activeConflicts[0].id);

    const characterBeatIds = input.characters.flatMap((character) =>
      character.beats.filter((beat) => beat.chapterNumber === chapterNumber).map((beat) => beat.id),
    );
    const participantNames = activeConflicts
      .filter((conflict) => conflictThreadIds.includes(conflict.id))
      .flatMap((conflict) => conflict.participants);
    const characterIds = [
      ...new Set([
        ...protagonists,
        ...resolveNamedIds(proposal.focusCharacters, input.characters, (item) => item.name),
        ...resolveNamedIds(participantNames, input.characters, (item) => item.name),
        ...input.characters
          .filter((character) => character.beats.some((beat) => characterBeatIds.includes(beat.id)))
          .map((character) => character.id),
      ]),
    ].slice(0, 8);

    const introducedWorld = input.worldElements.filter(
      (item) => item.firstChapter === chapterNumber,
    );
    const worldElementIds = [
      ...new Set([
        ...resolveNamedIds(proposal.worldElementNames, input.worldElements, (item) => item.name),
        ...introducedWorld.map((item) => item.id),
      ]),
    ];

    return {
      id: input.createId(),
      chapterNumber,
      volumeId: input.volume.id,
      arcId: arc.id,
      title: assertText(proposal.title, '章节标题', 1, 120),
      outline: assertText(proposal.outline, '章节大纲', 20, 3_000),
      goal: assertText(proposal.goal, '章节目标', 4, 1_000),
      targetWordCount: input.brief.targetWordsPerChapter,
      pacingMode: pacing.mode,
      tension: pacing.tension,
      endingHook: assertText(proposal.endingHook, '章节钩子', 2, 1_000),
      conflictThreadIds,
      characterIds,
      characterBeatIds,
      worldElementIds,
      status: 'planned',
    };
  });
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label}存在重复身份。`);
}

export function validateCompletePlan(plan: AutonomousStoryPlan): void {
  const brief = validateStoryBrief(plan.brief);
  if (plan.planningMode === 'continuation' && !plan.baseline) {
    throw new Error('Continuation plans require a baseline snapshot.');
  }
  if (!plan.storyBible) throw new Error('自主创作计划缺少故事圣经。');
  if (plan.status !== 'ready' && plan.status !== 'applied')
    throw new Error('自主创作计划尚未完成。');
  if (plan.stage !== 'ready' && plan.stage !== 'applied') throw new Error('自主创作计划阶段无效。');
  const chapterStart =
    plan.planningMode === 'continuation'
      ? Math.max(
          0,
          ...(plan.baseline?.existingChapters ?? []).map((chapter) => chapter.chapterNumber),
        ) + 1
      : 1;
  const plannedChapterCount = brief.targetChapterCount - chapterStart + 1;
  if (
    plannedChapterCount < 1 ||
    plan.chapters.length !== plannedChapterCount ||
    plan.pacingCurve.length !== plannedChapterCount
  ) {
    throw new Error('章节计划或节奏曲线数量与目标章节数不一致。');
  }
  const expectedNumbers = Array.from(
    { length: plannedChapterCount },
    (_, index) => chapterStart + index,
  );
  if (plan.chapters.some((item, index) => item.chapterNumber !== expectedNumbers[index])) {
    throw new Error(`章节编号必须从 ${chapterStart} 开始连续递增。`);
  }
  if (plan.pacingCurve.some((item, index) => item.chapterNumber !== expectedNumbers[index])) {
    throw new Error('节奏曲线必须覆盖每一个章节。');
  }

  assertUnique(
    plan.arcs.map((item) => item.id),
    '故事弧',
  );
  assertUnique(
    plan.volumes.map((item) => item.id),
    '分卷',
  );
  assertUnique(
    plan.chapters.map((item) => item.id),
    '章节',
  );
  assertUnique(
    plan.characters.map((item) => item.id),
    '角色',
  );
  assertUnique(
    plan.worldElements.map((item) => item.id),
    '世界元素',
  );
  assertUnique(
    plan.conflicts.map((item) => item.id),
    '冲突线程',
  );

  const volumeIds = new Set([
    ...plan.volumes.map((item) => item.id),
    ...(plan.planningMode === 'continuation'
      ? (plan.baseline?.existingVolumes ?? []).map((volume) => volume.id)
      : []),
  ]);
  const arcIds = new Set(plan.arcs.map((item) => item.id));
  const characterIds = new Set(plan.characters.map((item) => item.id));
  const beatIds = new Set(plan.characters.flatMap((item) => item.beats.map((beat) => beat.id)));
  const worldIds = new Set(plan.worldElements.map((item) => item.id));
  const conflictIds = new Set(plan.conflicts.map((item) => item.id));
  for (const chapter of plan.chapters) {
    if (!volumeIds.has(chapter.volumeId) || !arcIds.has(chapter.arcId)) {
      throw new Error(`第 ${chapter.chapterNumber} 章引用了不存在的分卷或故事弧。`);
    }
    if (
      chapter.characterIds.some((id) => !characterIds.has(id)) ||
      chapter.characterBeatIds.some((id) => !beatIds.has(id)) ||
      chapter.worldElementIds.some((id) => !worldIds.has(id)) ||
      chapter.conflictThreadIds.some((id) => !conflictIds.has(id))
    ) {
      throw new Error(`第 ${chapter.chapterNumber} 章包含无效的自主创作引用。`);
    }
  }

  const serialized = JSON.stringify(plan);
  if (serialized.length > MAX_PLAN_JSON_LENGTH) throw new Error('自主创作计划超过 2MB 安全上限。');
}
