import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { countTextWords, sha256, sourceChain } from './analyze-real-conversation-manuscript.mjs';

const EVIDENCE_SCHEMA_VERSION = 'real_conversation_acceptance_evidence_v6';
const CANDIDATE_INTEGRITY_CONTRACT_VERSION = 'chapter_candidate_integrity_v4';
const CHECKPOINT_SCHEMA_VERSION = 'real_conversation_completion_prefix_v1';
const ANALYZER_VERSION = 'ans_manuscript_checkpoint_analysis_v1';
const DEFAULT_TARGET_WORDS = 30_000;

const CAUTION_PHRASES = [
  '不能证明',
  '不能确认',
  '无法确认',
  '尚未确认',
  '未确认',
  '未核验',
  '不代表',
  '不能认定',
  '暂不得确认',
];

const STYLE_TICS = [
  '像是',
  '仿佛',
  '似乎',
  '沉默',
  '没有回答',
  '没有立刻回答',
  '停了一下',
  '看了她一眼',
  '她没有',
];

const MOTIFS = [
  '磁带',
  '录音',
  '档案',
  '编号',
  '十三',
  '排风机',
  '水滴',
  '父亲',
  '周启明',
  '沈弦',
  '七码头',
];

const TEMPORAL_PATTERN =
  /(?:\d{1,2}[：:]\d{2}(?::\d{2})?|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|(?:凌晨|清晨|早晨|上午|中午|下午|傍晚|晚上|深夜|午夜)[^，。！？；\n]{0,10}|(?:当天|当晚|次日|翌日|第二天|前一天|昨日|今天|明天|数日后|几天后|一周后|一个月后|多年后|十年前|三年前))/gu;

function usage() {
  console.error(
    'Usage: node scripts/analysis/analyze-real-conversation-checkpoint.mjs <real-conversation-evidence.json> [--target-words 30000] [--out-dir <directory>]',
  );
}

function parseArgs(argv) {
  const positional = [];
  let targetWords = DEFAULT_TARGET_WORDS;
  let outDir = '';
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--target-words') {
      targetWords = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--out-dir') {
      outDir = argv[index + 1] ?? '';
      index += 1;
    } else {
      positional.push(value);
    }
  }
  if (
    positional.length !== 1 ||
    !Number.isSafeInteger(targetWords) ||
    targetWords <= 0 ||
    (argv.includes('--out-dir') && !outDir)
  ) {
    usage();
    process.exitCode = 2;
    return null;
  }
  const evidencePath = path.resolve(positional[0]);
  return {
    evidencePath,
    targetWords,
    outDir: outDir ? path.resolve(outDir) : path.dirname(evidencePath),
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectCheckpoint(code, message) {
  throw new Error(`${code}: ${message}`);
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function distribution(values) {
  if (values.length === 0) {
    return { minimum: 0, maximum: 0, mean: 0, median: 0, stdev: 0, cv: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);
  return {
    minimum: sorted[0],
    maximum: sorted.at(-1),
    mean: round(mean, 2),
    median: sorted[Math.floor((sorted.length - 1) / 2)],
    stdev: round(stdev, 2),
    cv: mean ? round(stdev / mean) : 0,
  };
}

function splitParagraphs(value) {
  return value
    .split(/\r?\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitSentences(value) {
  return value
    .split(/(?<=[。！？!?；;])|\r?\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProse(value) {
  return value.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

function excerpt(value, fromEnd = false, limit = 180) {
  const compact = value.replace(/\s+/gu, ' ').trim();
  if (compact.length <= limit) return compact;
  return fromEnd ? `…${compact.slice(-limit)}` : `${compact.slice(0, limit)}…`;
}

function countPhrase(value, phrase) {
  return value.split(phrase).length - 1;
}

function shingleSet(value, size = 8) {
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
  return intersection / Math.max(1, left.size + right.size - intersection);
}

function dialogueCharacterCount(value) {
  return [...value.matchAll(/[“"]([^”"]+)[”"]/gu)].reduce((sum, match) => sum + match[1].length, 0);
}

function repeatedUnits(chapters, selector, minimumLength) {
  const occurrences = new Map();
  for (const chapter of chapters) {
    const seen = new Set();
    for (const unit of selector(chapter.adoptedContent)) {
      const normalized = normalizeProse(unit);
      if (normalized.length < minimumLength || seen.has(normalized)) continue;
      seen.add(normalized);
      const row = occurrences.get(normalized) ?? {
        sample: excerpt(unit, false, 140),
        chapters: [],
      };
      row.chapters.push(chapter.chapter);
      occurrences.set(normalized, row);
    }
  }
  return [...occurrences.values()]
    .filter((row) => row.chapters.length > 1)
    .sort(
      (left, right) =>
        right.chapters.length - left.chapters.length || right.sample.length - left.sample.length,
    )
    .slice(0, 40);
}

function validateChapterIdentity(chapters, field) {
  const values = chapters.map((chapter) => chapter[field]);
  if (values.some((value) => typeof value !== 'string' || !value.trim())) {
    rejectCheckpoint('CHECKPOINT_ID_MISSING', `Every included chapter must retain ${field}.`);
  }
  if (new Set(values).size !== values.length) {
    rejectCheckpoint('CHECKPOINT_ID_DUPLICATE', `${field} must be unique in the prefix.`);
  }
}

function selectCompletedPrefix(evidence, targetWords) {
  if (!isRecord(evidence)) {
    rejectCheckpoint('CHECKPOINT_EVIDENCE_INVALID', 'Evidence must be a JSON object.');
  }
  if (evidence.evidenceSchemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    rejectCheckpoint('CHECKPOINT_SCHEMA_UNSUPPORTED', `Expected ${EVIDENCE_SCHEMA_VERSION}.`);
  }
  if (evidence.candidateIntegrityContractVersion !== CANDIDATE_INTEGRITY_CONTRACT_VERSION) {
    rejectCheckpoint(
      'CHECKPOINT_CANDIDATE_CONTRACT_UNSUPPORTED',
      `Expected ${CANDIDATE_INTEGRITY_CONTRACT_VERSION}.`,
    );
  }
  if (evidence.status !== 'failed') {
    rejectCheckpoint(
      'CHECKPOINT_SOURCE_NOT_FAILED',
      'This completion-prefix analyzer only accepts evidence that failed after a reached checkpoint.',
    );
  }
  if (!Array.isArray(evidence.chapters) || evidence.chapters.length === 0) {
    rejectCheckpoint('CHECKPOINT_CHAPTERS_MISSING', 'Evidence contains no chapter rows.');
  }
  evidence.chapters.forEach((chapter, index) => {
    if (!isRecord(chapter) || chapter.chapter !== index + 1) {
      rejectCheckpoint(
        'CHECKPOINT_CHAPTER_SEQUENCE_INVALID',
        'Observed chapter rows must be contiguous and ordered from chapter 1.',
      );
    }
  });
  const firstNonPassedIndex = evidence.chapters.findIndex((chapter) => chapter.status !== 'passed');
  if (firstNonPassedIndex < 0) {
    rejectCheckpoint(
      'CHECKPOINT_FAILURE_BOUNDARY_MISSING',
      'Failed evidence must retain the chapter where completion stopped.',
    );
  }
  const chapters = evidence.chapters.slice(0, firstNonPassedIndex);
  const excludedChapters = evidence.chapters.slice(firstNonPassedIndex);
  if (chapters.length === 0 || excludedChapters[0]?.status !== 'failed') {
    rejectCheckpoint(
      'CHECKPOINT_COMPLETED_PREFIX_MISSING',
      'A non-empty passed prefix followed by a failed chapter is required.',
    );
  }
  if (excludedChapters.slice(1).some((chapter) => chapter.status === 'passed')) {
    rejectCheckpoint(
      'CHECKPOINT_NONCONTIGUOUS_COMPLETION',
      'Passed chapters after the first failed chapter cannot be included in a completion prefix.',
    );
  }

  const wordCount = chapters.reduce((sum, chapter) => {
    if (typeof chapter.adoptedContent !== 'string' || !chapter.adoptedContent.trim()) {
      rejectCheckpoint(
        'CHECKPOINT_ADOPTED_CONTENT_MISSING',
        `Chapter ${chapter.chapter} has no adopted content.`,
      );
    }
    const calculated = countTextWords(chapter.adoptedContent);
    if (chapter.wordCount !== calculated) {
      rejectCheckpoint(
        'CHECKPOINT_CHAPTER_WORD_LEDGER_MISMATCH',
        `Chapter ${chapter.chapter} word count does not match adopted content.`,
      );
    }
    if (sha256(chapter.adoptedContent) !== chapter.adoptedHash) {
      rejectCheckpoint(
        'CHECKPOINT_ADOPTED_HASH_MISMATCH',
        `Chapter ${chapter.chapter} adopted hash does not match content.`,
      );
    }
    return sum + calculated;
  }, 0);
  if (wordCount < targetWords) {
    rejectCheckpoint(
      'CHECKPOINT_TARGET_NOT_REACHED',
      `Completed prefix contains ${wordCount} words, below target ${targetWords}.`,
    );
  }
  if (evidence.completedChapterCount !== chapters.length) {
    rejectCheckpoint(
      'CHECKPOINT_COMPLETED_COUNT_MISMATCH',
      'Top-level completedChapterCount does not match the passed prefix.',
    );
  }
  if (evidence.totalWordCount !== wordCount) {
    rejectCheckpoint(
      'CHECKPOINT_TOTAL_WORD_LEDGER_MISMATCH',
      'Top-level totalWordCount does not match the passed prefix.',
    );
  }
  for (const field of [
    'chapterId',
    'artifactId',
    'summaryTurnId',
    'summaryRunId',
    'summaryArtifactId',
    'summaryApplyTransactionId',
    'summaryId',
  ]) {
    validateChapterIdentity(chapters, field);
  }
  return { chapters, excludedChapters, wordCount };
}

function candidateCompatibility(chapter) {
  const adopted = chapter.adoptedContent;
  const exact = sha256(adopted) === chapter.candidateHash;
  const trailingLfOnly =
    adopted.endsWith('\n') && sha256(adopted.slice(0, -1)) === chapter.candidateHash;
  return {
    mode: exact ? 'exact_match' : trailingLfOnly ? 'trailing_lf_only' : 'mismatch',
    passed: exact || trailingLfOnly,
    candidateSha256: chapter.candidateHash,
    adoptedSha256: chapter.adoptedHash,
    calculatedAdoptedSha256: sha256(adopted),
  };
}

function chapterMetrics(chapter) {
  const content = chapter.adoptedContent;
  const paragraphs = splitParagraphs(content);
  const sentences = splitSentences(content);
  const sentenceWordCounts = sentences.map(countTextWords);
  const paragraphWordCounts = paragraphs.map(countTextWords);
  const compatibility = candidateCompatibility(chapter);
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
    sentenceWords: distribution(sentenceWordCounts),
    paragraphWords: distribution(paragraphWordCounts),
    dialogueCharacterRatio: round(dialogueCharacterCount(content) / Math.max(1, content.length)),
    temporalMarkerCount: [...content.matchAll(TEMPORAL_PATTERN)].length,
    candidateCompatibility: compatibility,
    summaryClosedLoop: {
      applied: Boolean(
        chapter.summaryId && chapter.summaryArtifactId && chapter.summaryApplyTransactionId,
      ),
      contextRecordCount: chapter.contextRecordCount,
      memorySourceTypes: chapter.memorySourceTypes ?? [],
      independentSessionId: chapter.summaryExecutionEvidence?.sessionId ?? '',
      providerMessageCounts: chapter.summaryExecutionEvidence?.messageCounts ?? [],
      providerInputTokens: chapter.summaryExecutionEvidence?.providerUsage?.input ?? 0,
    },
    hashes: {
      candidateSha256: chapter.candidateHash,
      adoptedSha256: chapter.adoptedHash,
      continuitySourceSha256: chapter.continuitySourceHash,
    },
    openingExcerpt: excerpt(content),
    closingExcerpt: excerpt(content, true),
  };
}

function prefixValidation(evidence, chapters, rawSourceChain) {
  const compatibility = chapters.map((chapter) => ({
    chapter: chapter.chapter,
    ...candidateCompatibility(chapter),
  }));
  const compatibilityIssues = compatibility
    .filter((row) => !row.passed)
    .map((row) => ({ chapter: row.chapter, check: 'candidateContentCompatible' }));
  const legacyTailLfIssues = rawSourceChain.issues.filter(
    (issue) => issue.check === 'candidateToAdoptedEditIsOnlyTrailingLf',
  );
  const otherSourceChainIssues = rawSourceChain.issues.filter(
    (issue) => issue.check !== 'candidateToAdoptedEditIsOnlyTrailingLf',
  );
  const summarySessionIds = chapters.map(
    (chapter) => chapter.summaryExecutionEvidence?.sessionId ?? '',
  );
  const summaryChecks = chapters.map((chapter) => ({
    chapter: chapter.chapter,
    applied: Boolean(
      chapter.summaryId && chapter.summaryArtifactId && chapter.summaryApplyTransactionId,
    ),
    contextPersisted:
      Number.isSafeInteger(chapter.contextRecordCount) && chapter.contextRecordCount > 0,
    memoryPersisted: ['adopted_draft', 'chapter_summary', 'context_record'].every((type) =>
      (chapter.memorySourceTypes ?? []).includes(type),
    ),
    independentSummarySession: Boolean(chapter.summaryExecutionEvidence?.sessionId),
    summaryProviderMessageCountsReset:
      JSON.stringify(chapter.summaryExecutionEvidence?.messageCounts) === JSON.stringify([2, 5, 7]),
    positiveSummaryProviderInputTokens:
      Number(chapter.summaryExecutionEvidence?.providerUsage?.input ?? 0) > 0,
  }));
  const summaryClosedLoopPassed = summaryChecks.every((row) =>
    Object.entries(row)
      .filter(([key]) => key !== 'chapter')
      .every(([, value]) => value === true),
  );
  return {
    passed:
      compatibilityIssues.length === 0 &&
      otherSourceChainIssues.length === 0 &&
      summaryClosedLoopPassed &&
      summarySessionIds.every(Boolean) &&
      new Set(summarySessionIds).size === chapters.length,
    candidateCompatibilityRule:
      '候选与采用稿字节完全一致，或采用稿仅多一个尾部 LF，均视为内容兼容。',
    candidateCompatibility: compatibility,
    legacyAnalyzerDiagnostic: {
      applicableToPrefix: false,
      reason:
        '完整稿分析器要求 evidence 全书通过且包含 analysisMaterial；其 source-chain helper 还只接受采用稿多一个尾部 LF，因此会把候选与采用稿完全一致误报为失败。',
      rawPassed: rawSourceChain.passed,
      trailingLfOnlyIssueCount: legacyTailLfIssues.length,
      trailingLfOnlyIssues: legacyTailLfIssues,
      otherIssueCount: otherSourceChainIssues.length,
      otherIssues: otherSourceChainIssues,
    },
    planning: rawSourceChain.planning,
    summaryClosedLoop: {
      passed: summaryClosedLoopPassed,
      sessionIdsUnique:
        summarySessionIds.every(Boolean) && new Set(summarySessionIds).size === chapters.length,
      chapters: summaryChecks,
    },
  };
}

function adjacentTransitions(chapters) {
  return chapters.slice(1).map((chapter, index) => {
    const prior = chapters[index];
    const priorEnding = excerpt(prior.adoptedContent, true, 260);
    const currentOpening = excerpt(chapter.adoptedContent, false, 260);
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
  const sets = chapters.map((chapter) => shingleSet(chapter.adoptedContent));
  const rows = [];
  for (let left = 0; left < chapters.length; left += 1) {
    for (let right = left + 1; right < chapters.length; right += 1) {
      rows.push({
        leftChapter: chapters[left].chapter,
        rightChapter: chapters[right].chapter,
        shingleSimilarity: round(jaccard(sets[left], sets[right])),
      });
    }
  }
  return rows.sort((left, right) => right.shingleSimilarity - left.shingleSimilarity).slice(0, 15);
}

function phraseMetrics(fullText, phrases) {
  return phrases
    .map((phrase) => ({ phrase, count: countPhrase(fullText, phrase) }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count);
}

function editorialAssessment(chapters, corpus, styleReview, repetitionReview) {
  const cautionCount = styleReview.evidentiaryCautionPhrases.reduce(
    (sum, row) => sum + row.count,
    0,
  );
  const highDialogueChapters = styleReview.chapterDialogueRatios
    .filter((row) => row.ratio >= 0.4)
    .map((row) => ({ chapter: row.chapter, ratio: row.ratio }));
  const firstPhysicalEscalation = chapters.find((chapter) =>
    /从暗处冲出|拽住肩包|录音机被抢|拉扯中从机器/u.test(chapter.adoptedContent),
  )?.chapter;
  return {
    scope: 'completed_prefix_only',
    verdict:
      '3 万字真实使用 checkpoint 已达到，调查悬疑主线连贯；但这只是 6 万字规划的前半段，不是完整故事质量结论。',
    strengths: [
      {
        code: 'stable_evidence_chain',
        observation:
          '磁带、档案、编号、排风声、水滴声与抵达时间差反复互证，构成同一条线索链，而非彼此无关的转折。',
        evidence: { motifCounts: styleReview.motifCounts },
      },
      {
        code: 'disciplined_uncertainty',
        observation:
          '主角持续区分观察、推断与确认事实，避免悬疑过早被伪确定性破坏，也建立了稳定的调查者声音。',
        evidence: { evidentiaryCautionPhraseCount: cautionCount },
      },
      {
        code: 'chapter_end_hooks',
        observation: '各章结尾持续增加可指认的矛盾、编号、威胁或录音片段，前 10 章推进力稳定。',
        evidence: {
          reviewedChapters: chapters.map((chapter) => chapter.chapter),
          closingExcerptsPath: 'chapters[].closingExcerpt',
        },
      },
    ],
    optimizationPriorities: [
      {
        priority: 'high',
        code: 'compress_repeated_evidentiary_disclaimers',
        observation: `前缀含 ${cautionCount} 处显式谨慎判断表达。严谨性能够塑造人物，但规则建立后反复完整解释会拖慢场景。`,
        recommendation:
          '每次关键推断保留一句最有力的不确定性说明；邻近重复改为动作、停顿或调查记录中的短注。',
      },
      {
        priority: 'high',
        code: 'remove_accidental_exact_reuse',
        observation:
          repetitionReview.duplicateParagraphsAcrossChapters.length > 0
            ? `检测到 ${repetitionReview.duplicateParagraphsAcrossChapters.length} 组跨章完全重复段落；其中第 4、6 章复用了同一段录音交接核验申请话术。`
            : '未检测到跨章完全重复段落。',
        recommendation:
          '删除或改写非刻意回环的复用段句；若要表现调查流程重复，应让第二次问询新增阻力、情绪或信息差。',
      },
      {
        priority: 'high',
        code: 'vary_investigation_scene_mechanics',
        observation: `较多线索通过柜台、表单、电话、目录和工作人员回避式问答取得；高对话占比章节为 ${highDialogueChapters.map((row) => `第 ${row.chapter} 章 ${round(row.ratio * 100, 2)}%`).join('、') || '无'}，逻辑清楚但场景机制容易同质化。`,
        recommendation:
          '在文档核验之间加入证人的两难选择、空间行动、关系压力及无法靠下一份记录解决的现实后果。',
      },
      {
        priority: 'high',
        code: 'turn_midpoint_clues_into_irreversible_choice',
        observation:
          firstPhysicalEscalation === undefined
            ? '完成前缀中未检测到明确的现实冲突升级。'
            : `首次明确的现实冲突升级出现在第 ${firstPhysicalEscalation} 章，接近 20 章规划的中点。`,
        recommendation:
          '让中点抢夺与“抵达时间被改”迫使主角作出有代价的选择、承受损失、建立联盟或公开立场，而不只是继续扩充线索清单。',
      },
      {
        priority: 'medium',
        code: 'reduce_identifier_cognitive_load',
        observation:
          'A-07-16-23-13、JQ-0716-13、M-0716-02、217 与多组冲突时间有意互联，但读者需要同时记忆大量相似标记。',
        recommendation:
          '每次揭示都把编号绑定一个稳定的自然语言标签，只说明本次新增或改变的关系；完整账本留在内部时间线，避免在对话中重复全部标记。',
      },
      {
        priority: 'medium',
        code: 'deepen_personal_and_secondary_character_arcs',
        observation:
          '调查者声音清楚，但不少配角主要承担阻拦、限定或转述信息的功能；父亲线目前也更偏证据关系，情感变化较弱。',
        recommendation:
          '为关键证人和把关者补充不同的欲望、风险与说话节奏，并让每个重大线索改变沈弦的信任、哀伤或关系策略。',
      },
      {
        priority: 'medium',
        code: 'maintain_canonical_timeline',
        observation: `前缀含 ${corpus.temporalMarkerCount} 处显式时间标记，其中包含有意冲突的时钟与抵达记录。`,
        recommendation:
          '维护场景级权威时间线，记录来源、显示时间、校正时间、置信度与受影响人物；正文只展示当前推理所需的最小对照。',
      },
    ],
    nextReviewGate: [
      '核对第 11-20 章是否回收或有意延后每条高权重线索，不能把结构化总结直接当作正文事实。',
      '逐章复核人物知情范围与物件保管链，重点检查磁带、录音副本、录音机、档案页和编号 217。',
      '只有所有规划章节均通过、采用、总结并写入 analysisMaterial 后，才能进行最终全书语义审查。',
    ],
  };
}

function buildCheckpointReport(evidence, evidencePath, targetWords, sourceText = '') {
  const { chapters, excludedChapters, wordCount } = selectCompletedPrefix(evidence, targetWords);
  const fullText = chapters.map((chapter) => chapter.adoptedContent).join('\n');
  const chapterRows = chapters.map(chapterMetrics);
  const paragraphs = splitParagraphs(fullText);
  const sentences = splitSentences(fullText);
  const projectedEvidence = {
    ...evidence,
    chapters,
    userInstructions: evidence.userInstructions.slice(0, chapters.length),
    chapterCount: chapters.length,
    completedChapterCount: chapters.length,
    totalWordCount: wordCount,
    independentWordCount: wordCount,
    chapterWordCountSum: wordCount,
    novelWordCount: wordCount,
  };
  const rawSourceChain = sourceChain(projectedEvidence, chapters);
  const validation = prefixValidation(evidence, chapters, rawSourceChain);
  if (!validation.passed) {
    rejectCheckpoint(
      'CHECKPOINT_PREFIX_VALIDATION_FAILED',
      'The completed prefix failed content, source-chain, or summary closed-loop validation.',
    );
  }
  const styleReview = {
    evidentiaryCautionPhrases: phraseMetrics(fullText, CAUTION_PHRASES),
    selectedStyleTics: phraseMetrics(fullText, STYLE_TICS),
    motifCounts: phraseMetrics(fullText, MOTIFS),
    chapterDialogueRatios: chapterRows.map((chapter) => ({
      chapter: chapter.chapter,
      ratio: chapter.dialogueCharacterRatio,
    })),
  };
  const corpus = {
    characters: fullText.length,
    wordCount,
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    temporalMarkerCount: [...fullText.matchAll(TEMPORAL_PATTERN)].length,
    chapterWordCounts: distribution(chapterRows.map((chapter) => chapter.wordCount)),
    sentenceWords: distribution(sentences.map(countTextWords)),
    paragraphWords: distribution(paragraphs.map(countTextWords)),
  };
  const repetitionReview = {
    duplicateParagraphsAcrossChapters: repeatedUnits(chapters, splitParagraphs, 24),
    duplicateSentencesAcrossChapters: repeatedUnits(chapters, splitSentences, 18),
    mostSimilarChapterPairs: pairSimilarities(chapters),
  };
  return {
    checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    sourceEvidenceFile: path.basename(evidencePath),
    sourceEvidenceSha256: sourceText ? sha256(sourceText) : '',
    sourceEvidenceStatus: 'failed_after_checkpoint',
    analysisScope: 'contiguous_passed_chapter_prefix_only',
    sourceEvidence: {
      originalStatus: evidence.status,
      failureStage: evidence.failureStage,
      failureReason: evidence.failureReason,
      model: evidence.model,
      plannedChapterCount: evidence.plannedChapterCount,
      plannedTargetWordCount: evidence.plannedTargetWordCount,
      observedChapterRows: evidence.chapters.length,
      completedChapterCount: evidence.completedChapterCount,
      analysisMaterialPresent: isRecord(evidence.analysisMaterial),
      originalEvidenceWasModified: false,
      ledgerSnapshot: {
        totalWordCount: evidence.totalWordCount,
        independentWordCount: evidence.independentWordCount,
        chapterWordCountSum: evidence.chapterWordCountSum,
        novelWordCount: evidence.novelWordCount,
        interpretation:
          '失败 evidence 仅以 totalWordCount 记录完成前缀；三个完整稿终局 ledger 保持 0，不能伪装为全书结算完成。',
      },
    },
    checkpoint: {
      targetWordCount: targetWords,
      targetReached: wordCount >= targetWords,
      completedChapterCount: chapters.length,
      includedChapterNumbers: chapters.map((chapter) => chapter.chapter),
      wordCount,
      combinedAdoptedContentSha256: sha256(fullText),
      failureOccurredAfterCheckpoint: true,
      excludedChapters: excludedChapters.map((chapter) => ({
        chapter: chapter.chapter,
        title: chapter.chapterTitle,
        status: chapter.status,
        reportedWordCount: chapter.wordCount,
        exclusionReason: 'status_not_passed',
        error: chapter.error ?? '',
      })),
    },
    validation,
    limitations: [
      {
        code: 'not_full_book_evidence',
        explanation:
          '本报告证明连续通过前缀达到 3 万字，不证明 6 万字全书运行通过，也不证明故事已经完结。',
      },
      {
        code: 'failed_evidence_has_no_analysis_material',
        explanation:
          '源 evidence 以 analysisMaterial=null 结束，因此本报告无法重新做世界/规则原文与结构化章节 Context 的语义核对。',
      },
      {
        code: 'heuristics_require_editorial_judgment',
        explanation: '重复、对话、节奏、时间与相似度指标只定位审阅候选，不能单独证明写作缺陷。',
      },
      {
        code: 'excluded_failed_chapter',
        explanation: '第 11 章行虽含采用正文，但自动总结及闭环未完成，因此严格排除。',
      },
    ],
    corpus,
    chapters: chapterRows,
    continuityReview: {
      adjacentTransitions: adjacentTransitions(chapters),
      temporalMarkersByChapter: chapterRows.map((chapter) => ({
        chapter: chapter.chapter,
        count: chapter.temporalMarkerCount,
      })),
    },
    repetitionReview,
    styleReview,
    editorialAssessment: editorialAssessment(chapters, corpus, styleReview, repetitionReview),
  };
}

function renderCheckpointManuscript(report, chapters) {
  const metadata = [
    '<!--',
    `checkpointSchemaVersion: ${report.checkpointSchemaVersion}`,
    `sourceEvidenceFile: ${report.sourceEvidenceFile}`,
    `sourceEvidenceSha256: ${report.sourceEvidenceSha256}`,
    `sourceEvidenceStatus: ${report.sourceEvidenceStatus}`,
    `completedChapterCount: ${report.checkpoint.completedChapterCount}`,
    `wordCount: ${report.checkpoint.wordCount}`,
    'scope: contiguous passed prefix only; chapter 11 and later are excluded',
    '-->',
  ].join('\n');
  const body = chapters
    .map(
      (chapter) =>
        `# ${chapter.chapterTitle || `第 ${chapter.chapter} 章`}\n\n${chapter.adoptedContent.trimEnd()}`,
    )
    .join('\n\n');
  return `${metadata}\n\n${body}\n`;
}

function writeCheckpointArtifacts({ evidencePath, outDir, targetWords }) {
  const sourceText = fs.readFileSync(evidencePath, 'utf8');
  const evidence = JSON.parse(sourceText);
  const prefix = selectCompletedPrefix(evidence, targetWords);
  const report = buildCheckpointReport(evidence, evidencePath, targetWords, sourceText);
  const manuscript = renderCheckpointManuscript(report, prefix.chapters);
  report.artifacts = {
    manuscriptFile: `checkpoint-${targetWords}-manuscript.md`,
    manuscriptFileSha256: sha256(manuscript),
    analysisFile: `checkpoint-${targetWords}-analysis.json`,
  };
  report.validation.sourceEvidenceSha256Unchanged =
    sha256(fs.readFileSync(evidencePath, 'utf8')) === report.sourceEvidenceSha256;
  if (!report.validation.sourceEvidenceSha256Unchanged) {
    rejectCheckpoint(
      'CHECKPOINT_SOURCE_CHANGED_DURING_ANALYSIS',
      'Source evidence changed while checkpoint artifacts were being prepared.',
    );
  }
  fs.mkdirSync(outDir, { recursive: true });
  const manuscriptPath = path.join(outDir, report.artifacts.manuscriptFile);
  const analysisPath = path.join(outDir, report.artifacts.analysisFile);
  fs.writeFileSync(manuscriptPath, manuscript, { encoding: 'utf8', flag: 'wx' });
  try {
    fs.writeFileSync(analysisPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    fs.rmSync(manuscriptPath, { force: true });
    throw error;
  }
  return { report, manuscriptPath, analysisPath };
}

export {
  buildCheckpointReport,
  candidateCompatibility,
  renderCheckpointManuscript,
  selectCompletedPrefix,
  writeCheckpointArtifacts,
};

const invokedModuleUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === invokedModuleUrl) {
  const args = parseArgs(process.argv.slice(2));
  if (args) {
    const result = writeCheckpointArtifacts(args);
    process.stdout.write(
      `${JSON.stringify(
        {
          sourceEvidenceStatus: result.report.sourceEvidenceStatus,
          completedChapterCount: result.report.checkpoint.completedChapterCount,
          wordCount: result.report.checkpoint.wordCount,
          excludedChapters: result.report.checkpoint.excludedChapters.map(
            ({ chapter, status }) => ({
              chapter,
              status,
            }),
          ),
          manuscriptPath: result.manuscriptPath,
          analysisPath: result.analysisPath,
        },
        null,
        2,
      )}\n`,
    );
  }
}
