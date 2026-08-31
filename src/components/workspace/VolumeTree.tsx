import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronRight, FileText, Plus } from 'lucide-react';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import { describeUnknownError } from '../../utils/errorMessage';
import { buildChapterListIndex, centeredChapterWindowStart } from '../../utils/chapterListWindow';
import { showError } from '../../utils/nativeDialog';
import { ChapterWindowList } from './ChapterWindowList';
import { VolumeTreeDialogs } from './VolumeTreeDialogs';

interface VolumeTreeProps {
  volumes: Volume[];
  chapters: Chapter[];
  activeChapterId: string;
  loading?: boolean;
  unavailableMessage?: string;
  onSelectChapter: (chapterId: string) => void;
  onCreateVolume: (title: string) => Promise<void>;
  onCreateChapter: (volumeId: string, title: string, targetWordCount?: number) => Promise<void>;
  onCreateFirstChapter?: (title?: string, targetWordCount?: number) => Promise<void>;
}

const CHAPTER_PAGE_SIZE = 80;
const xsBtnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  fontSize: 11,
  borderRadius: 4,
  border: '1px solid var(--color-primary)',
  background: 'var(--color-primary)',
  color: 'var(--color-on-primary)',
  cursor: 'pointer',
};
const xsBtnSecondary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  fontSize: 11,
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-hover)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
};

function VolumeTree({
  volumes,
  chapters,
  activeChapterId,
  loading,
  unavailableMessage,
  onSelectChapter,
  onCreateVolume,
  onCreateChapter,
  onCreateFirstChapter,
}: VolumeTreeProps) {
  const [expandedVolumes, setExpandedVolumes] = useState<Record<string, boolean>>({});
  const [showNewVolume, setShowNewVolume] = useState(false);
  const [newVolumeTitle, setNewVolumeTitle] = useState('');
  const [showNewChapter, setShowNewChapter] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [newChapterTargetWordCount, setNewChapterTargetWordCount] = useState('4000');
  const [newChapterVolumeId, setNewChapterVolumeId] = useState('');
  const [creating, setCreating] = useState(false);
  const [chapterWindowStarts, setChapterWindowStarts] = useState<Record<string, number>>({});

  const toggleVolume = (volumeId: string) => {
    setExpandedVolumes((prev) => ({ ...prev, [volumeId]: !prev[volumeId] }));
  };
  const ensureExpanded = (volumeId: string) => {
    setExpandedVolumes((prev) => ({ ...prev, [volumeId]: true }));
  };
  const handleCreateVolume = useCallback(async () => {
    if (!newVolumeTitle.trim() || creating) return;
    setCreating(true);
    try {
      await onCreateVolume(newVolumeTitle.trim());
      setNewVolumeTitle('');
      setShowNewVolume(false);
    } catch (error: unknown) {
      await showError({
        title: '创建分卷失败',
        message: describeUnknownError(error, '未知错误'),
        testId: 'error-notice',
      });
    } finally {
      setCreating(false);
    }
  }, [creating, newVolumeTitle, onCreateVolume]);

  const handleCreateChapter = useCallback(async () => {
    if (!newChapterTitle.trim() || creating) return;
    const targetWordCount = Number(newChapterTargetWordCount);
    if (
      !Number.isSafeInteger(targetWordCount) ||
      targetWordCount < 500 ||
      targetWordCount > 20000
    ) {
      return;
    }
    const volumeId = newChapterVolumeId || volumes[0]?.id;
    if (!volumeId) {
      if (!onCreateFirstChapter) {
        await showError({
          title: '无法创建章节',
          message: '当前无分卷，请先创建分卷。',
          testId: 'error-notice',
        });
        return;
      }
      setCreating(true);
      try {
        await onCreateFirstChapter(newChapterTitle.trim(), targetWordCount);
        setNewChapterTitle('');
        setShowNewChapter(false);
        setNewChapterVolumeId('');
      } catch (error: unknown) {
        await showError({
          title: '创建章节失败',
          message: describeUnknownError(error, '未知错误'),
          testId: 'error-notice',
        });
      } finally {
        setCreating(false);
      }
      return;
    }
    setCreating(true);
    try {
      await onCreateChapter(volumeId, newChapterTitle.trim(), targetWordCount);
      setNewChapterTitle('');
      setShowNewChapter(false);
      setNewChapterVolumeId('');
      ensureExpanded(volumeId);
    } catch (error: unknown) {
      const wasLeaveCancelled =
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'WORKSPACE_LEAVE_CANCELLED';
      if (!wasLeaveCancelled)
        await showError({
          title: '创建章节失败',
          message: describeUnknownError(error, '未知错误'),
          testId: 'error-notice',
        });
    } finally {
      setCreating(false);
    }
  }, [
    creating,
    newChapterTitle,
    newChapterTargetWordCount,
    newChapterVolumeId,
    onCreateChapter,
    onCreateFirstChapter,
    volumes,
  ]);

  const handleOpenNewChapter = useCallback(
    (volumeId?: string) => {
      setNewChapterVolumeId(
        volumes.length === 0 && !volumeId ? '' : volumeId || volumes[0]?.id || '',
      );
      setNewChapterTitle('');
      setNewChapterTargetWordCount('4000');
      setShowNewChapter(true);
    },
    [volumes],
  );
  const chapterIndex = useMemo(() => buildChapterListIndex(chapters), [chapters]);
  const sortedVolumes = useMemo(
    () => [...volumes].sort((left, right) => left.orderIndex - right.orderIndex),
    [volumes],
  );
  const orphanChapters = chapterIndex.orphaned;
  const activeChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === activeChapterId),
    [activeChapterId, chapters],
  );

  useEffect(() => {
    if (!activeChapter) return;
    const windowKey = activeChapter.volumeId || '__orphan__';
    const siblings = activeChapter.volumeId
      ? (chapterIndex.byVolume.get(activeChapter.volumeId) ?? [])
      : orphanChapters;
    const nextStart = centeredChapterWindowStart(siblings, CHAPTER_PAGE_SIZE, activeChapter.id);
    setChapterWindowStarts((current) =>
      current[windowKey] === nextStart ? current : { ...current, [windowKey]: nextStart },
    );
    if (activeChapter.volumeId) {
      setExpandedVolumes((current) =>
        current[activeChapter.volumeId!] === true
          ? current
          : { ...current, [activeChapter.volumeId!]: true },
      );
    }
  }, [activeChapter, chapterIndex.byVolume, orphanChapters]);

  const renderHeader = () => (
    <div className="workspace-sidebar-header">
      <span className="workspace-sidebar-heading">
        <BookOpen aria-hidden="true" size={15} strokeWidth={1.8} />
        <span>卷章目录</span>
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          style={xsBtnPrimary}
          data-testid="chapter-create"
          onClick={() => handleOpenNewChapter()}
          disabled={creating}
          title="新建章节（自动创建第一卷）"
        >
          <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
          <span>章节</span>
        </button>
        <button
          style={xsBtnSecondary}
          data-testid="volume-create"
          onClick={() => {
            setNewVolumeTitle('');
            setShowNewVolume(true);
          }}
          disabled={creating}
          title="新建分卷"
        >
          <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
          <span>分卷</span>
        </button>
      </div>
    </div>
  );

  const renderDialogs = (emptyState: boolean) => (
    <VolumeTreeDialogs
      volumes={volumes}
      showNewVolume={showNewVolume}
      newVolumeTitle={newVolumeTitle}
      showNewChapter={showNewChapter}
      newChapterTitle={newChapterTitle}
      newChapterTargetWordCount={newChapterTargetWordCount}
      newChapterVolumeId={newChapterVolumeId}
      creating={creating}
      volumePlaceholder={emptyState ? '例如：第一卷' : '例如：第二卷'}
      onCloseVolume={() => setShowNewVolume(false)}
      onCloseChapter={() => {
        if (!creating || emptyState) setShowNewChapter(false);
      }}
      onVolumeTitleChange={setNewVolumeTitle}
      onChapterTitleChange={setNewChapterTitle}
      onChapterTargetWordCountChange={setNewChapterTargetWordCount}
      onChapterVolumeChange={setNewChapterVolumeId}
      onCreateVolume={handleCreateVolume}
      onCreateChapter={handleCreateChapter}
    />
  );

  if (loading || unavailableMessage) {
    return (
      <>
        <div className="workspace-sidebar-header">
          <span className="workspace-sidebar-heading">
            <BookOpen aria-hidden="true" size={15} strokeWidth={1.8} />
            <span>卷章目录</span>
          </span>
        </div>
        <div
          className="workspace-sidebar-tree workspace-sidebar-state"
          data-testid="chapter-list"
          role={unavailableMessage ? 'alert' : 'status'}
        >
          {unavailableMessage ? (
            <div className="workspace-sidebar-error">{unavailableMessage}</div>
          ) : (
            <>
              <div className="workspace-loading-label">加载中...</div>
              <div className="workspace-tree-skeleton" aria-hidden="true">
                <div className="workspace-skeleton-line is-tree-heading" />
                <div className="workspace-skeleton-line is-tree-item" />
                <div className="workspace-skeleton-line is-tree-item is-short" />
                <div className="workspace-skeleton-line is-tree-item" />
              </div>
            </>
          )}
        </div>
      </>
    );
  }
  if (volumes.length === 0 && chapters.length === 0) {
    return (
      <>
        {renderHeader()}
        <div className="workspace-sidebar-tree" data-testid="chapter-list">
          <div style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              尚无章节，点击上方按钮创建
            </div>
          </div>
        </div>
        {renderDialogs(true)}
      </>
    );
  }

  return (
    <>
      {renderHeader()}
      <div className="workspace-sidebar-tree" data-testid="chapter-list">
        <div className="tree-novel-root">
          <BookOpen aria-hidden="true" size={14} strokeWidth={1.8} />
          <span>作品相关</span>
        </div>
        {sortedVolumes.map((volume) => {
          const volumeChapters = chapterIndex.byVolume.get(volume.id) ?? [];
          const isExpanded =
            expandedVolumes[volume.id] ??
            (activeChapter?.volumeId === volume.id || sortedVolumes[0]?.id === volume.id);
          return (
            <div
              key={volume.id}
              className="tree-volume"
              data-testid="volume-item"
              data-volume-id={volume.id}
              data-volume-title={volume.title}
            >
              <button
                type="button"
                className="tree-volume-header"
                aria-expanded={isExpanded}
                onClick={() => toggleVolume(volume.id)}
              >
                <span className={`tree-arrow ${isExpanded ? 'expanded' : ''}`} aria-hidden="true">
                  <ChevronRight size={13} strokeWidth={1.8} />
                </span>
                <span>{volume.title}</span>
              </button>
              {isExpanded && (
                <div className="tree-volume-children">
                  {volumeChapters.length > 0 ? (
                    <ChapterWindowList
                      chapters={volumeChapters}
                      activeChapterId={activeChapterId}
                      start={chapterWindowStarts[volume.id] ?? 0}
                      windowSize={CHAPTER_PAGE_SIZE}
                      onStartChange={(start) =>
                        setChapterWindowStarts((current) => ({ ...current, [volume.id]: start }))
                      }
                      onSelectChapter={onSelectChapter}
                    />
                  ) : (
                    <div className="text-muted" style={{ padding: '4px 44px', fontSize: 11 }}>
                      暂无章节
                    </div>
                  )}
                  <button
                    type="button"
                    className="tree-add-btn"
                    onClick={() => handleOpenNewChapter(volume.id)}
                  >
                    <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
                    <span>在本卷新建章节</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {orphanChapters.length > 0 && (
          <div className="tree-volume">
            <div className="tree-volume-header" style={{ color: 'var(--color-text-muted)' }}>
              <FileText aria-hidden="true" size={13} strokeWidth={1.8} />
              <span>未分组章节</span>
            </div>
            <ChapterWindowList
              chapters={orphanChapters}
              activeChapterId={activeChapterId}
              start={chapterWindowStarts.__orphan__ ?? 0}
              windowSize={CHAPTER_PAGE_SIZE}
              showStatusLabel={false}
              onStartChange={(start) =>
                setChapterWindowStarts((current) => ({ ...current, __orphan__: start }))
              }
              onSelectChapter={onSelectChapter}
            />
          </div>
        )}
      </div>
      {renderDialogs(false)}
    </>
  );
}

export default memo(VolumeTree);
