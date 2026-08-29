export type ChapterCandidateIntegrityIssueCode =
  | 'chapter_opening_rollback'
  | 'chapter_boundary_sentence_repetition'
  | 'chapter_boundary_action_replay'
  | 'chapter_tail_pollution'
  | 'chapter_meta_reasoning_leakage'
  | 'chapter_authorial_label_leakage'
  | 'chapter_source_chain_break'
  | 'chapter_dialogue_reference_conflict'
  | 'chapter_temporal_semantics_conflict'
  | 'chapter_audit_voice_leakage';

export interface ChapterCandidateIntegrityIssue {
  code: ChapterCandidateIntegrityIssueCode;
  summary: string;
}

export interface InspectChapterCandidateIntegrityInput {
  candidateText: string;
  previousChapterText?: string;
}

const OPENING_MATCH_CHARS = 28;
const PREVIOUS_TAIL_ALLOWANCE_CHARS = 240;
const BOUNDARY_SENTENCE_MIN_CHARS = 16;
const BOUNDARY_SENTENCE_SCAN_COUNT = 3;
const APPROXIMATE_OPENING_CHARS = 180;
const APPROXIMATE_SENTENCE_MIN_CHARS = 8;
const APPROXIMATE_SENTENCE_MAX_CHARS = 48;
const APPROXIMATE_COMMON_MIN_CHARS = 6;
const APPROXIMATE_COMMON_MIN_CONTAINMENT = 0.45;
const APPROXIMATE_SENTENCE_MIN_BALANCE = 0.65;
const STRONG_SENTENCE_MATCH_MIN_CHARS = 18;
const STRONG_SENTENCE_MATCH_MIN_CONTAINMENT = 0.86;
const PREVIOUS_SCENE_WINDOW_RADIUS = 500;
const SCENE_NGRAM_SIZE = 3;
const SCENE_MIN_SHARED_NGRAMS = 10;
const SCENE_MIN_COVERED_CHARS = 24;
const SCENE_MIN_ANCHOR_RUNS = 6;
const SCENE_MIN_LONG_ANCHOR_RUNS = 2;
const MAX_TAIL_POLLUTION_CHARS = 16;
const VALID_STORY_ENDING = /[。！？!?…][”’」』）》）】"']*$/u;
const STORY_TERMINAL = /[。！？!?…]/u;
const SIGNIFICANT_CHARACTER = /[\p{L}\p{N}]/u;
const SENTENCE_SEPARATOR = /[\r\n。！？!?…]+/u;
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
const BOUNDARY_ACTION_WINDOW_CHARS = 420;
const BOUNDARY_ACTION_VERB =
  '(?:按下|按动|点开|打开|调出|关上|关闭|启动|停下|拿起|放下|收起|取出|拔出|拔下|拔掉|断开|插入|插上|接入|接上|连接|拨通|挂断|发出|发送|写下|记下|拍下|拍摄|截图|保存|锁上|解锁|交给|接过|走进|走出|进入|离开|站起|坐下|转身|抬头|低头|推开|拉开)';
const BOUNDARY_ACTION = new RegExp(`(${BOUNDARY_ACTION_VERB})[了着过]?([\\p{L}\\p{N}]{2,8})`, 'gu');
const QUOTED_DIALOGUE = /“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/gu;

interface IndexedSentence {
  content: string;
  start: number;
}

interface SceneOverlapSignals {
  sharedNgrams: number;
  coveredCharacters: number;
  anchorRuns: number;
  longAnchorRuns: number;
}

function comparableCharacters(value: string): string[] {
  return Array.from(value.normalize('NFKC')).filter((character) => !/\s/u.test(character));
}

function significantText(value: string): string {
  return Array.from(value.normalize('NFKC'))
    .filter((character) => SIGNIFICANT_CHARACTER.test(character))
    .join('');
}

function indexSentences(value: string): IndexedSentence[] {
  const normalizedText = significantText(value);
  let searchStart = 0;

  return value
    .split(SENTENCE_SEPARATOR)
    .map(significantText)
    .filter(Boolean)
    .map((content) => {
      const foundAt = normalizedText.indexOf(content, searchStart);
      const start = foundAt >= 0 ? foundAt : searchStart;
      searchStart = start + content.length;
      return { content, start };
    });
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  let previous = new Uint16Array(right.length + 1);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = new Uint16Array(right.length + 1);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] =
        left[leftIndex] === right[rightIndex - 1]
          ? previous[rightIndex - 1] + 1
          : Math.max(previous[rightIndex], current[rightIndex - 1]);
    }
    previous = current;
  }

  return previous[right.length];
}

function measureSceneOverlap(opening: string, previousWindow: string): SceneOverlapSignals {
  const covered = new Array<boolean>(opening.length).fill(false);
  const sharedNgrams = new Set<string>();

  for (let start = 0; start <= opening.length - SCENE_NGRAM_SIZE; start += 1) {
    const ngram = opening.slice(start, start + SCENE_NGRAM_SIZE);
    if (!previousWindow.includes(ngram)) continue;
    sharedNgrams.add(ngram);
    for (let index = start; index < start + SCENE_NGRAM_SIZE; index += 1) {
      covered[index] = true;
    }
  }

  let coveredCharacters = 0;
  let anchorRuns = 0;
  let longAnchorRuns = 0;
  for (let index = 0; index < covered.length;) {
    if (!covered[index]) {
      index += 1;
      continue;
    }
    const runStart = index;
    while (index < covered.length && covered[index]) {
      coveredCharacters += 1;
      index += 1;
    }
    anchorRuns += 1;
    if (index - runStart >= SCENE_NGRAM_SIZE + 1) longAnchorRuns += 1;
  }

  return {
    sharedNgrams: sharedNgrams.size,
    coveredCharacters,
    anchorRuns,
    longAnchorRuns,
  };
}

function hasApproximateOpeningRollback(
  candidateText: string,
  previousChapterText: string,
): boolean {
  // A paraphrased rollback must echo both an opening sentence and clustered scene anchors.
  const opening = significantText(candidateText).slice(0, APPROXIMATE_OPENING_CHARS);
  const previous = significantText(previousChapterText);
  const previousBody = previous.slice(
    0,
    Math.max(0, previous.length - PREVIOUS_TAIL_ALLOWANCE_CHARS),
  );
  if (!opening || !previousBody) return false;

  const openingSentences = indexSentences(candidateText)
    .slice(0, 3)
    .filter(
      ({ content }) =>
        content.length >= APPROXIMATE_SENTENCE_MIN_CHARS &&
        content.length <= APPROXIMATE_SENTENCE_MAX_CHARS,
    );
  const previousSentences = indexSentences(previousChapterText).filter(
    ({ content, start }) =>
      content.length >= APPROXIMATE_SENTENCE_MIN_CHARS &&
      content.length <= APPROXIMATE_SENTENCE_MAX_CHARS &&
      start + content.length <= previousBody.length,
  );

  for (const openingSentence of openingSentences) {
    for (const previousSentence of previousSentences) {
      const shorterLength = Math.min(
        openingSentence.content.length,
        previousSentence.content.length,
      );
      const longerLength = Math.max(
        openingSentence.content.length,
        previousSentence.content.length,
      );
      if (shorterLength / longerLength < APPROXIMATE_SENTENCE_MIN_BALANCE) continue;

      const commonLength = longestCommonSubsequenceLength(
        openingSentence.content,
        previousSentence.content,
      );
      if (
        commonLength >= STRONG_SENTENCE_MATCH_MIN_CHARS &&
        commonLength / shorterLength >= STRONG_SENTENCE_MATCH_MIN_CONTAINMENT
      ) {
        return true;
      }
      if (
        commonLength < APPROXIMATE_COMMON_MIN_CHARS ||
        commonLength / shorterLength < APPROXIMATE_COMMON_MIN_CONTAINMENT
      ) {
        continue;
      }

      const windowStart = Math.max(0, previousSentence.start - PREVIOUS_SCENE_WINDOW_RADIUS);
      const windowEnd = Math.min(
        previousBody.length,
        previousSentence.start + previousSentence.content.length + PREVIOUS_SCENE_WINDOW_RADIUS,
      );
      const signals = measureSceneOverlap(opening, previousBody.slice(windowStart, windowEnd));
      if (
        signals.sharedNgrams >= SCENE_MIN_SHARED_NGRAMS &&
        signals.coveredCharacters >= SCENE_MIN_COVERED_CHARS &&
        signals.anchorRuns >= SCENE_MIN_ANCHOR_RUNS &&
        signals.longAnchorRuns >= SCENE_MIN_LONG_ANCHOR_RUNS
      ) {
        return true;
      }
    }
  }

  return false;
}

function hasOpeningRollback(candidateText: string, previousChapterText: string): boolean {
  const candidate = comparableCharacters(candidateText);
  const previous = comparableCharacters(previousChapterText);
  if (candidate.length < OPENING_MATCH_CHARS || previous.length < OPENING_MATCH_CHARS * 2) {
    return false;
  }

  const opening = candidate.slice(0, OPENING_MATCH_CHARS).join('');
  const previousText = previous.join('');
  const matchIndex = previousText.indexOf(opening);
  if (matchIndex >= 0) {
    const matchEnd = matchIndex + OPENING_MATCH_CHARS;
    if (matchEnd < previous.length - PREVIOUS_TAIL_ALLOWANCE_CHARS) return true;
  }

  return hasApproximateOpeningRollback(candidateText, previousChapterText);
}

function hasBoundarySentenceRepetition(
  candidateText: string,
  previousChapterText: string,
): boolean {
  const previousBoundarySentences = indexSentences(previousChapterText)
    .slice(-BOUNDARY_SENTENCE_SCAN_COUNT)
    .filter(({ content }) => content.length >= BOUNDARY_SENTENCE_MIN_CHARS);
  if (previousBoundarySentences.length === 0) return false;

  const previousBoundary = new Set(previousBoundarySentences.map(({ content }) => content));
  return indexSentences(candidateText)
    .slice(0, BOUNDARY_SENTENCE_SCAN_COUNT)
    .some(
      ({ content }) =>
        content.length >= BOUNDARY_SENTENCE_MIN_CHARS && previousBoundary.has(content),
    );
}

function boundaryNarration(value: string): string {
  return value.replace(QUOTED_DIALOGUE, '');
}

function canonicalBoundaryVerb(verb: string): string {
  if (/^(?:按下|按动|启动)$/u.test(verb)) return 'activate';
  if (/^(?:点开|打开|调出)$/u.test(verb)) return 'open';
  if (/^(?:关上|关闭)$/u.test(verb)) return 'close';
  if (/^(?:拔出|拔下|拔掉|断开)$/u.test(verb)) return 'disconnect';
  if (/^(?:插入|插上|接入|接上|连接)$/u.test(verb)) return 'connect';
  return verb;
}

function canonicalBoundaryObject(object: string): string {
  if (/(?:照片|图片|影像|扫描件)/u.test(object)) return 'image';
  if (/(?:录音键|录音功能)/u.test(object)) return 'recording';
  if (/(?:数据线|连接线|接口)/u.test(object)) return 'connection';
  if (/(?:文件|文档)/u.test(object)) return 'file';
  return object;
}

function boundaryActions(value: string): Set<string> {
  const actions = new Set<string>();
  for (const match of boundaryNarration(value).matchAll(BOUNDARY_ACTION)) {
    const verb = match[1];
    const object = match[2]
      .replace(/^(?:先|再|又|才|已|已经|随后)/u, '')
      .replace(/(?:之后|以前|起来|下去)$/u, '');
    if (object.length >= 2) {
      actions.add(`${canonicalBoundaryVerb(verb)}:${canonicalBoundaryObject(object)}`);
    }
  }

  const imageInspectionPatterns = [
    /(?:再次|重新|又)?(?:放大|调高|提高|增强)[^。！？\n，,；;]{0,14}(?:照片|图片|影像|扫描件|纸片)/u,
    /(?:照片|图片|影像|扫描件|纸片)[^。！？\n，,；;]{0,14}(?:放大|调高|提高|增强)/u,
  ];
  if (imageInspectionPatterns.some((pattern) => pattern.test(boundaryNarration(value)))) {
    actions.add('inspect:image');
  }
  return actions;
}

function hasBoundaryActionReplay(candidateText: string, previousChapterText: string): boolean {
  const previousTail = Array.from(previousChapterText)
    .slice(-BOUNDARY_ACTION_WINDOW_CHARS)
    .join('');
  const candidateOpening = Array.from(candidateText)
    .slice(0, BOUNDARY_ACTION_WINDOW_CHARS)
    .join('');
  const previousActions = boundaryActions(previousTail);
  if (previousActions.size === 0) return false;
  return [...boundaryActions(candidateOpening)].some((action) => previousActions.has(action));
}

function matchIndexAfter(value: string, pattern: RegExp, start: number): number {
  const relativeIndex = value.slice(start).search(pattern);
  return relativeIndex < 0 ? -1 : start + relativeIndex;
}

function hasSourceChainBreak(candidateText: string): boolean {
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

function hasCharacterReferenceBreak(candidateText: string): boolean {
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

function hasNarrowTimeLabelConflict(candidateText: string): boolean {
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

function hasTailPollution(candidateText: string): boolean {
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

function localizedWindows(value: string): string[] {
  const characters = Array.from(value.normalize('NFKC'));
  if (characters.length <= META_LEAKAGE_WINDOW_CHARS) return [characters.join('')];

  const windows: string[] = [];
  for (let start = 0; start < characters.length; start += META_LEAKAGE_WINDOW_STEP_CHARS) {
    windows.push(characters.slice(start, start + META_LEAKAGE_WINDOW_CHARS).join(''));
    if (start + META_LEAKAGE_WINDOW_CHARS >= characters.length) break;
  }
  return windows;
}

function matchCount(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function hasEnglishMetaReasoning(window: string): boolean {
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

function hasChineseInternalConstraints(window: string): boolean {
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

function hasAuditVoiceLeakage(window: string): boolean {
  const uncertaintyCount = matchCount(window, AUDIT_UNCERTAINTY);
  const statusCount = matchCount(window, AUDIT_STATUS);
  const editorialCount = matchCount(window, AUDIT_EDITORIAL);
  const disclaimerCount = matchCount(window, AUDIT_DISCLAIMER);
  const activeSignalKinds = [uncertaintyCount, statusCount, editorialCount, disclaimerCount].filter(
    (count) => count > 0,
  ).length;

  return (
    activeSignalKinds >= 2 &&
    uncertaintyCount + statusCount + editorialCount + disclaimerCount >= 6 &&
    uncertaintyCount + editorialCount + disclaimerCount >= 2
  );
}

function hasChapterWideAuditVoiceLeakage(candidateText: string): boolean {
  const uncertaintyCount = matchCount(candidateText, AUDIT_UNCERTAINTY);
  const statusCount = matchCount(candidateText, AUDIT_STATUS);
  const editorialCount = matchCount(candidateText, AUDIT_EDITORIAL);
  const disclaimerCount = matchCount(candidateText, AUDIT_DISCLAIMER);
  const explicitAuditCount = uncertaintyCount + statusCount + editorialCount + disclaimerCount;
  const significantLength = Math.max(1, significantText(candidateText).length);

  return (
    explicitAuditCount >= 5 &&
    uncertaintyCount + editorialCount + disclaimerCount >= 4 &&
    (explicitAuditCount * 1_000) / significantLength >= 1.25
  );
}

function hasMetaReasoningLeakage(candidateText: string): boolean {
  if (EXPLICIT_REASONING_TAG.test(candidateText) || EXPLICIT_MODEL_META.test(candidateText)) {
    return true;
  }

  return localizedWindows(candidateText).some(
    (window) => hasEnglishMetaReasoning(window) || hasChineseInternalConstraints(window),
  );
}

function hasClusteredAuditVoiceLeakage(candidateText: string): boolean {
  return (
    localizedWindows(candidateText).some(hasAuditVoiceLeakage) ||
    hasChapterWideAuditVoiceLeakage(candidateText)
  );
}

export function inspectChapterCandidateIntegrity(
  input: InspectChapterCandidateIntegrityInput,
): ChapterCandidateIntegrityIssue[] {
  const issues: ChapterCandidateIntegrityIssue[] = [];
  if (
    input.previousChapterText?.trim() &&
    hasOpeningRollback(input.candidateText, input.previousChapterText)
  ) {
    issues.push({
      code: 'chapter_opening_rollback',
      summary: '章首与上一章非尾部正文重复，疑似回卷或替代分支。',
    });
  }
  if (
    input.previousChapterText?.trim() &&
    hasBoundarySentenceRepetition(input.candidateText, input.previousChapterText)
  ) {
    issues.push({
      code: 'chapter_boundary_sentence_repetition',
      summary: '本章开篇复制了上一章边界的完整句，连续性停留在文字复写。',
    });
  }
  if (
    input.previousChapterText?.trim() &&
    !issues.some((issue) => issue.code === 'chapter_boundary_sentence_repetition') &&
    hasBoundaryActionReplay(input.candidateText, input.previousChapterText)
  ) {
    issues.push({
      code: 'chapter_boundary_action_replay',
      summary: '上一章结尾已完成的动作在本章开篇被再次执行。',
    });
  }
  if (hasTailPollution(input.candidateText)) {
    issues.push({
      code: 'chapter_tail_pollution',
      summary: '完整故事句之后存在短残片或非正文尾缀。',
    });
  }
  if (hasMetaReasoningLeakage(input.candidateText)) {
    issues.push({
      code: 'chapter_meta_reasoning_leakage',
      summary: '章节正文混入模型自我修订、内部约束或隐藏推理。',
    });
  }
  if (
    !issues.some((issue) => issue.code === 'chapter_meta_reasoning_leakage') &&
    AUTHORIAL_CHAPTER_LABEL.test(input.candidateText)
  ) {
    issues.push({
      code: 'chapter_authorial_label_leakage',
      summary: '故事人物或叙述引用了作者侧章节编号。',
    });
  }
  if (hasSourceChainBreak(input.candidateText)) {
    issues.push({
      code: 'chapter_source_chain_break',
      summary: '正文使用了尚未取得或已断开来源中的目录、标签或附件影像细节。',
    });
  }
  if (hasCharacterReferenceBreak(input.candidateText)) {
    issues.push({
      code: 'chapter_dialogue_reference_conflict',
      summary: '近邻对话中的人物关系指代发生切换，无法确定所指对象。',
    });
  }
  if (hasNarrowTimeLabelConflict(input.candidateText)) {
    issues.push({
      code: 'chapter_temporal_semantics_conflict',
      summary: '同一事件被标为凌晨，同时又落在二十三时这一冲突时段。',
    });
  }
  if (hasClusteredAuditVoiceLeakage(input.candidateText)) {
    issues.push({
      code: 'chapter_audit_voice_leakage',
      summary: '章节正文密集泄漏核实状态与内部审校结论，未转化为故事呈现。',
    });
  }
  return issues;
}
