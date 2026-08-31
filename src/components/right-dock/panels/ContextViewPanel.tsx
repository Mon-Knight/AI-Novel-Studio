import { appLogger } from '../../../services/observability/appLogger';
/**
 * AI Novel Studio - 上下文记录查看面板
 * v1.7.14: 增加卷上下文生成 + 卷完成检查 + 过期联动
 */
import { useState, useEffect, useCallback } from 'react';
import { Archive, Clock3, Plus, X } from 'lucide-react';
import type { Chapter } from '../../../types/chapter';
import type { Volume } from '../../../types/volume';
import type {
  ContextRecord,
  ContextCategory,
  CreateContextRecordInput,
} from '../../../types/context';
import type { VolumeCompletionCheck, VolumeSummarizeResult } from '../../../types/chapterSummary';
import { contextRecordService } from '../../../services/context/contextRecordService';
import { volumeRepository } from '../../../services/database/volumeRepository';
import { chapterRepository } from '../../../services/database/chapterRepository';
import {
  checkVolumeCompletion,
  collectVolumeChapterContexts,
  volumeSummaryAiService,
} from '../../../services/ai/volumeSummaryService';
import { cancelLoadingOperation, runWithLoading } from '../../../lib/runWithLoading';
import ContextRecordList from '../../context-records/ContextRecordList';
import ContextRecordForm from '../../context-records/ContextRecordForm';
import { describeUnknownError } from '../../../utils/errorMessage';
import { VolumeContextGenerationSection } from './VolumeContextGenerationSection';

interface ContextViewPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

const CATEGORY_TABS: { key: ContextCategory | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'chapter_context', label: '章节上下文' },
  { key: 'volume_context', label: '卷上下文' },
  { key: 'manual_context', label: '手动上下文' },
];

function classifyRecord(r: ContextRecord): ContextCategory {
  if (r.chapterId && (r.contextType === 'chapter_summary' || r.contextType === 'plot_progress')) {
    return 'chapter_context';
  }
  if (r.contextType === 'volume_summary') return 'volume_context';
  return 'manual_context';
}

function ContextViewPanel({ novelId, chapter }: ContextViewPanelProps) {
  const [records, setRecords] = useState<ContextRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<ContextCategory | 'all'>('all');

  // 卷上下文状态
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [volumeChecks, setVolumeChecks] = useState<Record<string, VolumeCompletionCheck>>({});
  const [genLoading, setGenLoading] = useState<Record<string, boolean>>({});
  const [genError, setGenError] = useState<Record<string, string>>({});
  const [genResult, setGenResult] = useState<Record<string, VolumeSummarizeResult>>({});

  const load = useCallback(async () => {
    if (!novelId) return;
    setLoading(true);
    setLoadError('');
    try {
      const recs = await contextRecordService.getByNovelId(novelId);
      // 预加载卷和章节（用于卷上下文 tab）
      const [v, c] = await Promise.all([
        volumeRepository.getByNovelId(novelId),
        chapterRepository.getByNovelId(novelId),
      ]);
      setVolumes(v);
      setChapters(c);

      // 检查每个卷的完成状态
      const checks: Record<string, VolumeCompletionCheck> = {};
      for (const vol of v) {
        checks[vol.id] = await checkVolumeCompletion(vol, c);
      }
      setVolumeChecks(checks);

      // 过期联动：检查卷上下文是否仍有效
      let changed = false;
      for (const r of recs) {
        if (r.contextType === 'volume_summary' && r.volumeId && !r.isExpired) {
          const check = checks[r.volumeId];
          if (check && !check.completed) {
            await contextRecordService.update(r.id, { isExpired: true });
            changed = true;
          }
        }
      }
      // 如果有变更，重新加载
      if (changed) {
        setRecords(await contextRecordService.getByNovelId(novelId));
      } else {
        setRecords(recs);
      }
    } catch (error) {
      appLogger.error(error);
      setLoadError(describeUnknownError(error, '上下文读取或状态同步失败'));
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleActive = async (id: string, isActive: boolean) => {
    setLoadError('');
    try {
      await contextRecordService.setActive(id, isActive);
      setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, isActive } : r)));
    } catch (error) {
      appLogger.error(error);
      setLoadError(describeUnknownError(error, '上下文启用状态保存失败'));
    }
  };

  const handleDelete = async (id: string) => {
    setLoadError('');
    try {
      await contextRecordService.remove(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (error) {
      appLogger.error(error);
      setLoadError(describeUnknownError(error, '上下文删除失败'));
    }
  };

  const handleAdd = async (input: CreateContextRecordInput) => {
    setLoadError('');
    try {
      await contextRecordService.create(input);
      setShowForm(false);
      await load();
    } catch (error) {
      appLogger.error(error);
      setLoadError(describeUnknownError(error, '上下文保存失败'));
    }
  };

  // 生成卷上下文
  const handleGenerateVolumeContext = async (volume: Volume) => {
    if (!novelId) return;
    setGenLoading((prev) => ({ ...prev, [volume.id]: true }));
    setGenError((prev) => ({ ...prev, [volume.id]: '' }));

    try {
      await runWithLoading(
        {
          title: 'AI 正在生成卷上下文',
          initialMessage: `正在汇总「${volume.title}」的章节上下文……`,
          successMessage: '卷上下文生成完成',
          errorMessage: '生成失败',
          cancelable: true,
        },
        async ({ setStage, signal, operationId }) => {
          setStage('收集章节上下文……');
          const chapterContexts = await collectVolumeChapterContexts(volume.id, chapters);

          setStage('AI 正在汇总……');
          const result = await volumeSummaryAiService.summarize(
            {
              novelId,
              volumeId: volume.id,
              volumeTitle: volume.title,
              chapterContexts,
            },
            { signal, cancel: () => cancelLoadingOperation(operationId) },
          );
          setGenResult((prev) => ({ ...prev, [volume.id]: result }));
        },
      );
    } catch (e: unknown) {
      setGenError((prev) => ({ ...prev, [volume.id]: describeUnknownError(e, '生成失败') }));
    } finally {
      setGenLoading((prev) => ({ ...prev, [volume.id]: false }));
    }
  };

  // 保存卷上下文
  const handleSaveVolumeContext = async (volume: Volume) => {
    const result = genResult[volume.id];
    if (!novelId || !result) return;

    const content = [
      `## ${result.summaryTitle}`,
      `**主线**：${result.volumeMainArc}`,
      result.majorEvents.length > 0
        ? `**重大事件**：\n${result.majorEvents.map((e: string) => `- ${e}`).join('\n')}`
        : '',
      result.protagonistGrowth ? `**主角成长**：${result.protagonistGrowth}` : '',
      result.settingChanges.length > 0
        ? `**设定变化**：\n${result.settingChanges.map((s: string) => `- ${s}`).join('\n')}`
        : '',
      result.foreshadowingCollected.length > 0
        ? `**已埋伏笔**：\n${result.foreshadowingCollected.map((f: string) => `- ${f}`).join('\n')}`
        : '',
      result.unresolvedQuestions.length > 0
        ? `**未解决问题**：\n${result.unresolvedQuestions.map((q: string) => `- ${q}`).join('\n')}`
        : '',
      result.factsMustRemember.length > 0
        ? `**关键事实**：\n${result.factsMustRemember.map((f: string) => `- ${f}`).join('\n')}`
        : '',
      result.nextVolumeHook ? `**下卷衔接**：${result.nextVolumeHook}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    setGenError((prev) => ({ ...prev, [volume.id]: '' }));
    try {
      await contextRecordService.create({
        novelId,
        volumeId: volume.id,
        contextType: 'volume_summary',
        title: result.summaryTitle || `${volume.title} 卷总结`,
        content,
        importance: 5,
        isActive: true,
      });

      // 刷新
      setGenResult((prev) => {
        const next = { ...prev };
        delete next[volume.id];
        return next;
      });
      await load();
    } catch (error) {
      appLogger.error(error);
      setGenError((prev) => ({
        ...prev,
        [volume.id]: describeUnknownError(error, '卷上下文保存失败'),
      }));
    }
  };

  const filteredRecords =
    activeTab === 'all' ? records : records.filter((r) => classifyRecord(r) === activeTab);

  const activeCount = filteredRecords.filter((r) => r.isActive && !r.isExpired).length;
  const expiredCount = filteredRecords.filter((r) => r.isExpired).length;

  if (!novelId)
    return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择作品</div>;

  return (
    <div>
      {loadError && (
        <div
          className="panel-section"
          role="alert"
          data-testid="error-notice"
          style={{ color: 'var(--color-error)', fontSize: 12 }}
        >
          {loadError}
        </div>
      )}
      <div className="panel-section">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <div
            className="panel-section-title"
            style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Archive size={14} strokeWidth={1.8} aria-hidden="true" />
            上下文记录（{filteredRecords.length}）
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowForm(!showForm)}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
          >
            {showForm ? (
              <>
                <X size={13} strokeWidth={1.8} aria-hidden="true" />
                取消
              </>
            ) : (
              <>
                <Plus size={13} strokeWidth={1.8} aria-hidden="true" />
                新增
              </>
            )}
          </button>
        </div>

        {/* 分类标签 */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          {CATEGORY_TABS.map((tab) => {
            const count =
              tab.key === 'all'
                ? records.length
                : records.filter((r) => classifyRecord(r) === tab.key).length;
            return (
              <button
                key={tab.key}
                className={`btn btn-sm ${activeTab === tab.key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveTab(tab.key)}
                style={{ fontSize: 10, padding: '2px 8px' }}
              >
                {tab.label}（{count}）
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
          启用 {activeCount} 条 / 共 {filteredRecords.length} 条
          {expiredCount > 0 && (
            <span
              style={{
                color: 'var(--color-warning-text)',
                marginLeft: 6,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Clock3 size={12} strokeWidth={1.8} aria-hidden="true" />
              {expiredCount} 条已过期
            </span>
          )}
        </div>

        {activeTab === 'volume_context' && (
          <VolumeContextGenerationSection
            volumes={volumes}
            volumeChecks={volumeChecks}
            loadingByVolume={genLoading}
            errorByVolume={genError}
            resultByVolume={genResult}
            onGenerate={handleGenerateVolumeContext}
            onSave={handleSaveVolumeContext}
            onDiscard={(volumeId) =>
              setGenResult((previous) => {
                const next = { ...previous };
                delete next[volumeId];
                return next;
              })
            }
          />
        )}

        {showForm && (
          <ContextRecordForm
            novelId={novelId}
            chapterId={chapter?.id}
            onSave={handleAdd}
            onCancel={() => setShowForm(false)}
          />
        )}

        {loading ? (
          <div style={{ padding: 16, color: 'var(--color-text-muted)', textAlign: 'center' }}>
            加载中...
          </div>
        ) : (
          <ContextRecordList
            records={filteredRecords}
            onToggleActive={handleToggleActive}
            onDelete={handleDelete}
            compact
          />
        )}
      </div>
    </div>
  );
}

export default ContextViewPanel;
