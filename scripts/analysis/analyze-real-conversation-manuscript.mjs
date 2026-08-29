import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EVIDENCE_SCHEMA_VERSION = 'real_conversation_acceptance_evidence_v4';
const CANDIDATE_INTEGRITY_CONTRACT_VERSION = 'chapter_candidate_integrity_v4';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PROVIDER_SOURCE_STATUSES = new Set([
  'included',
  'truncated',
  'omitted_empty',
  'omitted_budget',
]);

const STOP_WORDS = new Set([
  '一个',
  '一些',
  '一样',
  '一直',
  '已经',
  '什么',
  '他们',
  '但是',
  '只是',
  '因为',
  '如果',
  '并不',
  '没有',
  '这个',
  '那个',
  '这里',
  '那里',
  '自己',
  '知道',
  '觉得',
  '开始',
  '还是',
  '不是',
  '然后',
  '现在',
  '已经',
  '可以',
  '可能',
  '时候',
  '东西',
  '事情',
  '声音',
  '看见',
  '看着',
  '说道',
  '似乎',
  '仿佛',
  '无法',
  '不会',
  '之后',
  '之前',
  '里面',
  '外面',
  '一下',
  '一点',
]);

const STYLE_TICS = [
  '仿佛',
  '似乎',
  '某种',
  '这一刻',
  '空气中',
  '不知为何',
  '说不清',
  '几乎',
  '下意识',
  '微微',
  '缓缓',
  '沉默了片刻',
  '不是因为',
  '不是……而是',
  '没有回答',
];

const V4_BASE_SNAPSHOT_SOURCE_TYPES = [
  'chapter_outline',
  'novel',
  'output_profile',
  'protagonist',
  'style_profile',
  'world_setting',
];

const TEMPORAL_PATTERN =
  /(?:\d{1,2}[：:]\d{2}(?::\d{2})?|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|(?:凌晨|清晨|早晨|上午|中午|下午|傍晚|晚上|深夜|午夜)[^，。！？；\n]{0,10}|(?:当天|当晚|次日|翌日|第二天|前一天|昨日|今天|明天|数日后|几天后|一周后|一个月后|多年后|十年前|三年前))/g;

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

function usage() {
  console.error(
    'Usage: node scripts/analysis/analyze-real-conversation-manuscript.mjs <real-conversation-evidence.json> [--out-dir <directory>]',
  );
}

function parseArgs(argv) {
  const positional = [];
  let outDir = '';
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--out-dir') {
      outDir = argv[index + 1] ?? '';
      index += 1;
    } else {
      positional.push(value);
    }
  }
  if (positional.length !== 1 || (argv.includes('--out-dir') && !outDir)) {
    usage();
    process.exitCode = 2;
    return null;
  }
  return { evidencePath: path.resolve(positional[0]), outDir: outDir ? path.resolve(outDir) : '' };
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function countTextWords(text) {
  const cleaned = text.replace(/[#*\-`>\s]+/g, ' ').trim();
  if (!cleaned) return 0;
  return (
    (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length +
    (cleaned.match(/[a-zA-Z0-9]+/g) ?? []).length
  );
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectEvidence(code, message) {
  throw new Error(`${code}: ${message}`);
}

function assertUniqueChapterIds(chapters, field) {
  const values = chapters.map((chapter) => chapter[field]);
  if (values.some((value) => typeof value !== 'string' || !value.trim())) {
    rejectEvidence('EVIDENCE_FINAL_ID_MISSING', `Every chapter must retain ${field}.`);
  }
  if (new Set(values).size !== values.length) {
    rejectEvidence('EVIDENCE_FINAL_ID_DUPLICATE', `${field} must be unique across chapters.`);
  }
}

function validateFinalEvidence(evidence) {
  if (!isRecord(evidence)) {
    rejectEvidence('EVIDENCE_FINAL_INVALID', 'Evidence must be a JSON object.');
  }
  if (evidence.evidenceSchemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    rejectEvidence('EVIDENCE_FINAL_SCHEMA_UNSUPPORTED', `Expected ${EVIDENCE_SCHEMA_VERSION}.`);
  }
  if (evidence.candidateIntegrityContractVersion !== CANDIDATE_INTEGRITY_CONTRACT_VERSION) {
    rejectEvidence(
      'EVIDENCE_FINAL_CANDIDATE_CONTRACT_UNSUPPORTED',
      `Expected ${CANDIDATE_INTEGRITY_CONTRACT_VERSION}.`,
    );
  }
  if (evidence.status !== 'passed') {
    rejectEvidence(
      'EVIDENCE_FINAL_NOT_PASSED',
      'Final manuscript analysis requires passed evidence.',
    );
  }
  if (evidence.scenario !== 'sparse-idea' && evidence.scenario !== 'prepared-assets') {
    rejectEvidence('EVIDENCE_FINAL_SCENARIO_UNSUPPORTED', 'Evidence scenario is unsupported.');
  }
  if (!Array.isArray(evidence.chapters) || evidence.chapters.length === 0) {
    rejectEvidence('EVIDENCE_FINAL_CHAPTERS_MISSING', 'Evidence must contain completed chapters.');
  }
  if (evidence.chapters.some((chapter) => !isRecord(chapter))) {
    rejectEvidence('EVIDENCE_FINAL_CHAPTER_INVALID', 'Every chapter row must be an object.');
  }

  const chapters = [...evidence.chapters].sort((left, right) => left.chapter - right.chapter);
  const chapterCount = chapters.length;
  for (const field of ['plannedChapterCount', 'chapterCount', 'completedChapterCount']) {
    if (!Number.isSafeInteger(evidence[field]) || evidence[field] !== chapterCount) {
      rejectEvidence(
        'EVIDENCE_FINAL_INCOMPLETE',
        `${field} must equal the ${chapterCount} retained chapters.`,
      );
    }
  }

  chapters.forEach((chapter, index) => {
    if (!isRecord(chapter) || chapter.status !== 'passed') {
      rejectEvidence(
        'EVIDENCE_FINAL_CHAPTER_NOT_PASSED',
        `Chapter row ${index + 1} is not passed.`,
      );
    }
    if (chapter.chapter !== index + 1) {
      rejectEvidence(
        'EVIDENCE_FINAL_CHAPTER_SEQUENCE_INVALID',
        'Chapter numbers must be unique and contiguous from 1.',
      );
    }
    if (typeof chapter.adoptedContent !== 'string' || !chapter.adoptedContent.trim()) {
      rejectEvidence(
        'EVIDENCE_FINAL_ADOPTED_CONTENT_MISSING',
        `Chapter ${chapter.chapter} has no adopted content.`,
      );
    }
    const calculatedWordCount = countTextWords(chapter.adoptedContent);
    if (chapter.wordCount !== calculatedWordCount) {
      rejectEvidence(
        'EVIDENCE_FINAL_CHAPTER_WORD_LEDGER_MISMATCH',
        `Chapter ${chapter.chapter} word count does not match adopted content.`,
      );
    }
  });

  for (const field of [
    'chapterId',
    'artifactId',
    'summaryTurnId',
    'summaryRunId',
    'summaryArtifactId',
    'summaryApplyTransactionId',
    'summaryId',
  ]) {
    assertUniqueChapterIds(chapters, field);
  }

  const extractedWordCount = chapters.reduce(
    (sum, chapter) => sum + countTextWords(chapter.adoptedContent),
    0,
  );
  for (const field of [
    'totalWordCount',
    'independentWordCount',
    'chapterWordCountSum',
    'novelWordCount',
  ]) {
    if (evidence[field] !== extractedWordCount) {
      rejectEvidence(
        'EVIDENCE_FINAL_WORD_LEDGER_MISMATCH',
        `${field} must equal the ${extractedWordCount}-word adopted manuscript.`,
      );
    }
  }
  return chapters;
}

function normalizeProse(value) {
  return value.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

function splitParagraphs(value) {
  return value
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitSentences(value) {
  return value
    .split(/(?<=[。！？!?；;])|\r?\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function words(value) {
  return [...segmenter.segment(value)]
    .filter((item) => item.isWordLike)
    .map((item) => item.segment.trim().toLowerCase())
    .filter((item) => item.length >= 2 && item.length <= 12 && !STOP_WORDS.has(item));
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio));
  return sorted[index];
}

function distribution(values) {
  if (values.length === 0)
    return { minimum: 0, maximum: 0, mean: 0, median: 0, p90: 0, stdev: 0, cv: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);
  return {
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    mean: round(mean, 2),
    median: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    stdev: round(stdev, 2),
    cv: mean ? round(stdev / mean) : 0,
  };
}

function excerpt(value, fromEnd = false, limit = 220) {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) return compact;
  return fromEnd ? `…${compact.slice(-limit)}` : `${compact.slice(0, limit)}…`;
}

function shingleSet(value, size) {
  const normalized = normalizeProse(value);
  const result = new Set();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    result.add(normalized.slice(index, index + size));
  }
  return result;
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function collectDuplicates(chapters, unitSelector, minimumLength) {
  const occurrences = new Map();
  for (const chapter of chapters) {
    const seenInChapter = new Set();
    for (const unit of unitSelector(chapter.adoptedContent)) {
      const normalized = normalizeProse(unit);
      if (normalized.length < minimumLength || seenInChapter.has(normalized)) continue;
      seenInChapter.add(normalized);
      const existing = occurrences.get(normalized) ?? {
        sample: excerpt(unit, false, 160),
        chapters: [],
      };
      existing.chapters.push(chapter.chapter);
      occurrences.set(normalized, existing);
    }
  }
  return [...occurrences.values()]
    .filter((item) => item.chapters.length > 1)
    .sort(
      (left, right) =>
        right.chapters.length - left.chapters.length || right.sample.length - left.sample.length,
    )
    .slice(0, 50);
}

function temporalMarkers(chapter) {
  const matches = [];
  for (const match of chapter.adoptedContent.matchAll(TEMPORAL_PATTERN)) {
    const index = match.index ?? 0;
    matches.push({
      marker: match[0],
      context: excerpt(
        chapter.adoptedContent.slice(Math.max(0, index - 40), index + match[0].length + 55),
        false,
        130,
      ),
    });
  }
  return matches.slice(0, 80);
}

function sentenceCues(sentences, pattern, limit = 24) {
  return sentences
    .filter((sentence) => pattern.test(sentence))
    .slice(0, limit)
    .map((sentence) => excerpt(sentence, false, 180));
}

function chapterMetrics(chapter) {
  const content = chapter.adoptedContent;
  const paragraphs = splitParagraphs(content);
  const sentences = splitSentences(content);
  const sentenceLengths = sentences.map(countTextWords);
  const paragraphLengths = paragraphs.map(countTextWords);
  const wordTokens = words(content);
  const uniqueWords = new Set(wordTokens);
  const dialogueCharacters = [...content.matchAll(/[“"]([^”"]+)[”"]/gu)].reduce(
    (sum, match) => sum + match[1].length,
    0,
  );
  const outlineTerms = [...new Set(words(`${chapter.chapterOutline}\n${chapter.chapterGoal}`))];
  const contentWordSet = new Set(wordTokens);
  const missingOutlineTerms = outlineTerms.filter((term) => !contentWordSet.has(term));
  const pronounHeavySentences = sentences
    .filter((sentence) => countMatches(sentence, /[他她它其]/g) >= 2)
    .slice(0, 30)
    .map((sentence) => excerpt(sentence, false, 180));
  return {
    chapter: chapter.chapter,
    chapterId: chapter.chapterId,
    title: chapter.chapterTitle,
    outline: chapter.chapterOutline,
    goal: chapter.chapterGoal,
    targetWordCount: chapter.targetWordCount,
    wordCount: countTextWords(content),
    characters: content.length,
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    sentenceWords: distribution(sentenceLengths),
    paragraphWords: distribution(paragraphLengths),
    dialogueCharacterRatio: content.length ? round(dialogueCharacters / content.length) : 0,
    lexicalDiversity: wordTokens.length ? round(uniqueWords.size / wordTokens.length) : 0,
    punctuationPerThousandWords: {
      questions: round(
        (countMatches(content, /[？?]/g) * 1000) / Math.max(1, countTextWords(content)),
        2,
      ),
      exclamations: round(
        (countMatches(content, /[！!]/g) * 1000) / Math.max(1, countTextWords(content)),
        2,
      ),
      ellipses: round(
        (countMatches(content, /(?:……|\.\.\.)/g) * 1000) / Math.max(1, countTextWords(content)),
        2,
      ),
    },
    outlineTermCoverage: outlineTerms.length
      ? round((outlineTerms.length - missingOutlineTerms.length) / outlineTerms.length)
      : 0,
    missingOutlineTerms,
    temporalMarkers: temporalMarkers(chapter),
    reviewCues: {
      pronounHeavySentences,
      clueMentions: sentenceCues(
        sentences,
        /线索|录音|档案|照片|证据|钥匙|编号|伤口|秘密|失踪|真相|异常|痕迹|签名|密码|纸条|文件|票据|时间线/,
      ),
      stateChangeMentions: sentenceCues(
        sentences,
        /受伤|死亡|失踪|被捕|离开|到达|拿走|交给|丢失|损坏|销毁|恢复|知道|发现|怀疑|相信|背叛|持有|藏起|取出|收起/,
      ),
    },
    openingExcerpt: excerpt(content),
    closingExcerpt: excerpt(content, true),
  };
}

function requiredV4SourceTypes(evidence, chapter, index) {
  const scenarioSource = evidence.scenario === 'sparse-idea' ? 'rule_system' : 'reference_material';
  const snapshot = [
    ...V4_BASE_SNAPSHOT_SOURCE_TYPES,
    scenarioSource,
    ...(index > 0 ? ['adopted_chapter'] : []),
  ];
  const provider = [
    ...snapshot,
    'user_instruction',
    ...(chapter.lengthRepairCount > 0 || chapter.integrityRepairCount > 0
      ? ['current_editor']
      : []),
  ];
  return { snapshot, provider };
}

function sourceChain(evidence, chapters) {
  const issues = [];
  const rows = chapters.map((chapter, index) => {
    const prior = chapters[index - 1];
    const contentHash = sha256(chapter.adoptedContent);
    const candidateContent = chapter.adoptedContent.endsWith('\n')
      ? chapter.adoptedContent.slice(0, -1)
      : chapter.adoptedContent;
    const requiredSources = requiredV4SourceTypes(evidence, chapter, index);
    const sourceTypes = new Set(
      Array.isArray(chapter.snapshotSourceTypes) ? chapter.snapshotSourceTypes : [],
    );
    const missingSnapshotSources = requiredSources.snapshot.filter(
      (item) => !sourceTypes.has(item),
    );
    const providerRequest = chapter.providerRequestEvidence;
    const providerStatuses = isRecord(providerRequest?.generationSourceStatuses)
      ? providerRequest.generationSourceStatuses
      : {};
    const criticalProviderSourceFailures = requiredSources.provider
      .filter((type) => providerStatuses[type] !== 'included')
      .map((type) => ({ type, status: providerStatuses[type] ?? 'missing' }));
    const omittedProviderSources = Object.entries(providerStatuses)
      .filter(([, status]) => status === 'omitted_empty' || status === 'omitted_budget')
      .map(([type, status]) => ({ type, status }));
    const optionalOmittedProviderSources = omittedProviderSources.filter(
      ({ type }) => !requiredSources.provider.includes(type),
    );
    const invalidProviderSourceStatuses = Object.entries(providerStatuses)
      .filter(([, status]) => !PROVIDER_SOURCE_STATUSES.has(status))
      .map(([type, status]) => ({ type, status }));
    const instruction = Array.isArray(evidence.userInstructions)
      ? evidence.userInstructions[index]
      : undefined;
    const checks = {
      adoptedHashMatches: contentHash === chapter.adoptedHash,
      wordCountMatches: countTextWords(chapter.adoptedContent) === chapter.wordCount,
      artifactHashMatchesCandidate:
        chapter.artifactCandidateIntegrityCheck?.artifactContentSha256 === chapter.candidateHash,
      candidateToAdoptedEditIsOnlyTrailingLf:
        sha256(candidateContent) === chapter.candidateHash && chapter.adoptedContent.endsWith('\n'),
      continuityHashMatchesPrevious:
        index === 0
          ? !chapter.continuitySourceHash
          : chapter.continuitySourceHash === prior.adoptedHash,
      candidateIntegrityPassed:
        chapter.artifactCandidateIntegrityCheck?.checker === 'inspectChapterCandidateIntegrity' &&
        chapter.artifactCandidateIntegrityCheck?.source === 'persisted_result_artifact' &&
        chapter.artifactCandidateIntegrityCheck?.executed === true &&
        chapter.artifactCandidateIntegrityCheck?.passed === true &&
        chapter.artifactCandidateIntegrityCheck?.artifactId === chapter.artifactId &&
        (chapter.artifactCandidateIntegrityCheck?.issueCodes?.length ?? 0) === 0,
      summaryApplied: Boolean(
        chapter.summaryId && chapter.summaryArtifactId && chapter.summaryApplyTransactionId,
      ),
      memoryClosedLoop: ['adopted_draft', 'chapter_summary', 'context_record'].every((type) =>
        (chapter.memorySourceTypes ?? []).includes(type),
      ),
      instructionHashMatches:
        typeof instruction === 'string' && sha256(instruction) === chapter.instructionHash,
      providerRequestEvidenceValid:
        providerRequest?.schemaVersion === 'workbench_provider_request_evidence_v1' &&
        providerRequest?.hashAlgorithm === 'sha256' &&
        providerRequest?.messagesSerialization === 'json_stringify_messages_v1' &&
        SHA256_PATTERN.test(providerRequest?.messagesSha256 ?? '') &&
        SHA256_PATTERN.test(providerRequest?.compiledContextSha256 ?? '') &&
        SHA256_PATTERN.test(providerRequest?.snapshotCompiledPromptSha256 ?? '') &&
        SHA256_PATTERN.test(providerRequest?.snapshotRequestSourceSha256 ?? '') &&
        providerRequest?.includedSnapshotRequestSourceSha256 ===
          providerRequest?.snapshotRequestSourceSha256 &&
        providerRequest?.snapshotRequestSourceStatus === 'included' &&
        PROVIDER_SOURCE_STATUSES.has(providerRequest?.providerSourceStatus) &&
        typeof providerRequest?.taskId === 'string' &&
        Boolean(providerRequest.taskId.trim()) &&
        typeof providerRequest?.attemptId === 'string' &&
        Boolean(providerRequest.attemptId.trim()) &&
        Number.isSafeInteger(providerRequest?.messageCount) &&
        providerRequest.messageCount > 0 &&
        /^(?:txt_[0-9a-f]{8}|[0-9a-f]{64})$/.test(providerRequest?.snapshotContextHash ?? ''),
      requiredSnapshotSourcesPresent: missingSnapshotSources.length === 0,
      criticalProviderSourcesIncluded: criticalProviderSourceFailures.length === 0,
      providerSourceStatusesValid: invalidProviderSourceStatuses.length === 0,
      continuousConversation: chapter.conversationId === evidence.conversationId,
      fixedModel:
        chapter.model?.providerId === evidence.model?.providerId &&
        chapter.model?.modelId === evidence.model?.modelId,
    };
    for (const [check, passed] of Object.entries(checks)) {
      if (!passed) issues.push({ chapter: chapter.chapter, check });
    }
    return {
      chapter: chapter.chapter,
      chapterId: chapter.chapterId,
      artifactId: chapter.artifactId,
      adoptedHash: chapter.adoptedHash,
      candidateHash: chapter.candidateHash,
      continuitySourceHash: chapter.continuitySourceHash,
      providerMessagesHash: chapter.providerRequestEvidence?.messagesSha256 ?? '',
      snapshotContextHash: chapter.providerRequestEvidence?.snapshotContextHash ?? '',
      requiredSnapshotSources: requiredSources.snapshot,
      requiredProviderSources: requiredSources.provider,
      missingSources: missingSnapshotSources,
      missingSnapshotSources,
      criticalProviderSourceFailures,
      omittedProviderSources,
      optionalOmittedProviderSources,
      invalidProviderSourceStatuses,
      checks,
    };
  });
  const firstInstruction = Array.isArray(evidence.userInstructions)
    ? String(evidence.userInstructions[0] ?? '')
    : '';
  const firstInstructionHash = firstInstruction ? sha256(firstInstruction) : '';
  const plannedTarget = evidence.plannedTargetWordCount;
  const extractedWordCount = chapters.reduce(
    (sum, chapter) => sum + countTextWords(chapter.adoptedContent),
    0,
  );
  const planningChecks = {
    shortContinuationTurns:
      Array.isArray(evidence.userInstructions) &&
      evidence.userInstructions.length === evidence.chapters.length &&
      evidence.userInstructions.slice(1).every((instruction) => instruction === '继续写'),
    authoritativeWordLedgersAgree: [
      evidence.totalWordCount,
      evidence.independentWordCount,
      evidence.chapterWordCountSum,
      evidence.novelWordCount,
    ].every((value) => value === extractedWordCount),
    ...(evidence.scenario === 'sparse-idea'
      ? {
          firstInstructionMatchesBookGoalHash:
            firstInstructionHash === evidence.bookWordGoal?.sourceContentSha256,
          firstInstructionMatchesFrozenPlanHash:
            firstInstructionHash === evidence.storyPlanApplyEvidence?.frozenSource?.contentSha256,
          planApplied: evidence.storyPlanApplyEvidence?.applyResult === 'applied',
          plannedWordCountsAgree:
            evidence.bookWordGoal?.targetWords === plannedTarget &&
            evidence.storyPlanApplyEvidence?.rootTargetWordCount === plannedTarget &&
            evidence.storyPlanApplyEvidence?.chapterTargetWordCountSum === plannedTarget,
        }
      : {}),
  };
  for (const [check, passed] of Object.entries(planningChecks)) {
    if (!passed) issues.push({ chapter: 0, check });
  }
  return {
    passed: issues.length === 0,
    issues,
    planning: {
      firstInstructionSha256: firstInstructionHash,
      bookGoalSourceSha256: evidence.bookWordGoal?.sourceContentSha256 ?? '',
      frozenPlanSourceSha256: evidence.storyPlanApplyEvidence?.frozenSource?.contentSha256 ?? '',
      plannedTargetWordCount: plannedTarget,
      extractedWordCount,
      checks: planningChecks,
    },
    chapters: rows,
  };
}

function salientTermTimeline(chapters) {
  const terms = new Map();
  for (const chapter of chapters) {
    const perChapter = new Map();
    for (const term of words(
      `${chapter.chapterTitle}\n${chapter.chapterOutline}\n${chapter.adoptedContent}`,
    )) {
      perChapter.set(term, (perChapter.get(term) ?? 0) + 1);
    }
    for (const [term, count] of perChapter) {
      const record = terms.get(term) ?? { term, total: 0, chapters: [] };
      record.total += count;
      record.chapters.push({ chapter: chapter.chapter, count });
      terms.set(term, record);
    }
  }
  return [...terms.values()]
    .filter((item) => item.chapters.length >= 2 && item.total >= 4)
    .sort(
      (left, right) =>
        right.chapters.length - left.chapters.length ||
        right.total - left.total ||
        left.term.localeCompare(right.term),
    )
    .slice(0, 100)
    .map((item) => ({
      ...item,
      firstChapter: item.chapters[0].chapter,
      lastChapter: item.chapters.at(-1).chapter,
    }));
}

function adjacentTransitions(chapters) {
  return chapters.slice(1).map((chapter, index) => {
    const prior = chapters[index];
    const priorEnding = excerpt(prior.adoptedContent, true, 300);
    const currentOpening = excerpt(chapter.adoptedContent, false, 300);
    return {
      fromChapter: prior.chapter,
      toChapter: chapter.chapter,
      boundaryShingleSimilarity: round(
        jaccard(shingleSet(priorEnding, 5), shingleSet(currentOpening, 5)),
      ),
      priorEnding,
      currentOpening,
    };
  });
}

function pairSimilarities(chapters) {
  const sets = new Map(
    chapters.map((chapter) => [chapter.chapter, shingleSet(chapter.adoptedContent, 8)]),
  );
  const pairs = [];
  for (let left = 0; left < chapters.length; left += 1) {
    for (let right = left + 1; right < chapters.length; right += 1) {
      pairs.push({
        leftChapter: chapters[left].chapter,
        rightChapter: chapters[right].chapter,
        shingleSimilarity: round(
          jaccard(sets.get(chapters[left].chapter), sets.get(chapters[right].chapter)),
        ),
      });
    }
  }
  return pairs.sort((left, right) => right.shingleSimilarity - left.shingleSimilarity).slice(0, 30);
}

function styleTics(chapters) {
  const text = chapters.map((chapter) => chapter.adoptedContent).join('\n');
  const totalWords = countTextWords(text);
  return STYLE_TICS.map((phrase) => {
    const count = text.split(phrase).length - 1;
    return {
      phrase,
      count,
      perTenThousandWords: round((count * 10_000) / Math.max(1, totalWords), 2),
    };
  })
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count);
}

function analysisCoverage(sourceChainReport) {
  return {
    schemaVersion: 'ans_manuscript_analysis_coverage_v1',
    dimensions: [
      {
        dimension: 'source_hash_chain',
        status: 'verified',
        verificationResult: sourceChainReport.passed ? 'passed' : 'failed',
        scope:
          'Validates v4 identity, word ledgers, adopted/candidate/continuity hashes, planning hashes, closed-loop receipts, and critical Provider source inclusion.',
      },
      {
        dimension: 'timeline',
        status: 'heuristic_candidate',
        evidencePath: 'continuityReview.temporalMarkers',
        scope:
          'Locates explicit temporal language but does not adjudicate chronology or travel time.',
      },
      {
        dimension: 'reference_resolution',
        status: 'heuristic_candidate',
        evidencePath: 'chapters[].reviewCues.pronounHeavySentences',
        scope: 'Locates pronoun-heavy sentences without resolving antecedents.',
      },
      {
        dimension: 'object_lifecycle',
        status: 'unavailable_from_v4',
        scope:
          'v4 has no structured item-state history; keyword cues are only manual-review navigation.',
      },
      {
        dimension: 'character_state',
        status: 'unavailable_from_v4',
        scope: 'v4 retains state-source receipts but not persisted CharacterState semantics.',
      },
      {
        dimension: 'world_rules',
        status: 'unavailable_from_v4',
        scope:
          'v4 proves source inclusion but omits the formal world and rule text needed for comparison.',
      },
      {
        dimension: 'cross_chapter_transition',
        status: 'heuristic_candidate',
        evidencePath: 'continuityReview.adjacentTransitions',
        scope:
          'Provides chapter-boundary excerpts and lexical similarity without semantic adjudication.',
      },
      {
        dimension: 'foreshadowing',
        status: 'unavailable_from_v4',
        scope: 'v4 omits structured new/resolved foreshadow records and their semantic content.',
      },
      {
        dimension: 'repetition',
        status: 'heuristic_candidate',
        evidencePath: 'repetitionReview',
        scope:
          'Finds exact cross-chapter units and high shingle similarity; results require review.',
      },
      {
        dimension: 'pacing',
        status: 'heuristic_candidate',
        evidencePath: 'corpus and chapters[]',
        scope: 'Reports length, sentence, paragraph, dialogue, and punctuation distributions only.',
      },
      {
        dimension: 'style',
        status: 'heuristic_candidate',
        evidencePath: 'styleReview',
        scope:
          'Reports selected phrase, dialogue, and lexical metrics without style-profile comparison.',
      },
    ],
  };
}

const ANALYSIS_LIMITATIONS = [
  {
    code: 'provider_payload_opaque',
    explanation:
      'v4 retains Provider and compiled-context hashes but not their payloads, so those hashes cannot be independently recomputed by this analyzer.',
  },
  {
    code: 'semantic_closed_loop_content_unavailable',
    explanation:
      'v4 retains Summary, Context, and Memory identities/source types but not their semantic content or downstream content hashes.',
  },
  {
    code: 'formal_asset_content_unavailable',
    explanation:
      'v4 source receipts prove inclusion but do not expose the formal world, rule, style, and output-profile text for semantic comparison.',
  },
  {
    code: 'heuristics_are_not_quality_verdicts',
    explanation:
      'Temporal, pronoun, transition, repetition, pacing, and style metrics locate review candidates and do not by themselves prove a defect.',
  },
];

function analyze(evidence, evidencePath) {
  const chapters = validateFinalEvidence(evidence);
  const chapterNumbers = chapters.map((chapter) => chapter.chapter);
  const expectedNumbers = Array.from({ length: chapters.length }, (_, index) => index + 1);
  const chapterRows = chapters.map(chapterMetrics);
  const fullText = chapters.map((chapter) => chapter.adoptedContent).join('\n');
  const allSentences = splitSentences(fullText);
  const allParagraphs = splitParagraphs(fullText);
  const totalWords = countTextWords(fullText);
  const sourceChainReport = sourceChain(evidence, chapters);
  return {
    analyzerVersion: 'ans_manuscript_analysis_v2',
    sourceEvidenceFile: path.basename(evidencePath),
    evidenceSummary: {
      evidenceSchemaVersion: evidence.evidenceSchemaVersion,
      candidateIntegrityContractVersion: evidence.candidateIntegrityContractVersion,
      status: evidence.status,
      scenario: evidence.scenario,
      model: evidence.model,
      plannedChapterCount: evidence.plannedChapterCount,
      completedChapterCount: evidence.completedChapterCount,
      extractedChapterCount: chapters.length,
      totalWordCount: evidence.totalWordCount,
      extractedWordCount: totalWords,
      chapterNumbersContiguous: JSON.stringify(chapterNumbers) === JSON.stringify(expectedNumbers),
      fullBookEvidence: true,
    },
    coverage: analysisCoverage(sourceChainReport),
    limitations: ANALYSIS_LIMITATIONS,
    sourceChain: sourceChainReport,
    corpus: {
      characters: fullText.length,
      wordCount: totalWords,
      paragraphs: allParagraphs.length,
      sentences: allSentences.length,
      chapterWordCounts: distribution(chapterRows.map((chapter) => chapter.wordCount)),
      sentenceWords: distribution(allSentences.map(countTextWords)),
      paragraphWords: distribution(allParagraphs.map(countTextWords)),
    },
    chapters: chapterRows,
    continuityReview: {
      adjacentTransitions: adjacentTransitions(chapters),
      temporalMarkers: chapterRows.map((chapter) => ({
        chapter: chapter.chapter,
        markers: chapter.temporalMarkers,
      })),
      salientTermTimeline: salientTermTimeline(chapters),
    },
    repetitionReview: {
      duplicateParagraphsAcrossChapters: collectDuplicates(chapters, splitParagraphs, 24),
      duplicateSentencesAcrossChapters: collectDuplicates(chapters, splitSentences, 18),
      mostSimilarChapterPairs: pairSimilarities(chapters),
    },
    styleReview: {
      styleTics: styleTics(chapters),
      chapterDialogueRatios: chapterRows.map((chapter) => ({
        chapter: chapter.chapter,
        ratio: chapter.dialogueCharacterRatio,
      })),
      chapterLexicalDiversity: chapterRows.map((chapter) => ({
        chapter: chapter.chapter,
        ratio: chapter.lexicalDiversity,
      })),
    },
    manualReviewRequired: [
      '按 temporalMarkers 建立绝对时间与相对时间表，核对先后、耗时、昼夜和人物可达性；正则只能定位，不能裁决矛盾。',
      '按 salientTermTimeline 为人物、地点、物件分别建状态表，逐次核对持有者、位置、损坏/丢失/回收和知情范围。',
      '逐章把正文与 outline/goal 对照，确认目标完成且没有提前泄露后续章事实；outlineTermCoverage 仅是导航。',
      '阅读 adjacentTransitions 的章尾/章首，核对动作、地点、情绪、伤势、时间和上一章悬念是否自然承接。',
      '将线索分为埋设、强化、误导、解释、回收，检查终章后仍未解释的高权重线索；词频不能替代因果判断。',
      '复核重复段句、相似章节对和高频表达，区分刻意回环、必要回顾与模板化复述。',
      '结合章长、段句长度、对话比例与关键情节密度评估节奏；统计波动本身不是质量问题。',
      '统一叙事视角、语体、比喻密度、人物口吻和悬疑信息控制；自动文风指标只用于发现异常章。',
      '世界规则的严格符合性需要正式世界/规则原文；当前证据仅证明 Provider 注入及哈希链，不包含可供语义比对的完整规则正文。',
    ],
    manuscript: {
      chapters: chapters.map((chapter) => ({
        chapter: chapter.chapter,
        title: chapter.chapterTitle,
        content: chapter.adoptedContent,
      })),
    },
  };
}

function renderManuscript(report) {
  return `${report.manuscript.chapters
    .map(
      (chapter) =>
        `# ${chapter.title || `第 ${chapter.chapter} 章`}\n\n${chapter.content.trimEnd()}`,
    )
    .join('\n\n')}\n`;
}

export { analyze, countTextWords, sha256, sourceChain, validateFinalEvidence };

const invokedModuleUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === invokedModuleUrl) {
  const args = parseArgs(process.argv.slice(2));
  if (args) {
    const evidence = JSON.parse(fs.readFileSync(args.evidencePath, 'utf8'));
    const report = analyze(evidence, args.evidencePath);
    if (args.outDir) {
      fs.mkdirSync(args.outDir, { recursive: true });
      fs.writeFileSync(
        path.join(args.outDir, 'manuscript-analysis.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      fs.writeFileSync(path.join(args.outDir, 'manuscript.md'), renderManuscript(report), {
        encoding: 'utf8',
        flag: 'wx',
      });
    }
    const summary = {
      ...report,
      manuscript: {
        chapters: report.manuscript.chapters.map(({ chapter, title, content }) => ({
          chapter,
          title,
          contentSha256: sha256(content),
        })),
      },
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}
