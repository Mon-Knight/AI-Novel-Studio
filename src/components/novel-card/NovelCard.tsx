import type { Novel } from '../../types/novel';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  BookOpenText,
  Building2,
  Heart,
  Landmark,
  Rocket,
  Sparkles,
  Sword,
  Trash2,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { formatNumber } from '../../utils/format';
import { formatDate } from '../../utils/date';

interface NovelCardProps {
  novel: Novel;
  onClick: () => void;
  onEnterWorkspace: () => void;
  onDelete?: (novelId: string) => void;
}

const genreIcons: Record<string, LucideIcon> = {
  科幻: Rocket,
  仙侠: Sword,
  都市悬疑: Building2,
  奇幻: Sparkles,
  历史: Landmark,
  言情: Heart,
};

const statusLabels: Record<string, string> = {
  draft: '草稿',
  planning: '规划中',
  writing: '创作中',
  completed: '已完成',
  paused: '已暂停',
  archived: '已归档',
};

function NovelCard({ novel, onClick, onEnterWorkspace, onDelete }: NovelCardProps) {
  const GenreIcon = genreIcons[novel.genre || ''] || BookOpenText;
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
      } catch {
        /* ignore */
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [novel.id, novel.currentVolumeId, novel.currentChapterId]);

  return (
    <div
      className="novel-card"
      data-testid="project-card"
      data-project-id={novel.id}
      data-project-name={novel.title}
      onClick={onClick}
    >
      {/* v1.0.26 删除按钮 */}
      {onDelete && (
        <button
          type="button"
          className="novel-card-delete-btn"
          title="删除作品"
          aria-label={`删除作品 ${novel.title}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDelete(novel.id);
          }}
        >
          <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
        </button>
      )}
      <div className="novel-card-cover">
        <span className="novel-card-cover-icon" aria-hidden="true">
          <GenreIcon size={34} strokeWidth={1.8} />
        </span>
        <span className="novel-card-genre">{novel.genre || '未分类'}</span>
      </div>
      <div
        className="novel-card-body"
        data-testid="project-open"
        data-project-id={novel.id}
        data-project-name={novel.title}
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }}
      >
        <div className="novel-card-title">{novel.title}</div>
        <div className="novel-card-desc">{novel.description || ''}</div>
        {progressLabel && <div className="novel-card-progress">{progressLabel}</div>}
        <div className="novel-card-meta">
          <span className="novel-card-meta-item">{formatNumber(wordCount)} 字</span>
          <span className="novel-card-meta-item">目标 {formatNumber(targetCount)} 字</span>
          <span className="novel-card-meta-item">{formatDate(novel.updatedAt)}</span>
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
            进入工作台
            <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
          </span>
        </div>
      </div>
    </div>
  );
}

export default NovelCard;
