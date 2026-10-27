import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  projectChapterStageTree,
  type ChapterFutureScene,
  type ChapterSceneProjection,
  type ChapterSceneStatus,
  type ChapterStage,
  type ChapterStageAnchor,
  type ChapterStagePersistenceSummary,
  type ChapterStageRow,
  type ChapterStageStatus,
} from '../../features/workbench/chapterStageProjection';
import './WorkbenchChapterStageTree.css';

const EMPTY_FUTURE_SCENES: readonly ChapterFutureScene[] = [];

const STAGE_STATUS_LABELS: Record<ChapterStageStatus, string> = {
  not_recorded: '暂无记录',
  pending: '待执行',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

const SCENE_STATUS_LABELS: Record<ChapterSceneStatus, string> = {
  ...STAGE_STATUS_LABELS,
  partial: '部分记录',
};

const PERSISTENCE_LABELS: Record<ChapterStagePersistenceSummary, string> = {
  sqlite: 'SQLite 持久记录',
  browser: '浏览器本机记录',
  mixed: 'SQLite / 浏览器记录',
  none: '暂无持久记录',
};

const PERSISTENCE_HINTS: Record<ChapterStagePersistenceSummary, string> = {
  sqlite: '阶段状态来自桌面 SQLite 持久执行事实',
  browser: '阶段状态来自浏览器本机记录，不等同于桌面 SQLite 事务',
  mixed: '同时包含 SQLite 与浏览器本机记录，不合并为单一事务证据',
  none: '尚无持久记录；无记录阶段不会显示为已完成',
};

export interface WorkbenchChapterStageTreeProps {
  readonly chapterTitle?: string;
  readonly stages: readonly ChapterStage[];
  /** Explicit Scene shells; their Beats are planned only when the scene is reached. */
  readonly futureScenes?: readonly ChapterFutureScene[];
  /** Bounded-read explanation from the reader; never presented as full history. */
  readonly historyNotice?: string;
  /** Locates an existing public run/tool/artifact record. It grants no decision or adoption. */
  readonly onLocate?: (anchor: ChapterStageAnchor) => void;
  readonly className?: string;
}

function classNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function activateOnKeyboard(event: KeyboardEvent<HTMLElement>, action: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
  event.preventDefault();
  action();
}

function attemptLabel(attempt: number | undefined): string | undefined {
  return attempt && attempt > 1 ? `第 ${attempt} 次尝试` : undefined;
}

function revisionLabel(revision: string | undefined): string | undefined {
  const text = revision?.trim();
  if (!text) return undefined;
  return `修订 ${text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text}`;
}

function StageMeta({ row }: { row: ChapterStageRow }) {
  const meta = [attemptLabel(row.attempt), revisionLabel(row.revision)].filter(Boolean).join(' · ');
  return meta ? <span className="workbench-chapter-stage-meta">{meta}</span> : null;
}

function LocateButton({
  anchor,
  label,
  onLocate,
  testId,
}: {
  anchor: ChapterStageAnchor;
  label: string;
  onLocate: ((anchor: ChapterStageAnchor) => void) | undefined;
  testId: string;
}) {
  if (!onLocate) return null;
  const accessibleLabel = `定位${label}的公开记录`;
  const activate = () => onLocate(anchor);
  return (
    <button
      type="button"
      className="workbench-chapter-stage-locate"
      data-testid={testId}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      onClick={activate}
      onKeyDown={(event) => activateOnKeyboard(event, activate)}
    >
      定位
    </button>
  );
}

function StageRowView({
  row,
  onLocate,
  showLabel = true,
  locateLabel,
}: {
  row: ChapterStageRow;
  onLocate: ((anchor: ChapterStageAnchor) => void) | undefined;
  showLabel?: boolean;
  locateLabel?: string;
}) {
  return (
    <div
      className="workbench-chapter-stage-row"
      data-testid={`workbench-chapter-stage-row-${row.stageId}`}
      data-status={row.status}
      data-persistence={row.persistence}
    >
      <span className="workbench-chapter-stage-dot" aria-hidden="true" />
      {showLabel ? <span className="workbench-chapter-stage-label">{row.label}</span> : null}
      <StageMeta row={row} />
      <span className={classNames('workbench-chapter-stage-status', `is-${row.status}`)}>
        {STAGE_STATUS_LABELS[row.status]}
      </span>
      {row.anchor ? (
        <LocateButton
          anchor={row.anchor}
          label={locateLabel ?? row.label}
          onLocate={onLocate}
          testId={`workbench-chapter-stage-locate-${row.stageId}`}
        />
      ) : null}
    </div>
  );
}

function StageSection({
  label,
  rows,
  onLocate,
  emptyText,
  testId,
}: {
  label: string;
  rows: readonly ChapterStageRow[];
  onLocate: ((anchor: ChapterStageAnchor) => void) | undefined;
  emptyText: string;
  testId: string;
}) {
  return (
    <section className="workbench-chapter-stage-section" data-testid={testId}>
      <div className="workbench-chapter-stage-section-title">{label}</div>
      {rows.length > 0 ? (
        rows.map((row) => <StageRowView key={row.stageId} row={row} onLocate={onLocate} />)
      ) : (
        <p className="workbench-chapter-stage-empty">{emptyText}</p>
      )}
    </section>
  );
}

function BeatGroup({
  beat,
  onLocate,
}: {
  beat: ChapterSceneProjection['beats'][number];
  onLocate: ((anchor: ChapterStageAnchor) => void) | undefined;
}) {
  const beatLabel = beat.beatOrder > 0 ? `Beat ${beat.beatOrder}` : 'Beat';
  return (
    <div
      className="workbench-chapter-stage-beat"
      data-testid={`workbench-chapter-stage-beat-${beat.beatId}`}
      data-status={beat.status}
    >
      <div className="workbench-chapter-stage-beat-head">
        <span className="workbench-chapter-stage-beat-title">{beatLabel}</span>
        <span className={classNames('workbench-chapter-stage-status', `is-${beat.status}`)}>
          {STAGE_STATUS_LABELS[beat.status]}
        </span>
      </div>
      {beat.prose.length > 0 ? (
        beat.prose.map((row) => <StageRowView key={row.stageId} row={row} onLocate={onLocate} />)
      ) : (
        <p className="workbench-chapter-stage-empty">暂无记录</p>
      )}
    </div>
  );
}

function SceneItem({
  scene,
  sceneIndex,
  expanded,
  onToggle,
  onLocate,
  treeId,
}: {
  scene: ChapterSceneProjection;
  sceneIndex: number;
  expanded: boolean;
  onToggle: () => void;
  onLocate: ((anchor: ChapterStageAnchor) => void) | undefined;
  treeId: string;
}) {
  const panelId = `${treeId}-scene-panel-${sceneIndex}`;
  const title = scene.sceneNo ? `Scene ${scene.sceneNo} · ${scene.title}` : scene.title;
  const toggle = () => onToggle();
  return (
    <li
      className={classNames(
        'workbench-chapter-stage-scene',
        scene.future && 'is-future',
        scopedStatusClass(scene.status),
      )}
      data-testid={`workbench-chapter-stage-scene-${scene.sceneId}`}
      data-status={scene.status}
    >
      <div className="workbench-chapter-stage-scene-head">
        <button
          type="button"
          className="workbench-chapter-stage-scene-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          data-testid={`workbench-chapter-stage-scene-toggle-${scene.sceneId}`}
          onClick={toggle}
          onKeyDown={(event) => activateOnKeyboard(event, toggle)}
        >
          <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
          <span className="workbench-chapter-stage-scene-title">{title}</span>
          <span className={classNames('workbench-chapter-stage-status', `is-${scene.status}`)}>
            {SCENE_STATUS_LABELS[scene.status]}
          </span>
        </button>
        {scene.anchor ? (
          <LocateButton
            anchor={scene.anchor}
            label={title}
            onLocate={onLocate}
            testId={`workbench-chapter-stage-scene-locate-${scene.sceneId}`}
          />
        ) : null}
      </div>
      {expanded ? (
        <div
          id={panelId}
          className="workbench-chapter-stage-scene-body"
          data-testid={`workbench-chapter-stage-scene-panel-${scene.sceneId}`}
        >
          {scene.future ? (
            <p className="workbench-chapter-stage-empty">执行到场景时规划</p>
          ) : (
            <>
              <StageSection
                label="Beat 规划"
                rows={scene.beatPlanRows}
                onLocate={onLocate}
                emptyText="执行到场景时规划"
                testId={`workbench-chapter-stage-plan-${scene.sceneId}`}
              />
              <section
                className="workbench-chapter-stage-section"
                data-testid={`workbench-chapter-stage-beats-${scene.sceneId}`}
              >
                <div className="workbench-chapter-stage-section-title">逐 Beat 正文</div>
                {scene.beats.length > 0 ? (
                  scene.beats.map((beat) => (
                    <BeatGroup key={beat.beatId} beat={beat} onLocate={onLocate} />
                  ))
                ) : (
                  <p className="workbench-chapter-stage-empty">暂无记录</p>
                )}
              </section>
              <StageSection
                label="实际状态归纳"
                rows={scene.stateRows}
                onLocate={onLocate}
                emptyText="暂无记录"
                testId={`workbench-chapter-stage-state-${scene.sceneId}`}
              />
              <StageSection
                label="场景完成"
                rows={scene.completionRows}
                onLocate={onLocate}
                emptyText="暂无记录"
                testId={`workbench-chapter-stage-complete-${scene.sceneId}`}
              />
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function scopedStatusClass(status: ChapterSceneStatus): string | undefined {
  return status === 'partial' ? 'is-partial' : `is-${status}`;
}

export function WorkbenchChapterStageTree({
  chapterTitle,
  stages,
  futureScenes = EMPTY_FUTURE_SCENES,
  historyNotice,
  onLocate,
  className,
}: WorkbenchChapterStageTreeProps) {
  const treeId = useId().replace(/:/g, '');
  const headingId = `${treeId}-heading`;
  const noteId = `${treeId}-note`;
  const historyNoteId = `${treeId}-history-note`;
  const model = useMemo(
    () => projectChapterStageTree(stages, futureScenes),
    [stages, futureScenes],
  );
  const defaultExpandedRef = useRef<readonly string[]>(model.defaultExpandedSceneIds);
  const [expandedSceneIds, setExpandedSceneIds] = useState<ReadonlySet<string>>(
    () => new Set(model.defaultExpandedSceneIds),
  );

  useEffect(() => {
    const previous = defaultExpandedRef.current;
    const added = model.defaultExpandedSceneIds.filter((sceneId) => !previous.includes(sceneId));
    defaultExpandedRef.current = model.defaultExpandedSceneIds;
    if (added.length === 0) return;
    setExpandedSceneIds((current) => {
      const next = new Set(current);
      for (const sceneId of added) next.add(sceneId);
      return next;
    });
  }, [model.defaultExpandedSceneIds]);

  const toggleScene = (sceneId: string) => {
    setExpandedSceneIds((current) => {
      const next = new Set(current);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  };

  return (
    <section
      className={classNames('workbench-chapter-stage-tree', className)}
      data-testid="workbench-chapter-stage-tree"
      aria-labelledby={headingId}
      aria-describedby={historyNotice ? `${noteId} ${historyNoteId}` : noteId}
    >
      <header className="workbench-chapter-stage-header">
        <div className="workbench-chapter-stage-heading">
          <h3 id={headingId}>章节写作进度</h3>
          {chapterTitle ? <p className="workbench-chapter-stage-subtitle">{chapterTitle}</p> : null}
        </div>
        <div
          className="workbench-chapter-stage-persistence"
          data-persistence={model.persistence}
          title={PERSISTENCE_HINTS[model.persistence]}
        >
          <span className="workbench-chapter-stage-persistence-label">进度依据</span>
          <span
            className="workbench-chapter-stage-persistence-value"
            data-testid="workbench-chapter-stage-persistence"
          >
            {PERSISTENCE_LABELS[model.persistence]}
          </span>
        </div>
      </header>

      <ol className="workbench-chapter-stage-list">
        <li
          className="workbench-chapter-stage-fixed"
          data-testid="workbench-chapter-stage-fixed-materials"
        >
          <div className="workbench-chapter-stage-fixed-title">章节资料准备</div>
          {model.chapterMaterials.length > 0 ? (
            model.chapterMaterials.map((row) => (
              <StageRowView
                key={row.stageId}
                row={row}
                onLocate={onLocate}
                showLabel={false}
                locateLabel="章节资料准备"
              />
            ))
          ) : (
            <p className="workbench-chapter-stage-empty">暂无记录</p>
          )}
        </li>
        <li
          className="workbench-chapter-stage-fixed"
          data-testid="workbench-chapter-stage-fixed-plan"
        >
          <div className="workbench-chapter-stage-fixed-title">Scene 规划</div>
          {model.scenePlan.length > 0 ? (
            model.scenePlan.map((row) => (
              <StageRowView
                key={row.stageId}
                row={row}
                onLocate={onLocate}
                showLabel={false}
                locateLabel="Scene 规划"
              />
            ))
          ) : (
            <p className="workbench-chapter-stage-empty">暂无记录</p>
          )}
        </li>
        {model.scenes.map((scene, index) => (
          <SceneItem
            key={scene.sceneId}
            scene={scene}
            sceneIndex={index}
            treeId={treeId}
            expanded={expandedSceneIds.has(scene.sceneId)}
            onToggle={() => toggleScene(scene.sceneId)}
            onLocate={onLocate}
          />
        ))}
        <li
          className="workbench-chapter-stage-fixed"
          data-testid="workbench-chapter-stage-fixed-candidate"
        >
          <div className="workbench-chapter-stage-fixed-title">完整章节候选</div>
          {model.chapterCandidate.length > 0 ? (
            model.chapterCandidate.map((row) => (
              <StageRowView
                key={row.stageId}
                row={row}
                onLocate={onLocate}
                showLabel={false}
                locateLabel="完整章节候选"
              />
            ))
          ) : (
            <p className="workbench-chapter-stage-empty">暂无记录</p>
          )}
        </li>
      </ol>

      {model.unscoped.length > 0 ? (
        <div
          className="workbench-chapter-stage-unscoped"
          data-testid="workbench-chapter-stage-unscoped"
        >
          <div className="workbench-chapter-stage-section-title">未归属阶段记录</div>
          <p className="workbench-chapter-stage-empty">
            缺少显式 Scene 身份，未纳入进度树；请由宿主补齐映射。
          </p>
          {model.unscoped.map((row) => (
            <StageRowView key={row.stageId} row={row} onLocate={onLocate} />
          ))}
        </div>
      ) : null}

      {historyNotice ? (
        <p
          id={historyNoteId}
          className="workbench-chapter-stage-note"
          data-testid="workbench-chapter-stage-history-note"
        >
          {historyNotice}
        </p>
      ) : null}

      <p id={noteId} className="workbench-chapter-stage-note">
        只读进度：定位到已有运行、工具或产物记录，不授予确认或采用。未来 Beat
        在到达场景时规划，不显示推算完成率；不包含正文或隐藏推理。
      </p>
    </section>
  );
}
