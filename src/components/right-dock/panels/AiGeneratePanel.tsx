import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft, ChapterGenerationContext, ChapterPromptDebugInfo } from '../../../types/ai';
import type { StyleProfile } from '../../../types/style';
import type { OutputProfile } from '../../../types/output';
import { ChapterStatusLabels } from '../../../types/chapter';
import { createAiClient, aiSettingsService } from '../../../services/ai/aiClient';
import { buildFreshChapterGenerationContext } from '../../../services/prompt/contextBuilder';
import { buildGenerateRequest } from '../../../services/prompt/promptOrchestrator';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { chapterRepository } from '../../../services/database/chapterRepository';
import { aiTaskService } from '../../../services/ai/aiTaskService';
import { contextRecordService } from '../../../services/context/contextRecordService';
import { styleProfileService } from '../../../services/styles/styleProfileService';
import { outputProfileService } from '../../../services/styles/outputProfileService';
import { runWithLoading } from '../../../lib/runWithLoading';

function namesText(names: string[]): string {
  return names.length > 0 ? names.join('、') : '无';
}

function getChapterCharacterNames(ctx: ChapterGenerationContext | null | undefined): string[] {
  return ctx?.chapterCharacterList?.map((item) => item.name).filter(Boolean) ?? [];
}

function getRequiredCharacterNames(ctx: ChapterGenerationContext | null | undefined): string[] {
  return ctx?.requiredCharacters?.map((item) => item.name).filter(Boolean) ?? [];
}

function extractOutlineSignals(outline?: string): string[] {
  const text = outline?.trim();
  if (!text) return [];
  const quoted = Array.from(text.matchAll(/[《「『“"]([^》」』”"]{2,20})[》」』”"]/g))
    .map((match) => match[1].trim());
  const chunks = text
    .replace(/[#*`>~-]/g, ' ')
    .split(/[\n\r，。！？；：、,.!?;:]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 24);
  const tokens = chunks.flatMap((part) => part.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) ?? []);
  return [...new Set([...quoted, ...chunks, ...tokens])]
    .filter((item) => !['本章', '主角', '剧情', '事件', '冲突', '结尾', '推进', '发现', '开始'].includes(item))
    .slice(0, 18);
}

function buildOutlineWarning(outline: string | undefined, generatedText: string): string | undefined {
  const signals = extractOutlineSignals(outline);
  if (signals.length === 0) return undefined;
  const hitCount = signals.filter((signal) => generatedText.includes(signal)).length;
  return hitCount === 0
    ? '⚠️ 生成正文可能未遵循章节大纲，建议重新生成或检查大纲。'
    : undefined;
}

interface AiGeneratePanelProps {
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft) => void;
  onAdopted?: () => void;
  contextVersion?: number;
}

function AiGeneratePanel({ novelId, chapter, onGenerated, onAdopted, contextVersion = 0 }: AiGeneratePanelProps) {
  const [userInstruction, setUserInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [genMode, setGenMode] = useState<'new' | 'rewrite'>('new');

  // v1.0.26 风格方案与输出控制选择
  const [availableStyles, setAvailableStyles] = useState<StyleProfile[]>([]);
  const [availableOutputs, setAvailableOutputs] = useState<OutputProfile[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState('');
  const [selectedOutputId, setSelectedOutputId] = useState('');

  // v1.0.42 目标字数可编辑（必须在 availableOutputs/selectedOutputId 声明之后）
  const [wordCountDraft, setWordCountDraft] = useState<number>(0);
  const [wordCountSaving, setWordCountSaving] = useState(false);
  const [wordCountSaved, setWordCountSaved] = useState(false);

  // 初始化/更新目标字数草稿
  useEffect(() => {
    const resolved = (() => {
      if (chapter?.targetWordCount && chapter.targetWordCount > 0) return chapter.targetWordCount;
      if (selectedOutputId) {
        const output = availableOutputs.find((o) => o.id === selectedOutputId);
        const ot = output?.targetWordCount || output?.chapterWordRange?.default;
        if (ot && ot > 0) return ot;
      }
      return 4000;
    })();
    setWordCountDraft(resolved);
    setWordCountSaved(false);
  }, [chapter?.id, chapter?.targetWordCount, selectedOutputId, availableOutputs]);

  // 保存目标字数
  const handleSaveWordCount = async () => {
    if (!novelId || !chapter?.id || wordCountDraft <= 0) return;
    setWordCountSaving(true);
    try {
      await chapterRepository.update(chapter.id, { targetWordCount: wordCountDraft });
      setWordCountSaved(true);
      setTimeout(() => setWordCountSaved(false), 2000);
    } catch (e: any) {
      setErrorMsg(`保存目标字数失败：${e.message || '未知错误'}`);
    } finally {
      setWordCountSaving(false);
    }
  };

  // v1.0.25 上下文摘要状态
  const [contextSummary, setContextSummary] = useState<ChapterGenerationContext | null>(null);
  const [promptDebug, setPromptDebug] = useState<ChapterPromptDebugInfo | null>(null);
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

  // v1.0.26 加载可用风格方案和输出控制
  useEffect(() => {
    if (novelId) {
      styleProfileService.getAll(novelId).then((list) => {
        setAvailableStyles(list);
        if (list.length > 0 && !selectedStyleId) setSelectedStyleId(list[0].id);
      }).catch(() => {});
      outputProfileService.getAll(novelId).then((list) => {
        setAvailableOutputs(list);
        const def = list.find((o) => o.isDefault) || list[0];
        if (def && !selectedOutputId) setSelectedOutputId(def.id);
      }).catch(() => {});
    }
  }, [novelId, selectedStyleId, selectedOutputId]);

  // v1.0.42 上下文摘要自动刷新（角色变更/字数变更/章节切换时）
  useEffect(() => {
    if (!novelId || !chapter?.id) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const ctx = await buildFreshChapterGenerationContext({
          novelId,
          volumeId: chapter.volumeId,
          chapterId: chapter.id,
          styleId: selectedStyleId || undefined,
          outputId: selectedOutputId || undefined,
          targetWordCount: wordCountDraft || undefined,
        });
        if (!cancelled) {
          setContextSummary(ctx);
          setPromptDebug(null);
        }
      } catch { /* ignore */ }
    };
    refresh();
    return () => { cancelled = true; };
  }, [novelId, chapter?.id, chapter?.volumeId, chapter?.targetWordCount, selectedStyleId, selectedOutputId, wordCountDraft, contextVersion]);

  const settings = aiSettingsService.getSettings();

  // v1.0.25 手动查看上下文摘要
  const handlePreviewContext = useCallback(async () => {
    if (!novelId || !chapter) return;
    try {
      const ctx = await buildFreshChapterGenerationContext({
        novelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        styleId: selectedStyleId || undefined,
        outputId: selectedOutputId || undefined,
        targetWordCount: wordCountDraft || undefined,
      });
      const request = await buildGenerateRequest(ctx);
      setContextSummary(ctx);
      setPromptDebug(request.promptDebug ?? null);
      setShowContext(true);
    } catch { /* ignore */ }
  }, [novelId, chapter, selectedStyleId, selectedOutputId, wordCountDraft]);

  const handleGenerate = async () => {
    if (!novelId || !chapter) return;

    let preflightContext: ChapterGenerationContext;
    try {
      preflightContext = await buildFreshChapterGenerationContext({
        novelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        userInstruction: userInstruction.trim() || undefined,
        styleId: selectedStyleId || undefined,
        outputId: selectedOutputId || undefined,
        targetWordCount: wordCountDraft || undefined,
      });
      setContextSummary(preflightContext);
      setPromptDebug(null);
    } catch (e: any) {
      setErrorMsg(e?.message || '生成前读取最新上下文失败');
      return;
    }

    const chapterCharacterCount = preflightContext.chapterCharacterList?.length || 0;
    const requiredCharacterCount = preflightContext.requiredCharacters?.length || 0;
    if (chapterCharacterCount > 0 && requiredCharacterCount === 0) {
      setStatusMsg('已将本章出场角色默认视为必须出场角色。');
    }

    // v1.0.25 缺少章节大纲时给出警告
    if (!preflightContext.chapterOutline?.trim()) {
      const ok = confirm(
        '⚠️ 当前章节大纲为空，建议先生成或填写章节大纲。\n\n' +
        '本次生成将降级使用分卷大纲、总纲和本章目标，但生成内容仍可能偏离规划。\n\n' +
        '建议先在大纲面板中生成或填写章节大纲。\n\n' +
        '是否仍然继续生成？'
      );
      if (!ok) return;
    }

    setGenerating(true);
    setErrorMsg('');

    try {
      await runWithLoading(
        {
          title: genMode === 'rewrite' ? 'AI 正在重新生成正文' : 'AI 正在生成正文',
          initialMessage: '正在构建上下文……',
          successMessage: `✅ 生成成功！已保存为草稿`,
          errorMessage: 'AI 生成失败',
          cancelable: false,
        },
        async ({ setMessage, setStage, setPercent }) => {
          // 点击生成前已经强制构建 fresh context；这里沿用同一份上下文进入最终 prompt。
          const ctx: ChapterGenerationContext = preflightContext;

          const hasOutline = ctx?.chapterOutline ? '有' : '无';
          const hasChapterGoal = ctx?.chapterGoal ? '有' : '无';
          const charCount = ctx?.chapterCharacterList?.length || 0;
          const eventCount = ctx?.chapterEvents ? (ctx.chapterEvents.match(/\n- /g)?.length || 1) : 0;
          const hasPrevContext = ctx?.previousContext ? '有' : '无';
          const styleName = availableStyles.find((s) => s.id === selectedStyleId)?.name || '默认';
          const outputName = availableOutputs.find((o) => o.id === selectedOutputId)?.name || '默认';

          const inputSummary = [
            `生成：${novelId.slice(0,8)}/${ctx.chapterTitle}`,
            `大纲：${hasOutline}`,
            `目标：${hasChapterGoal}`,
            `角色：${charCount}个`,
            `必须出场：${ctx.requiredCharacters?.length || 0}个`,
            `事件：${eventCount}个`,
            `前文：${hasPrevContext}`,
            `风格：${styleName}`,
            `输出：${outputName}`,
            `字数：${ctx.targetWordCount || wordCountDraft}`,
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

          setStage('正在组装提示词……');
          setPercent(15);

          // 2. 组装提示词
          setStage('正在分析角色、事件和风格方案……');
          setPercent(25);
          const request = await buildGenerateRequest(ctx);
          setPromptDebug(request.promptDebug ?? null);

          // 3. 调用 AI
          setStage('正在请求 AI 生成正文……');
          setMessage('AI 正在输出章节内容，请稍候……');
          setPercent(40);
          const client = createAiClient(settings);
          const response = await client.generate(request);

          setPercent(80);
          setStage('正在整理生成结果……');
          setMessage('正在保存生成结果……');

          // 4. 保存为草稿
          const draft = await draftVersionService.create({
            novelId,
            chapterId: chapter.id,
            content: response.text,
            source: genMode === 'rewrite' ? 'ai_regenerated' : 'ai_generated',
            aiTaskId: task?.id,
          });

          setPercent(90);
          setStage('正在校验生成结果……');

          const validationMessages: string[] = [];
          const uniqueRequiredNames = [...new Set(getRequiredCharacterNames(ctx))];
          if (uniqueRequiredNames.length > 0) {
            const missingNames = uniqueRequiredNames.filter((name) => !response.text.includes(name));
            if (missingNames.length === uniqueRequiredNames.length) {
              validationMessages.push(`⚠️ 生成正文缺少必须出场角色：${uniqueRequiredNames.join('、')}。可选择：重新生成 / 自动补写缺失角色 / 保留草稿但不建议采纳。`);
            } else if (missingNames.length > 0) {
              validationMessages.push(`⚠️ 生成正文缺少部分必须出场角色：${missingNames.join('、')}。可选择：重新生成 / 自动补写缺失角色 / 保留草稿但不建议采纳。`);
            }
          }
          const outlineWarning = buildOutlineWarning(ctx.chapterOutline, response.text);
          if (outlineWarning) validationMessages.push(outlineWarning);
          const validationWarning = validationMessages.join('\n') || undefined;

          setPercent(95);

          // 5. 更新 AI 任务记录
          if (task) {
            await aiTaskService.markSucceeded(task.id, {
              resultText: `字数：${draft.wordCount}，首段：${response.text.slice(0, 200)}${validationWarning ? ' ' + validationWarning : ''}`,
              promptSnapshot: `template=${request.promptTemplateSource || 'unknown'} length=${request.promptDebug?.promptLength || request.messages[0]?.content?.length || 0} chapterOutline=${request.promptDebug?.includesChapterOutlineText ? 'yes' : 'no'} volumeOutline=${request.promptDebug?.includesVolumeOutlineText ? 'yes' : 'no'} masterOutline=${request.promptDebug?.includesMasterOutlineText ? 'yes' : 'no'} requiredCharacters=${request.promptDebug?.requiredCharactersCount || 0}:${request.promptDebug?.requiredCharacterNames.join('、') || ''}`,
              tokenInput: response.tokenInput,
              tokenOutput: response.tokenOutput,
              tokenTotal: response.tokenTotal,
            });
          }

          setPercent(100);
          setStage('生成完成');

          // v1.0.43: 增强调试日志（确认大纲和角色已进入 prompt）
          console.info('[AiGenerate] 生成完成:', {
            chapterId: chapter.id,
            novelId,
            styleProfileId: selectedStyleId || '(未选择)',
            outputControlId: selectedOutputId || '(未选择)',
            hasOutline: !!ctx.chapterOutline,
            outlineLength: ctx.chapterOutline?.length || 0,
            hasVolumeOutline: !!ctx.volumeOutline,
            hasMasterOutline: !!(ctx.masterOutline || ctx.novelOutline),
            chapterGoal: ctx.chapterGoal ? '有' : '无',
            targetWordCount: ctx.targetWordCount,
            chapterCharacters: namesText(getChapterCharacterNames(ctx)),
            requiredCharacters: namesText(uniqueRequiredNames),
            protagonistNames: ctx.protagonistNames,
            wordCount: draft.wordCount,
            model: settings.modelName,
            provider: settings.provider,
            promptTemplateSource: request.promptTemplateSource,
            promptLength: request.promptDebug?.promptLength || request.messages[0]?.content?.length || 0,
          });

          onGenerated?.(draft);

          // 校验警告提示
          if (validationWarning) {
            setErrorMsg(validationWarning);
          }
        },
      );

      setStatusMsg('');
      setGenerating(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '生成失败';
      setErrorMsg(msg);
      setStatusMsg('');
      setGenerating(false);

      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        // 错误已由 runWithLoading 显示弹窗，这里只做本地状态清理
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              value={wordCountDraft || ''}
              onChange={(e) => { setWordCountDraft(Number(e.target.value)); setWordCountSaved(false); }}
              onBlur={() => { if (wordCountDraft <= 0) setWordCountDraft(4000); }}
              min={500}
              max={50000}
              step={100}
              disabled={wordCountSaving}
              style={{
                width: 80,
                padding: '4px 8px',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                fontSize: 13,
                textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>字</span>
            <button
              className="btn btn-sm"
              onClick={handleSaveWordCount}
              disabled={wordCountSaving || wordCountDraft <= 0}
              style={{
                padding: '3px 10px',
                fontSize: 12,
                background: wordCountSaved ? 'var(--color-success)' : 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                whiteSpace: 'nowrap',
              }}
            >
              {wordCountSaving ? '⏳' : wordCountSaved ? '✓ 已保存' : '保存'}
            </button>
          </div>
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

      {/* v1.0.26 风格方案与输出控制选择 */}
      <div className="panel-section">
        <div className="panel-section-title">🎨 风格与输出配置</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          选择本章生成时的写作风格和输出控制方案
        </div>
        <div className="panel-field" style={{ marginBottom: 8 }}>
          <div className="panel-field-label">风格方案</div>
          <select
            className="panel-select"
            value={selectedStyleId}
            onChange={(e) => setSelectedStyleId(e.target.value)}
            style={{ fontSize: 12 }}
          >
            {availableStyles.length === 0 && (
              <option value="">无可用方案</option>
            )}
            {availableStyles.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="panel-field">
          <div className="panel-field-label">输出控制</div>
          <select
            className="panel-select"
            value={selectedOutputId}
            onChange={(e) => setSelectedOutputId(e.target.value)}
            style={{ fontSize: 12 }}
          >
            {availableOutputs.length === 0 && (
              <option value="">无可用方案</option>
            )}
            {availableOutputs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        {selectedStyleId && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            {(() => {
              const s = availableStyles.find((x) => x.id === selectedStyleId);
              if (!s) return null;
              return [
                s.narrativePerspective && `👁️ ${s.narrativePerspective}`,
                s.tone && `🎭 ${s.tone}`,
                s.pace && `⚡ ${s.pace}`,
                `💬${Math.round(s.dialogueRatio * 100)}% 🖊️${Math.round(s.descriptionRatio * 100)}%`
              ].filter(Boolean).join(' · ');
            })()}
          </div>
        )}
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
        {/* v1.0.42 内联摘要：始终显示出场角色和字数 */}
        {contextSummary && (
          <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--color-text-secondary)', marginBottom: 6, padding: '6px 8px', background: 'var(--color-bg-primary)', borderRadius: 4 }}>
            <span>📊 目标字数：{contextSummary.targetWordCount || wordCountDraft} 字</span>
            <span style={{ marginLeft: 12 }}>📝 章节大纲：{contextSummary.chapterOutline ? '有' : '无'}</span>
            <span style={{ marginLeft: 12 }}>👥 出场角色：{(() => {
              const nameList = getChapterCharacterNames(contextSummary);
              return nameList.length > 0 ? `${nameList.length} 个（${nameList.join('、')}）` : '0 个';
            })()}</span>
            <span style={{ marginLeft: 12 }}>⚠️ 必须出场：{(() => {
              const nameList = getRequiredCharacterNames(contextSummary);
              return nameList.length > 0 ? `${nameList.length} 个（${nameList.join('、')}）` : '0 个';
            })()}</span>
          </div>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={handlePreviewContext}
          disabled={generating}
          style={{ width: '100%', marginBottom: 6 }}
        >
          🔍 查看上下文摘要
        </button>
        {contextSummary && !contextSummary.chapterOutline?.trim() && (
          <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 4 }}>
            ⚠️ 当前章节大纲为空，建议先生成或填写章节大纲
          </div>
        )}
        {showContext && contextSummary && (
          <div style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--color-text-secondary)', marginTop: 8, padding: 8, background: 'var(--color-bg-primary)', borderRadius: 4 }}>
            <div>📖 总大纲：{(contextSummary.masterOutline || contextSummary.novelOutline) ? `✅ 有（${(contextSummary.masterOutline || contextSummary.novelOutline)!.length} 字）` : '❌ 无'}</div>
            <div>📋 分卷大纲：{contextSummary.volumeOutline ? `✅ 有（${contextSummary.volumeOutline.length} 字）` : '❌ 无'}</div>
            <div>📝 章节大纲：{contextSummary.chapterOutline ? `✅ 有（${contextSummary.chapterOutline.length} 字）` : '❌ 无'}</div>
            <div>🎯 本章目标：{contextSummary.chapterGoal ? `✅ 有（${contextSummary.chapterGoal.length} 字）` : '❌ 无'}</div>
            <div>👥 出场角色：{(() => {
              const nameList = getChapterCharacterNames(contextSummary);
              return nameList.length > 0 ? `${nameList.length} 个（${nameList.join('、')}）` : '0 个';
            })()}</div>
            <div>⚠️ 必须出场角色：{(() => {
              const nameList = getRequiredCharacterNames(contextSummary);
              return nameList.length > 0 ? `${nameList.length} 个（${nameList.join('、')}）` : '0 个';
            })()}</div>
            <div>⚡ 本章事件：{contextSummary.chapterEvents ? (contextSummary.chapterEvents.match(/\n- /g)?.length || 1) : 0} 个</div>
            <div>🌍 世界设定：{contextSummary.worldBackground ? '✅ 有' : '❌ 无'}</div>
            <div>📦 前文总结：{contextSummary.previousContext ? '✅ 有' : '❌ 无'}</div>
            <div>🎨 风格方案：{contextSummary.styleProfile ? '✅ 有' : '❌ 无（使用默认）'} {availableStyles.find((s) => s.id === selectedStyleId)?.name ? `→ ${availableStyles.find((s) => s.id === selectedStyleId)!.name}` : ''}</div>
            <div>⚙️ 输出控制：{availableOutputs.find((o) => o.id === selectedOutputId)?.name || '默认'}</div>
            <div>📊 目标字数：{contextSummary.targetWordCount || wordCountDraft} 字</div>
            {promptDebug && (
              <>
                <div>🧪 最终 prompt 模板：{promptDebug.templateSource}</div>
                <div>🧪 包含角色块：{promptDebug.hasRequiredCharactersBlock ? '是' : '否'}（{promptDebug.requiredCharactersCount} 个）</div>
                <div>🧪 包含章节大纲：{promptDebug.includesChapterOutlineText ? '是' : '否'}</div>
                <div>🧪 包含分卷大纲：{promptDebug.includesVolumeOutlineText ? '是' : '否'}</div>
                <div>🧪 包含总纲：{promptDebug.includesMasterOutlineText ? '是' : '否'}</div>
                <div>🧪 prompt 长度：{promptDebug.promptLength} 字符</div>
              </>
            )}
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
