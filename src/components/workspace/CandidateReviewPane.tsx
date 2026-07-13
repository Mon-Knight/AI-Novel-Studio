import { useMemo, useRef, useState } from 'react';
import NormalizedCandidateReview, { type CandidateReviewStatus } from '../ai-tasks/NormalizedCandidateReview';
import { normalizeCandidate } from '../../services/ai-tasks/normalizedCandidateService';
import type { Chapter } from '../../types/chapter';
import type { CandidateLifecycleContext, CandidateReviewRecord } from '../../types/placement';
import type { NormalizedCandidateChange } from '../../types/normalizedCandidate';

interface CandidateReviewPaneProps {
  chapter: Chapter;
  context: CandidateLifecycleContext;
  onAdopt: (record: CandidateReviewRecord) => Promise<void>;
  onClose: () => void;
  onOpenGenerator: () => void;
}

const STATUS_COPY: Record<CandidateLifecycleContext['status'], CandidateReviewStatus> = {
  empty: { tone: 'neutral', label: '暂无候选', message: '打开 AI 创作并生成正文。' },
  generating: { tone: 'working', label: '正在生成', message: '可以继续阅读正文，完成后再审查。' },
  validating: { tone: 'working', label: '检查未完成', message: '正在核对约束、差异和采用目标。' },
  ready: { tone: 'ready', label: '检查通过', message: '候选已经可以审查并采用。' },
  blocked: { tone: 'blocked', label: '存在阻断问题', message: '检查发现必须先处理的问题。' },
  baseline_changed: { tone: 'warning', label: '正文已变化', message: '差异仍对应生成时的草稿，禁止直接覆盖。' },
  adopted: { tone: 'neutral', label: '已经采用', message: '该候选已经进入正式正文。' },
  invalidated: { tone: 'blocked', label: '候选已失效', message: '请返回目标章节重新生成。' },
  cancelled: { tone: 'neutral', label: '生成已取消', message: '可以重新生成新的候选。' },
  failed: { tone: 'blocked', label: '生成失败', message: '检查错误后重新生成。' },
  read_failed: { tone: 'blocked', label: '读取失败', message: '重试读取或重新生成。' },
  diff_failed: { tone: 'blocked', label: '差异不可用', message: '无法根据冻结正文核对修改。' },
  format_error: { tone: 'blocked', label: '格式异常', message: '无法重建安全的完整正文。' },
  empty_content: { tone: 'blocked', label: '候选正文为空', message: '请重新生成正文。' },
  identity_mismatch: { tone: 'blocked', label: '候选身份异常', message: '候选与目标不一致，已阻止采用。' },
};

function fallbackChanges(context: CandidateLifecycleContext): NormalizedCandidateChange[] {
  return context.candidate?.diff?.blocks.flatMap((block, index) => {
    if (block.kind === 'unchanged') return [];
    return [{
      id: `paragraph-change-${index + 1}`,
      originalText: block.baseText || '',
      revisedText: block.candidateText || '',
      summary: block.kind === 'added' ? '新增内容' : block.kind === 'removed' ? '删除内容' : '修改内容',
      paragraphIndex: block.baseIndex,
      candidateParagraphIndex: block.candidateIndex,
    }];
  }) || [];
}

function CandidateReviewPane({ chapter, context, onAdopt, onClose, onOpenGenerator }: CandidateReviewPaneProps) {
  const [adopting, setAdopting] = useState(false);
  const adoptLockRef = useRef(false);
  const candidate = context.candidate;
  const normalized = useMemo(() => {
    if (!candidate) return null;
    const value = candidate.normalizedCandidate ?? normalizeCandidate({
      content: candidate.content,
      rawResponse: candidate.content,
      baseContent: candidate.baseContent,
    });
    return value.changes.length > 0 || value.status !== 'ready'
      ? value
      : { ...value, changes: fallbackChanges(context) };
  }, [candidate, context]);

  const visibleIssues = useMemo(() => {
    const validation = candidate?.constraintValidation;
    if (!validation) return [];
    return [...validation.must, ...validation.should, ...validation.forbid]
      .filter((item) => item.status !== 'passed')
      .map((item) => item.message);
  }, [candidate?.constraintValidation]);

  if (!candidate || !normalized) {
    const copy = STATUS_COPY[context.status];
    return (
      <section className="candidate-review candidate-review-state" aria-label="AI 正文候选审查">
        <strong>{copy.label}</strong>
        <p>{context.cannotAdoptReason || copy.message}</p>
        <button type="button" className="btn btn-primary" onClick={onOpenGenerator}>调整生成设置</button>
      </section>
    );
  }

  const warningCount = candidate.constraintValidation?.warningCount || 0;
  const status = context.status === 'baseline_changed'
    ? {
      tone: 'warning' as const,
      label: '正文已变化',
      message: `差异仍对应生成时的草稿${context.baseDraftVersion ? ` v${context.baseDraftVersion}` : ''}，请重新生成后再采用。`,
    }
    : context.status === 'ready' && warningCount > 0
      ? { tone: 'warning' as const, label: '需要复核', message: `检查通过，但有 ${warningCount} 项建议性提醒。` }
      : STATUS_COPY[context.status];
  const canAdopt = context.canAdopt && normalized.status === 'ready' && !adopting;
  const cannotAdoptReason = normalized.status === 'ready'
    ? context.cannotAdoptReason
    : normalized.error || '候选格式异常，禁止采用。';

  const handleAdopt = async () => {
    if (!canAdopt || !context.record || adoptLockRef.current) return;
    adoptLockRef.current = true;
    setAdopting(true);
    try {
      await onAdopt(context.record);
    } finally {
      adoptLockRef.current = false;
      setAdopting(false);
    }
  };

  return (
    <section className="candidate-review" aria-label="AI 正文候选审查">
      <NormalizedCandidateReview
        title={`第${chapter.chapterNumber}章：${chapter.title}`}
        metadata={[
          `${Array.from(normalized.fullText).length.toLocaleString()} 字`,
          normalized.mode === 'targeted_fix' ? '定向修订' : '全文改写',
          context.baseDraftVersion ? `基于草稿 v${context.baseDraftVersion}` : '',
        ].filter(Boolean)}
        candidate={normalized}
        status={status}
        constraintIssues={visibleIssues}
        technicalDetails={[
          { label: 'Candidate Artifact', value: candidate.artifactId },
          { label: 'AI Task', value: candidate.taskId },
          { label: 'Content hash', value: candidate.contentHash },
          { label: 'Base content hash', value: context.baseContentHash },
        ]}
        canAdopt={canAdopt}
        cannotAdoptReason={cannotAdoptReason}
        adopting={adopting}
        onDiscard={onClose}
        onRegenerate={onOpenGenerator}
        onAdopt={() => void handleAdopt()}
        adoptLabel="审查并采用此候选"
      />
    </section>
  );
}

export default CandidateReviewPane;
