import { useState, useEffect, useCallback } from 'react';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { createFirstVolumeAndChapter, createChapterInVolume } from '../../services/chapters/chapterCreationService';
import VolumeCard from './VolumeCard';
import VolumeFormModal from './VolumeFormModal';
import ChapterFormModal from './ChapterFormModal';
import type { Volume, CreateVolumeInput, UpdateVolumeInput } from '../../types/volume';
import type { Chapter, CreateChapterInput, UpdateChapterInput } from '../../types/chapter';

interface OutlineManagerProps {
  novelId: string;
}

function OutlineManager({ novelId }: OutlineManagerProps) {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [showVolumeForm, setShowVolumeForm] = useState(false);
  const [editingVolume, setEditingVolume] = useState<Volume | null>(null);
  const [showChapterForm, setShowChapterForm] = useState(false);
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null);
  const [targetVolumeId, setTargetVolumeId] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [v, c] = await Promise.all([
        volumeRepository.getByNovelId(novelId),
        chapterRepository.getByNovelId(novelId),
      ]);
      setVolumes(v);
      setChapters(c);
    } catch (e) {
      console.error('Failed to load outline data:', e);
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => { loadData(); }, [loadData]);

  const flash = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(''), 3000); };

  // v1.0.20 创建分卷：写入 + 反查 + 重载
  const handleCreateVolume = async (input: CreateVolumeInput) => {
    try {
      const created = await volumeRepository.create(input);
      if (!created?.id) throw new Error('分卷创建返回无效数据');
      // 反查验证
      const volsAfter = await volumeRepository.getByNovelId(novelId);
      if (!volsAfter.some((v) => v.id === created.id)) {
        throw new Error('分卷创建后无法读取，请检查存储');
      }
      await loadData();
      setShowVolumeForm(false);
      flash('✅ 分卷创建成功');
    } catch (e: any) {
      flash('❌ 创建失败：' + (e?.message || '未知错误'));
      console.error('[OutlineManager] createVolume error:', e);
    }
  };

  const handleUpdateVolume = async (id: string, input: UpdateVolumeInput) => {
    await volumeRepository.update(id, input);
    await loadData();
    setEditingVolume(null);
    flash('分卷保存成功');
  };

  const handleDeleteVolume = async (id: string) => {
    const volChapters = chapters.filter((ch) => ch.volumeId === id);
    if (volChapters.length > 0) {
      flash('该分卷下仍有章节，请先移动或删除章节');
      return;
    }
    if (!confirm('确定删除此分卷？')) return;
    await volumeRepository.remove(id);
    await loadData();
    flash('分卷已删除');
  };

  // v1.0.20 创建章节：统一服务（chapter + draft + 反查 + 重载）
  const handleCreateChapter = async (input: CreateChapterInput) => {
    try {
      const volumeId = input.volumeId || '';
      if (!volumeId) {
        // 无分卷时创建第一卷
        flash('⏳ 正在创建第一卷和第一章...');
        const result = await createFirstVolumeAndChapter(novelId);
        await loadData();
        setShowChapterForm(false);
        setTargetVolumeId(undefined);
        flash('✅ 已创建第一卷和第1章（含空草稿）');
        console.info('[OutlineManager] createFirstVolumeAndChapter done, chapterId=', result.chapter.id);
      } else {
        const result = await createChapterInVolume(novelId, volumeId, input.title);
        await loadData();
        setShowChapterForm(false);
        setTargetVolumeId(undefined);
        flash('✅ 章节创建成功（含空草稿）');
        console.info('[OutlineManager] createChapterInVolume done, chapterId=', result.chapter.id);
      }
    } catch (e: any) {
      flash('❌ 创建失败：' + (e?.message || '未知错误'));
      console.error('[OutlineManager] createChapter error:', e);
    }
  };

  const handleUpdateChapter = async (id: string, input: UpdateChapterInput) => {
    await chapterRepository.update(id, input);
    await loadData();
    setEditingChapter(null);
    flash('章节保存成功');
  };

  const handleDeleteChapter = async (id: string) => {
    if (!confirm('确定删除此章节？')) return;
    await chapterRepository.remove(id);
    await loadData();
    flash('章节已删除');
  };

  if (loading) {
    return <div className="text-sm text-muted" style={{ padding: 16 }}>加载中...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📋</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>大纲与章节管理</span>
          <span className="text-sm text-muted">（{volumes.length} 卷 · {chapters.length} 章）</span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditingVolume(null); setShowVolumeForm(true); }}>
          + 新建分卷
        </button>
      </div>

      {message && (
        <div style={{ fontSize: 13, padding: '6px 12px', background: 'var(--color-primary-light)', borderRadius: 6, marginBottom: 12, color: 'var(--color-primary)' }}>
          {message}
        </div>
      )}

      {volumes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 8 }}>
          <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.5 }}>📚</div>
          <div style={{ fontSize: 15, marginBottom: 8 }}>还没有分卷</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>长篇小说通常从分卷结构开始。你可以先创建第一卷，再添加章节大纲。</div>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditingVolume(null); setShowVolumeForm(true); }}>
            + 新建分卷
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {volumes
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((volume) => (
              <VolumeCard
                key={volume.id}
                volume={volume}
                chapters={chapters.filter((ch) => ch.volumeId === volume.id).sort((a, b) => a.orderIndex - b.orderIndex)}
                onEdit={() => { setEditingVolume(volume); setShowVolumeForm(true); }}
                onDelete={() => handleDeleteVolume(volume.id)}
                onAddChapter={() => { setTargetVolumeId(volume.id); setEditingChapter(null); setShowChapterForm(true); }}
                onEditChapter={(ch) => { setEditingChapter(ch); setShowChapterForm(true); }}
                onDeleteChapter={handleDeleteChapter}
              />
            ))}
        </div>
      )}

      {showVolumeForm && (
        <VolumeFormModal
          initial={editingVolume}
          novelId={novelId}
          onSave={(input) => {
            if (editingVolume) handleUpdateVolume(editingVolume.id, input as UpdateVolumeInput);
            else handleCreateVolume({ ...input, novelId } as CreateVolumeInput);
          }}
          onClose={() => { setShowVolumeForm(false); setEditingVolume(null); }}
        />
      )}

      {showChapterForm && (
        <ChapterFormModal
          initial={editingChapter}
          novelId={novelId}
          volumeId={editingChapter?.volumeId || targetVolumeId}
          volumes={volumes}
          onSave={(input) => {
            if (editingChapter) handleUpdateChapter(editingChapter.id, input as UpdateChapterInput);
            else handleCreateChapter({ ...input, novelId } as CreateChapterInput);
          }}
          onClose={() => { setShowChapterForm(false); setEditingChapter(null); }}
        />
      )}
    </div>
  );
}

export default OutlineManager;
