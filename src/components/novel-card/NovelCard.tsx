import type { Novel } from '../../types/novel';
import { useState, useEffect } from 'react';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { fmtNumber, fmtDate } from '../../utils/format';

interface NovelCardProps {
  novel: Novel;
  onClick: () => void;
  onEnterWorkspace: () => void;
}

const genreIcons: Record<string, string> = {
  '科幻': '🚀',
  '仙侠': '⚔️',
  '都市悬疑': '🌃',
  '奇幻': '🐉',
  '历史': '📜',
  '言情': '💕',
};

function formatDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN');
}

const statusLabels: Record<string, string> = {
  'draft': '草稿',
  'planning': '规划中',
  'writing': '创作中',
  'completed': '已完成',
  'paused': '已暂停',
  'archived': '已归档',
};

function NovelCard({ novel, onClick, onEnterWorkspace }: NovelCardProps) {
  const icon = genreIcons[novel.genre || ''] || '📖';
  const wordCount = novel.totalWordCount ?? novel.totalWords ?? 0;
  const targetCount = novel.targetWordCount ?? novel.targetWords ?? 0;
  const [progressLabel, setProgressLabel] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [volumes, chapters] = await Promise.all([
          volumeRepository.getByNovelId(novel.id),
          chapterRepository.getByNovelId(novel.id),
        ]);
        if (cancelled) return;
        const vol = volumes.find((v) => v.id === novel.currentVolumeId) || volumes[0];
        const ch = chapters.find((c) => c.id === novel.currentChapterId) || chapters[0];
        if (vol && ch) {
          setProgressLabel(`${vol.title} / 第${ch.chapterNumber}章 ${ch.title}`);
        } else if (vol) {
          setProgressLabel(`${vol.title} · ${chapters.length} 章`);
        } else if (chapters.length > 0) {
          setProgressLabel(`${chapters.length} 章`);
        } else {
          setProgressLabel('尚未创建章节');
        }
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
  }, [novel.id, novel.currentVolumeId, novel.currentChapterId]);

  return (
    <div className="novel-card" onClick={onClick}>
      <div className="novel-card-cover">
        <span className="novel-card-cover-icon">{icon}</span>
        <span className="novel-card-genre">{novel.genre || '未分类'}</span>
      </div>
      <div className="novel-card-body">
        <div className="novel-card-title">{novel.title}</div>
        <div className="novel-card-desc">{novel.description || ''}</div>
        <div className="novel-card-meta">
          <span className="novel-card-meta-item">
            {fmtNumber(wordCount)} 字
          </span>
          <span className="novel-card-meta-item">
            目标 {fmtNumber(targetCount)} 字
          </span>
          <span className="novel-card-meta-item">
            {fmtDate(novel.updatedAt)}
          </span>
        </div>
        <div className="novel-card-footer">
          <span className={`novel-card-status ${novel.status}`}>
            {statusLabels[novel.status] || novel.status}
          </span>
          <span
            className="novel-card-action"
            onClick={(e) => {
              e.stopPropagation();
              onEnterWorkspace();
            }}
          >
            进入工作台 →
          </span>
        </div>
      </div>
    </div>
  );
}

export default NovelCard;
