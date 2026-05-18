import { useState, useEffect, useCallback } from 'react';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { settingRepository } from '../../services/database/settingRepository';
import { createVolumeForNovel, createFirstVolumeAndChapter, createChapterInVolume } from '../../services/chapters/chapterCreationService';
import { outlineGenerateService, type ChapterOutlineCandidate, type VolumeOutlineCandidate } from '../../services/ai/outlineGenerateService';
import VolumeCard from './VolumeCard';
import VolumeFormModal from './VolumeFormModal';
import ChapterFormModal from './ChapterFormModal';
import type { Volume, CreateVolumeInput, UpdateVolumeInput } from '../../types/volume';
import type { Chapter, CreateChapterInput, UpdateChapterInput } from '../../types/chapter';
import { runWithLoading } from '../../lib/runWithLoading';

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
  const [aiLoading, setAiLoading] = useState('');
  const [novelOutline, setNovelOutline] = useState('');
  const [volumeCandidate, setVolumeCandidate] = useState<VolumeOutlineCandidate | null>(null);
  const [chapterCandidates, setChapterCandidates] = useState<ChapterOutlineCandidate[]>([]);

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
      await createVolumeForNovel(novelId, input.title, {
        summary: input.summary,
        goal: input.goal,
        mainConflict: input.mainConflict,
        orderIndex: input.orderIndex,
      });
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
        const result = await createFirstVolumeAndChapter(novelId, {
          chapterTitle: input.title,
          outline: input.outline,
          goal: input.goal,
          targetWordCount: input.targetWordCount,
        });
        await loadData();
        setShowChapterForm(false);
        setTargetVolumeId(undefined);
        flash('✅ 已创建第一卷和第1章（含空草稿）');
        console.info('[OutlineManager] createFirstVolumeAndChapter done, chapterId=', result.chapter.id);
      } else {
        const result = await createChapterInVolume(novelId, volumeId, input.title, {
          outline: input.outline,
          goal: input.goal,
          targetWordCount: input.targetWordCount,
        });
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

  const handleGenerateNovelOutline = async () => {
    setAiLoading('novel');
    setNovelOutline('');
    setVolumeCandidate(null);
    setChapterCandidates([]);
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成作品总大纲',
          initialMessage: '正在读取作品设定……',
          successMessage: '作品总大纲已生成，请确认后保存',
          errorMessage: '作品总大纲生成失败',
        },
        async ({ setMessage, setStage }) => {
          setStage('正在分析世界观和角色……');
          const outline = await outlineGenerateService.generateNovelOutline(novelId);
          setNovelOutline(outline);
        },
      );
    } catch (e: any) {
      flash('AI 作品总大纲生成失败：' + (e?.message || '未知错误'));
    } finally {
      setAiLoading('');
    }
  };

  const handleSaveNovelOutline = async () => {
    if (!novelOutline.trim()) return;
    await settingRepository.saveWorldSetting(null, {
      novelId,
      title: 'AI 作品总大纲',
      content: novelOutline,
      isActive: false,
    });
    setNovelOutline('');
    flash('作品总大纲已保存到设定库');
  };

  const handleGenerateVolumeOutline = async () => {
    const target = volumes.find((volume) => volume.id === targetVolumeId);
    setAiLoading('volume');
    setVolumeCandidate(null);
    setChapterCandidates([]);
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成分卷大纲',
          initialMessage: '正在读取分卷和作品设定……',
          successMessage: '分卷大纲已生成，请确认后保存',
          errorMessage: '分卷大纲生成失败',
        },
        async ({ setStage }) => {
          setStage('正在分析分卷结构……');
          const candidate = await outlineGenerateService.generateVolumeOutline({
            novelId,
            volumeTitle: target?.title,
          });
          setVolumeCandidate(candidate);
        },
      );
    } catch (e: any) {
      flash('AI 分卷大纲生成失败：' + (e?.message || '未知错误'));
    } finally {
      setAiLoading('');
    }
  };

  const handleSaveVolumeCandidate = async () => {
    if (!volumeCandidate) return;
    if (targetVolumeId) {
      await volumeRepository.update(targetVolumeId, {
        title: volumeCandidate.title,
        summary: volumeCandidate.summary,
        goal: volumeCandidate.goal,
        mainConflict: volumeCandidate.mainConflict,
      });
    } else {
      await createVolumeForNovel(novelId, volumeCandidate.title, {
        summary: volumeCandidate.summary,
        goal: volumeCandidate.goal,
        mainConflict: volumeCandidate.mainConflict,
      });
    }
    setVolumeCandidate(null);
    await loadData();
    flash('分卷大纲已保存');
  };

  const handleGenerateChapterOutlines = async () => {
    const volumeId = targetVolumeId || volumes[0]?.id;
    setAiLoading('chapters');
    setChapterCandidates([]);
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成章节大纲',
          initialMessage: '正在读取分卷大纲和设定……',
          successMessage: '章节大纲已生成，请逐条确认保存',
          errorMessage: '章节大纲生成失败',
        },
        async ({ setStage }) => {
          setStage('AI 正在规划章节结构……');
          const candidates = await outlineGenerateService.generateChapterOutlines({
            novelId,
            volumeId,
            chapterCount: 6,
          });
          setChapterCandidates(candidates);
        },
      );
    } catch (e: any) {
      flash('AI 章节大纲生成失败：' + (e?.message || '未知错误'));
    } finally {
      setAiLoading('');
    }
  };

  const handleSaveChapterCandidate = async (candidate: ChapterOutlineCandidate) => {
    let volumeId = targetVolumeId || volumes[0]?.id || '';
    if (!volumeId) {
      const created = await createFirstVolumeAndChapter(novelId, {
        chapterTitle: candidate.title,
        outline: candidate.outline,
        goal: candidate.goal,
        targetWordCount: candidate.targetWordCount,
      });
      volumeId = created.chapter.volumeId || '';
    } else {
      await createChapterInVolume(novelId, volumeId, candidate.title, {
        outline: candidate.outline,
        goal: candidate.goal,
        targetWordCount: candidate.targetWordCount,
      });
    }
    setChapterCandidates((prev) => prev.filter((item) => item !== candidate));
    await loadData();
    flash('章节大纲已保存为新章节');
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

      <div className="detail-card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>AI 大纲生成</div>
          <select className="panel-select" value={targetVolumeId || ''} onChange={(e) => setTargetVolumeId(e.target.value || undefined)} style={{ minWidth: 180 }}>
            <option value="">默认分卷/新分卷</option>
            {volumes.map((volume) => <option key={volume.id} value={volume.id}>{volume.title}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleGenerateNovelOutline} disabled={!!aiLoading}>
            {aiLoading === 'novel' ? '生成中...' : '生成作品总大纲'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleGenerateVolumeOutline} disabled={!!aiLoading}>
            {aiLoading === 'volume' ? '生成中...' : '生成分卷大纲'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleGenerateChapterOutlines} disabled={!!aiLoading}>
            {aiLoading === 'chapters' ? '生成中...' : '生成章节大纲'}
          </button>
        </div>

        {novelOutline && (
          <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--color-border-light)', borderRadius: 6 }}>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>{novelOutline}</div>
            <button className="btn btn-primary btn-sm" onClick={handleSaveNovelOutline} style={{ marginTop: 8 }}>确认保存到设定库</button>
          </div>
        )}

        {volumeCandidate && (
          <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--color-border-light)', borderRadius: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{volumeCandidate.title}</div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{volumeCandidate.summary}</div>
            {volumeCandidate.goal && <div style={{ fontSize: 12, marginTop: 4 }}>目标：{volumeCandidate.goal}</div>}
            {volumeCandidate.mainConflict && <div style={{ fontSize: 12, marginTop: 4 }}>冲突：{volumeCandidate.mainConflict}</div>}
            <button className="btn btn-primary btn-sm" onClick={handleSaveVolumeCandidate} style={{ marginTop: 8 }}>
              {targetVolumeId ? '确认更新分卷' : '确认创建分卷'}
            </button>
          </div>
        )}

        {chapterCandidates.length > 0 && (
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            {chapterCandidates.map((candidate, index) => (
              <div key={`${candidate.title}-${index}`} style={{ padding: 10, border: '1px solid var(--color-border-light)', borderRadius: 6 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{candidate.title}</div>
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{candidate.rawText || candidate.outline}</div>
                {candidate.goal && <div style={{ fontSize: 12, marginTop: 4 }}>目标：{candidate.goal}</div>}
                {!candidate.rawText && (
                  <button className="btn btn-primary btn-sm" onClick={() => handleSaveChapterCandidate(candidate)} style={{ marginTop: 8 }}>
                    确认保存为章节
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
