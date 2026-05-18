/**
 * AI Novel Studio - 大纲编辑器页面
 * 支持总纲、分卷大纲、章节大纲的查看、编辑、AI 生成和版本管理
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import OutlineEditor from '../../components/outline/OutlineEditor';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import type { Volume } from '../../types/volume';
import type { Chapter } from '../../types/chapter';

function OutlineEditorPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const [outlineType, setOutlineType] = useState<'master' | 'volume' | 'chapter'>('master');
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedVolumeId, setSelectedVolumeId] = useState<string | undefined>();
  const [selectedChapterId, setSelectedChapterId] = useState<string | undefined>();
  const [selectedTitle, setSelectedTitle] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(1);

  const loadData = useCallback(async () => {
    if (!novelId) return;
    try {
      const [v, c] = await Promise.all([
        volumeRepository.getByNovelId(novelId),
        chapterRepository.getByNovelId(novelId),
      ]);
      setVolumes(v);
      setChapters(c);
    } catch { /* ignore */ }
  }, [novelId]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredChapters = chapters.filter(
    (c) => c.volumeId === selectedVolumeId || (!selectedVolumeId && !c.volumeId),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg-app)' }}>
      {/* 顶部导航 */}
      <div style={{
        padding: '12px 20px', background: '#fff', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <button className="back-button" onClick={() => navigate(`/novels/${novelId}`)}>
          ← 返回作品
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          大纲编辑器
        </span>

        {/* 大纲类型选择 */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
          {(['master', 'volume', 'chapter'] as const).map((type) => (
            <button
              key={type}
              className={`btn btn-sm ${outlineType === type ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                setOutlineType(type);
                setSelectedVolumeId(undefined);
                setSelectedChapterId(undefined);
                setSelectedTitle('');
              }}
            >
              {type === 'master' ? '📋 总纲' : type === 'volume' ? '📗 分卷大纲' : '📄 章节大纲'}
            </button>
          ))}
        </div>

        {/* 分卷选择 */}
        {outlineType === 'volume' && (
          <select
            className="input"
            value={selectedVolumeId || ''}
            onChange={(e) => {
              const vid = e.target.value || undefined;
              setSelectedVolumeId(vid);
              const vol = volumes.find((v) => v.id === vid);
              setSelectedTitle(vol?.title || '');
              setSelectedIndex(vol?.orderIndex || 1);
            }}
            style={{ fontSize: 12, minWidth: 160 }}
          >
            <option value="">选择分卷</option>
            {volumes.map((v) => (
              <option key={v.id} value={v.id}>{v.title}</option>
            ))}
          </select>
        )}

        {/* 章节选择 */}
        {outlineType === 'chapter' && (
          <>
            <select
              className="input"
              value={selectedVolumeId || ''}
              onChange={(e) => {
                setSelectedVolumeId(e.target.value || undefined);
                setSelectedChapterId(undefined);
              }}
              style={{ fontSize: 12, minWidth: 140 }}
            >
              <option value="">选择分卷（可选）</option>
              {volumes.map((v) => (
                <option key={v.id} value={v.id}>{v.title}</option>
              ))}
            </select>
            <select
              className="input"
              value={selectedChapterId || ''}
              onChange={(e) => {
                const cid = e.target.value || undefined;
                setSelectedChapterId(cid);
                const ch = chapters.find((c) => c.id === cid);
                setSelectedTitle(ch?.title || '');
                setSelectedIndex(ch?.orderIndex || 1);
              }}
              style={{ fontSize: 12, minWidth: 160 }}
            >
              <option value="">选择章节</option>
              {filteredChapters.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* 编辑器主体 */}
      <div style={{ flex: 1, padding: 20, overflow: 'auto' }}>
        {!novelId ? (
          <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 48 }}>
            请从作品页面进入
          </div>
        ) : outlineType === 'volume' && !selectedVolumeId ? (
          <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 48 }}>
            👆 请先在上方选择一个分卷
          </div>
        ) : outlineType === 'chapter' && !selectedChapterId ? (
          <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 48 }}>
            👆 请先在上方选择一个章节
          </div>
        ) : (
          <OutlineEditor
            projectId={novelId}
            outlineType={outlineType}
            targetId={outlineType === 'volume' ? selectedVolumeId : selectedChapterId}
            targetTitle={selectedTitle}
            targetIndex={selectedIndex}
            parentOutlineId={undefined}
          />
        )}
      </div>
    </div>
  );
}

export default OutlineEditorPage;
