import { useNavigate } from 'react-router-dom';
import type { Volume } from '../../types/volume';
import type { Chapter } from '../../types/chapter';
import { ChapterStatusLabels } from '../../types/chapter';
import { formatNumber } from '../../utils/format';

const volumeStatusLabels: Record<string, string> = {
  planned: '规划中',
  writing: '创作中',
  completed: '已完成',
};

const chapterStatusColors: Record<string, string> = {
  not_started: '#9a9ab0',
  outline_ready: '#4a7cf7',
  draft_generated: '#7c3aed',
  editing: '#f59e0b',
  polished: '#8b5cf6',
  adopted: '#10b981',
  summarized: '#059669',
};

interface VolumeCardProps {
  volume: Volume;
  chapters: Chapter[];
  onEdit: () => void;
  onDelete: () => void;
  onAddChapter: () => void;
  onEditChapter: (ch: Chapter) => void;
  onDeleteChapter: (id: string) => void;
}

function VolumeCard({ volume, chapters, onEdit, onDelete, onAddChapter, onEditChapter, onDeleteChapter }: VolumeCardProps) {
  const navigate = useNavigate();

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      background: 'var(--color-bg-card)',
      overflow: 'hidden',
    }}>
      {/* 分卷头部 */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--color-bg-hover)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: chapters.length > 0 ? '1px solid var(--color-border-light)' : 'none',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>📘 {volume.title}</span>
            <span style={{
              fontSize: 11, padding: '1px 8px', borderRadius: 10,
              background: 'var(--color-bg-active)', color: 'var(--color-primary)',
            }}>
              {volumeStatusLabels[volume.status] || volume.status}
            </span>
            <span className="text-sm text-muted">{chapters.length} 章</span>
          </div>
          {(volume.summary || volume.goal || volume.mainConflict) && (
            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              {volume.summary && <div>📝 {volume.summary.slice(0, 100)}{volume.summary.length > 100 ? '...' : ''}</div>}
              {volume.goal && <div style={{ marginTop: 2 }}>🎯 分卷目标：{volume.goal.slice(0, 80)}{volume.goal.length > 80 ? '...' : ''}</div>}
              {volume.mainConflict && <div style={{ marginTop: 2 }}>⚡ 主要矛盾：{volume.mainConflict.slice(0, 80)}{volume.mainConflict.length > 80 ? '...' : ''}</div>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={onEdit}>✏️ 编辑</button>
          <button className="btn btn-secondary btn-sm" onClick={onDelete} style={{ color: 'var(--color-error)' }}>🗑️</button>
          <button className="btn btn-primary btn-sm" onClick={onAddChapter}>+ 新章</button>
        </div>
      </div>

      {/* 章节列表 */}
      {chapters.length > 0 && (
        <div style={{ padding: '4px 0' }}>
          {chapters.map((ch) => (
            <div key={ch.id} style={{
              display: 'flex', alignItems: 'center', padding: '8px 16px',
              borderBottom: '1px solid var(--color-border-light)',
              transition: 'background 0.15s',
              cursor: 'default',
            }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <span style={{ fontWeight: 500, fontSize: 14, minWidth: 36 }}>第{ch.chapterNumber}章</span>
              <span style={{ flex: 1, fontSize: 14 }}>{ch.title}</span>
              <span style={{
                fontSize: 11, padding: '1px 8px', borderRadius: 10, marginRight: 8,
                background: `${chapterStatusColors[ch.status]}18`, color: chapterStatusColors[ch.status],
                fontWeight: 500,
              }}>
                {ChapterStatusLabels[ch.status]}
              </span>
              {ch.targetWordCount && (
                <span className="text-sm text-muted" style={{ marginRight: 8 }}>
                  目标 {formatNumber(ch.targetWordCount)} 字
                </span>
              )}
              {ch.wordCount > 0 && (
                <span className="text-sm text-muted" style={{ marginRight: 8 }}>
                  {formatNumber(ch.wordCount)} 字
                </span>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => onEditChapter(ch)} style={{ marginRight: 4 }}>✏️</button>
              <button className="btn btn-secondary btn-sm" onClick={() => onDeleteChapter(ch.id)} style={{ marginRight: 4, color: 'var(--color-error)' }}>🗑️</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate(`/novels/${ch.novelId}/workspace?chapterId=${ch.id}`)}
              >
                进入工作台 →
              </button>
            </div>
          ))}
        </div>
      )}

      {chapters.length === 0 && (
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          当前分卷还没有章节，请创建章节标题和章节大纲
          <br />
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={onAddChapter}>+ 新建章节</button>
        </div>
      )}
    </div>
  );
}

export default VolumeCard;
