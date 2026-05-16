import { useState } from 'react';
import type { Chapter } from '../../types/chapter';

interface VolumeTreeProps {
  volumes: Array<{
    id: string;
    novelId: string;
    title: string;
    volumeNumber: number;
    summary: string;
    chapters: Chapter[];
    sortOrder: number;
  }>;
  chapters: Chapter[];
  activeChapterId: string;
  onSelectChapter: (chapterId: string) => void;
}

const chapterStatusLabels: Record<string, string> = {
  unwritten: '未生成',
  ai_draft: 'AI初稿',
  user_revised: '待修改',
  adopted: '已采用',
  summarized: '已总结',
};

function VolumeTree({ volumes, chapters, activeChapterId, onSelectChapter }: VolumeTreeProps) {
  const [expandedVolumes, setExpandedVolumes] = useState<Record<string, boolean>>(
    volumes.reduce((acc, v) => ({ ...acc, [v.id]: true }), {})
  );

  const toggleVolume = (volumeId: string) => {
    setExpandedVolumes((prev) => ({ ...prev, [volumeId]: !prev[volumeId] }));
  };

  const getVolumeChapters = (volumeId: string) =>
    chapters.filter((ch) => ch.volumeId === volumeId).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <>
      <div className="workspace-sidebar-header">
        <span>📖 卷章目录</span>
      </div>
      <div className="workspace-sidebar-tree">
        <div className="tree-novel-root">
          <span>📖</span> 作品相关
        </div>

        {volumes
          .sort((a, b) => a.volumeNumber - b.volumeNumber)
          .map((volume) => {
            const volumeChapters = getVolumeChapters(volume.id);
            const isExpanded = expandedVolumes[volume.id];

            return (
              <div key={volume.id} className="tree-volume">
                <div
                  className="tree-volume-header"
                  onClick={() => toggleVolume(volume.id)}
                >
                  <span className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
                  <span>{volume.title}</span>
                </div>

                {isExpanded &&
                  volumeChapters.map((chapter) => (
                    <div
                      key={chapter.id}
                      className={`tree-chapter ${activeChapterId === chapter.id ? 'active' : ''}`}
                      onClick={() => onSelectChapter(chapter.id)}
                    >
                      <span className={`chapter-status-dot ${chapter.status}`} />
                      <span>
                        第{chapter.chapterNumber}章：{chapter.title}
                      </span>
                      <span className="text-muted" style={{ fontSize: 10, marginLeft: 'auto' }}>
                        {chapterStatusLabels[chapter.status]}
                      </span>
                    </div>
                  ))}

                {isExpanded && (
                  <div
                    className="tree-add-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    + 新建章节
                  </div>
                )}
              </div>
            );
          })}

        <div className="tree-add-btn" style={{ marginTop: 4 }}>
          + 新建分卷
        </div>
      </div>
    </>
  );
}

export default VolumeTree;
