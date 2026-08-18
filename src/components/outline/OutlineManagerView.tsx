import type { Dispatch, SetStateAction } from 'react';
import VolumeCard from './VolumeCard';
import VolumeFormModal from './VolumeFormModal';
import ChapterFormModal from './ChapterFormModal';
import { OutlineCandidateResults } from './OutlineCandidateResults';
import type { Volume, CreateVolumeInput, UpdateVolumeInput } from '../../types/volume';
import type { Chapter, CreateChapterInput, UpdateChapterInput } from '../../types/chapter';
import type {
  ChapterOutlineCandidate,
  VolumeOutlineCandidate,
} from '../../services/ai/outlineGenerateService';
import type { MasterOutline } from '../../types/outline';

interface OutlineManagerViewProps {
  novelId: string;
  volumes: Volume[];
  chapters: Chapter[];
  message: string;
  aiLoading: string;
  novelOutline: string;
  setNovelOutline: Dispatch<SetStateAction<string>>;
  volumeCandidate: VolumeOutlineCandidate | null;
  setVolumeCandidate: Dispatch<SetStateAction<VolumeOutlineCandidate | null>>;
  chapterCandidates: ChapterOutlineCandidate[];
  setChapterCandidates: Dispatch<SetStateAction<ChapterOutlineCandidate[]>>;
  masterOutlines: MasterOutline[];
  selectedMasterOutlineId: string;
  setSelectedMasterOutlineId: Dispatch<SetStateAction<string>>;
  targetVolumeId?: string;
  setTargetVolumeId: Dispatch<SetStateAction<string | undefined>>;
  showVolumeForm: boolean;
  setShowVolumeForm: Dispatch<SetStateAction<boolean>>;
  editingVolume: Volume | null;
  setEditingVolume: Dispatch<SetStateAction<Volume | null>>;
  showChapterForm: boolean;
  setShowChapterForm: Dispatch<SetStateAction<boolean>>;
  editingChapter: Chapter | null;
  setEditingChapter: Dispatch<SetStateAction<Chapter | null>>;
  handleGenerateNovelOutline: () => Promise<void>;
  handleGenerateVolumeOutline: () => Promise<void>;
  handleGenerateChapterOutlines: () => Promise<void>;
  handleSaveNovelOutline: () => Promise<void>;
  handleSetActiveMasterOutline: () => Promise<void>;
  handleSaveVolumeCandidate: () => Promise<void>;
  handleSaveChapterCandidate: (candidate: ChapterOutlineCandidate) => Promise<void>;
  handleCreateVolume: (input: CreateVolumeInput) => Promise<void>;
  handleUpdateVolume: (id: string, input: UpdateVolumeInput) => Promise<void>;
  handleDeleteVolume: (id: string) => Promise<void>;
  handleCreateChapter: (input: CreateChapterInput) => Promise<void>;
  handleUpdateChapter: (id: string, input: UpdateChapterInput) => Promise<void>;
  handleDeleteChapter: (id: string) => Promise<void>;
}

export function OutlineManagerView({
  novelId,
  volumes,
  chapters,
  message,
  aiLoading,
  novelOutline,
  setNovelOutline,
  volumeCandidate,
  setVolumeCandidate,
  chapterCandidates,
  setChapterCandidates,
  masterOutlines,
  selectedMasterOutlineId,
  setSelectedMasterOutlineId,
  targetVolumeId,
  setTargetVolumeId,
  showVolumeForm,
  setShowVolumeForm,
  editingVolume,
  setEditingVolume,
  showChapterForm,
  setShowChapterForm,
  editingChapter,
  setEditingChapter,
  handleGenerateNovelOutline,
  handleGenerateVolumeOutline,
  handleGenerateChapterOutlines,
  handleSaveNovelOutline,
  handleSetActiveMasterOutline,
  handleSaveVolumeCandidate,
  handleSaveChapterCandidate,
  handleCreateVolume,
  handleUpdateVolume,
  handleDeleteVolume,
  handleCreateChapter,
  handleUpdateChapter,
  handleDeleteChapter,
}: OutlineManagerViewProps) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📋</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>大纲与章节管理</span>
          <span className="text-sm text-muted">
            （{volumes.length} 卷 · {chapters.length} 章）
          </span>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            setEditingVolume(null);
            setShowVolumeForm(true);
          }}
        >
          + 新建分卷
        </button>
      </div>

      {message && (
        <div
          style={{
            fontSize: 13,
            padding: '6px 12px',
            background: 'var(--color-primary-light)',
            borderRadius: 6,
            marginBottom: 12,
            color: 'var(--color-primary)',
          }}
        >
          {message}
        </div>
      )}

      <div className="detail-card" style={{ marginBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>AI 大纲生成</div>
          <select
            className="panel-select"
            value={targetVolumeId || ''}
            onChange={(e) => setTargetVolumeId(e.target.value || undefined)}
            style={{ minWidth: 180 }}
          >
            <option value="">默认分卷/新分卷</option>
            {volumes.map((volume) => (
              <option key={volume.id} value={volume.id}>
                {volume.title}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleGenerateNovelOutline}
            disabled={!!aiLoading}
          >
            {aiLoading === 'novel' ? '生成中...' : '生成作品总大纲'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleGenerateVolumeOutline}
            disabled={!!aiLoading}
          >
            {aiLoading === 'volume' ? '生成中...' : '生成分卷大纲'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleGenerateChapterOutlines}
            disabled={!!aiLoading}
          >
            {aiLoading === 'chapters' ? '生成中...' : '生成章节大纲'}
          </button>
        </div>

        {novelOutline && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              border: '1px solid var(--color-border-light)',
              borderRadius: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              📋 生成的总纲（可编辑后保存）
            </div>
            <textarea
              className="input"
              value={novelOutline}
              onChange={(e) => setNovelOutline(e.target.value)}
              style={{
                width: '100%',
                height: 180,
                resize: 'vertical',
                fontSize: 13,
                lineHeight: 1.7,
                fontFamily: 'var(--font-family-editor)',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleSaveNovelOutline}>
                💾 保存到大纲库
              </button>
            </div>
          </div>
        )}

        {/* v1.0.35: 大纲库选择 */}
        {masterOutlines.length > 0 && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              border: '1px solid var(--color-border-light)',
              borderRadius: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              📚 已保存的总纲（{masterOutlines.length} 个版本）
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="panel-select"
                value={selectedMasterOutlineId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedMasterOutlineId(id);
                  const outline = masterOutlines.find((o) => o.id === id);
                  if (outline) setNovelOutline(outline.content);
                }}
                style={{ flex: 1, minWidth: 200 }}
              >
                <option value="">选择已保存的总纲</option>
                {masterOutlines.map((o) => (
                  <option key={o.id} value={o.id}>
                    v{o.version} {o.isActive ? '★ 采用中' : ''} - {o.title}
                  </option>
                ))}
              </select>
              {selectedMasterOutlineId && (
                <button className="btn btn-sm btn-secondary" onClick={handleSetActiveMasterOutline}>
                  ✅ 设为采用
                </button>
              )}
            </div>
          </div>
        )}

        <OutlineCandidateResults
          volumeCandidate={volumeCandidate}
          setVolumeCandidate={setVolumeCandidate}
          chapterCandidates={chapterCandidates}
          setChapterCandidates={setChapterCandidates}
          targetVolumeId={targetVolumeId}
          onSaveVolumeCandidate={handleSaveVolumeCandidate}
          onSaveChapterCandidate={handleSaveChapterCandidate}
        />
      </div>

      {volumes.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 32,
            color: 'var(--color-text-muted)',
            border: '1px dashed var(--color-border)',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.5 }}>📚</div>
          <div style={{ fontSize: 15, marginBottom: 8 }}>还没有分卷</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>
            长篇小说通常从分卷结构开始。你可以先创建第一卷，再添加章节大纲。
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditingVolume(null);
              setShowVolumeForm(true);
            }}
          >
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
                chapters={chapters
                  .filter((ch) => ch.volumeId === volume.id)
                  .sort((a, b) => a.orderIndex - b.orderIndex)}
                onEdit={() => {
                  setEditingVolume(volume);
                  setShowVolumeForm(true);
                }}
                onDelete={() => handleDeleteVolume(volume.id)}
                onAddChapter={() => {
                  setTargetVolumeId(volume.id);
                  setEditingChapter(null);
                  setShowChapterForm(true);
                }}
                onEditChapter={(ch) => {
                  setEditingChapter(ch);
                  setShowChapterForm(true);
                }}
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
          onClose={() => {
            setShowVolumeForm(false);
            setEditingVolume(null);
          }}
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
          onClose={() => {
            setShowChapterForm(false);
            setEditingChapter(null);
          }}
        />
      )}
    </div>
  );
}
