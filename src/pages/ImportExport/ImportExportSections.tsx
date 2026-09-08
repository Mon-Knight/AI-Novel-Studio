/**
 * AI Novel Studio - 导出卡片组件
 */
import { BookOpenText, FileCode, FileText, HardDriveDownload, Library, Save } from 'lucide-react';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';
import { NovelImportSection } from './NovelImportSection';

export { NovelImportSection };

interface ExportPanelProps {
  novels: Novel[];
  selectedNovelId: string;
  onSelectNovelId: (id: string) => void;
  chapters: Chapter[];
  selectedChapterId: string;
  onSelectChapterId: (id: string) => void;
  onExport: (fn: () => Promise<string | void>) => void;
  exportNovelToTxt: (id: string) => Promise<string | void>;
  exportNovelToMarkdown: (id: string) => Promise<string | void>;
  exportNovelBackupJson: (id: string) => Promise<string | void>;
  exportChapterToTxt: (id: string) => Promise<string | void>;
  exportChapterToMarkdown: (id: string) => Promise<string | void>;
}

export function NovelExportSection({
  novels,
  selectedNovelId,
  onSelectNovelId,
  chapters,
  selectedChapterId,
  onSelectChapterId,
  onExport,
  exportNovelToTxt,
  exportNovelToMarkdown,
  exportNovelBackupJson,
  exportChapterToTxt,
  exportChapterToMarkdown,
}: ExportPanelProps) {
  const selectedNovel = novels.find((n) => n.id === selectedNovelId);
  const adoptedChapters = chapters.filter(
    (c) => c.status === 'adopted' || c.status === 'summarized',
  );
  const chapterExportDisabled =
    !selectedChapterId || !adoptedChapters.some((c) => c.id === selectedChapterId);

  return (
    <>
      <div className="resource-card resource-gap-bottom-lg">
        <div className="resource-card-header">
          <div className="resource-card-title">
            <BookOpenText aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>目标小说作品</span>
          </div>
          {selectedNovel && (
            <div className="resource-pill-row">
              <span className="resource-pill">总章节：{chapters.length} 章</span>
              <span className="resource-pill resource-pill--primary">
                已采用：{adoptedChapters.length} 章
              </span>
            </div>
          )}
        </div>

        {novels.length === 0 ? (
          <div className="resource-empty">暂无作品，请先在作品管理或工作台中创建小说。</div>
        ) : (
          <select
            className="panel-select resource-fill"
            value={selectedNovelId}
            onChange={(e) => onSelectNovelId(e.target.value)}
          >
            {novels.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title} ({n.genre || '未分类'})
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="resource-grid">
        {/* 卡片 1: 整本作品正文导出 */}
        <div className="resource-card">
          <div>
            <div className="resource-card-header">
              <div className="resource-card-title">
                <Library aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>整本作品正文</span>
              </div>
              <span className="resource-pill">{adoptedChapters.length} 章可导</span>
            </div>
            <div className="resource-card-description">
              汇总全部已采用章节的正文，按卷章结构完整拼接输出，适合离线阅读或发布排版。
            </div>
          </div>

          <div className="resource-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm resource-grow"
              disabled={adoptedChapters.length === 0}
              onClick={() => onExport(() => exportNovelToTxt(selectedNovelId))}
            >
              <FileText aria-hidden="true" size={14} strokeWidth={1.8} />
              导出 TXT
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm resource-grow"
              disabled={adoptedChapters.length === 0}
              onClick={() => onExport(() => exportNovelToMarkdown(selectedNovelId))}
            >
              <FileCode aria-hidden="true" size={14} strokeWidth={1.8} />
              导出 Markdown
            </button>
          </div>
        </div>

        {/* 卡片 2: 完整项目数据备份 */}
        <div className="resource-card">
          <div>
            <div className="resource-card-header">
              <div className="resource-card-title">
                <Save aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>项目全量备份</span>
              </div>
              <span className="resource-pill resource-pill--primary">JSON 备份</span>
            </div>
            <div className="resource-card-description">
              备份当前小说的基础信息、全部卷章历史、草稿快照、世界设定与角色体系，用于数据迁移与灾备恢复。
            </div>
          </div>

          <div className="resource-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm resource-fill"
              disabled={!selectedNovelId}
              onClick={() => onExport(() => exportNovelBackupJson(selectedNovelId))}
            >
              <HardDriveDownload aria-hidden="true" size={14} strokeWidth={1.8} />
              备份完整 JSON
            </button>
          </div>
        </div>

        {/* 卡片 3: 指定单章导出 */}
        <div className="resource-card">
          <div>
            <div className="resource-card-header">
              <div className="resource-card-title">
                <FileText aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>指定单章导出</span>
              </div>
              <span className="resource-pill">单章独立</span>
            </div>

            <div className="resource-gap-top">
              {chapters.length === 0 ? (
                <div className="resource-meta">暂无章节数据</div>
              ) : (
                <select
                  className="panel-select resource-fill"
                  value={selectedChapterId}
                  onChange={(e) => onSelectChapterId(e.target.value)}
                >
                  {adoptedChapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      第{c.chapterNumber}章 {c.title}（已采用）
                    </option>
                  ))}
                  {chapters
                    .filter((c) => !adoptedChapters.includes(c))
                    .map((c) => (
                      <option key={c.id} value={c.id} disabled>
                        第{c.chapterNumber}章 {c.title}（未采用，无法导出）
                      </option>
                    ))}
                </select>
              )}
            </div>
          </div>

          <div className="resource-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm resource-grow"
              disabled={chapterExportDisabled}
              onClick={() => onExport(() => exportChapterToTxt(selectedChapterId))}
            >
              <FileText aria-hidden="true" size={14} strokeWidth={1.8} />
              本章 TXT
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm resource-grow"
              disabled={chapterExportDisabled}
              onClick={() => onExport(() => exportChapterToMarkdown(selectedChapterId))}
            >
              <FileCode aria-hidden="true" size={14} strokeWidth={1.8} />
              本章 Markdown
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
