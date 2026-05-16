import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import type { Volume } from '../../types/volume';
import type { Chapter } from '../../types/chapter';
import { ChapterStatusLabels } from '../../types/chapter';

interface VolumeTreeProps {
  novelId: string;
  activeChapterId: string;
  onSelectChapter: (chapterId: string) => void;
}

const statusDotColors: Record<string, string> = {
  not_started: 'var(--color-text-muted)',
  outline_ready: 'var(--color-primary)',
  draft_generated: '#7c3aed',
  editing: 'var(--color-warning)',
  polished: '#8b5cf6',
  adopted: 'var(--color-success)',
  summarized: '#059669',
};

function VolumeTree({ novelId, activeChapterId, onSelectChapter }: VolumeTreeProps) {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [expandedVolumes, setExpandedVolumes] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [v, c] = await Promise.all([
          volumeRepository.getByNovelId(novelId),
          chapterRepository.getByNovelId(novelId),
        ]);
        if (cancelled) return;
        setVolumes(v);
        setChapters(c);
        setExpandedVolumes(v.reduce((acc, vol) => ({ ...acc, [vol.id]: true }), {}));
      } catch (e) {
        console.error('Failed to load volume tree:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [novelId]);

  const toggleVolume = (volumeId: string) => {
    setExpandedVolumes((prev) => ({ ...prev, [volumeId]: !prev[volumeId] }));
  };

  const getVolumeChapters = (volumeId: string) =>
    chapters.filter((ch) => ch.volumeId === volumeId).sort((a, b) => a.orderIndex - b.orderIndex);

  const orphanChapters = chapters.filter((ch) => !ch.volumeId).sort((a, b) => a.orderIndex - b.orderIndex);

  if (loading) {
    return (
      <>
        <div className="workspace-sidebar-header"><span>📖 卷章目录</span></div>
        <div className="workspace-sidebar-tree">
          <div style={{ padding: 16, color: 'var(--color-text-muted)', fontSize: 13 }}>加载中...</div>
        </div>
      </>
    );
  }

  if (volumes.length === 0 && chapters.length === 0) {
    return (
      <>
        <div className="workspace-sidebar-header"><span>📖 卷章目录</span></div>
        <div className="workspace-sidebar-tree">
          <div style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              当前作品还没有章节
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/novels/${novelId}`)}>
              ← 返回详情页创建章节
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="workspace-sidebar-header">
        <span>📖 卷章目录</span>
      </div>
      <div className="workspace-sidebar-tree">
        <div className="tree-novel-root"><span>📖</span> 作品相关</div>

        {volumes.sort((a, b) => a.orderIndex - b.orderIndex).map((volume) => {
          const volumeChapters = getVolumeChapters(volume.id);
          const isExpanded = expandedVolumes[volume.id] ?? true;
          return (
            <div key={volume.id} className="tree-volume">
              <div className="tree-volume-header" onClick={() => toggleVolume(volume.id)}>
                <span className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
                <span>{volume.title}</span>
              </div>
              {isExpanded && volumeChapters.map((chapter) => (
                <div key={chapter.id}
                  className={`tree-chapter ${activeChapterId === chapter.id ? 'active' : ''}`}
                  onClick={() => onSelectChapter(chapter.id)}>
                  <span className="chapter-status-dot" style={{ background: statusDotColors[chapter.status] || 'var(--color-text-muted)' }} />
                  <span style={{ flex: 1 }}>第{chapter.chapterNumber}章：{chapter.title}</span>
                  <span className="text-muted" style={{ fontSize: 9 }}>{ChapterStatusLabels[chapter.status]}</span>
                </div>
              ))}
              {isExpanded && volumeChapters.length === 0 && (
                <div className="text-muted" style={{ padding: '4px 44px', fontSize: 11 }}>暂无章节</div>
              )}
              {isExpanded && (
                <div className="tree-add-btn" onClick={() => navigate(`/novels/${novelId}`)}>+ 新建章节</div>
              )}
            </div>
          );
        })}

        {orphanChapters.length > 0 && (
          <div className="tree-volume">
            <div className="tree-volume-header" style={{ color: 'var(--color-text-muted)' }}>📄 未分组章节</div>
            {orphanChapters.map((chapter) => (
              <div key={chapter.id}
                className={`tree-chapter ${activeChapterId === chapter.id ? 'active' : ''}`}
                onClick={() => onSelectChapter(chapter.id)}>
                <span className="chapter-status-dot" style={{ background: statusDotColors[chapter.status] || 'var(--color-text-muted)' }} />
                <span>第{chapter.chapterNumber}章：{chapter.title}</span>
              </div>
            ))}
          </div>
        )}

        <div className="tree-add-btn" style={{ marginTop: 4 }} onClick={() => navigate(`/novels/${novelId}`)}>+ 新建分卷</div>
      </div>
    </>
  );
}

export default VolumeTree;
