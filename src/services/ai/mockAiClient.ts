/**
 * AI Novel Studio - Mock AI Client (v1.0.21 增强版)
 * 根据系统提示词自动检测任务类型，返回对应的模拟数据
 */
import type {
  AiGenerateOptions,
  AiGenerateRequest,
  AiGenerateResponse,
  AiClient,
} from '../../types/ai';
import { AiRequestCancelledError, throwIfAiRequestCancelled } from './aiCancellation';
import { emitAiStreamEvent } from './aiStreamProtocol';
import { createProviderTransportRequestId } from './providerRequestPolicy';

const E2E_MODE = import.meta.env?.VITE_AI_NOVEL_STUDIO_E2E === '1';
const E2E_TOKEN_INPUT = 320;
const E2E_TOKEN_OUTPUT = 640;

export interface E2eMockAiGateState {
  paused: boolean;
  waitingRequests: number;
  requestCount: number;
}

let e2eGatePaused = false;
let e2eRequestCount = 0;
const e2eGateWaiters = new Set<() => void>();

function requireE2eMockGate(): void {
  if (!E2E_MODE) throw new Error('Mock AI gate is available only in E2E mode');
}

export function getMockAiGateStateForE2e(): E2eMockAiGateState {
  requireE2eMockGate();
  return {
    paused: e2eGatePaused,
    waitingRequests: e2eGateWaiters.size,
    requestCount: e2eRequestCount,
  };
}

export function pauseMockAiForE2e(): E2eMockAiGateState {
  requireE2eMockGate();
  e2eGatePaused = true;
  return getMockAiGateStateForE2e();
}

export function advanceMockAiForE2e(): E2eMockAiGateState {
  requireE2eMockGate();
  e2eGatePaused = true;
  const waiters = [...e2eGateWaiters];
  e2eGateWaiters.clear();
  waiters.forEach((resolve) => resolve());
  return getMockAiGateStateForE2e();
}

export function releaseMockAiForE2e(): E2eMockAiGateState {
  requireE2eMockGate();
  e2eGatePaused = false;
  const waiters = [...e2eGateWaiters];
  e2eGateWaiters.clear();
  waiters.forEach((resolve) => resolve());
  return getMockAiGateStateForE2e();
}

async function waitForMockAiGateForE2e(signal?: AbortSignal): Promise<void> {
  throwIfAiRequestCancelled(signal);
  if (!E2E_MODE) return;
  e2eRequestCount += 1;
  if (!e2eGatePaused) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const release = () => settle();
    const onAbort = () => settle(new AiRequestCancelledError());
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      e2eGateWaiters.delete(release);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    e2eGateWaiters.add(release);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function countWords(text: string): number {
  const cleaned = text.replace(/[#*\-`>\s]+/g, ' ').trim();
  if (!cleaned) return 0;
  const cjk = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const words = (cleaned.match(/[a-zA-Z0-9]+/g) || []).length;
  return cjk + words;
}

function delay(ms?: number, signal?: AbortSignal): Promise<void> {
  throwIfAiRequestCancelled(signal);
  const duration = ms ?? (E2E_MODE ? 20 : 800 + Math.random() * 1200);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(new AiRequestCancelledError());
    const timer = setTimeout(() => finish(), duration);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/** 从系统提示词中检测任务类型 */
type MockTaskType =
  | 'chapter_generate'
  | 'chapter_beat_repair'
  | 'character_generate'
  | 'event_suggest'
  | 'setting_expand'
  | 'setting_suggestion_generate'
  | 'quality_check'
  | 'chapter_polish'
  | 'chapter_scene_plan_generate'
  | 'connection_test'
  | 'context_summarize'
  | 'outline_generate'
  | 'volume_outline_generate'
  | 'chapter_outline_generate'
  | 'style_analyze'
  | 'multi_agent_review'
  | 'multi_agent_revision'
  | 'autonomous_plot_plan'
  | 'autonomous_character_evolution'
  | 'autonomous_world_build'
  | 'autonomous_conflict_generate'
  | 'autonomous_pacing_control'
  | 'autonomous_chapter_batch'
  | 'unknown';

function detectTaskType(messages: { role: string; content: string }[]): MockTaskType {
  const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
  // 连接测试（英文）
  if (
    systemMsg.includes('Reply with "OK" only') ||
    systemMsg === 'You are an AI assistant. Reply with "OK" only.'
  ) {
    return 'connection_test';
  }
  if (systemMsg.includes('小说创作顾问') && systemMsg.includes('角色')) return 'character_generate';
  if (systemMsg.includes('剧情策划') || systemMsg.includes('关键事件')) return 'event_suggest';
  if (systemMsg.includes('设定库 AI 推演') || systemMsg.includes('生成类型：'))
    return 'setting_suggestion_generate';
  if (systemMsg.includes('世界观构建') || systemMsg.includes('设定补充')) return 'setting_expand';
  if (systemMsg.includes('编辑和质量审查') || systemMsg.includes('质量检查'))
    return 'quality_check';
  if (systemMsg.includes('文字编辑') || systemMsg.includes('润色')) return 'chapter_polish';
  if (
    systemMsg.includes('小说作家') ||
    systemMsg.includes('小说正文') ||
    systemMsg.includes('修稿编辑') ||
    systemMsg.includes('偏离大纲')
  )
    return 'chapter_generate';
  return 'unknown';
}

/** 提取提示词中的关键信息 */
function extractInfo(messages: { role: string; content: string }[]) {
  const allText = messages.map((m) => m.content).join('\n');
  const novelTitle = allText.match(/作品：《(.+?)》/)?.[1] || '未命名作品';
  const protagonist = allText.match(/主角：(.+)/)?.[1] || '主角';
  const chapterTitle =
    allText.match(/完整性修复《(.+?)》正文/)?.[1] ||
    allText.match(/^当前章节[：:]\s*(.+)$/m)?.[1] ||
    allText.match(/^章节[：:]\s*(.+)$/m)?.[1] ||
    '未命名章节';
  const genre = allText.match(/题材：(.+)/)?.[1];
  const targetWords = parseInt(allText.match(/目标字数：约 (\d+)/)?.[1] || '4000');
  const chapterOutline =
    allText
      .match(
        /【当前章节大纲】\s*([\s\S]+?)(?:\n\n|【章节大纲执行清单】|【本章必须直接出场角色】)/,
      )?.[1]
      ?.trim() ||
    allText
      .match(
        /(?:^|\r?\n)章节大纲[：:][ \t]*\r?\n([\s\S]+?)(?=\r?\n(?:执行清单|本章目标|本章事件)[：:]|\r?\n\r?\n---(?:\r?\n|$)|$)/,
      )?.[1]
      ?.trim() ||
    allText.match(/章节大纲[：:]([^\r\n]+)/)?.[1]?.trim();
  const outlineChecklist = allText
    .match(
      /【章节大纲执行清单】\s*([\s\S]+?)(?:\n\n|【本章必须直接出场角色】|【修正要求】|请直接输出)/,
    )?.[1]
    ?.trim();
  const userInstruction = allText
    .match(/## 本轮用户创作指令\s*([\s\S]+?)(?:\n\n---|\n\n【待修改\/润色原正文】|$)/)?.[1]
    ?.trim();
  const rewriteSource =
    allText.match(/【待修改\/润色原正文】\s*([\s\S]+)$/)?.[1]?.trim() ||
    allText.match(/## Current chapter repair draft\s*([\s\S]+?)(?=\n\n## |$)/)?.[1]?.trim() ||
    allText.match(/## 当前正文修改\s*([\s\S]+?)(?=\n\n## |$)/)?.[1]?.trim();
  const integrityIssueCodes =
    allText
      .match(/issue_codes[：:]\s*([a-z0-9_,\s-]+)/i)?.[1]
      ?.split(',')
      .map((code) => code.trim())
      .filter(Boolean) ?? [];
  return {
    novelTitle,
    protagonist,
    chapterTitle,
    genre,
    targetWords,
    chapterOutline,
    outlineChecklist,
    userInstruction,
    rewriteSource,
    integrityIssueCodes,
  };
}

function replaceMockChapterOpening(source: string, replacement: string): string {
  const paragraphs = source
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const minimumRemovedCharacters = Array.from(replacement).length;
  let removedCharacters = 0;
  let firstPreservedParagraph = 0;

  while (
    firstPreservedParagraph < paragraphs.length - 1 &&
    removedCharacters < minimumRemovedCharacters
  ) {
    removedCharacters += Array.from(paragraphs[firstPreservedParagraph]).length;
    firstPreservedParagraph += 1;
  }

  const preserved = paragraphs.slice(firstPreservedParagraph).join('\n\n');
  return preserved ? `${replacement}\n\n${preserved}` : replacement;
}

function mockChapterGenerate(info: ReturnType<typeof extractInfo>): string {
  const {
    protagonist: protag,
    chapterTitle,
    chapterOutline,
    outlineChecklist,
    targetWords,
    userInstruction,
    rewriteSource,
    integrityIssueCodes,
  } = info;
  const instructionSeed = Array.from(
    [chapterTitle, chapterOutline, userInstruction].filter(Boolean).join('|'),
  ).reduce(
    (total, character) => (Math.imul(total, 31) + (character.codePointAt(0) ?? 0)) >>> 0,
    2_166_136_261,
  );
  if (rewriteSource) {
    if (integrityIssueCodes.includes('chapter_opening_rollback')) {
      const replacementOpenings = [
        [
          `冷光沿着地面缓缓移过，${protag}在边界外停住脚步，把纷乱声响逐一分开。`,
          '近处有细微震颤持续传来，原先松散的注意力随之收紧，眼前的变化也显出清楚层次。',
          '他顺着最新出现的迹象向前，没有回到已经结束的场面，也没有让迟疑拖慢此刻的判断。',
          '周围人的反应悄然改变，新的压力从沉默里浮现，迫使他接住正在发生的后果。',
        ],
        [
          `短促的回声越过空处，${protag}抬眼确认前方动静，呼吸随脚下节奏逐渐稳定。`,
          '光线在几处棱角间跳动，藏起的细节被重新照亮，人群却比刚才更加安静。',
          '他从这份异常里选定方向，随即靠近关键位置，让尚未落定的局面继续向前推进。',
          '第一道阻力很快迎面而来，旁观者的目光同时聚拢，等待他给出实际回应。',
        ],
        [
          `空气里残留着微弱的震感，${protag}越过遮挡处，先看清正在变化的轮廓。`,
          '远近声息彼此错开，紧张感没有消散，反而随着几次短暂碰撞变得更加具体。',
          '他避开来路留下的干扰，将注意力放在眼前的新动向上，并及时调整了站位。',
          '局势由这一小步发生偏移，沉默的人群开始交换眼神，迫近的压力也随之显形。',
        ],
        [
          `低沉的响动贴近四周，${protag}穿过明暗交界处，目光落在刚刚出现的变化上。`,
          '某种细小却连续的征兆正在累积，附近每一次停顿都让危险显得更为清晰。',
          '他没有重复先前的动作，而是顺着新的因果继续靠近，使自己的选择真正作用于现场。',
          '下一刻，原本维持平衡的力量骤然偏转，所有等待中的视线都被牵向同一处。',
        ],
      ];
      return replaceMockChapterOpening(
        rewriteSource,
        replacementOpenings[instructionSeed % replacementOpenings.length].join(''),
      );
    }
    const revisionLeads = [
      `风声贴着墙根缓慢游走，${protag}没有立刻动作，只让压在胸口的情绪一点点沉入呼吸。`,
      `四周的声音仿佛被拉远了，${protag}在短暂的停顿里重新看清眼前每一道细微变化。`,
      `空气比先前更沉，${protag}放慢脚步，任由尚未说出口的话在寂静中积蓄重量。`,
      `光影从${protag}脸上缓缓移过，原本急促的片刻被拉长，危险也因此显得更加清晰。`,
    ];
    const revisionAnchor = chapterOutline
      ?.replace(/\s+/g, ' ')
      .replace(/[。！？!?…]+$/u, '')
      .slice(0, 32)
      .trim();
    const anchoredLead = revisionAnchor ? `当${revisionAnchor}逐步显出后果时，` : '';
    return `${anchoredLead}${revisionLeads[instructionSeed % revisionLeads.length]}\n\n${rewriteSource}`;
  }
  const hasOutline = !!chapterOutline;
  const paragraphs: string[] = [];

  if (hasOutline && chapterOutline) {
    paragraphs.push(
      `${protag}站在窗前，望着远方的天际线。${chapterOutline.slice(0, 50)}……这一切要从那天说起。`,
    );
  } else {
    paragraphs.push(`${protag}醒来的时候，周围的一切都显得陌生而又熟悉。`);
  }

  if (outlineChecklist) {
    const checklistLines = outlineChecklist
      .split(/\r?\n/)
      .map((line) => line.replace(/^\d+[.、]\s*/, '').trim())
      .filter((line) => line.length > 4)
      .slice(0, 6);
    for (const line of checklistLines) {
      paragraphs.push(
        `${line}。这不是旁白里的计划，而是在本章现场真正发生的变化，${protag}也因此被迫继续向前。`,
      );
    }
  }

  paragraphs.push(
    `窗外是一片灰蒙蒙的天空，远处的建筑在晨雾中若隐若现。${protag}深吸一口气，空气中带着些许潮湿的味道，像是刚刚下过一场小雨。房间里很安静，只有挂钟的滴答声在不知疲倦地走着。`,
  );
  paragraphs.push(
    `"时间不多了。"${protag}低声自语。他知道今天必须做出决定，这个决定将改变所有人的命运。`,
  );
  paragraphs.push(
    `门外传来了脚步声，稳健而有力。${protag}转过身，面向那扇即将被推开的门。他整理了一下衣领，努力让自己看起来平静一些。但指尖的微微颤抖还是出卖了他内心的波澜。`,
  );
  paragraphs.push(
    `门开了。一个身影逆光站在门口，看不清面容，但那种压迫感却真真切切地传达过来。${protag}挺直了背脊，迎向那个身影。`,
  );
  paragraphs.push(`"你考虑清楚了？"那个声音低沉而沙哑，像是很久没有说过话。`);
  paragraphs.push(
    `${protag}没有立刻回答。他的目光越过对方，落在走廊尽头那扇半掩的窗户上。阳光正从那里洒进来，金色的光束中漂浮着细小的尘埃。这平凡的一幕却让他的心跳渐渐平稳下来。`,
  );
  paragraphs.push(
    `"是的，我考虑清楚了。"${protag}的声音比他预想的更加坚定，"无论结果如何，我都不会后悔。"`,
  );

  if (hasOutline && chapterOutline && chapterOutline.length > 30) {
    paragraphs.push(`对方沉默了几秒，像是在评估${protag}的决心。然后，那个身影缓缓点了点头。`);
    paragraphs.push(`"很好。那就开始吧。"`);
  }

  paragraphs.push(
    `${protag}迈出了第一步。他知道，这一步一旦迈出，就再也没有回头路了。但他没有犹豫，因为他心里清楚——这不仅仅是他的选择，更是他的使命。`,
  );
  paragraphs.push(
    `窗外的阳光越来越亮，驱散了晨雾，也驱散了${protag}心中最后一丝不确定。不管前方等待着他的是什么，他都已经做好了准备。`,
  );

  let result = paragraphs.join('\n\n');
  if (countWords(result) < targetWords) {
    const extras = [
      `日子一天天过去，${protag}逐渐适应了新的身份。他开始注意到那些以前被忽略的细节。`,
      `每到一个新的地方，他都会仔细观察周围的一切。这已经成为了一种本能。`,
      `线索并不总是显而易见的。有时候它们伪装成巧合，有时候又以意外的方式出现。`,
    ];
    for (const ex of extras) {
      if (countWords(result) >= targetWords) break;
      result += '\n\n' + ex;
    }
  }
  return result;
}

function mockChapterScenePlan(): string {
  return JSON.stringify({
    scenes: [
      {
        sceneNo: 1,
        title: '线索进入现场',
        contextCapsule: '主角刚进入当前场景，尚未确认线索来源。',
        location: '当前章节主要地点',
        characters: ['主角'],
        goal: '让主角获得一个可验证的新线索。',
        conflict: '时间压力迫使主角在信息不完整时做出选择。',
        beats: [
          { order: 1, text: '建立场景开场状态并明确当前行动目标。', required: true },
          { order: 2, text: '出现阻力，使主角必须采取具体行动。', required: true },
          { order: 3, text: '以新的线索或状态变化结束场景。', required: true },
        ],
        constraints: ['保持当前视角，不提前解释幕后真相。'],
        expectedEndState: '主角获得下一步行动依据。',
        result: '主角得到下一步行动依据。',
        transition: '转入下一场景的行动准备。',
      },
    ],
  });
}

function mockCharacterGenerate(_info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    characters: [
      {
        name: '路明非',
        roleType: 'protagonist',
        identity: '卡塞尔学院学生',
        faction: '卡塞尔学院',
        relationToProtagonist: '本人',
        goal: '存活并保护同伴',
        personality: '内向自卑，关键时刻勇敢',
        behaviorLimits: '不会主动伤害无辜者',
        forbiddenBehaviors: '不会背叛同伴',
        currentState: '刚接受S级身份',
        chapterFunction: '本章视角人物',
      },
      {
        name: '陈墨瞳',
        roleType: 'supporting',
        identity: '学生会主席',
        faction: '卡塞尔学院',
        relationToProtagonist: '前辈/导师',
        goal: '维持学生会地位',
        personality: '果断冷静，责任感强',
        behaviorLimits: '不会公开对抗校方',
        forbiddenBehaviors: '不会放弃弱者',
        currentState: '观察主角中',
        chapterFunction: '提供关键指引',
      },
      {
        name: '楚天骄',
        roleType: 'antagonist',
        identity: '龙族裔',
        faction: '龙族势力',
        relationToProtagonist: '宿敌',
        goal: '复活龙王',
        personality: '高傲冷酷',
        behaviorLimits: '不会主动暴露身份',
        forbiddenBehaviors: '不会在公开场合使用龙族之力',
        currentState: '伪装潜伏',
        chapterFunction: '本章冲突源',
      },
      {
        name: '酒德麻衣',
        roleType: 'neutral',
        identity: '执行部探员',
        faction: '卡塞尔学院',
        relationToProtagonist: '潜在盟友',
        goal: '执行学院任务',
        personality: '洒脱不拘',
        behaviorLimits: '不会偏离任务目标',
        forbiddenBehaviors: '不会伤害无辜',
        currentState: '正在执行任务',
        chapterFunction: '提供情报',
      },
    ],
  });
}

function mockEventSuggest(_info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    events: [
      {
        title: '初次交锋',
        type: 'conflict',
        description: '主角首次遭遇本章对手，双方试探实力差距',
        impact: '建立本章冲突基调，引出后续对抗',
        risk: '若实力对比失衡，可能影响读者期待',
        mustHappen: false,
      },
      {
        title: '情报获取',
        type: 'reveal',
        description: '通过对话或观察获得关于主线的重要线索',
        impact: '推动主线剧情进展，揭示世界观一角',
        risk: '信息量过大可能导致伏笔暴露过早',
        mustHappen: false,
      },
      {
        title: '内部矛盾',
        type: 'emotional',
        description: '主角团队内部因意见分歧产生短暂摩擦',
        impact: '丰富人物关系层次，展示角色立场',
        risk: '分散主线注意力，需控制篇幅',
        mustHappen: false,
      },
      {
        title: '关键抉择',
        type: 'twist',
        description: '主角面临两难选择，决定本章走向',
        impact: '影响后续剧情方向，塑造角色性格',
        risk: '选择过于简单可能缺乏戏剧张力',
        mustHappen: false,
      },
    ],
  });
}

function mockSettingExpand(_info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    settings: [
      {
        name: '场景：关键地点',
        category: 'location',
        description: '本章核心事件发生地的详细设定，包括环境氛围、建筑特征、历史背景',
        usageInChapter: '作为本章主要场景，承载关键对话和冲突',
        risk: '与已设定世界背景的衔接需注意一致性',
      },
      {
        name: '势力关系',
        category: 'faction',
        description: '本章涉及的各势力间的权力格局和利益关系',
        usageInChapter: '影响角色的行为动机和决策逻辑',
        risk: '避免与已有阵营设定冲突',
      },
      {
        name: '规则补充',
        category: 'world_rules',
        description: '本章可能涉及的世界规则细节，如特殊能力的限制条件',
        usageInChapter: '制约主角在本章的行动选择',
        risk: '确保规则前后一致，不自相矛盾',
      },
    ],
  });
}

function mockQualityCheck(info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    overallScore: 78,
    summary: `本章「${info.chapterTitle}」整体质量良好，主线推进清晰，但在角色行为一致性和节奏控制上还有提升空间。共发现 5 个需要关注的问题。`,
    items: [
      {
        issueType: 'character_behavior',
        severity: 'high',
        title: '角色行为与设定不符',
        description:
          '主角在关键时刻的行为与已设定性格存在偏差，请检查本章出场角色的言行是否符合其性格设定。',
        evidence: '（原文关键片段）',
        suggestion: '回顾角色设定中的性格描述和行为限制，确保关键决策符合角色立场。',
      },
      {
        issueType: 'setting_violation',
        severity: 'medium',
        title: '可能违反能力限制',
        description: '主角使用特殊能力时，未体现应有的代价或限制。',
        evidence: '（原文关键片段）',
        suggestion: '在使用能力的关键场景中加入代价描写（疲惫、副作用等）。',
      },
      {
        issueType: 'continuity',
        severity: 'medium',
        title: '与前后文衔接需注意',
        description: '本章某些设定与前文可能存在不一致，请核实与上一章的衔接。',
        evidence: '',
        suggestion: '对比上一章总结，确认关键信息和角色状态前后一致。',
      },
      {
        issueType: 'pacing',
        severity: 'low',
        title: '中段节奏稍显急促',
        description: '章节中段的冲突解决速度较快，读者可能感到进展过于突然。',
        evidence: '',
        suggestion: '在中段增加过渡段落，让情节推进更自然。',
      },
      {
        issueType: 'language',
        severity: 'low',
        title: '部分表达重复',
        description: '同一描述方式在短距离内重复出现，建议替换用词。',
        evidence: '',
        suggestion: '使用同义词或变换句式来避免重复。',
      },
    ],
  });
}

function mockChapterSummary(info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    summaryTitle: `${info.chapterTitle}上下文`,
    summary: `本章《${info.chapterTitle}》推进了主线，并留下后续承接点。`,
    keyEvents: ['主角进入关键场景', '重要冲突被触发', '获得新的线索'],
    coreEvents: ['主角获得可继续追查的关键线索'],
    protagonistStateChange: '主角由被动应对转为主动追查。',
    importantCharacterChanges: [{ name: info.protagonist, change: '目标更明确，并决定继续追查。' }],
    characterChanges: [
      {
        characterName: info.protagonist,
        stateSummary: '经历本章事件后目标更明确。',
        relationshipChanges: '与同伴信任上升',
        goalChanges: '准备追查下一条线索',
      },
    ],
    relationshipChanges: [],
    settingChanges: ['关键场景受隐藏势力影响'],
    newLocations: ['关键线索所在的新场景'],
    newItemsOrAbilities: [],
    newForeshadows: ['关键线索背后仍有隐藏势力'],
    resolvedForeshadows: [],
    foreshadowing: ['隐藏势力仍未现身'],
    unresolvedQuestions: ['隐藏势力为何介入'],
    factsMustRemember: ['主角已经获得关键线索'],
    nextChapterHints: '下一章可以承接本章线索，继续推进调查和冲突。',
    nextChapterHook: '关键线索指向新的调查目标。',
    contextRecords: [
      {
        contextType: 'chapter_summary',
        title: `${info.chapterTitle}摘要`,
        content: `本章核心事件：${info.chapterOutline || '主线推进'}`,
        importance: 4,
      },
    ],
  });
}

function extractSuggestionType(messages: { role: string; content: string }[]): string {
  const allText = messages.map((m) => m.content).join('\n');
  return allText.match(/生成类型：(\w+)/)?.[1] || 'character';
}

function mockSettingSuggestion(messages: { role: string; content: string }[]): string {
  const type = extractSuggestionType(messages);
  if (type === 'faction') {
    return JSON.stringify({
      items: [
        {
          name: '白塔议会',
          type: '学术权力组织',
          leader: '首席星象师伊莱恩',
          goal: '垄断星辉矿脉的解释权',
          resources: '古代观测台、学徒网络、禁书库',
          allies: '北境城邦',
          enemies: '灰烬商会',
          territory: '王都白塔区',
          internal_conflict: '保守派与改革派争夺议席',
          plot_role: '能为主角提供知识，也可能隐瞒关键真相',
        },
        {
          name: '灰烬商会',
          type: '跨境贸易势力',
          leader: '无面账房',
          goal: '打开被封锁的地下航线',
          resources: '佣兵、黑市账册、走私港',
          allies: '边境矿主',
          enemies: '白塔议会',
          territory: '旧码头与南部驿路',
          internal_conflict: '利润派与复仇派互相制衡',
          plot_role: '制造经济压力与情报交换场景',
        },
      ],
    });
  }
  if (type === 'location') {
    return JSON.stringify({
      items: [
        {
          name: '镜湖旧站',
          type: '废弃中转站',
          region: '北境湖区',
          controlled_by: '名义上归王国巡防队',
          description: '半沉入湖面的旧车站，夜间会映出不存在的列车灯光',
          danger_level: '中高',
          resource: '失落航线图',
          history: '二十年前一次整车失踪事故后废弃',
          plot_trigger: '发现被抹除的乘客名单',
        },
        {
          name: '第七码头',
          type: '隐秘港口',
          region: '王都南岸',
          controlled_by: '灰烬商会',
          description: '只在退潮后开放的石拱码头，货物从水下仓库进出',
          danger_level: '高',
          resource: '禁运晶核',
          history: '曾是王室秘密补给点',
          plot_trigger: '主角可在此交换情报或遭遇伏击',
        },
      ],
    });
  }
  if (type === 'rule') {
    return JSON.stringify({
      items: [
        {
          name: '星辉誓约反噬',
          type: 'magic',
          content: '使用星辉术式时，若违背亲口许下的誓约，术式会反向抽取记忆作为代价',
          limits: '只对主动宣誓者生效',
          scope: '高阶星辉术士',
          possible_conflict: '需要避免普通角色也被误伤',
          plot_usage: '可用于制造信任与背叛的两难局面',
        },
        {
          name: '旧铁轨不可回望',
          type: 'social',
          content: '进入废弃铁路区域后，回头看见的若是已故之人，必须继续前行，否则会迷失在原地',
          limits: '仅在镜湖旧站周边生效',
          scope: '民间禁忌与超自然规则',
          possible_conflict: '不能替代正式传送体系',
          plot_usage: '适合作为悬疑章节的行动约束',
        },
      ],
    });
  }
  return JSON.stringify({
    items: [
      {
        name: '林照夜',
        identity: '流亡的星象书记官',
        faction: '白塔议会边缘派',
        personality: '谨慎、记忆力极强，但不轻易相信权威',
        goal: '找回被删改的星图原本',
        ability: '能读出旧纸张上残留的观测痕迹',
        weakness: '害怕公开审判，容易在权力面前退让',
        current_status: '被白塔除名后潜伏在镜湖旧站',
        plot_role: '提供世界规则线索并牵出白塔内部矛盾',
        mainline_relation: '可能成为主角理解星辉体系的关键协作者',
      },
      {
        name: '沈洛川',
        identity: '灰烬商会护送人',
        faction: '灰烬商会',
        personality: '寡言、务实，习惯先算风险再谈道义',
        goal: '完成一次会改写商会格局的护送',
        ability: '熟悉地下航线与黑市暗号',
        weakness: '家族债务被商会掌握',
        current_status: '正在寻找可靠的临时盟友',
        plot_role: '把主角带入势力冲突现场',
        mainline_relation: '既能协助主角，也可能因债务被迫背叛',
      },
    ],
  });
}

function mockOutlineGenerate(info: ReturnType<typeof extractInfo>): string {
  return `# ${info.novelTitle} 总大纲\n\n主线围绕${info.protagonist}的成长与关键冲突展开，分为开端、升级、反转和终局四个阶段。\n\n## 分卷规划\n1. 第一卷：建立世界规则与主角目标。\n2. 第二卷：扩大冲突，揭示敌对势力。\n3. 第三卷：回收伏笔，完成核心决战。`;
}

function mockVolumeOutline(): string {
  return JSON.stringify({
    title: '第一卷：启程',
    summary: '主角进入新的事件漩涡，逐步理解世界规则，并确立短期目标。',
    goal: '建立主角目标、核心同伴和主要敌对关系。',
    mainConflict: '主角个人选择与外部势力规则之间的冲突。',
  });
}

function mockChapterOutlines(): string {
  return JSON.stringify({
    chapters: [
      {
        title: '第一章 余波',
        outline: '主角处理上一事件的后果，并发现新的线索。',
        goal: '承接前文并开启新冲突',
        targetWordCount: 2500,
      },
      {
        title: '第二章 暗线',
        outline: '同伴提供情报，隐藏势力第一次露出痕迹。',
        goal: '抛出新的调查方向',
        targetWordCount: 2500,
      },
      {
        title: '第三章 试探',
        outline: '主角与对手进行间接交锋，确认危险等级。',
        goal: '制造冲突升级',
        targetWordCount: 2500,
      },
    ],
  });
}

function mockStyleAnalyze(): string {
  return JSON.stringify({
    name: 'Mock 风格分析',
    narrativePerspective: '第三人称有限视角',
    tone: '克制、紧凑',
    pace: 'medium',
    sentenceStyle: '中短句结合，动作与心理交替',
    dialogueRatio: 0.35,
    descriptionRatio: 0.4,
    styleSummary: '整体风格偏向紧凑叙事，注重情节推进和关键情绪节点。',
  });
}

function mockChapterPolish(
  _info: ReturnType<typeof extractInfo>,
  messages: { role: string; content: string }[],
): string {
  // 从用户消息中提取原文
  const original =
    messages.find((m) => m.role === 'system')?.content?.match(/以下是原文：\n\n([\s\S]*?)$/)?.[1] ||
    '（空正文）';

  const modeText =
    messages.find((m) => m.role === 'system')?.content?.match(/润色模式：(.+)/)?.[1] ||
    '保持剧情不变，优化表达';

  const processed = original
    .replace(/他说/g, '他低声说')
    .replace(/她说/g, '她轻声说')
    .replace(/。/g, '。\n');

  return `【润色版：${modeText}】\n\n${processed}\n\n// 润色完成。保留了核心剧情、人物关系和关键事件。`;
}

function mockMultiAgentReview(messages: { role: string; content: string }[]): string {
  const system = messages.find((message) => message.role === 'system')?.content ?? '';
  const expert = system.match(/\[MULTI_AGENT_EXPERT:([a-z]+)\]/)?.[1] ?? 'quality';
  const labels: Record<string, string> = {
    outline: '情节结构完整，主要场景能够落实章节目标。',
    character: '角色行动与动机保持一致。',
    setting: '场景和世界规则没有明显冲突。',
    logic: '因果关系与时间顺序清晰。',
    polish: '语言节奏稳定，可进入用户审核。',
    quality: '章节整体完成度达到候选稿标准。',
  };
  return JSON.stringify({
    score: 82,
    accepted: true,
    summary: labels[expert] ?? labels.quality,
    issues: [],
    suggestions: ['保留当前结构，在用户审核时重点确认章节结尾力度。'],
  });
}

function mockMultiAgentRevision(messages: { role: string; content: string }[]): string {
  const user = messages.find((message) => message.role === 'user')?.content ?? '';
  const original = user.match(/【当前草稿】\s*([\s\S]+)$/)?.[1]?.trim() || '（空正文）';
  return `${original}\n\n本轮候选稿已根据专家共识调整场景衔接与表达节奏。`;
}

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asJsonObjectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asJsonObject) : [];
}

function stringField(value: JsonObject, key: string, fallback = ''): string {
  const field = value[key];
  return typeof field === 'string' && field.trim() ? field : fallback;
}

function numberField(value: JsonObject, key: string, fallback: number): number {
  const parsed = Number(value[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function autonomousRequest(messages: { role: string; content: string }[]): JsonObject {
  const user = messages.find((message) => message.role === 'user')?.content ?? '';
  const match = user.match(/【REQUEST_JSON】\s*([\s\S]+)$/);
  if (!match) return {};
  try {
    return asJsonObject(JSON.parse(match[1]) as unknown);
  } catch {
    return {};
  }
}

function boundedChapter(value: number, total: number): number {
  return Math.max(1, Math.min(total, Math.round(value)));
}

function mockAutonomousPlot(messages: { role: string; content: string }[]): string {
  const request = autonomousRequest(messages);
  const brief = asJsonObject(request.brief);
  const shape = asJsonObject(request.shape);
  const arcCount = numberField(shape, 'arcCount', 5);
  const volumeCount = numberField(shape, 'volumeCount', 10);
  return JSON.stringify({
    storyBible: {
      title: `${stringField(brief, 'genre', '长篇')}：回声边界`,
      logline: `${stringField(brief, 'premise', '主角必须在不断升级的危机中寻找真相')}，并为最终选择付出不可逆的代价。`,
      themes: ['选择与代价', '身份与记忆', '秩序与自由'],
      protagonistPromise: '主角从被局势推动的人，成长为能够承担选择后果的行动者。',
      centralQuestion: '当真相会摧毁既有生活时，主角是否仍愿意揭开它？',
      endingVision: stringField(
        brief,
        'endingPreference',
        '核心矛盾得到回答，人物完成有代价的成长。',
      ),
      narrativeRules: [
        '每个分卷改变至少一项长期局势',
        '关键胜利必须伴随代价',
        '伏笔在跨卷后形成回收',
      ],
    },
    arcs: Array.from({ length: arcCount }, (_, index) => ({
      title: `故事弧 ${index + 1}：${['启程', '裂痕', '围困', '反击', '终局', '余波', '重构', '归途'][index] || '推进'}`,
      goal: `完成第 ${index + 1} 阶段目标，并让主角对核心真相的理解发生变化。`,
      turningPoint: `第 ${index + 1} 阶段中点出现证据反转，迫使阵营重新选择。`,
      climax: `阶段末的正面冲突暴露更高层代价。`,
      outcome: `旧问题得到局部回答，同时产生下一阶段必须处理的新后果。`,
    })),
    volumes: Array.from({ length: volumeCount }, (_, index) => ({
      title: `第 ${index + 1} 卷：${['陌生信号', '失真档案', '封锁之城', '逆向追踪', '静默同盟', '断层风暴', '真相回廊', '终极协议', '世界重启', '余波归途'][index] || `推进 ${index + 1}`}`,
      summary: `本卷推进全书第 ${index + 1} 个长期阶段，通过新的场域与证据改变人物关系和局势。`,
      goal: `解决一个阶段问题，并把核心谜题推进到第 ${index + 1} 层。`,
      mainConflict: `主角必须在时间压力、阵营阻力与个人代价之间完成本卷选择。`,
    })),
  });
}

function mockAutonomousCharacters(messages: { role: string; content: string }[]): string {
  const request = autonomousRequest(messages);
  const total = numberField(asJsonObject(request.brief), 'targetChapterCount', 300);
  const points = [1, total * 0.25, total * 0.5, total * 0.75, total];
  const cast = [
    ['林序', 'protagonist', '调查员', '寻找真相并保住自我', '过度相信可验证的证据'],
    ['苏弥', 'supporting', '记忆工程师', '修复被篡改的公共记忆', '隐瞒与主角有关的旧实验'],
    ['周策', 'antagonist', '秩序委员会执行官', '维持城市稳定', '把可控秩序置于个人生命之上'],
    ['闻夏', 'supporting', '地下档案员', '公开被删除的历史', '不信任任何正式机构'],
    ['零号', 'neutral', '失控预测模型', '验证人类能否偏离预测', '只能通过间接线索影响现实'],
  ] as const;
  return JSON.stringify({
    characters: cast.map(([name, role, identity, need, flaw], characterIndex) => ({
      name,
      role,
      identity,
      faction: role === 'antagonist' ? '秩序委员会' : '调查阵线',
      relationToProtagonist:
        role === 'protagonist' ? '本人' : role === 'antagonist' ? '理念对手' : '不稳定盟友',
      personality: characterIndex % 2 === 0 ? '克制、执着、善于观察' : '敏锐、谨慎、重视承诺',
      coreNeed: need,
      flaw,
      initialState: '只掌握局部事实，对自身处境存在错误判断。',
      desiredEndState: '能够面对完整真相，并为主动选择承担后果。',
      behaviorLimits: ['行动必须符合已知信息', '重大立场变化需要事件推动'],
      forbiddenBehaviors: ['无理由背叛核心目标', '突然获得未铺垫的能力'],
      beats: points.map((point, beatIndex) => ({
        chapterNumber: boundedChapter(point + characterIndex, total),
        stage: ['建立', '动摇', '认知反转', '主动选择', '终局兑现'][beatIndex],
        change: `${name}在第 ${beatIndex + 1} 个成长节点重新理解自己的目标与代价。`,
        relationshipShift: `与主角的信任在节点 ${beatIndex + 1} 发生可追踪变化。`,
        knowledgeGain: `获得第 ${beatIndex + 1} 层核心信息。`,
      })),
    })),
  });
}

function mockAutonomousWorld(messages: { role: string; content: string }[]): string {
  const request = autonomousRequest(messages);
  const volumes = asJsonObjectArray(request.volumes);
  const types = ['location', 'faction', 'rule', 'culture', 'technology', 'artifact'];
  const elements = volumes.flatMap((volume, index) => {
    const first = numberField(volume, 'chapterStart', index * 30 + 1);
    const volumeTitle = stringField(volume, 'title', `第 ${index + 1} 卷`);
    return [
      {
        type: types[index % types.length],
        name: `${volumeTitle}核心场域`,
        summary: '承载本卷主要行动，并通过可观察规则限制角色选择。',
        firstChapter: first,
        dependencies: index === 0 ? [] : [`第 ${index} 卷遗留后果`],
        constraints: ['首次出现必须通过行动展示', '后续使用不得改变既定规则'],
      },
      {
        type: types[(index + 2) % types.length],
        name: `${volumeTitle}关键机制`,
        summary: '为冲突升级提供资源、限制或信息差。',
        firstChapter: Math.min(numberField(volume, 'chapterEnd', first), first + 3),
        dependencies: [],
        constraints: ['能力必须有代价', '不得替代人物主动选择'],
      },
    ];
  });
  while (elements.length < 3) {
    elements.push({
      type: 'rule',
      name: `基础规则 ${elements.length + 1}`,
      summary: '约束故事世界中的因果和资源交换。',
      firstChapter: elements.length + 1,
      dependencies: [],
      constraints: ['规则不可被无代价绕过'],
    });
  }
  return JSON.stringify({ elements });
}

function mockAutonomousConflicts(messages: { role: string; content: string }[]): string {
  const request = autonomousRequest(messages);
  const total = numberField(asJsonObject(request.brief), 'targetChapterCount', 300);
  const arcs = asJsonObjectArray(request.arcs);
  const requestedNames = asJsonObjectArray(request.characters)
    .map((item) => stringField(item, 'name'))
    .filter(Boolean);
  const names = requestedNames.length > 0 ? requestedNames : ['林序', '周策'];
  const conflicts = arcs.map((arc, index) => {
    const introduced = numberField(
      arc,
      'chapterStart',
      index * Math.floor(total / Math.max(1, arcs.length)) + 1,
    );
    const resolution = numberField(arc, 'chapterEnd', Math.min(total, introduced + 50));
    const climax = Math.max(
      introduced,
      resolution - Math.max(1, Math.floor((resolution - introduced) * 0.15)),
    );
    const escalation = Math.max(
      introduced,
      Math.min(climax, introduced + Math.max(1, Math.floor((climax - introduced) * 0.55))),
    );
    return {
      title: `${stringField(arc, 'title', `故事弧 ${index + 1}`)}核心冲突`,
      type: ['mystery', 'interpersonal', 'faction', 'world', 'internal'][index % 5],
      participants: names.slice(0, Math.min(3, names.length)),
      stakes: '失败将失去关键证据、盟友或改变全局的行动窗口。',
      summary: '冲突通过信息差、立场差异和时间压力逐级升级。',
      introducedChapter: introduced,
      escalationChapters: [escalation],
      climaxChapter: climax,
      resolutionChapter: resolution,
    };
  });
  if (conflicts.length < 2) {
    conflicts.push({
      title: '自我认知冲突',
      type: 'internal',
      participants: names.slice(0, 1),
      stakes: '主角可能失去行动依据。',
      summary: '错误记忆持续影响判断。',
      introducedChapter: 1,
      escalationChapters: [boundedChapter(total * 0.5, total)],
      climaxChapter: boundedChapter(total * 0.8, total),
      resolutionChapter: total,
    });
  }
  return JSON.stringify({ conflicts });
}

function mockAutonomousPacing(messages: { role: string; content: string }[]): string {
  const request = autonomousRequest(messages);
  const arcs = asJsonObjectArray(request.arcs);
  const modes = [
    'setup',
    'build',
    'pressure',
    'climax',
    'recovery',
    'pressure',
    'climax',
    'resolution',
  ];
  return JSON.stringify({
    phases: arcs.map((arc, index) => ({
      title: `${stringField(arc, 'title', `故事弧 ${index + 1}`)}节奏阶段`,
      mode: index === arcs.length - 1 ? 'resolution' : modes[index % modes.length],
      tensionStart: Math.min(90, 25 + index * 7),
      tensionEnd: index === arcs.length - 1 ? 55 : Math.min(95, 55 + index * 7),
      purpose: '在推进主线的同时交替安排升级、兑现和必要的恢复空间。',
    })),
  });
}

function mockAutonomousChapterBatch(messages: { role: string; content: string }[]): string {
  const request = autonomousRequest(messages);
  const volume = asJsonObject(request.volume);
  const start = numberField(volume, 'chapterStart', 1);
  const end = numberField(volume, 'chapterEnd', start);
  const characters = asJsonObjectArray(request.characters);
  const conflicts = asJsonObjectArray(request.conflicts);
  const worldElements = asJsonObjectArray(request.worldElements);
  return JSON.stringify({
    chapters: Array.from({ length: end - start + 1 }, (_, offset) => {
      const chapterNumber = start + offset;
      const activeConflicts = conflicts.filter(
        (item) =>
          chapterNumber >= numberField(item, 'introducedChapter', Number.MAX_SAFE_INTEGER) &&
          chapterNumber <= numberField(item, 'resolutionChapter', Number.MIN_SAFE_INTEGER),
      );
      const introducedWorld = worldElements.filter(
        (item) => numberField(item, 'firstChapter', -1) === chapterNumber,
      );
      const focus =
        characters.length > 0
          ? [
              stringField(characters[0], 'name'),
              stringField(
                characters[(offset % Math.max(1, characters.length - 1)) + 1] ?? {},
                'name',
              ),
            ].filter(Boolean)
          : [];
      return {
        chapterNumber,
        title: `第 ${chapterNumber} 章：${offset === 0 ? '新的入口' : offset === end - start ? '阶段回响' : `线索推进 ${offset + 1}`}`,
        outline: `主角围绕${stringField(volume, 'mainConflict', '本卷核心矛盾')}采取一次具体行动，遭遇新的阻力，并让既有线索产生可验证的变化。第 ${chapterNumber} 章结束时，局势必须不同于开场。`,
        goal: `推进${stringField(activeConflicts[0] ?? {}, 'title', '当前冲突')}，完成一次人物选择并留下后续因果。`,
        endingHook: `一条与既有判断冲突的新证据在第 ${chapterNumber} 章末出现。`,
        focusCharacters: focus,
        conflictTitles: activeConflicts
          .slice(0, 2)
          .map((item) => stringField(item, 'title'))
          .filter(Boolean),
        worldElementNames: introducedWorld.map((item) => stringField(item, 'name')).filter(Boolean),
      };
    }),
  });
}

export class MockAiClient implements AiClient {
  async generate(
    request: AiGenerateRequest,
    options: AiGenerateOptions = {},
  ): Promise<AiGenerateResponse> {
    const useStream = options.stream === true || options.onStreamEvent !== undefined;
    const requestId = options.requestId?.trim() || createProviderTransportRequestId('mock-stream');
    if (useStream) emitAiStreamEvent(options.onStreamEvent, { type: 'started', requestId });
    await waitForMockAiGateForE2e(options.signal);
    await delay(undefined, options.signal);
    throwIfAiRequestCancelled(options.signal);
    const taskType =
      (request.taskType as MockTaskType | undefined) || detectTaskType(request.messages);
    const info = extractInfo(request.messages);
    let text: string;

    switch (taskType) {
      case 'connection_test':
        text = 'OK';
        break;
      case 'character_generate':
        text = mockCharacterGenerate(info);
        break;
      case 'event_suggest':
        text = mockEventSuggest(info);
        break;
      case 'setting_expand':
        text = mockSettingExpand(info);
        break;
      case 'setting_suggestion_generate':
        text = mockSettingSuggestion(request.messages);
        break;
      case 'quality_check':
        text = mockQualityCheck(info);
        break;
      case 'chapter_polish':
        text = mockChapterPolish(info, request.messages);
        break;
      case 'context_summarize':
        text = mockChapterSummary(info);
        break;
      case 'outline_generate':
        text = mockOutlineGenerate(info);
        break;
      case 'volume_outline_generate':
        text = mockVolumeOutline();
        break;
      case 'chapter_outline_generate':
        text = mockChapterOutlines();
        break;
      case 'style_analyze':
        text = mockStyleAnalyze();
        break;
      case 'multi_agent_review':
        text = mockMultiAgentReview(request.messages);
        break;
      case 'multi_agent_revision':
        text = mockMultiAgentRevision(request.messages);
        break;
      case 'autonomous_plot_plan':
        text = mockAutonomousPlot(request.messages);
        break;
      case 'autonomous_character_evolution':
        text = mockAutonomousCharacters(request.messages);
        break;
      case 'autonomous_world_build':
        text = mockAutonomousWorld(request.messages);
        break;
      case 'autonomous_conflict_generate':
        text = mockAutonomousConflicts(request.messages);
        break;
      case 'autonomous_pacing_control':
        text = mockAutonomousPacing(request.messages);
        break;
      case 'autonomous_chapter_batch':
        text = mockAutonomousChapterBatch(request.messages);
        break;
      case 'chapter_scene_plan_generate':
        text = mockChapterScenePlan();
        break;
      case 'chapter_beat_repair':
      case 'chapter_generate':
      default:
        text = mockChapterGenerate(info);
        break;
    }

    const tokenInput = E2E_MODE ? E2E_TOKEN_INPUT : Math.floor(Math.random() * 500) + 200;
    const tokenOutput = E2E_MODE ? E2E_TOKEN_OUTPUT : Math.floor(Math.random() * 1000) + 500;
    if (useStream) {
      const characters = Array.from(text);
      let sequence = 0;
      try {
        for (let offset = 0; offset < characters.length; offset += 96) {
          throwIfAiRequestCancelled(options.signal);
          const chunk = characters.slice(offset, offset + 96).join('');
          sequence += 1;
          emitAiStreamEvent(options.onStreamEvent, {
            type: 'delta',
            requestId,
            sequence,
            text: chunk,
          });
          await delay(E2E_MODE ? 0 : 20, options.signal);
        }
        emitAiStreamEvent(options.onStreamEvent, {
          type: 'usage',
          requestId,
          tokenInput,
          tokenOutput,
          tokenTotal: tokenInput + tokenOutput,
        });
        emitAiStreamEvent(options.onStreamEvent, {
          type: 'completed',
          requestId,
          finishReason: 'stop',
        });
      } catch (error) {
        emitAiStreamEvent(options.onStreamEvent, {
          type: 'error',
          requestId,
          code: 'AI_REQUEST_CANCELLED',
        });
        throw error;
      }
    }

    return {
      text,
      tokenInput,
      tokenOutput,
      tokenTotal: tokenInput + tokenOutput,
      finishReason: 'stop',
    };
  }
}
