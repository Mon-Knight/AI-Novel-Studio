import { CircleCheck, PencilLine, Play, RefreshCw, Sparkles, X } from 'lucide-react';
import {
  CHAPTER_CORE_ASSET_DESCRIPTORS,
  type ChapterAssetRecovery,
  type ChapterCoreAsset,
} from '../../services/conversation/chapterAssetReadiness';

interface WorkbenchAssetReadinessCardProps {
  recovery: ChapterAssetRecovery;
  busy: boolean;
  running: boolean;
  candidateCardId?: string;
  onViewCandidate?: (cardId: string) => void;
  onGenerate: (asset: ChapterCoreAsset) => void;
  onEdit: (asset: ChapterCoreAsset) => void;
  onRefresh: () => void;
  onResume: () => void;
  onDismiss: () => void;
}

export function WorkbenchAssetReadinessCard({
  recovery,
  busy,
  running,
  candidateCardId,
  onViewCandidate,
  onGenerate,
  onEdit,
  onRefresh,
  onResume,
  onDismiss,
}: WorkbenchAssetReadinessCardProps) {
  const ready = recovery.missingAssets.length === 0;
  const actionsDisabled = busy || running;
  const phase = recovery.orchestration.phase;
  const canGenerate = phase === 'queued' || phase === 'failed';
  const phaseLabel =
    phase === 'queued'
      ? '即将自动准备'
      : phase === 'generating'
        ? '正在生成候选'
        : phase === 'awaiting_apply'
          ? '等待应用候选'
          : phase === 'failed'
            ? '需要手动重试'
            : '正在恢复正文';

  const renderAssetItem = (asset: ChapterCoreAsset, index: number) => {
    const descriptor = CHAPTER_CORE_ASSET_DESCRIPTORS[asset];
    const isCurrent = index === 0;
    const awaitingCandidate = isCurrent && phase === 'awaiting_apply';
    const canLocateCandidate = Boolean(candidateCardId && onViewCandidate);
    const currentState = isCurrent
      ? phase === 'generating'
        ? '正在生成'
        : phase === 'awaiting_apply'
          ? '请应用候选'
          : phase === 'failed'
            ? '生成失败'
            : '即将开始'
      : '等待前项';
    return (
      <div
        className={'workbench-asset-readiness__item ' + (isCurrent ? 'is-current' : 'is-queued')}
        data-testid={`workbench-missing-asset-${asset}`}
        data-asset-state={isCurrent ? 'current' : 'queued'}
        aria-current={isCurrent ? 'step' : undefined}
        key={asset}
      >
        <span className="workbench-asset-readiness__index">{index + 1}</span>
        <div className="workbench-asset-readiness__copy">
          <strong>
            {descriptor.label}
            <span role={isCurrent ? 'status' : undefined}>{currentState}</span>
          </strong>
          <span>{descriptor.reason}</span>
        </div>
        <div className="workbench-asset-readiness__item-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid={
              awaitingCandidate
                ? 'workbench-view-preparation-candidate'
                : `workbench-generate-asset-${asset}`
            }
            data-candidate-card-id={awaitingCandidate ? candidateCardId : undefined}
            disabled={
              awaitingCandidate
                ? !canLocateCandidate
                : actionsDisabled || !isCurrent || !canGenerate
            }
            title={
              awaitingCandidate && !canLocateCandidate
                ? '本次候选卡尚未恢复，请重新检查；不会跳转到其他候选。'
                : isCurrent
                  ? undefined
                  : '请先完成前一项创作资产'
            }
            onClick={() => {
              if (awaitingCandidate) {
                if (candidateCardId) onViewCandidate?.(candidateCardId);
              } else onGenerate(asset);
            }}
          >
            <Sparkles aria-hidden="true" size={13} strokeWidth={1.8} />
            {awaitingCandidate
              ? canLocateCandidate
                ? '查看本次候选'
                : '正在恢复本次候选'
              : phase === 'generating' && isCurrent
                ? '正在生成候选…'
                : phase === 'failed' && isCurrent
                  ? descriptor.generateLabel.replace('生成', '重试')
                  : descriptor.generateLabel}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid={`workbench-edit-asset-${asset}`}
            disabled={busy || running || !isCurrent || phase === 'awaiting_apply'}
            title={isCurrent ? undefined : '请先完成前一项创作资产'}
            onClick={() => onEdit(asset)}
          >
            <PencilLine aria-hidden="true" size={13} strokeWidth={1.8} />
            {descriptor.editLabel}
          </button>
        </div>
      </div>
    );
  };

  const normalizedGoal = recovery.originalGoal.trim() || '原始创作要求未提供';
  const goalPreview =
    normalizedGoal.length > 180 ? normalizedGoal.slice(0, 177) + '…' : normalizedGoal;
  const currentAsset = recovery.missingAssets[0];
  const nextAsset = recovery.missingAssets[1];
  const currentDescriptor = currentAsset ? CHAPTER_CORE_ASSET_DESCRIPTORS[currentAsset] : undefined;
  const nextDescriptor = nextAsset ? CHAPTER_CORE_ASSET_DESCRIPTORS[nextAsset] : undefined;
  const nextStepLabel = ready
    ? '下一步：继续生成正文'
    : phase === 'awaiting_apply'
      ? `下一步：应用${currentDescriptor?.label ?? '当前'}候选${nextDescriptor ? `后准备${nextDescriptor.label}` : '后继续'}`
      : phase === 'failed'
        ? `下一步：重试${currentDescriptor?.label ?? '当前资产'}`
        : phase === 'generating'
          ? `下一步：等待${currentDescriptor?.label ?? '当前资产'}候选完成`
          : `下一步：开始准备${currentDescriptor?.label ?? '当前资产'}`;

  return (
    <article
      aria-busy={busy || phase === 'generating'}
      className={`workbench-asset-readiness ${ready ? 'is-ready' : 'is-blocked'}`}
      data-testid="workbench-asset-readiness"
      data-ready={ready ? 'true' : 'false'}
      data-chapter-id={recovery.chapterId ?? ''}
      data-orchestration-phase={phase}
      data-orchestration-asset={recovery.orchestration.asset ?? ''}
      data-orchestration-error-code={recovery.orchestration.errorCode ?? ''}
      data-orchestration-updated-at={recovery.orchestration.updatedAt}
      data-preparation-turn-id={recovery.orchestration.preparationTurnId ?? ''}
      data-source-turn-id={recovery.sourceTurnId ?? ''}
      data-context-stage="automatic-preparation"
    >
      <div className="workbench-asset-readiness__header">
        <div>
          <div className="workbench-eyebrow">系统自动准备</div>
          <h3>{ready ? '写章前置资产已就绪' : `还需补充 ${recovery.missingAssets.length} 项`}</h3>
        </div>
        <span className="workbench-asset-readiness__status">
          {ready ? (
            <>
              <CircleCheck aria-hidden="true" size={14} strokeWidth={1.8} />
              {phaseLabel}
            </>
          ) : (
            phaseLabel
          )}
        </span>
      </div>

      <div className="workbench-asset-readiness__goal">
        <span>你的原始创作要求</span>
        <p title={normalizedGoal}>{goalPreview}</p>
        {goalPreview !== normalizedGoal && (
          <details
            className="workbench-asset-readiness__full-goal"
            data-disclosure-key={`asset-readiness-goal:${recovery.conversationId}:${recovery.createdAt}`}
          >
            <summary>查看完整原始要求</summary>
            <p>{normalizedGoal}</p>
          </details>
        )}
      </div>

      {!ready && (
        <p className="workbench-asset-readiness__note">
          系统会依据这条简短要求准备正式创作资产，不需要你补写详细提示词。
        </p>
      )}

      {!ready && (
        <>
          <p
            className="workbench-asset-readiness__next-step"
            data-testid="workbench-asset-readiness-next-step"
          >
            {nextStepLabel}
          </p>
          <div className="workbench-asset-readiness__items">
            {recovery.missingAssets.slice(0, 1).map(renderAssetItem)}
          </div>
          {recovery.missingAssets.length > 1 && (
            <details
              className="workbench-asset-readiness__remaining"
              data-disclosure-key={`asset-readiness-remaining:${recovery.conversationId}:${recovery.createdAt}`}
            >
              <summary>查看后续准备（{recovery.missingAssets.length - 1} 项）</summary>
              <div className="workbench-asset-readiness__items">
                {recovery.missingAssets
                  .slice(1)
                  .map((asset, index) => renderAssetItem(asset, index + 1))}
              </div>
            </details>
          )}
        </>
      )}
      {!ready && (
        <p className="workbench-asset-readiness__note">
          {phase === 'awaiting_apply'
            ? '候选已经生成。点击当前项的“查看本次候选”可定位到这次准备的产物；审阅后仍需明确应用，成功后才会准备下一项。'
            : phase === 'failed'
              ? recovery.orchestration.error || '本次准备未完成，请重试当前项。'
              : '缺失项会按顺序生成候选；每项仍需你确认应用，候选不会直接改写作品。'}
        </p>
      )}

      <div className="workbench-asset-readiness__footer">
        {ready ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="workbench-resume-chapter-goal"
            disabled={actionsDisabled}
            onClick={onResume}
          >
            <Play aria-hidden="true" size={13} strokeWidth={1.8} />
            继续生成正文
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="workbench-refresh-asset-readiness"
            disabled={actionsDisabled}
            onClick={onRefresh}
          >
            <RefreshCw
              className={busy ? 'is-spinning' : undefined}
              aria-hidden="true"
              size={13}
              strokeWidth={1.8}
            />
            重新检查
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="workbench-dismiss-asset-readiness"
          disabled={busy}
          onClick={onDismiss}
        >
          <X aria-hidden="true" size={13} strokeWidth={1.8} />
          取消恢复
        </button>
      </div>
    </article>
  );
}
