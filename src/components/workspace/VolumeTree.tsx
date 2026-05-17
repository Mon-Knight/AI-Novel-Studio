import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { draftVersionService } from '../../services/database/draftVersionService';
import type { Volume } from '../../types/volume';
import type { Chapter } from '../../types/chapter';
import { ChapterStatusLabels } from '../../types/chapter';

interface VolumeTreeProps {
  novelId: string;
  activeChapterId: string;
  onSelectChapter: (chapterId: string) => void;
  onChapterCreated?: (chapterId: string) => void;
  onChaptersRefresh?: () => Promise<Chapter[]>;
  refreshKey?: number;
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

function VolumeTree({ novelId, activeChapterId, onSelectChapter, onChapterCreated, onChaptersRefresh, refreshKey }: VolumeTreeProps) {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [expandedVolumes, setExpandedVolumes] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // v1.0.16 新建分卷/章节弹窗状态
  const [showNewVolume, setShowNewVolume] = useState(false);
  const [newVolumeTitle, setNewVolumeTitle] = useState('');
  const [showNewChapter, setShowNewChapter] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [newChapterVolumeId, setNewChapterVolumeId] = useState('');
  const [creating, setCreating] = useState(false);

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
  }, [novelId, refreshKey]);

  const refreshTree = useCallback(async () => {
    try {
      const [v, c] = await Promise.all([
        volumeRepository.getByNovelId(novelId),
        chapterRepository.getByNovelId(novelId),
      ]);
      setVolumes(v);
      setChapters(c);
      // 通知父组件刷新
      onChaptersRefresh?.();
      // 保持展开状态并新增分卷自动展开
      setExpandedVolumes((prev) => {
        const next = { ...prev };
        v.forEach((vol) => { if (!(vol.id in next)) next[vol.id] = true; });
        return next;
      });
      return { volumes: v, chapters: c };
    } catch (e) {
      console.error('Failed to refresh tree:', e);
      return { volumes, chapters };
    }
  }, [novelId, volumes, chapters, onChaptersRefresh]);

  const handleCreateVolume = useCallback(async () => {
    if (!newVolumeTitle.trim() || creating) return;
    setCreating(true);
    try {
      const vols = await volumeRepository.getByNovelId(novelId);
      const maxNum = vols.reduce((max, v) => Math.max(max, v.volumeNumber), 0);
      await volumeRepository.create({
        novelId,
        title: newVolumeTitle.trim(),
        orderIndex: vols.length,
      });
      setNewVolumeTitle('');
      setShowNewVolume(false);
      await refreshTree();
    } catch (e: any) {
      alert('创建分卷失败：' + (e?.message || '未知错误'));
    } finally {
      setCreating(false);
    }
  }, [novelId, newVolumeTitle, creating, refreshTree]);

  const handleCreateChapter = useCallback(async () => {
    if (!newChapterTitle.trim() || creating) return;
    const volumeId = newChapterVolumeId || volumes[0]?.id;
    if (!volumeId) {
      // 无分卷时自动创建第一卷
      setCreating(true);
      try {
        const vol = await volumeRepository.create({ novelId, title: '第一卷' });
        await refreshTree();
        // 递归调用以使用新分卷
        const ch = await chapterRepository.create({
          novelId,
          volumeId: vol.id,
          title: newChapterTitle.trim() || '第1章',
        });
        // 自动创建空草稿
        try {
          await draftVersionService.create({
            novelId,
            chapterId: ch.id,
            title: ch.title,
            content: '',
            source: 'user_edited',
          });
        } catch { /* 草稿创建失败不阻塞 */ }
        setNewChapterTitle('');
        setShowNewChapter(false);
        await refreshTree();
        onSelectChapter(ch.id);
        onChapterCreated?.(ch.id);
      } catch (e: any) {
        alert('创建章节失败：' + (e?.message || '未知错误'));
      } finally {
        setCreating(false);
      }
      return;
    }

    setCreating(true);
    try {
      const chs = await chapterRepository.getByVolumeId(volumeId);
      const maxNum = chs.reduce((max, c) => Math.max(max, c.chapterNumber), 0);
      const ch = await chapterRepository.create({
        novelId,
        volumeId,
        title: newChapterTitle.trim(),
        orderIndex: chs.length,
      });
      // 自动创建空草稿
      try {
        await draftVersionService.create({
          novelId,
          chapterId: ch.id,
          title: ch.title,
          content: '',
          source: 'user_edited',
        });
      } catch { /* 草稿创建失败不阻塞 */ }
      setNewChapterTitle('');
      setShowNewChapter(false);
      setNewChapterVolumeId('');
      await refreshTree();
      onSelectChapter(ch.id);
      onChapterCreated?.(ch.id);
    } catch (e: any) {
      alert('创建章节失败：' + (e?.message || '未知错误'));
    } finally {
      setCreating(false);
    }
  }, [novelId, newChapterTitle, newChapterVolumeId, volumes, creating, refreshTree, onSelectChapter, onChapterCreated]);

  const handleOpenNewChapter = useCallback((volumeId?: string) => {
    if (volumes.length === 0 && !volumeId) {
      // 无分卷时直接创建（会自动创建第一卷）
      setNewChapterVolumeId('');
    } else {
      setNewChapterVolumeId(volumeId || volumes[0]?.id || '');
    }
    setNewChapterTitle('');
    setShowNewChapter(true);
  }, [volumes]);

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

  // 无章节空状态（但允许在工作台直接创建）
  if (volumes.length === 0 && chapters.length === 0) {
    return (
      <>
        <div className="workspace-sidebar-header">
          <span>📖 卷章目录</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--color-primary)', background: 'var(--color-primary)', color: '#fff', cursor: 'pointer' }}
              onClick={() => handleOpenNewChapter()} disabled={creating} title="新建章节（自动创建第一卷）">
              + 章节
            </button>
            <button style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}
              onClick={() => { setNewVolumeTitle(''); setShowNewVolume(true); }} disabled={creating} title="新建分卷">
              + 分卷
            </button>
          </div>
        </div>
        <div className="workspace-sidebar-tree">
          <div style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              尚无章节，点击上方按钮创建
            </div>
          </div>
        </div>
        {/* 新建分卷弹窗 */}
        {showNewVolume && (
          <div className="modal-overlay" onClick={() => setShowNewVolume(false)}>
            <div className="modal-dialog" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">📖 新建分卷</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label className="panel-field-label">分卷名称</label>
                  <input type="text" className="form-input" value={newVolumeTitle}
                    onChange={(e) => setNewVolumeTitle(e.target.value)}
                    placeholder="例如：第一卷" style={{ width: '100%' }}
                    autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreateVolume()} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowNewVolume(false)}>取消</button>
                  <button className="btn btn-primary btn-sm" onClick={handleCreateVolume} disabled={creating || !newVolumeTitle.trim()}>
                    {creating ? '创建中...' : '创建'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* 新建章节弹窗 */}
        {showNewChapter && (
          <div className="modal-overlay" onClick={() => setShowNewChapter(false)}>
            <div className="modal-dialog" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">📝 新建章节</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {volumes.length > 0 && (
                  <div>
                    <label className="panel-field-label">所属分卷</label>
                    <select className="form-input" value={newChapterVolumeId || volumes[0]?.id || ''}
                      onChange={(e) => setNewChapterVolumeId(e.target.value)} style={{ width: '100%' }}>
                      {volumes.map((v) => (
                        <option key={v.id} value={v.id}>{v.title}</option>
                      ))}
                    </select>
                  </div>
                )}
                {volumes.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 0' }}>
                    当前无分卷，将自动创建"第一卷"。
                  </div>
                )}
                <div>
                  <label className="panel-field-label">章节标题</label>
                  <input type="text" className="form-input" value={newChapterTitle}
                    onChange={(e) => setNewChapterTitle(e.target.value)}
                    placeholder="例如：第1章" style={{ width: '100%' }}
                    autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreateChapter()} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowNewChapter(false)}>取消</button>
                  <button className="btn btn-primary btn-sm" onClick={handleCreateChapter} disabled={creating || !newChapterTitle.trim()}>
                    {creating ? '创建中...' : '创建'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="workspace-sidebar-header">
        <span>📖 卷章目录</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--color-primary)', background: 'var(--color-primary)', color: '#fff', cursor: 'pointer' }}
            onClick={() => handleOpenNewChapter()} disabled={creating} title="新建章节（自动创建第一卷）">
            + 章节
          </button>
          <button style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}
            onClick={() => { setNewVolumeTitle(''); setShowNewVolume(true); }} disabled={creating} title="新建分卷">
            + 分卷
          </button>
        </div>
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
                <div className="tree-add-btn" onClick={() => handleOpenNewChapter(volume.id)}>+ 在本卷新建章节</div>
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
      </div>

      {/* 新建分卷弹窗 */}
      {showNewVolume && (
        <div className="modal-overlay" onClick={() => setShowNewVolume(false)}>
          <div className="modal-dialog" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">📖 新建分卷</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="panel-field-label">分卷名称</label>
                <input type="text" className="form-input" value={newVolumeTitle}
                  onChange={(e) => setNewVolumeTitle(e.target.value)}
                  placeholder="例如：第二卷" style={{ width: '100%' }}
                  autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreateVolume()} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowNewVolume(false)}>取消</button>
                <button className="btn btn-primary btn-sm" onClick={handleCreateVolume} disabled={creating || !newVolumeTitle.trim()}>
                  {creating ? '创建中...' : '创建'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 新建章节弹窗 */}
      {showNewChapter && (
        <div className="modal-overlay" onClick={() => setShowNewChapter(false)}>
          <div className="modal-dialog" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">📝 新建章节</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {volumes.length > 0 && (
                <div>
                  <label className="panel-field-label">所属分卷</label>
                  <select className="form-input" value={newChapterVolumeId || volumes[0]?.id || ''}
                    onChange={(e) => setNewChapterVolumeId(e.target.value)} style={{ width: '100%' }}>
                    {volumes.map((v) => (
                      <option key={v.id} value={v.id}>{v.title}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="panel-field-label">章节标题</label>
                <input type="text" className="form-input" value={newChapterTitle}
                  onChange={(e) => setNewChapterTitle(e.target.value)}
                  placeholder="例如：第2章" style={{ width: '100%' }}
                  autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreateChapter()} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowNewChapter(false)}>取消</button>
                <button className="btn btn-primary btn-sm" onClick={handleCreateChapter} disabled={creating || !newChapterTitle.trim()}>
                  {creating ? '创建中...' : '创建'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default VolumeTree;
