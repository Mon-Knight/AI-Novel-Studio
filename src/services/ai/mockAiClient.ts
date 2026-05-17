/**
 * AI Novel Studio - Mock AI Client (v1.0.21 增强版)
 * 根据系统提示词自动检测任务类型，返回对应的模拟数据
 */
import type { AiGenerateRequest, AiGenerateResponse, AiClient } from '../../types/ai';

function countWords(text: string): number {
  const cleaned = text.replace(/[#*\-`>\s]+/g, ' ').trim();
  if (!cleaned) return 0;
  const cjk = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const words = (cleaned.match(/[a-zA-Z0-9]+/g) || []).length;
  return cjk + words;
}

function delay(ms?: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms || (800 + Math.random() * 1200)));
}

/** 从系统提示词中检测任务类型 */
type MockTaskType = 'chapter_generate' | 'character_generate' | 'event_suggest' | 'setting_expand' | 'quality_check' | 'chapter_polish' | 'connection_test' | 'unknown';

function detectTaskType(messages: { role: string; content: string }[]): MockTaskType {
  const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
  // 连接测试（英文）
  if (systemMsg.includes('Reply with "OK" only') || systemMsg === 'You are an AI assistant. Reply with "OK" only.') {
    return 'connection_test';
  }
  if (systemMsg.includes('小说创作顾问') && systemMsg.includes('角色')) return 'character_generate';
  if (systemMsg.includes('剧情策划') || systemMsg.includes('关键事件')) return 'event_suggest';
  if (systemMsg.includes('世界观构建') || systemMsg.includes('设定补充')) return 'setting_expand';
  if (systemMsg.includes('编辑和质量审查') || systemMsg.includes('质量检查')) return 'quality_check';
  if (systemMsg.includes('文字编辑') || systemMsg.includes('润色')) return 'chapter_polish';
  if (systemMsg.includes('小说作家') || systemMsg.includes('小说正文')) return 'chapter_generate';
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
  const chapterOutline = allText.match(/章节大纲：(.+)/)?.[1];
  return { novelTitle, protagonist, chapterTitle, genre, targetWords, chapterOutline };
}

function mockChapterGenerate(info: ReturnType<typeof extractInfo>): string {
  const { protagonist: protag, chapterOutline, targetWords } = info;
  const hasOutline = !!chapterOutline;
  const paragraphs: string[] = [];

  if (hasOutline && chapterOutline) {
    paragraphs.push(`${protag}站在窗前，望着远方的天际线。${chapterOutline.slice(0, 50)}……这一切要从那天说起。`);
  } else {
    paragraphs.push(`${protag}醒来的时候，周围的一切都显得陌生而又熟悉。`);
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

function mockCharacterGenerate(info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    characters: [
      { name: '路明非', roleType: 'protagonist', identity: '卡塞尔学院学生', faction: '卡塞尔学院', relationToProtagonist: '本人', goal: '存活并保护同伴', personality: '内向自卑，关键时刻勇敢', behaviorLimits: '不会主动伤害无辜者', forbiddenBehaviors: '不会背叛同伴', currentState: '刚接受S级身份', chapterFunction: '本章视角人物' },
      { name: '陈墨瞳', roleType: 'supporting', identity: '学生会主席', faction: '卡塞尔学院', relationToProtagonist: '前辈/导师', goal: '维持学生会地位', personality: '果断冷静，责任感强', behaviorLimits: '不会公开对抗校方', forbiddenBehaviors: '不会放弃弱者', currentState: '观察主角中', chapterFunction: '提供关键指引' },
      { name: '楚天骄', roleType: 'antagonist', identity: '龙族裔', faction: '龙族势力', relationToProtagonist: '宿敌', goal: '复活龙王', personality: '高傲冷酷', behaviorLimits: '不会主动暴露身份', forbiddenBehaviors: '不会在公开场合使用龙族之力', currentState: '伪装潜伏', chapterFunction: '本章冲突源' },
      { name: '酒德麻衣', roleType: 'neutral', identity: '执行部探员', faction: '卡塞尔学院', relationToProtagonist: '潜在盟友', goal: '执行学院任务', personality: '洒脱不拘', behaviorLimits: '不会偏离任务目标', forbiddenBehaviors: '不会伤害无辜', currentState: '正在执行任务', chapterFunction: '提供情报' },
    ],
  });
}

function mockEventSuggest(info: ReturnType<typeof extractInfo>): string {
  return JSON.stringify({
    events: [
      { title: '初次交锋', type: 'conflict', description: '主角首次遭遇本章对手，双方试探实力差距', impact: '建立本章冲突基调，引出后续对抗', risk: '若实力对比失衡，可能影响读者期待', mustHappen: false },
      { title: '情报获取', type: 'reveal', description: '通过对话或观察获得关于主线的重要线索', impact: '推动主线剧情进展，揭示世界观一角', risk: '信息量过大可能导致伏笔暴露过早', mustHappen: false },
      { title: '内部矛盾', type: 'emotional', description: '主角团队内部因意见分歧产生短暂摩擦', impact: '丰富人物关系层次，展示角色立场', risk: '分散主线注意力，需控制篇幅', mustHappen: false },
      { title: '关键抉择', type: 'twist', description: '主角面临两难选择，决定本章走向', impact: '影响后续剧情方向，塑造角色性格', risk: '选择过于简单可能缺乏戏剧张力', mustHappen: false },
    ],
  });
}

function mockSettingExpand(info: ReturnType<typeof extractInfo>): string {
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

function mockChapterPolish(info: ReturnType<typeof extractInfo>, messages: { role: string; content: string }[]): string {
  // 从用户消息中提取原文
  const userMsg = messages.find((m) => m.role === 'user')?.content || '';
  const original = messages.find((m) => m.role === 'system')?.content?.match(/以下是原文：\n\n([\s\S]*?)$/)?.[1] || '（空正文）';

  const modeText = messages.find((m) => m.role === 'system')?.content?.match(/润色模式：(.+)/)?.[1] || '保持剧情不变，优化表达';

  const processed = original
    .replace(/他说/g, '他低声说')
    .replace(/她说/g, '她轻声说')
    .replace(/。/g, '。\n');

  return `【润色版：${modeText}】\n\n${processed}\n\n// 润色完成。保留了核心剧情、人物关系和关键事件。`;
}

export class MockAiClient implements AiClient {
  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    await delay();
    const taskType = detectTaskType(request.messages);
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
      case 'quality_check':
        text = mockQualityCheck(info);
        break;
      case 'chapter_polish':
        text = mockChapterPolish(info, request.messages);
        break;
      case 'chapter_generate':
      default:
        text = mockChapterGenerate(info);
        break;
    }

    return {
      text,
      tokenInput: Math.floor(Math.random() * 500) + 200,
      tokenOutput: Math.floor(Math.random() * 1000) + 500,
    };
  }
}
