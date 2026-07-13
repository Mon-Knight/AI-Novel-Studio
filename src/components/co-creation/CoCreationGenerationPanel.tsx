import { useEffect, useMemo, useState } from 'react';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import type {
  CoCreationGenerationKind,
  CoCreationGenerationRecordV1,
  CoCreationObjectContext,
  CoCreationStage,
} from '../../types/coCreation';
import { CO_CREATION_MAX_CHAPTER_OUTLINE_COUNT } from '../../features/co-creation/generationProtocol';

interface Props {
  stage: CoCreationStage;
  objectContext: CoCreationObjectContext;
  volumes: Volume[];
  chapters: Chapter[];
  records: CoCreationGenerationRecordV1[];
  busy?: boolean;
  desktopRuntime: boolean;
  onStart: (input: {
    kind: CoCreationGenerationKind;
    volumeId?: string;
    chapterId?: string;
    chapterCount?: number;
    targetWordCount?: number;
    additionalInstruction?: string;
  }) => void | Promise<void>;
  onRetry: (requestId: string) => void | Promise<void>;
  onOpenTasks: () => void;
  onOpenHandoff: (record: CoCreationGenerationRecordV1) => void;
}

const kindLabels: Record<CoCreationGenerationKind, string> = {
  master_outline: '生成完整作品总纲',
  volume_outline: '展开指定分卷',
  chapter_outlines: '生成章节大纲',
  chapter_generation_handoff: '交接章节正文生成',
};

const statusLabels: Record<CoCreationGenerationRecordV1['status'], string> = {
  prepared: '已准备',
  submitted: '后台执行中',
  handoff_ready: '可交接',
  failed: '提交失败',
};

function defaultKind(stage: CoCreationStage): CoCreationGenerationKind {
  if (stage === 'chapter_generation') return 'chapter_generation_handoff';
  if (stage === 'chapter_plan') return 'chapter_outlines';
  return 'master_outline';
}

export default function CoCreationGenerationPanel({
  stage,
  objectContext,
  volumes,
  chapters,
  records,
  busy,
  desktopRuntime,
  onStart,
  onRetry,
  onOpenTasks,
  onOpenHandoff,
}: Props) {
  const [kind, setKind] = useState<CoCreationGenerationKind>(() => defaultKind(stage));
  const contextChapter = chapters.find((chapter) => chapter.id === objectContext.chapterId);
  const [volumeId, setVolumeId] = useState(objectContext.volumeId ?? contextChapter?.volumeId ?? '');
  const [chapterId, setChapterId] = useState(objectContext.chapterId ?? '');
  const [chapterCount, setChapterCount] = useState(6);
  const [targetWordCount, setTargetWordCount] = useState(contextChapter?.targetWordCount ?? 4_000);
  const [instruction, setInstruction] = useState('');

  useEffect(() => {
    if (stage === 'chapter_generation') setKind('chapter_generation_handoff');
    else if (stage === 'chapter_plan') setKind('chapter_outlines');
  }, [stage]);

  useEffect(() => {
    const selected = chapters.find((chapter) => chapter.id === chapterId);
    if (!selected) return;
    if (selected.volumeId) setVolumeId(selected.volumeId);
    setTargetWordCount(selected.targetWordCount ?? 4_000);
  }, [chapterId, chapters]);

  const availableChapters = useMemo(() => chapters.filter((chapter) => (
    !volumeId || chapter.volumeId === volumeId
  )), [chapters, volumeId]);
  const requiresVolume = kind === 'volume_outline' || kind === 'chapter_outlines';
  const requiresChapter = kind === 'chapter_generation_handoff';
  const isBackgroundWorkflow = kind !== 'chapter_generation_handoff';
  const hasValidVolume = !requiresVolume || volumes.some((volume) => volume.id === volumeId);
  const hasValidChapter = !requiresChapter || chapters.some((chapter) => (
    chapter.id === chapterId && (!volumeId || chapter.volumeId === volumeId)
  ));
  const hasValidCount = kind !== 'chapter_outlines'
    || (Number.isSafeInteger(chapterCount)
      && chapterCount >= 1
      && chapterCount <= CO_CREATION_MAX_CHAPTER_OUTLINE_COUNT);
  const hasValidWordCount = kind !== 'chapter_generation_handoff'
    || (Number.isSafeInteger(targetWordCount)
      && targetWordCount >= 500
      && targetWordCount <= 50_000);
  const canSubmit = !busy
    && hasValidVolume
    && hasValidChapter
    && hasValidCount
    && hasValidWordCount
    && (!isBackgroundWorkflow || desktopRuntime);

  return (
    <section className="co-creation-generation" aria-label="大纲与章节生成入口">
      <div className="co-creation-draft-heading">
        <div>
          <h3>生成任务入口</h3>
          <span>复用现有 Task / Artifact / 审查管线</span>
        </div>
      </div>
      <div className="co-creation-generation-form">
        <label>
          <span>生成类型</span>
          <select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as CoCreationGenerationKind)}>
            {Object.entries(kindLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {kind !== 'master_outline' && (
          <label>
            <span>目标分卷</span>
            <select
              value={volumeId}
              disabled={busy}
              onChange={(event) => {
                setVolumeId(event.target.value);
                if (chapterId && !chapters.some((chapter) => (
                  chapter.id === chapterId && chapter.volumeId === event.target.value
                ))) setChapterId('');
              }}
            >
              <option value="">请选择分卷</option>
              {volumes.map((volume) => <option key={volume.id} value={volume.id}>{volume.title}</option>)}
            </select>
          </label>
        )}
        {(kind === 'chapter_outlines' || kind === 'chapter_generation_handoff') && (
          <label>
            <span>{kind === 'chapter_outlines' ? '指定章节（可选）' : '目标章节'}</span>
            <select value={chapterId} disabled={busy} onChange={(event) => setChapterId(event.target.value)}>
              {kind === 'chapter_outlines' && <option value="">按整个分卷生成</option>}
              {kind === 'chapter_generation_handoff' && <option value="">请选择章节</option>}
              {availableChapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>第{chapter.chapterNumber}章 · {chapter.title}</option>
              ))}
            </select>
          </label>
        )}
        {kind === 'chapter_outlines' && (
          <label>
            <span>章节候选数量</span>
            <input
              type="number"
              min={1}
              max={CO_CREATION_MAX_CHAPTER_OUTLINE_COUNT}
              value={chapterId ? 1 : chapterCount}
              disabled={busy || !!chapterId}
              onChange={(event) => setChapterCount(Number(event.target.value))}
            />
          </label>
        )}
        {kind === 'chapter_generation_handoff' && (
          <label>
            <span>目标字数</span>
            <input
              type="number"
              min={500}
              max={50_000}
              step={100}
              value={targetWordCount}
              disabled={busy}
              onChange={(event) => setTargetWordCount(Number(event.target.value))}
            />
          </label>
        )}
        <label>
          <span>本轮附加要求（可选）</span>
          <textarea
            rows={3}
            maxLength={2_000}
            value={instruction}
            disabled={busy}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="例如：只展开第二卷；加强中段节奏；保留已确认的结尾钩子。"
          />
        </label>
        {isBackgroundWorkflow && !desktopRuntime && (
          <p className="co-creation-impact-warning">后台大纲工作流仅在桌面应用中可用；浏览器开发模式不会创建任务。</p>
        )}
        {kind === 'chapter_generation_handoff' && (
          <p className="co-creation-generation-note">只把已确认的章节计划预填到工作台，不会自动生成或采用正文。</p>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canSubmit}
          onClick={() => void onStart({
            kind,
            ...(kind !== 'master_outline' && volumeId ? { volumeId } : {}),
            ...((kind === 'chapter_outlines' || kind === 'chapter_generation_handoff') && chapterId
              ? { chapterId } : {}),
            ...(kind === 'chapter_outlines' ? { chapterCount: chapterId ? 1 : chapterCount } : {}),
            ...(kind === 'chapter_generation_handoff' ? { targetWordCount } : {}),
            ...(instruction.trim() ? { additionalInstruction: instruction.trim() } : {}),
          })}
        >
          {busy ? '正在准备…' : isBackgroundWorkflow ? '提交后台任务' : '准备工作台交接'}
        </button>
      </div>
      <div className="co-creation-generation-history">
        <h3>最近请求 <span>{records.length}</span></h3>
        {records.length === 0 && <p className="co-creation-empty-copy">尚未创建大纲或章节生成请求。</p>}
        {[...records].reverse().slice(0, 8).map((record) => (
          <article key={record.request.requestId} className={`is-${record.status}`}>
            <header>
              <strong>{kindLabels[record.request.kind]}</strong>
              <em>{statusLabels[record.status]}</em>
            </header>
            <small>{record.request.requestId}</small>
            {record.receipt?.receiptType === 'background_workflow' && (
              <p>Root Task：<code>{record.receipt.rootTaskId}</code></p>
            )}
            {record.errorMessage && <p className="co-creation-impact-warning">{record.errorMessage}</p>}
            {record.errorCode === 'CO_CREATION_GENERATION_STALE' && (
              <p className="co-creation-generation-note">旧请求不可重试，请从上方基于当前内容重新准备。</p>
            )}
            <footer>
              {record.receipt?.receiptType === 'background_workflow' && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenTasks}>进入任务中心审查</button>
              )}
              {record.receipt?.receiptType === 'chapter_generation_handoff' && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenHandoff(record)}>
                  在工作台打开 AI 生成
                </button>
              )}
              {['prepared', 'failed'].includes(record.status)
                && record.errorCode !== 'CO_CREATION_GENERATION_STALE' && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void onRetry(record.request.requestId)}>
                  重试同一请求
                </button>
              )}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
