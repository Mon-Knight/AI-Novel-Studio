import { useState, useEffect } from 'react';
import { volumeRepository } from '../../../services/database/volumeRepository';
import type { Chapter } from '../../../types/chapter';
import type { Volume } from '../../../types/volume';
import { ChapterStatusLabels } from '../../../types/chapter';

interface OutlinePanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function OutlinePanel({ novelId, chapter }: OutlinePanelProps) {
  const [volume, setVolume] = useState<Volume | null>(null);

  useEffect(() => {
    if (chapter?.volumeId) {
      volumeRepository.getById(chapter.volumeId).then(setVolume).catch(() => {});
    } else {
      setVolume(null);
    }
  }, [chapter?.volumeId]);

  if (!chapter) {
    return (
      <div className="text-sm text-muted" style={{ padding: 16, textAlign: 'center' }}>
        请先在左侧目录树中选择一个章节
      </div>
    );
  }

  return (
    <div>
      {volume && (
        <div className="panel-section">
          <div className="panel-section-title">当前分卷</div>
          <div className="panel-field">
            <div className="panel-field-label">分卷名称</div>
            <div className="panel-field-value">{volume.title}</div>
          </div>
          {volume.goal && (
            <div className="panel-field" style={{ marginTop: 8 }}>
              <div className="panel-field-label">分卷目标</div>
              <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
                {volume.goal}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="panel-section">
        <div className="panel-section-title">当前章节</div>
        <div className="panel-field">
          <div className="panel-field-label">标题</div>
          <div className="panel-field-value">第{chapter.chapterNumber}章：{chapter.title}</div>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">状态</div>
          <div className="panel-field-value">{ChapterStatusLabels[chapter.status]}</div>
        </div>
        {chapter.targetWordCount && (
          <div className="panel-field" style={{ marginTop: 8 }}>
            <div className="panel-field-label">目标字数</div>
            <div className="panel-field-value">{chapter.targetWordCount.toLocaleString()} 字</div>
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">章节大纲</div>
        {chapter.outline ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {chapter.outline}
          </div>
        ) : (
          <div className="text-sm text-muted">本章尚未编写大纲</div>
        )}
      </div>

      {chapter.goal && (
        <div className="panel-section">
          <div className="panel-section-title">本章目标</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
            {chapter.goal}
          </div>
        </div>
      )}
    </div>
  );
}

export default OutlinePanel;
