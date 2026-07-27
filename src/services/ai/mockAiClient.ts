/**
 * AI Novel Studio - Mock AI Client (v1.0.21 增强版)
 * 根据系统提示词自动检测任务类型，返回对应的模拟数据
 */
import type { AiGenerateOptions, AiGenerateRequest, AiGenerateResponse, AiClient } from '../../types/ai';
import { AiRequestCancelledError, throwIfAiRequestCancelled } from './aiCancellation';

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
  | 'chapter_rewrite'
  | 'character_generate'
  | 'event_suggest'
  | 'setting_expand'
  | 'setting_suggestion_generate'
  | 'quality_check'
  | 'chapter_polish'
  | 'chapter_summary'
  | 'continuity_check'
  | 'expert_review'
  | 'connection_test'
  | 'context_summarize'
  | 'chapter_summarize'
  | 'outline_generate'
  | 'volume_outline_generate'
  | 'chapter_outline_generate'
  | 'style_analyze'
  | 'unknown';

function detectTaskType(messages: { role: string; content: string }[]): MockTaskType {
  const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
  // 连接测试（英文）
  if (systemMsg.includes('Reply with "OK" only') || systemMsg === 'You are an AI assistant. Reply with "OK" only.') {
    return 'connection_test';
  }
  if (systemMsg.includes('小说创作顾问') && systemMsg.includes('角色')) return 'character_generate';
  if (systemMsg.includes('剧情策划') || systemMsg.includes('关键事件')) return 'event_suggest';
  if (systemMsg.includes('设定库 AI 推演') || systemMsg.includes('生成类型：')) return 'setting_suggestion_generate';
  if (systemMsg.includes('世界观构建') || systemMsg.includes('设定补充')) return 'setting_expand';
  if (systemMsg.includes('连续性审校') || systemMsg.includes('连续性检查')) return 'continuity_check';
  if (systemMsg.includes('专家评审') || (systemMsg.includes('专家') && systemMsg.includes('suggestions'))) return 'expert_review';
  if (systemMsg.includes('结构化章节总结') || systemMsg.includes('章节总结')) return 'chapter_summary';
  if (systemMsg.includes('完整重写') || systemMsg.includes('重写正文')) return 'chapter_rewrite';
  if (systemMsg.includes('小说大纲编辑') || systemMsg.includes('章节树')) return 'outline_generate';
  if (systemMsg.includes('编辑和质量审查') || systemMsg.includes('质量检查')) return 'quality_check';
  if (systemMsg.includes('文字编辑') || systemMsg.includes('润色')) return 'chapter_polish';
  if (systemMsg.includes('小说作家') || systemMsg.includes('小说正文') || systemMsg.includes('修稿编辑') || systemMsg.includes('偏离大纲')) return 'chapter_generate';
  return 'unknown';
}

/** 提取提示词中的关键信息 */
function extractInfo(messages: { role: string; content: string }[]) {
  const allText = messages.map((m) => m.content).join('\n');
  const novelTitle = allText.match(/作品：《(.+?)》/)?.[1] || '未命名作品';
  const protagonist = allText.match(/主角：(.+)/)?.[1] || '主角';
  const chapterTitle = allText.match(/当前章节：(.+)/)?.[1] || allText.match(/章节：(.+)/)?.[1] || '未命名章节';
  const genre = allText.match(/题材：(.+)/)?.[1];
  const targetWords = parseInt(allText.match(/目标字数：约 (\d+)/)?.[1] || '4000');
  const chapterOutline = allText.match(/【当前章节大纲】\s*([\s\S]+?)(?:\n\n|【章节大纲执行清单】|【本章必须直接出场角色】)/)?.[1]?.trim()
    || allText.match(/章节大纲：(.+)/)?.[1];
  const outlineChecklist = allText.match(/【章节大纲执行清单】\s*([\s\S]+?)(?:\n\n|【本章必须直接出场角色】|【修正要求】|请直接输出)/)?.[1]?.trim();
  return { novelTitle, protagonist, chapterTitle, genre, targetWords, chapterOutline, outlineChecklist };
}

function mockChapterGenerate(info: ReturnType<typeof extractInfo>): string {
  const { protagonist: protag, chapterOutline, outlineChecklist, targetWords } = info;
  const hasOutline = !!chapterOutline;
  const paragraphs: string[] = [];

  if (hasOutline && chapterOutline) {
    paragraphs.push(`${protag}站在窗前，望着远方的天际线。${chapterOutline.slice(0, 50)}……这一切要从那天说起。`);
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
      paragraphs.push(`${line}。这不是旁白里的计划，而是在本章现场真正发生的变化，${protag}也因此被迫继续向前。`);
    }
  }

  paragraphs.push(`窗外是一片灰蒙蒙的天空，远处的建筑在晨雾中若隐若现。${protag}深吸一口气，空气中带着些许潮湿的味道，像是刚刚下过一场小雨。房间里很安静，只有挂钟的滴答声在不知疲倦地走着。`);
  paragraphs.push(`"时间不多了。"${protag}低声自语。他知道今天必须做出决定，这个决定将改变所有人的命运。`);
  paragraphs.push(`门外传来了脚步声，稳健而有力。${protag}转过身，面向那扇即将被推开的门。他整理了一下衣领，努力让自己看起来平静一些。但指尖的微微颤抖还是出卖了他内心的波澜。`);
  paragraphs.push(`门开了。一个身影逆光站在门口，看不清面容，但那种压迫感却真真切切地传达过来。${protag}挺直了背脊，迎向那个身影。`);
  paragraphs.push(`"你考虑清楚了？"那个声音低沉而沙哑，像是很久没有说过话。`);
  paragraphs.push(`${protag}没有立刻回答。他的目光越过对方，落在走廊尽头那扇半掩的窗户上。阳光正从那里洒进来，金色的光束中漂浮着细小的尘埃。这平凡的一幕却让他的心跳渐渐平稳下来。`);
  paragraphs.push(`"是的，我考虑清楚了。"${protag}的声音比他预想的更加坚定，"无论结果如何，我都不会后悔。"`);

  if (hasOutline && chapterOutline && chapterOutline.length > 30) {
    paragraphs.push(`对方沉默了几秒，像是在评估${protag}的决心。然后，那个身影缓缓点了点头。`);
    paragraphs.push(`"很好。那就开始吧。"`);
  }

  paragraphs.push(`${protag}迈出了第一步。他知道，这一步一旦迈出，就再也没有回头路了。但他没有犹豫，因为他心里清楚——这不仅仅是他的选择，更是他的使命。`);
  paragraphs.push(`窗外的阳光越来越亮，驱散了晨雾，也驱散了${protag}心中最后一丝不确定。不管前方等待着他的是什么，他都已经做好了准备。`);

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

function mockCharacterGenerate(_info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    characters: [
      { name: '路明非', roleType: 'protagonist', identity: '卡塞尔学院学生', faction: '卡塞尔学院', relationToProtagonist: '本人', goal: '存活并保护同伴', personality: '内向自卑，关键时刻勇敢', behaviorLimits: '不会主动伤害无辜者', forbiddenBehaviors: '不会背叛同伴', currentState: '刚接受S级身份', chapterFunction: '本章视角人物' },
      { name: '陈墨瞳', roleType: 'supporting', identity: '学生会主席', faction: '卡塞尔学院', relationToProtagonist: '前辈/导师', goal: '维持学生会地位', personality: '果断冷静，责任感强', behaviorLimits: '不会公开对抗校方', forbiddenBehaviors: '不会放弃弱者', currentState: '观察主角中', chapterFunction: '提供关键指引' },
      { name: '楚天骄', roleType: 'antagonist', identity: '龙族裔', faction: '龙族势力', relationToProtagonist: '宿敌', goal: '复活龙王', personality: '高傲冷酷', behaviorLimits: '不会主动暴露身份', forbiddenBehaviors: '不会在公开场合使用龙族之力', currentState: '伪装潜伏', chapterFunction: '本章冲突源' },
      { name: '酒德麻衣', roleType: 'neutral', identity: '执行部探员', faction: '卡塞尔学院', relationToProtagonist: '潜在盟友', goal: '执行学院任务', personality: '洒脱不拘', behaviorLimits: '不会偏离任务目标', forbiddenBehaviors: '不会伤害无辜', currentState: '正在执行任务', chapterFunction: '提供情报' },
    ],
  });
}

function mockEventSuggest(_info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    events: [
      { title: '初次交锋', type: 'conflict', description: '主角首次遭遇本章对手，双方试探实力差距', impact: '建立本章冲突基调，引出后续对抗', risk: '若实力对比失衡，可能影响读者期待', mustHappen: false },
      { title: '情报获取', type: 'reveal', description: '通过对话或观察获得关于主线的重要线索', impact: '推动主线剧情进展，揭示世界观一角', risk: '信息量过大可能导致伏笔暴露过早', mustHappen: false },
      { title: '内部矛盾', type: 'emotional', description: '主角团队内部因意见分歧产生短暂摩擦', impact: '丰富人物关系层次，展示角色立场', risk: '分散主线注意力，需控制篇幅', mustHappen: false },
      { title: '关键抉择', type: 'twist', description: '主角面临两难选择，决定本章走向', impact: '影响后续剧情方向，塑造角色性格', risk: '选择过于简单可能缺乏戏剧张力', mustHappen: false },
    ],
  });
}

function mockSettingExpand(_info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    settings: [
      { name: '场景：关键地点', category: 'location', description: '本章核心事件发生地的详细设定，包括环境氛围、建筑特征、历史背景', usageInChapter: '作为本章主要场景，承载关键对话和冲突', risk: '与已设定世界背景的衔接需注意一致性' },
      { name: '势力关系', category: 'faction', description: '本章涉及的各势力间的权力格局和利益关系', usageInChapter: '影响角色的行为动机和决策逻辑', risk: '避免与已有阵营设定冲突' },
      { name: '规则补充', category: 'world_rules', description: '本章可能涉及的世界规则细节，如特殊能力的限制条件', usageInChapter: '制约主角在本章的行动选择', risk: '确保规则前后一致，不自相矛盾' },
    ],
  });
}

function mockQualityCheck(info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    overallScore: 78,
    summary: `本章「${info.chapterTitle}」整体质量良好，主线推进清晰，但在角色行为一致性和节奏控制上还有提升空间。共发现 5 个需要关注的问题。`,
    items: [
      { issueType: 'character_behavior', severity: 'high', title: '角色行为与设定不符', description: '主角在关键时刻的行为与已设定性格存在偏差，请检查本章出场角色的言行是否符合其性格设定。', evidence: '（原文关键片段）', suggestion: '回顾角色设定中的性格描述和行为限制，确保关键决策符合角色立场。' },
      { issueType: 'setting_violation', severity: 'medium', title: '可能违反能力限制', description: '主角使用特殊能力时，未体现应有的代价或限制。', evidence: '（原文关键片段）', suggestion: '在使用能力的关键场景中加入代价描写（疲惫、副作用等）。' },
      { issueType: 'continuity', severity: 'medium', title: '与前后文衔接需注意', description: '本章某些设定与前文可能存在不一致，请核实与上一章的衔接。', evidence: '', suggestion: '对比上一章总结，确认关键信息和角色状态前后一致。' },
      { issueType: 'pacing', severity: 'low', title: '中段节奏稍显急促', description: '章节中段的冲突解决速度较快，读者可能感到进展过于突然。', evidence: '', suggestion: '在中段增加过渡段落，让情节推进更自然。' },
      { issueType: 'language', severity: 'low', title: '部分表达重复', description: '同一描述方式在短距离内重复出现，建议替换用词。', evidence: '', suggestion: '使用同义词或变换句式来避免重复。' },
    ],
  });
}

function mockAutonomousQualityCheck(info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    overallScore: 96,
    summary: `本章「${info.chapterTitle}」通过自主质量门禁。`,
    items: [],
  });
}

function mockChapterSummary(info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    summary: `本章《${info.chapterTitle}》推进了主线，并留下后续承接点。`,
    keyEvents: ['主角进入关键场景', '重要冲突被触发', '获得新的线索'],
    characterChanges: [
      { characterName: info.protagonist, stateSummary: '经历本章事件后目标更明确。', relationshipChanges: '与同伴信任上升', goalChanges: '准备追查下一条线索' },
    ],
    relationshipChanges: [],
    newForeshadows: ['关键线索背后仍有隐藏势力'],
    resolvedForeshadows: [],
    nextChapterHints: '下一章可以承接本章线索，继续推进调查和冲突。',
    contextRecords: [
      { contextType: 'chapter_summary', title: `${info.chapterTitle}摘要`, content: `本章核心事件：${info.chapterOutline || '主线推进'}`, importance: 4 },
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
        { name: '白塔议会', type: '学术权力组织', leader: '首席星象师伊莱恩', goal: '垄断星辉矿脉的解释权', resources: '古代观测台、学徒网络、禁书库', allies: '北境城邦', enemies: '灰烬商会', territory: '王都白塔区', internal_conflict: '保守派与改革派争夺议席', plot_role: '能为主角提供知识，也可能隐瞒关键真相' },
        { name: '灰烬商会', type: '跨境贸易势力', leader: '无面账房', goal: '打开被封锁的地下航线', resources: '佣兵、黑市账册、走私港', allies: '边境矿主', enemies: '白塔议会', territory: '旧码头与南部驿路', internal_conflict: '利润派与复仇派互相制衡', plot_role: '制造经济压力与情报交换场景' },
      ],
    });
  }
  if (type === 'location') {
    return JSON.stringify({
      items: [
        { name: '镜湖旧站', type: '废弃中转站', region: '北境湖区', controlled_by: '名义上归王国巡防队', description: '半沉入湖面的旧车站，夜间会映出不存在的列车灯光', danger_level: '中高', resource: '失落航线图', history: '二十年前一次整车失踪事故后废弃', plot_trigger: '发现被抹除的乘客名单' },
        { name: '第七码头', type: '隐秘港口', region: '王都南岸', controlled_by: '灰烬商会', description: '只在退潮后开放的石拱码头，货物从水下仓库进出', danger_level: '高', resource: '禁运晶核', history: '曾是王室秘密补给点', plot_trigger: '主角可在此交换情报或遭遇伏击' },
      ],
    });
  }
  if (type === 'rule') {
    return JSON.stringify({
      items: [
        { name: '星辉誓约反噬', type: 'magic', content: '使用星辉术式时，若违背亲口许下的誓约，术式会反向抽取记忆作为代价', limits: '只对主动宣誓者生效', scope: '高阶星辉术士', possible_conflict: '需要避免普通角色也被误伤', plot_usage: '可用于制造信任与背叛的两难局面' },
        { name: '旧铁轨不可回望', type: 'social', content: '进入废弃铁路区域后，回头看见的若是已故之人，必须继续前行，否则会迷失在原地', limits: '仅在镜湖旧站周边生效', scope: '民间禁忌与超自然规则', possible_conflict: '不能替代正式传送体系', plot_usage: '适合作为悬疑章节的行动约束' },
      ],
    });
  }
  return JSON.stringify({
    items: [
      { name: '林照夜', identity: '流亡的星象书记官', faction: '白塔议会边缘派', personality: '谨慎、记忆力极强，但不轻易相信权威', goal: '找回被删改的星图原本', ability: '能读出旧纸张上残留的观测痕迹', weakness: '害怕公开审判，容易在权力面前退让', current_status: '被白塔除名后潜伏在镜湖旧站', plot_role: '提供世界规则线索并牵出白塔内部矛盾', mainline_relation: '可能成为主角理解星辉体系的关键协作者' },
      { name: '沈洛川', identity: '灰烬商会护送人', faction: '灰烬商会', personality: '寡言、务实，习惯先算风险再谈道义', goal: '完成一次会改写商会格局的护送', ability: '熟悉地下航线与黑市暗号', weakness: '家族债务被商会掌握', current_status: '正在寻找可靠的临时盟友', plot_role: '把主角带入势力冲突现场', mainline_relation: '既能协助主角，也可能因债务被迫背叛' },
    ],
  });
}

function mockOutlineGenerate(info: ReturnType<typeof extractInfo>): string {
  return `# ${info.novelTitle} 总大纲\n\n主线围绕${info.protagonist}的成长与关键冲突展开，分为开端、升级、反转和终局四个阶段。\n\n## 分卷规划\n1. 第一卷：建立世界规则与主角目标。\n2. 第二卷：扩大冲突，揭示敌对势力。\n3. 第三卷：回收伏笔，完成核心决战。`;
}

function mockAutonomousOutline(
  info: ReturnType<typeof extractInfo>,
  messages: { role: string; content: string }[],
): string {
  const combined = messages.map((message) => message.content).join('\n');
  const requested = Number(combined.match(/生成\s*(\d+)\s*章/)?.[1] ?? 3);
  const chapterCount = Math.max(1, Math.min(100, Number.isFinite(requested) ? requested : 3));
  return JSON.stringify({
    overallTheme: `${info.protagonist}在持续升级的冲突中完成选择与成长。`,
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      order: index + 1,
      title: `第${index + 1}章 ${index === 0 ? '启程' : `转折${index}`}`,
      summary: index === 0
        ? '主角进入核心事件，明确本阶段目标。'
        : `承接前章线索，推进第 ${index + 1} 个关键冲突。`,
      plotPoints: [
        '承接既有事实与人物状态',
        '推进本章核心冲突',
        '留下可供下一章承接的明确线索',
      ],
    })),
  });
}

function mockAutonomousChapterSummary(info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    plot_points: ['主角进入关键场景', '核心冲突得到推进', '新的线索被确认'],
    characters: [{ name: info.protagonist, state: '目标更加明确，准备继续追查线索' }],
    foreshadowing: ['关键线索背后仍有隐藏势力'],
    ending_state: '本章冲突暂时告一段落，下一步行动已经明确。',
  });
}

function mockContinuityCheck(): string {
  return JSON.stringify({ score: 96, issues: [] });
}

function mockExpertReview(): string {
  return JSON.stringify({
    score: 88,
    issues: [],
    suggestions: ['保持当前人物动机与因果链，下一章继续回收已建立线索。'],
  });
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
      { title: '第一章 余波', outline: '主角处理上一事件的后果，并发现新的线索。', goal: '承接前文并开启新冲突', targetWordCount: 4000 },
      { title: '第二章 暗线', outline: '同伴提供情报，隐藏势力第一次露出痕迹。', goal: '抛出新的调查方向', targetWordCount: 4000 },
      { title: '第三章 试探', outline: '主角与对手进行间接交锋，确认危险等级。', goal: '制造冲突升级', targetWordCount: 4000 },
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

function mockChapterPolish(_info: ReturnType<typeof extractInfo>, messages: { role: string; content: string }[]): string {
  // 从用户消息中提取原文
  const combined = messages.map((message) => message.content).join('\n');
  const original = combined.match(/(?:原文|以下是原文)：?\s*\n([\s\S]*?)$/)?.[1] || '（空正文）';

  const modeText = messages.find((m) => m.role === 'system')?.content?.match(/润色模式：(.+)/)?.[1] || '保持剧情不变，优化表达';

  const processed = original
    .replace(/他说/g, '他低声说')
    .replace(/她说/g, '她轻声说')
    .replace(/。/g, '。\n');

  return `【润色版：${modeText}】\n\n${processed}\n\n// 润色完成。保留了核心剧情、人物关系和关键事件。`;
}

export class MockAiClient implements AiClient {
  async generate(request: AiGenerateRequest, options: AiGenerateOptions = {}): Promise<AiGenerateResponse> {
    await waitForMockAiGateForE2e(options.signal);
    await delay(undefined, options.signal);
    throwIfAiRequestCancelled(options.signal);
    const taskType = (request.taskType as MockTaskType | undefined) || detectTaskType(request.messages);
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
        text = request.promptTemplateSource === 'autonomous/quality-check'
          ? mockAutonomousQualityCheck(info)
          : mockQualityCheck(info);
        break;
      case 'chapter_polish':
        text = mockChapterPolish(info, request.messages);
        break;
      case 'chapter_rewrite':
        text = mockChapterPolish(info, request.messages);
        break;
      case 'chapter_summary':
        text = mockAutonomousChapterSummary(info);
        break;
      case 'continuity_check':
        text = mockContinuityCheck();
        break;
      case 'expert_review':
        text = mockExpertReview();
        break;
      case 'context_summarize':
        text = mockChapterSummary(info);
        break;
      case 'chapter_summarize':
        text = mockChapterSummary(info);
        break;
      case 'outline_generate':
        text = request.promptTemplateSource === 'autonomous/outline-generate'
          ? mockAutonomousOutline(info, request.messages)
          : mockOutlineGenerate(info);
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
      case 'chapter_generate':
      default:
        text = mockChapterGenerate(info);
        break;
    }

    return {
      text,
      tokenInput: E2E_MODE ? E2E_TOKEN_INPUT : Math.floor(Math.random() * 500) + 200,
      tokenOutput: E2E_MODE ? E2E_TOKEN_OUTPUT : Math.floor(Math.random() * 1000) + 500,
    };
  }
}
