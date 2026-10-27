import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { characterService } from '../characters/characterService';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import type { GenerateSettingSuggestionsInput } from '../../types/settingSuggestion';

export async function buildSettingSuggestionPrompt(
  input: GenerateSettingSuggestionsInput,
): Promise<string> {
  const [novel, worldSettings, ruleSystems, characters, chapters] = await Promise.all([
    novelRepository.getById(input.novelId),
    settingRepository.getWorldSettings(input.novelId),
    settingRepository.getRuleSystems(input.novelId),
    input.includeExistingAssets
      ? characterService.getByNovelId(input.novelId)
      : Promise.resolve([]),
    chapterRepository.getByNovelId(input.novelId),
  ]);
  if (!novel) throw new Error('作品不存在');
  const adopted = chapters.filter((chapter) => chapter.adoptedDraftId);
  const evidence = await Promise.all(
    adopted.slice(-20).map(async (chapter) => {
      const draft = await draftVersionService.getById(chapter.id, chapter.adoptedDraftId!);
      if (
        !draft ||
        !draft.isAdopted ||
        draft.novelId !== input.novelId ||
        draft.contentState?.status === 'unavailable'
      ) {
        throw new Error('已采用章节证据不可用，请先恢复正文，不以空上下文推演规则');
      }
      return (
        '《' +
        chapter.title +
        '》章ID=' +
        chapter.id +
        ' 采用稿=' +
        draft.id +
        ' 版本=' +
        draft.versionNo +
        '\n' +
        draft.content.slice(0, 1200) +
        (draft.content.length > 1200 ? '\n[仅摘录1200字；其余未审查，不代表一致性通过]' : '')
      );
    }),
  );

  const worldSummary = worldSettings
    .map((item) => `《${item.title}》${item.content}`)
    .join('\n')
    .slice(0, 2400);
  const ruleSummary = ruleSystems
    .filter((item) => item.isActive)
    .map(
      (item) =>
        '《' +
        item.title +
        '》来源=' +
        item.id +
        '\n规则：' +
        item.content +
        '\n禁止违背：' +
        (item.forbiddenRules || '未声明（不代表任意例外已获准）') +
        '\n结构化范围/来源：' +
        (item.structuredJson || '旧规则：未结构化，不能自动判定任意语义一致性'),
    )
    .join('\n');
  if (ruleSummary.length > 60000)
    throw new Error('权威规则超过推演上下文上限，请先整理；不会截掉禁令后继续生成');
  const characterSummary = characters
    .map(
      (item) =>
        `${item.name}${item.identity ? `（${item.identity}）` : ''}${item.faction ? ` / ${item.faction}` : ''}`,
    )
    .join('、')
    .slice(0, 1200);

  return [
    '你是 AI Novel Studio 的设定库 AI 推演助手。',
    '你的职责是生成候选设定，不能把候选当作正式正史。',
    '',
    `作品：《${novel?.title || '未命名作品'}》`,
    novel?.genre ? `题材：${novel.genre}` : '',
    novel?.description ? `简介：${novel.description}` : '',
    `生成类型：${input.suggestionType}`,
    `世界类型：${input.worldType}`,
    `参考方向：${input.referenceStyle}`,
    `生成数量：${input.count}`,
    input.userInstruction ? `用户补充要求：${input.userInstruction}` : '',
    '',
    input.includeWorldSettings && worldSummary ? `【已有世界设定摘要】\n${worldSummary}` : '',
    ruleSummary ? `【必须核对的启用规则与禁止事项】\n${ruleSummary}` : '',
    evidence.length
      ? '【已采用章节证据（不是候选）】\n' + evidence.join('\n')
      : '【采用证据】尚无已采用章节。',
    adopted.length > evidence.length
      ? `[另有${adopted.length - evidence.length}章未纳入摘录：需要作者影响审查，不得宣称无冲突]`
      : '',
    '自然语言证据不能自动证明任意语义一致性；冲突、例外和正史修改须标出证据及不确定性，等待作者决定。',
    input.includeExistingAssets && characterSummary
      ? `【已有角色/势力线索摘要】\n${characterSummary}`
      : '',
    '',
    '请参考典型题材中的世界结构、势力矛盾、种族关系、力量体系、宗教冲突、社会结构和战争格局，生成原创设定。',
    '不得直接使用任何现成作品中的专有名称、角色、地点、势力、具体剧情或可识别 IP 元素。',
    '只能借鉴类型结构，不能复制具体作品内容。',
    '输出必须为结构化 JSON，不要输出解释文字。',
    '',
    '请严格按以下 JSON 格式返回：',
    '{',
    '  "items": [',
    input.suggestionType === 'character'
      ? '    { "name": "角色姓名", "identity": "身份", "faction": "所属势力", "personality": "性格", "goal": "目标", "ability": "能力", "weakness": "弱点", "current_status": "当前状态", "plot_role": "潜在剧情作用", "mainline_relation": "与主线关系" }'
      : input.suggestionType === 'faction'
        ? '    { "name": "势力名称", "type": "势力类型", "leader": "领袖", "goal": "核心目标", "resources": "资源", "allies": "盟友", "enemies": "敌人", "territory": "控制区域", "internal_conflict": "内部矛盾", "plot_role": "剧情作用" }'
        : input.suggestionType === 'location'
          ? '    { "name": "地点名称", "type": "地点类型", "region": "所在区域", "controlled_by": "控制势力", "description": "描述", "danger_level": "危险程度", "resource": "重要资源", "history": "关键历史", "plot_trigger": "可触发剧情" }'
          : '    { "name": "规则名称", "type": "规则类型", "content": "规则内容", "limits": "限制条件", "scope": "影响范围", "possible_conflict": "可能冲突", "plot_usage": "剧情用途" }',
    '  ]',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}
