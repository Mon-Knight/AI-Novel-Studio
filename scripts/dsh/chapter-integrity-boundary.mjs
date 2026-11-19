// Shared finite integrity rules; no model calls, side effects or semantic proof.
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
const SIGNIFICANT_CHARACTER = /[\p{L}\p{N}]/u;
const SENTENCE_SEPARATOR = /[\r\n。！？!?…]+/u;
const BOUNDARY_ACTION_WINDOW_CHARS = 420;
const BOUNDARY_ACTION_VERB =
  '(?:按下|按动|点开|打开|调出|关上|关闭|启动|停下|拿起|放下|收起|取出|拔出|拔下|拔掉|断开|插入|插上|接入|接上|连接|拨通|挂断|发出|发送|写下|记下|拍下|拍摄|截图|保存|锁上|解锁|交给|接过|走进|走出|进入|离开|站起|坐下|转身|抬头|低头|推开|拉开)';
const BOUNDARY_ACTION = new RegExp(`(${BOUNDARY_ACTION_VERB})[了着过]?([\\p{L}\\p{N}]{2,8})`, 'gu');
const QUOTED_DIALOGUE = /“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/gu;
function comparableCharacters(value) {
  return Array.from(value.normalize('NFKC')).filter((character) => !/\s/u.test(character));
}
function significantText(value) {
  return Array.from(value.normalize('NFKC'))
    .filter((character) => SIGNIFICANT_CHARACTER.test(character))
    .join('');
}
function indexSentences(value) {
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
function longestCommonSubsequenceLength(left, right) {
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
function measureSceneOverlap(opening, previousWindow) {
  const covered = new Array(opening.length).fill(false);
  const sharedNgrams = new Set();
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
function hasApproximateOpeningRollback(candidateText, previousChapterText) {
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
function hasOpeningRollback(candidateText, previousChapterText) {
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
function hasBoundarySentenceRepetition(candidateText, previousChapterText) {
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
function boundaryNarration(value) {
  return value.replace(QUOTED_DIALOGUE, '');
}
function canonicalBoundaryVerb(verb) {
  if (/^(?:按下|按动|启动)$/u.test(verb)) return 'activate';
  if (/^(?:点开|打开|调出)$/u.test(verb)) return 'open';
  if (/^(?:关上|关闭)$/u.test(verb)) return 'close';
  if (/^(?:拔出|拔下|拔掉|断开)$/u.test(verb)) return 'disconnect';
  if (/^(?:插入|插上|接入|接上|连接)$/u.test(verb)) return 'connect';
  return verb;
}
function canonicalBoundaryObject(object) {
  if (/(?:照片|图片|影像|扫描件)/u.test(object)) return 'image';
  if (/(?:录音键|录音功能)/u.test(object)) return 'recording';
  if (/(?:数据线|连接线|接口)/u.test(object)) return 'connection';
  if (/(?:文件|文档)/u.test(object)) return 'file';
  return object;
}
function boundaryActions(value) {
  const actions = new Set();
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
function hasBoundaryActionReplay(candidateText, previousChapterText) {
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
export {
  significantText,
  SENTENCE_SEPARATOR,
  boundaryNarration,
  hasOpeningRollback,
  hasBoundarySentenceRepetition,
  hasBoundaryActionReplay,
};
