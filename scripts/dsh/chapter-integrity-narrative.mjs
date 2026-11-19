// Shared finite integrity rules; no model calls, side effects or semantic proof.
import {
  significantText,
  SENTENCE_SEPARATOR,
  boundaryNarration,
} from './chapter-integrity-boundary.mjs';
const MAX_TAIL_POLLUTION_CHARS = 16;
const VALID_STORY_ENDING = /[。！？!?…][”’」』）》）】"']*$/u;
const STORY_TERMINAL = /[。！？!?…]/u;
const META_LEAKAGE_WINDOW_CHARS = 1_200;
const META_LEAKAGE_WINDOW_STEP_CHARS = 600;
const EXPLICIT_REASONING_TAG = /<\/?(?:analysis|reasoning|think)>/iu;
const EXPLICIT_MODEL_META =
  /(?:^|[\r\n]\s*)(?:(?:以下|下面)(?:是|为).{0,12}(?:最终)?(?:章节)?正文|(?:最终)?(?:章节)?正文(?:如下)?[：:]|(?:字数|字符数)(?:统计|核对)?[：:]|(?:here (?:is|are)|below is) (?:the )?(?:final )?(?:chapter|prose|story|output)\b)/imu;
const ENGLISH_SELF_REVISION =
  /(?:^|[.!?]\s+|\n\s*)(?:wait\b|need(?:\s+to)?\s+(?:continue|cut|ensure|fix|keep|preserve|remove|replace|revise|rewrite|write)\b|we\s+(?:need|must|should)\b|let['’]?s\s+(?:continue|craft|cut|produce|remove|replace|revise|rewrite|write)\b|better\s+(?:cut|end|ending|remove|replace|revise|rewrite|to\b))/giu;
const ENGLISH_WRITING_META =
  /\b(?:asset|chapter|character count|constraint|dialogue ratio|draft|ending|final|hook|outline|output|paragraph|plot|prompt|prose|scene|story|typo|word count)\b/iu;
const ENGLISH_OUTPUT_INSTRUCTION =
  /(?:^|[.!?]\s+|\n\s*)(?:(?:do not|don['’]?t|must not|only)\s+(?:include|output|return|write)|(?:final|target)\s+(?:answer|output)|(?:keep|make)\s+(?:it|the (?:chapter|output|prose))\s+(?:under|within))\b/giu;
const CHINESE_DIRECTIVE =
  /(?:^|[\n，,。！？!?；;：:]\s*)(?:另外|不过|但|同时|因此|注意[：:]?)?\s*(?:必须|不得|不能|不要|只(?:能|需|要)|需要|应当|应该|确保|保持|避免|禁止|严格(?:按照|遵循|控制)|重新(?:组织|输出|改写|写|来)|先(?:删掉|删除|改写|修正|重写))/gu;
const CHINESE_REVISION =
  /(?:^|[\n，,。！？!?；;]\s*)(?:等等|不对|这样不行|这里(?:不能|需要)|改成|删掉|重来)/gu;
const CHINESE_WRITING_META =
  /(?:本章|当前章节|章节正文|正文|原稿|草稿|输出|回答|回复|字数|篇幅|大纲|提示词|用户要求|系统指令|写作要求|冻结资产|章末钩子|对话比例|新设定|新角色|新秘密)/gu;
const CHINESE_OUTPUT_INSTRUCTION =
  /(?:(?:只|仅)(?:输出|返回).{0,24}(?:正文|章节|文本|结果)|(?:不要|不得)(?:输出|返回).{0,24}(?:解释|标题|列表|Markdown|JSON|思考过程))/gu;
const AUDIT_UNCERTAINTY =
  /(?:(?:不能|无法|尚不能|并不能|不足以|尚不足以)(?:直接|据此)?(?:证明|确认|断定|认定|排除)|(?:证据|记录|信息|线索)(?:仍|尚|还)?(?:不足|不充分|不完整|未闭合)|(?:结论|事实)(?:仍|尚)?(?:待|有待|尚待)(?:核实|确认|验证|复核))/gu;
const AUDIT_STATUS =
  /(?:(?:待|有待|尚待|已经|已|尚未|未)(?:进一步)?(?:核实|确认|验证|复核)|(?:核实|确认|验证|复核)(?:中|完成|完毕|结果|状态))/gu;
const AUDIT_EDITORIAL =
  /(?:(?:这|这点|这一点|上述(?:事实|信息|记录|线索)?)(?:仍|也)?(?:只能|不足以|并不能).{0,8}(?:说明|证明|确认)|(?:因此|据此|由此)(?:仍|也)?(?:不能|无法|尚不能|可以|可).{0,8}(?:证明|确认|断定|认定|排除)|(?:现阶段|目前)(?:仍|也)?(?:只能|无法|不能|尚不能))/gu;
const AUDIT_DISCLAIMER =
  /(?:(?:这|那|它|上述(?:事实|信息|记录|线索)?)(?:仍|也)?(?:不是|并非|不等同于)(?:证据|结论|确认|事实)|(?:没有|并未|不会|不愿|不能).{0,12}(?:下结论|得出结论|写成(?:结论|事实)|当(?:成|作)(?:证据|事实|结论)|理解成(?:事实|确认))|(?:只是|仅是)(?:判断|推测|假设|方向))/gu;
const AUDIT_SIGNAL_PATTERNS = [
  ['uncertainty', AUDIT_UNCERTAINTY],
  ['status', AUDIT_STATUS],
  ['editorial', AUDIT_EDITORIAL],
  ['disclaimer', AUDIT_DISCLAIMER],
];
const LOCAL_AUDIT_MIN_SIGNAL_SENTENCES = 4;
const LOCAL_AUDIT_MIN_STRONG_SENTENCES = 2;
const CHAPTER_AUDIT_MIN_SIGNAL_SENTENCES = 5;
const CHAPTER_AUDIT_MIN_STRONG_SENTENCES = 4;
const AUTHORIAL_CHAPTER_LABEL =
  /(?:(?:本|上|上一|前|前一|下|下一)章|第[0-9一二三四五六七八九十百零〇两]+章)(?:中|里|内|的)?(?:新闻(?:照片|配图)|照片|那(?:张|组|段|个)|这(?:张|组|段|个)|线索|情节|剧情|事件|开头|结尾|末尾|正文|内容|出现|提到|发生)/u;
const DEVICE_DIRECTORY_UNREADABLE =
  /(?:设备(?:存储)?|录音笔|存储(?:器|卡))[^。！？\n]{0,32}(?:目录|文件(?:名)?|标签)[^。！？\n]{0,16}(?:无法|不能|未能|不可)(?:读取|读出|访问|辨认)/u;
const DEVICE_DISCONNECTED =
  /(?:把|将)?(?:录音笔|设备|存储卡)[^。！？\n]{0,20}(?:数据线|接口)[^。！？\n]{0,10}(?:拔下|拔出|拔掉|断开)[^。！？\n]{0,24}(?:取出|卸下|断开)[^。！？\n]{0,8}(?:电池|电源)/u;
const DEVICE_DIRECTORY_DISCLOSED =
  /(?:(?:目录|文件)(?:名称|名)|时间标签)[^。！？\n]{0,24}(?:出现|显示|多出|写着|为)|(?:出现|显示|多出)[^。！？\n]{0,28}(?:(?:目录|文件)(?:名称|名)|时间标签)|\b(?:REC|DIR|FOLDER)[_-]?[0-9]{4,}(?:[_-][0-9]{2,})*\b/iu;
const DEVICE_SOURCE_RECOVERED =
  /(?:重新|再次)(?:接入|连接|插上|插入)|恢复(?:了)?连接|成功(?:读取|载入)|设备(?:重新)?(?:连接|上线)/u;
const ATTACHMENT_VISUAL_UNAVAILABLE =
  /附件(?:影像|图像|扫描件|原件)?[^。！？\n]{0,28}(?:现场核验|未取得|尚未取得|无法(?:查看|读取|下载)|不可(?:查看|读取|下载)|尚未开放|未开放)/u;
const ATTACHMENT_VISUAL_USED =
  /(?:(?:旧|新|现存)?(?:卷宗|附件)[^。！？\n]{0,24}(?:同一位置|第[0-9一二三四五六七八九十百零〇两]+页)[^。！？\n]{0,20}(?:压痕|钉孔|折痕|笔画|文字|图像|影像|扫描黑边|蓝痕)|(?:旧|新|现存)?附件第[0-9一二三四五六七八九十百零〇两]+页)/u;
const ATTACHMENT_VISUAL_ACQUIRED =
  /(?:(?:收到|取得|下载|获取|打开|调出)[^。！？\n]{0,18}(?:附件(?:影像|图像|扫描件|原件)|完整卷宗)|(?:附件(?:影像|图像|扫描件|原件)|完整卷宗)[^。！？\n]{0,18}(?:收到|取得|下载|获取|打开|可查))/u;
const CHARACTER_REFERENCE_WINDOW_CHARS = 3_000;
const INTERLOCUTOR_MOTHER_QUESTION =
  /[“「『"]您母亲(?:知道|来过|问过|说过|见过)[^”」』"。！？]{0,12}[吗呢]?[？?]/gu;
const TIME_AT_23 =
  /(?:23[:：][0-5][0-9]|二十三(?:点|时)(?:(?:[0-5]?[0-9])|(?:[零一二三四五六七八九十]{1,3}))分?)/u;
const EXPLICIT_TIME_DISAGREEMENT =
  /(?:(?:时间|时刻|报时|记录|说法|口径|两者|两份|目击|档案)[^。！？\n]{0,24}(?:矛盾|冲突|不一致|对不上|不相符|相悖|出入|写错|标错|误记|篡改|改写)|(?:矛盾|冲突|不一致|对不上|不相符|相悖|出入)[^。！？\n]{0,18}(?:时间|时刻|报时|记录|说法|口径)|(?:档案|记录|系统|日志|标签)[^。！？\n]{0,10}(?:却|但|而)[^。！？\n]{0,14}(?:写|记|标)|(?:却写|但记录|而记录))/u;
const QUALIFIED_NEXT_DAY_DAWN = /(?:次日|翌日|第二天|第二日|隔日)(?:的)?凌晨/gu;
const TEMPORAL_EVENT_ASSERTION =
  /(?:发生|案发|事发|起火|坍塌|爆炸|失踪|死亡|遇害|报时|时间|时刻|记录|标注|写明)[^，,；;。！？\n]{0,18}凌晨|凌晨[^，,；;。！？\n]{0,18}(?:发生|案发|事发|起火|坍塌|爆炸|失踪|死亡|遇害|报时|时间|时刻|记录|标注|写明)/u;
const TEMPORAL_HOUR_23_ASSERTION = new RegExp(
  `(?:发生|案发|事发|起火|坍塌|爆炸|失踪|死亡|遇害|报时|时间|时刻|记录|标注|写明)[^，,；;。！？\\n]{0,24}(?:${TIME_AT_23.source})|(?:${TIME_AT_23.source})[^，,；;。！？\\n]{0,24}(?:发生|案发|事发|起火|坍塌|爆炸|失踪|死亡|遇害|报时|时间|时刻|记录|标注|写明)`,
  'u',
);
const DIRECT_DAWN_HOUR_23_LABEL = new RegExp(
  `(?:凌晨(?:时间|时刻|报时)?(?:是|为|写作|标为|显示为|显示|记为|[:：])?\\s*(?:${TIME_AT_23.source})|(?:${TIME_AT_23.source})\\s*(?:被|却被)?(?:称为|写作|标为|记为)\\s*凌晨)`,
  'u',
);
const OVERNIGHT_TIME_RANGE = new RegExp(
  `(?:(?:${TIME_AT_23.source})[^。！？\\n]{0,28}(?:持续|延续|一直|直到|至|到)[^。！？\\n]{0,18}凌晨|凌晨[^。！？\\n]{0,18}(?:持续|延续|一直|直到|至|到)[^。！？\\n]{0,28}(?:${TIME_AT_23.source}))`,
  'u',
);
function matchIndexAfter(value, pattern, start) {
  const relativeIndex = value.slice(start).search(pattern);
  return relativeIndex < 0 ? -1 : start + relativeIndex;
}
function hasSourceChainBreak(candidateText) {
  const unreadableIndex = candidateText.search(DEVICE_DIRECTORY_UNREADABLE);
  if (unreadableIndex >= 0) {
    const disconnectedIndex = matchIndexAfter(candidateText, DEVICE_DISCONNECTED, unreadableIndex);
    if (disconnectedIndex >= 0) {
      const disclosedIndex = matchIndexAfter(
        candidateText,
        DEVICE_DIRECTORY_DISCLOSED,
        disconnectedIndex,
      );
      if (
        disclosedIndex >= 0 &&
        !DEVICE_SOURCE_RECOVERED.test(candidateText.slice(disconnectedIndex, disclosedIndex))
      ) {
        return true;
      }
    }
  }
  const unavailableIndex = candidateText.search(ATTACHMENT_VISUAL_UNAVAILABLE);
  if (unavailableIndex < 0) return false;
  const visualUseIndex = matchIndexAfter(candidateText, ATTACHMENT_VISUAL_USED, unavailableIndex);
  return (
    visualUseIndex >= 0 &&
    !ATTACHMENT_VISUAL_ACQUIRED.test(candidateText.slice(unavailableIndex, visualUseIndex))
  );
}
function hasCharacterReferenceBreak(candidateText) {
  for (const match of candidateText.matchAll(INTERLOCUTOR_MOTHER_QUESTION)) {
    const questionIndex = match.index ?? 0;
    const contextStart = Math.max(0, questionIndex - CHARACTER_REFERENCE_WINDOW_CHARS);
    const precedingContext = candidateText.slice(contextStart, questionIndex);
    const protagonistMotherIndex = Math.max(
      precedingContext.lastIndexOf('你母亲'),
      precedingContext.lastIndexOf('你妈妈'),
    );
    if (protagonistMotherIndex < 0 || !/老人/u.test(precedingContext)) continue;
    const relationshipContext = precedingContext.slice(protagonistMotherIndex);
    if (!/(?:我母亲|我的母亲|老人(?:的)?母亲|她母亲|她的母亲)/u.test(relationshipContext)) {
      return true;
    }
  }
  return false;
}
function hasNarrowTimeLabelConflict(candidateText) {
  const normalized = candidateText.normalize('NFKC');
  const sameStatement = normalized.split(/[。！？\n]+/u).some((statement) => {
    const sameDayStatement = statement.replace(QUALIFIED_NEXT_DAY_DAWN, '');
    if (!/凌晨/u.test(sameDayStatement) || !TIME_AT_23.test(sameDayStatement)) return false;
    if (
      EXPLICIT_TIME_DISAGREEMENT.test(sameDayStatement) ||
      OVERNIGHT_TIME_RANGE.test(sameDayStatement)
    ) {
      return false;
    }
    return (
      DIRECT_DAWN_HOUR_23_LABEL.test(sameDayStatement) ||
      (TEMPORAL_EVENT_ASSERTION.test(sameDayStatement) &&
        TEMPORAL_HOUR_23_ASSERTION.test(sameDayStatement))
    );
  });
  if (sameStatement) return true;
  const crossStatement = new RegExp(
    `(?:发生|案发|事发|起火|坍塌|爆炸|失踪|死亡|遇害|报时|时间|时刻|记录|标注|写明)[^。！？\\n]{0,24}凌晨[。！？]\\s*(?:可|但|而|然而)?\\s*(?:官方|档案|记录|系统|日志|标签)[^。！？\\n]{0,32}(?:${TIME_AT_23.source})`,
    'u',
  );
  const match = normalized.match(crossStatement)?.[0] ?? '';
  return Boolean(match) && !EXPLICIT_TIME_DISAGREEMENT.test(match);
}
function hasTailPollution(candidateText) {
  const trimmed = candidateText.trim();
  if (!trimmed || VALID_STORY_ENDING.test(trimmed)) return false;
  const characters = Array.from(trimmed);
  let lastTerminalIndex = -1;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    if (STORY_TERMINAL.test(characters[index])) {
      lastTerminalIndex = index;
      break;
    }
  }
  if (lastTerminalIndex < 0) return false;
  const suffix = characters
    .slice(lastTerminalIndex + 1)
    .join('')
    .replace(/\s+/gu, '');
  return suffix.length > 0 && Array.from(suffix).length <= MAX_TAIL_POLLUTION_CHARS;
}
function localizedWindows(value) {
  const characters = Array.from(value.normalize('NFKC'));
  if (characters.length <= META_LEAKAGE_WINDOW_CHARS) return [characters.join('')];
  const windows = [];
  for (let start = 0; start < characters.length; start += META_LEAKAGE_WINDOW_STEP_CHARS) {
    windows.push(characters.slice(start, start + META_LEAKAGE_WINDOW_CHARS).join(''));
    if (start + META_LEAKAGE_WINDOW_CHARS >= characters.length) break;
  }
  return windows;
}
function matchCount(value, pattern) {
  return value.match(pattern)?.length ?? 0;
}
function hasEnglishMetaReasoning(window) {
  const revisionMatches = [...window.matchAll(ENGLISH_SELF_REVISION)];
  if (revisionMatches.length >= 3) {
    for (let index = 0; index <= revisionMatches.length - 3; index += 1) {
      const start = revisionMatches[index].index ?? 0;
      const endMatch = revisionMatches[index + 2];
      const end = (endMatch.index ?? start) + endMatch[0].length;
      if (ENGLISH_WRITING_META.test(window.slice(start, end + 240))) return true;
    }
  }
  return matchCount(window, ENGLISH_OUTPUT_INSTRUCTION) >= 2 && ENGLISH_WRITING_META.test(window);
}
function hasChineseInternalConstraints(window) {
  const directiveCount = matchCount(window, CHINESE_DIRECTIVE);
  const metaAnchorCount = matchCount(window, CHINESE_WRITING_META);
  const outputInstructionCount = matchCount(window, CHINESE_OUTPUT_INSTRUCTION);
  if (metaAnchorCount < 2) return false;
  return (
    outputInstructionCount >= 2 ||
    directiveCount >= 3 ||
    (directiveCount >= 2 && matchCount(window, CHINESE_REVISION) >= 1)
  );
}
function auditSentenceSignals(value) {
  return value
    .split(SENTENCE_SEPARATOR)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .flatMap((sentence) => {
      const kinds = new Set();
      for (const [kind, pattern] of AUDIT_SIGNAL_PATTERNS) {
        if (matchCount(sentence, pattern) > 0) kinds.add(kind);
      }
      return kinds.size > 0 ? [{ kinds }] : [];
    });
}
function auditSignalStats(value) {
  const signals = auditSentenceSignals(value);
  const activeKinds = new Set(signals.flatMap(({ kinds }) => [...kinds]));
  const strongSentenceCount = signals.filter(
    ({ kinds }) => kinds.has('uncertainty') || kinds.has('editorial') || kinds.has('disclaimer'),
  ).length;
  return {
    activeSignalKinds: activeKinds.size,
    signalSentenceCount: signals.length,
    strongSentenceCount,
  };
}
function hasAuditVoiceLeakage(window) {
  const { activeSignalKinds, signalSentenceCount, strongSentenceCount } = auditSignalStats(window);
  return (
    activeSignalKinds >= 2 &&
    signalSentenceCount >= LOCAL_AUDIT_MIN_SIGNAL_SENTENCES &&
    strongSentenceCount >= LOCAL_AUDIT_MIN_STRONG_SENTENCES
  );
}
function hasChapterWideAuditVoiceLeakage(candidateText) {
  const { signalSentenceCount, strongSentenceCount } = auditSignalStats(candidateText);
  const significantLength = Math.max(1, significantText(candidateText).length);
  return (
    signalSentenceCount >= CHAPTER_AUDIT_MIN_SIGNAL_SENTENCES &&
    strongSentenceCount >= CHAPTER_AUDIT_MIN_STRONG_SENTENCES &&
    (signalSentenceCount * 1_000) / significantLength >= 1.25
  );
}
function hasMetaReasoningLeakage(candidateText) {
  if (EXPLICIT_REASONING_TAG.test(candidateText) || EXPLICIT_MODEL_META.test(candidateText)) {
    return true;
  }
  return localizedWindows(candidateText).some(
    (window) => hasEnglishMetaReasoning(window) || hasChineseInternalConstraints(window),
  );
}
function hasClusteredAuditVoiceLeakage(candidateText) {
  const narrativeText = boundaryNarration(candidateText);
  return (
    localizedWindows(narrativeText).some(hasAuditVoiceLeakage) ||
    hasChapterWideAuditVoiceLeakage(narrativeText)
  );
}
export {
  AUTHORIAL_CHAPTER_LABEL,
  hasTailPollution,
  hasMetaReasoningLeakage,
  hasSourceChainBreak,
  hasCharacterReferenceBreak,
  hasNarrowTimeLabelConflict,
  hasClusteredAuditVoiceLeakage,
};
