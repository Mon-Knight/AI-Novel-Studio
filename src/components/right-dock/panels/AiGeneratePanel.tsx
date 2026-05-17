import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft, ChapterGenerationContext } from '../../../types/ai';
import { ChapterStatusLabels } from '../../../types/chapter';
import { createAiClient, aiSettingsService } from '../../../services/ai/aiClient';
import { buildChapterContext } from '../../../services/prompt/contextBuilder';
import { buildGenerateRequest } from '../../../services/prompt/promptOrchestrator';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { aiTaskService } from '../../../services/ai/aiTaskService';
import { contextRecordService } from '../../../services/context/contextRecordService';
import { formatNumber } from '../../../utils/format';

interface AiGeneratePanelProps {
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft) => void;
  onAdopted?: () => void;
}

function AiGeneratePanel({ novelId, chapter, onGenerated, onAdopted }: AiGeneratePanelProps) {
  const [userInstruction, setUserInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [genMode, setGenMode] = useState<'new' | 'rewrite'>('new');

  // v1.0.25 上下文摘要状态
  const [contextSummary, setContextSummary] = useState<ChapterGenerationContext | null>(null);
  const [showContext, setShowContext] = useState(false);

  // v0.8.0 上下文加载状态
  const [contextCount, setContextCount] = useState(0);

  useEffect(() => {
    if (novelId) {
      contextRecordService.getForGeneration({ novelId, maxCount: 15 })
        .then((records) => setContextCount(records.length))
        .catch(() => setContextCount(0));
    }
  }, [novelId]);

  // v1.0.25 预加载上下文摘要
  const handlePreviewContext = useCallback(async () => {
    if (!novelId || !chapter) return;
    try {
      const ctx = await buildChapterContext(novelId, chapter, userInstruction.trim() || undefined);
      setContextSummary(ctx);
      setShowContext(true);
    } catch { /* ignore */ }
  }, [novelId, chapter, userInstruction]);

  const settings = aiSettingsService.getSettings();

  const handleGenerate = async () => {
    if (!novelId || !chapter) return;

    // v1.0.25 缺少章节大纲时给出警告
    if (!chapter.outline?.trim()) {
      const ok = confirm(
        '⚠️ 当前章节没有章节大纲。\n\n' +
        '没有大纲的情况下，AI 可能无法准确把握本章方向，生成内容可能与你的规划脱节。\n\n' +
        '建议先在大纲面板中生成或填写章节大纲。\n\n' +
        '是否仍然继续生成？'
      );
      if (!ok) return;
    }

    setGenerating(true);
    setStatusMsg('正在构建上下文...');
    setErrorMsg('');

    // v1.0.25 构建详细的 inputSummary
    let ctx: ChapterGenerationContext | undefined;
    try {
      ctx = await buildChapterContext(novelId, chapter, userInstruction.trim() || undefined);
    } catch { /* 上下文构建失败不阻止生成 */ }

    const hasOutline = ctx?.chapterOutline ? '有' : '无';
    const charCount = ctx?.chapterCharacters ? (ctx.chapterCharacters.match(/\n- /g)?.length || 1) : 0;
    const eventCount = ctx?.chapterEvents ? (ctx.chapterEvents.match(/\n- /g)?.length || 1) : 0;
    const hasPrevContext = ctx?.previousContext ? '有' : '无';

    const inputSummary = [
      `生成：${novelId.slice(0,8)}/${chapter.title}`,
      `大纲：${hasOutline}`,
      `角色：${charCount}个`,
      `事件：${eventCount}个`,
      `前文：${hasPrevContext}`,
      `字数：${chapter.targetWordCount || 4000}`,
    ].join('，');

    // 创建 AI 任务记录
    const task = await aiTaskService.create('chapter_generate', {
      novelId,
      chapterId: chapter.id,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary,
    }).catch(() => null);

    try {
      setStatusMsg('正在组装提示词...');
      // 1. 构建上下文（如果前面没构建过）
      if (!ctx) {
        ctx = await buildChapterContext(novelId, chapter, userInstruction.trim() || undefined);
      }

      // 2. 组装提示词
      const request = await buildGenerateRequest(ctx);

      // 3. 调用 AI
      setStatusMsg('正在调用 AI 生成正文...');
      const client = createAiClient(settings);
      const response = await client.generate(request);

      // 4. 保存为草稿
      const draft = await draftVersionService.create({
        novelId,
        chapterId: chapter.id,
        content: response.text,
        source: genMode === 'rewrite' ? 'ai_regenerated' : 'ai_generated',
        aiTaskId: task?.id,
      });

      // 5. 更新 AI 任务记录
      if (task) {
        await aiTaskService.markSucceeded(task.id, {
          resultText: `字数：${draft.wordCount}，首段：${response.text.slice(0, 200)}`,
          tokenInput: response.tokenInput,
          tokenOutput: response.tokenOutput,
          tokenTotal: response.tokenTotal,
        });
      }

      setStatusMsg(`✅ 生成成功！已保存为草稿 v${draft.versionNo}（${formatNumber(draft.wordCount)} 字）`);
      setGenerating(false);
      onGenerated?.(draft);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '生成失败';
      setErrorMsg(msg);
      setStatusMsg('');
      setGenerating(false);

      if (task) {
        await aiTaskService.markFailed(task.id, msg);
      }
    }
  };

  const handleAdopt = async () => {
    if (!chapter) return;
    const latest = await draftVersionService.getLatestByChapterId(chapter.id);
    if (!latest) {
      setErrorMsg('没有可采用的草稿');
      return;
    }
    if (!confirm(`确认采用草稿 v${latest.versionNo} 作为正式正文？\n\n采用后该版本将成为当前章节的正式正文。`)) return;

    await draftVersionService.adopt(latest.id, chapter.id);
    setStatusMsg('已采用为正式正文！');
    setTimeout(() => setStatusMsg(''), 3000);
    onAdopted?.();
  };

  if (!chapter) {
    return (
      <div className="text-sm text-muted" style={{ padding: 16, textAlign: 'center' }}>
        请先在左侧目录树中选择一个章节
      </div>
    );
  }

  return (
    <div>
      {/* AI 设置状态 */}
      <div className="panel-section">
        <div className="panel-section-title">AI 状态</div>
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
          <div>模式：{settings.runtimeMode === 'mock' ? '🔶 Mock 模式' : '🔷 真实 API'}</div>
          {settings.runtimeMode === 'api' && (
            <div>模型：{settings.modelName || '未配置'}</div>
          )}
          {settings.runtimeMode === 'api' && !settings.apiKey && (
            <div style={{ color: 'var(--color-error)', marginTop: 4 }}>
              ⚠️ 未配置 API Key，请先到设置中心配置
            </div>
          )}
        </div>
      </div>

      {/* v0.8.0 上下文加载状态 */}
      <div className="panel-section">
        <div className="panel-section-title">📦 上下文加载状态</div>
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
          <div>已加载上下文：<strong>{contextCount}</strong> 条</div>
          {contextCount === 0 && (
            <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
              暂无前文上下文记录，可先在已采用章节中生成总结
            </div>
          )}
          {contextCount > 0 && (
            <div style={{ color: 'var(--color-success)', marginTop: 2 }}>
              ✅ 下一章生成时将自动加载以上下文摘要
            </div>
          )}
        </div>
      </div>

      {/* 当前章节 */}
      <div className="panel-section">
        <div className="panel-section-title">当前章节</div>
        <div className="panel-field">
          <div className="panel-field-label">章节</div>
          <div className="panel-field-value">第{chapter.chapterNumber}章：{chapter.title}</div>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">目标字数</div>
          <div className="panel-field-value">{formatNumber(chapter.targetWordCount ?? 4000)} 字</div>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">状态</div>
          <div className="panel-field-value">{ChapterStatusLabels[chapter.status]}</div>
        </div>
      </div>

      {/* 生成模式 */}
      <div className="panel-section">
        <div className="panel-section-title">生成模式</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`panel-btn ${genMode === 'new' ? 'panel-btn-primary' : 'panel-btn-secondary'}`}
            onClick={() => setGenMode('new')}
            style={{ flex: 1 }}
          >
            生成新稿
          </button>
          <button
            className={`panel-btn ${genMode === 'rewrite' ? 'panel-btn-primary' : 'panel-btn-secondary'}`}
            onClick={() => setGenMode('rewrite')}
            style={{ flex: 1 }}
          >
            重新生成
          </button>
        </div>
      </div>

      {/* 额外要求 */}
      <div className="panel-section">
        <div className="panel-section-title">本次生成额外要求</div>
        <textarea
          className="form-textarea"
          value={userInstruction}
          onChange={(e) => setUserInstruction(e.target.value)}
          placeholder="例如：本章开头要压抑一些，结尾留下悬念..."
          style={{ width: '100%', height: 70, resize: 'vertical', fontSize: 13 }}
        />
      </div>

      {/* v1.0.25 上下文摘要预览 */}
      <div className="panel-section">
        <div className="panel-section-title">📋 本次将使用的上下文</div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handlePreviewContext}
          disabled={generating}
          style={{ width: '100%', marginBottom: 6 }}
        >
          🔍 查看上下文摘要
        </button>
        {!chapter.outline?.trim() && (
          <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 4 }}>
            ⚠️ 当前章节没有章节大纲，AI 可能偏离规划方向
          </div>
        )}
        {showContext && contextSummary && (
          <div style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--color-text-secondary)', marginTop: 8, padding: 8, background: 'var(--color-bg-primary)', borderRadius: 4 }}>
            <div>📖 总大纲：{contextSummary.novelOutline ? '✅ 有' : '❌ 无'}</div>
            <div>📋 分卷大纲：{contextSummary.volumeOutline ? '✅ 有' : '❌ 无'}</div>
            <div>📝 章节大纲：{contextSummary.chapterOutline ? `✅ 有（${contextSummary.chapterOutline.length} 字）` : '❌ 无'}</div>
            <div>👥 出场角色：{contextSummary.chapterCharacters ? (contextSummary.chapterCharacters.match(/\n- /g)?.length || 1) : 0} 个</div>
            <div>⚡ 本章事件：{contextSummary.chapterEvents ? (contextSummary.chapterEvents.match(/\n- /g)?.length || 1) : 0} 个</div>
            <div>🌍 世界设定：{contextSummary.worldBackground ? '✅ 有' : '❌ 无'}</div>
            <div>📦 前文总结：{contextSummary.previousContext ? '✅ 有' : '❌ 无'}</div>
            <div>🎨 风格方案：{contextSummary.styleProfile ? '✅ 有' : '❌ 无（使用默认）'}</div>
            <div>📊 目标字数：{contextSummary.targetWordCount || 4000} 字</div>
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
          点击「查看上下文摘要」可预览 AI 将收到的全部配置信息
        </div>
      </div>

      {/* 状态消息 */}
      {statusMsg && (
        <div style={{
          fontSize: 13, padding: '8px 12px', borderRadius: 6, marginBottom: 12,
          background: statusMsg.includes('成功') ? '#e8f5e9' : 'var(--color-primary-light)',
          color: statusMsg.includes('成功') ? '#2e7d32' : 'var(--color-primary)',
        }}>
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div style={{
          fontSize: 13, padding: '8px 12px', borderRadius: 6, marginBottom: 12,
          background: '#ffebee', color: '#c62828',
        }}>
          {errorMsg}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="panel-section">
        <button
          className="panel-btn panel-btn-primary"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? '⏳ 正在生成...' : `🤖 ${genMode === 'rewrite' ? '重新生成' : '生成本章'}`}
        </button>
        <button
          className="panel-btn panel-btn-secondary"
          onClick={handleAdopt}
        >
          ✅ 确认采用
        </button>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 6 }}>
          AI 生成结果将保存为草稿版本，需手动确认采用
        </div>
      </div>
    </div>
  );
}

export default AiGeneratePanel;
