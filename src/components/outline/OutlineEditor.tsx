/**
 * AI Novel Studio - 大纲编辑器组件
 * 支持：手动编辑、AI 生成、保存、版本管理、设置为采用版本
 */
import { useState, useEffect, useCallback } from 'react';
import { cancelLoadingOperation, runWithLoading } from '../../lib/runWithLoading';
import {
  masterOutlineService,
  volumeOutlineService,
  chapterOutlineService,
  loadOutlineContext,
} from '../../services/outlines/outlineService';
import { createAiClient, aiSettingsService } from '../../services/ai/aiClient';
import { aiTaskService } from '../../services/ai/aiTaskService';
import {
  buildOutlineGeneratePrompt,
  buildVolumeOutlineGeneratePrompt,
  buildChapterOutlineGeneratePrompt,
} from '../../services/ai/promptBuilder';
import type { OutlineGenerationContext, OutlineType } from '../../types/outline';
import type {
  OutlineGeneratePromptContext,
  VolumeOutlineGeneratePromptContext,
  ChapterOutlineGeneratePromptContext,
} from '../../services/ai/promptBuilder';
import type { AiGenerateResponse } from '../../types/ai';
import { throwIfAiRequestCancelled } from '../../services/ai/aiCancellation';
import { settleAiTaskError } from '../../services/ai/aiTaskCancellation';
import { reportAndPresentError } from '../../utils/reportAndPresentError';
import { OutlineEditorView } from './OutlineEditorView';

interface OutlineEditorProps {
  projectId: string;
  outlineType: OutlineType;
  targetId?: string; // volumeId or chapterId
  targetTitle?: string; // display title
  targetIndex?: number; // order index
  parentOutlineId?: string; // for chapter -> volume outline, for volume -> master outline
  onSaved?: () => void;
}

/** 构建章节大纲 AI 生成 Prompt 上下文 */
function buildChapterPromptContext(
  base: OutlineGenerationContext,
  chapterTitle?: string,
): ChapterOutlineGeneratePromptContext {
  return {
    novelTitle: base.novelTitle,
    novelGenre: base.novelGenre,
    worldBackground: base.worldBackground,
    protagonist:
      [base.protagonistName, base.protagonistIdentity].filter(Boolean).join('；') || undefined,
    specialAbility: base.protagonistAbility,
    existingChapters: base.existingChapters,
    volumeTitle: chapterTitle,
    chapterCount: 6,
    activeMasterOutline: base.activeMasterOutline,
    activeVolumeOutline: base.activeVolumeOutline,
    styleSummary: base.styleSummary,
  };
}

function OutlineEditor({
  projectId,
  outlineType,
  targetId,
  targetTitle,
  targetIndex,
  parentOutlineId,
  onSaved,
}: OutlineEditorProps) {
  const [content, setContent] = useState('');
  const [title, setTitle] = useState(targetTitle || '');
  const [isDirty, setIsDirty] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<number>(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ id: string; version: number; isActive: boolean }[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<OutlineGenerationContext | null>(null);
  const [showContext, setShowContext] = useState(false);

  const typeLabel =
    outlineType === 'master' ? '总纲' : outlineType === 'volume' ? '分卷大纲' : '章节大纲';

  // 加载当前大纲
  const load = useCallback(async () => {
    setLoading(true);
    try {
      let result;
      if (outlineType === 'master') {
        result = await masterOutlineService.getActive(projectId);
      } else if (outlineType === 'volume') {
        result = await volumeOutlineService.getActive(projectId, targetId);
      } else {
        result = await chapterOutlineService.getActive(projectId, targetId);
      }
      if (result) {
        setContent(result.content);
        setTitle(result.title);
        setCurrentVersion(result.version);
        setCurrentId(result.id);
      } else {
        setContent('');
        setCurrentVersion(0);
        setCurrentId(null);
      }
      // 加载版本列表
      let versionList;
      if (outlineType === 'master') {
        versionList = await masterOutlineService.getVersions(projectId);
      } else if (outlineType === 'volume') {
        versionList = await volumeOutlineService.getVersions(projectId, targetId);
      } else {
        versionList = await chapterOutlineService.getVersions(projectId, targetId);
      }
      setVersions(versionList.map((v) => ({ id: v.id, version: v.version, isActive: v.isActive })));
    } catch (error) {
      await reportAndPresentError({
        event: 'OUTLINE_EDITOR_LOAD_FAILED',
        error,
        fallbackMessage: '大纲及版本记录加载失败，请重试。',
        title: '大纲加载失败',
        testId: 'outline-load-error',
        context: { projectId, outlineType, targetId },
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, outlineType, targetId]);

  useEffect(() => {
    load();
  }, [load]);

  // AI 生成大纲
  const handleAiGenerate = async () => {
    try {
      await runWithLoading(
        {
          title: `AI 正在生成${typeLabel}`,
          initialMessage:
            outlineType === 'volume'
              ? '正在读取当前采用总纲……'
              : outlineType === 'chapter'
                ? '正在读取当前采用分卷大纲和总纲……'
                : '正在读取作品设定、主角背景和世界设定……',
          successMessage: `${typeLabel}生成完成，请检查并保存`,
          errorMessage: `${typeLabel}生成失败`,
          cancelable: true,
        },
        async ({ setMessage, setStage, signal, operationId }) => {
          setStage('正在构建完整上下文……');
          setMessage('正在读取世界背景、主角设定、已有大纲……');
          const ctx = await loadOutlineContext(projectId);
          setContext(ctx);

          // 显示缺失信息提示
          const warnings: string[] = [];
          if (!ctx.protagonistName) warnings.push('缺少主角设定');
          if (!ctx.worldBackground) warnings.push('缺少世界背景');
          if (outlineType === 'volume' && !ctx.activeMasterOutline)
            warnings.push('缺少总纲（建议先生成总纲）');
          if (outlineType === 'chapter') {
            if (!ctx.activeMasterOutline) warnings.push('缺少总纲');
            if (!ctx.activeVolumeOutline) warnings.push('缺少分卷大纲（建议先生成分卷大纲）');
          }
          if (warnings.length > 0) {
            setStage(`⚠️ ${warnings.join('、')}，将生成简化版`);
          }

          setStage('正在调用 AI 生成……');
          setMessage('AI 正在组织内容结构，请稍候……');

          const settings = aiSettingsService.getSettings();

          let request;
          if (outlineType === 'master') {
            const promptCtx: OutlineGeneratePromptContext = {
              novelTitle: ctx.novelTitle,
              novelGenre: ctx.novelGenre,
              description: ctx.description || undefined,
              worldBackground: ctx.worldBackground,
              ruleSystems: ctx.ruleSystems || undefined,
              protagonist:
                [ctx.protagonistName, ctx.protagonistIdentity].filter(Boolean).join('；') ||
                undefined,
              specialAbility: ctx.protagonistAbility,
              existingVolumes: ctx.existingVolumes || undefined,
              existingChapters: ctx.existingChapters || undefined,
            };
            request = buildOutlineGeneratePrompt(promptCtx);
          } else if (outlineType === 'volume') {
            const promptCtx: VolumeOutlineGeneratePromptContext = {
              novelTitle: ctx.novelTitle,
              novelGenre: ctx.novelGenre,
              worldBackground: ctx.worldBackground,
              protagonist:
                [ctx.protagonistName, ctx.protagonistIdentity].filter(Boolean).join('；') ||
                undefined,
              specialAbility: ctx.protagonistAbility,
              existingVolumes: ctx.existingVolumes || undefined,
              volumeTitle: targetTitle,
              activeMasterOutline: ctx.activeMasterOutline,
              styleSummary: ctx.styleSummary,
            };
            request = buildVolumeOutlineGeneratePrompt(promptCtx);
          } else {
            const promptCtx = buildChapterPromptContext(ctx, targetTitle);
            request = buildChapterOutlineGeneratePrompt(promptCtx);
          }

          const task = await aiTaskService
            .create(
              outlineType === 'master'
                ? 'outline_generate'
                : outlineType === 'volume'
                  ? 'volume_outline_generate'
                  : 'chapter_outline_generate',
              {
                novelId: projectId,
                runtimeMode: settings.runtimeMode,
                provider: settings.provider,
                modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
                inputSummary: `生成${typeLabel}：${targetTitle || ctx.novelTitle}`,
              },
            )
            .catch(() => null);
          const releaseCancellation = task
            ? aiTaskService.registerActiveExecution(task.id, () =>
                cancelLoadingOperation(operationId),
              )
            : () => {};

          let response: AiGenerateResponse;
          try {
            const client = createAiClient(settings);
            response = await client.generate(request, {
              signal,
              cancel: () => cancelLoadingOperation(operationId),
            });
            throwIfAiRequestCancelled(signal);

            if (task) {
              await aiTaskService.markSucceeded(task.id, {
                resultText: response.text,
                tokenInput: response.tokenInput,
                tokenOutput: response.tokenOutput,
                tokenTotal: response.tokenTotal,
              });
            }
          } catch (error: unknown) {
            await settleAiTaskError({
              taskId: task?.id,
              error,
              signal,
              fallbackMessage: `${typeLabel}生成失败`,
            });
            throw error;
          } finally {
            releaseCancellation();
          }

          setContent(response.text);
          setIsDirty(true);

          setStage('生成完成');
          setMessage(`AI 已生成${typeLabel}，请检查内容后保存`);
        },
      );
    } catch {
      // 错误已在弹窗显示
    }
  };

  // 保存大纲
  const handleSave = useCallback(
    async (saveAsNew: boolean) => {
      if (!content.trim()) return;
      try {
        await runWithLoading(
          {
            title: `正在保存${typeLabel}`,
            initialMessage: '正在写入数据库……',
            successMessage: `${typeLabel}已保存`,
            errorMessage: '保存失败',
            successAutoCloseMs: 800,
          },
          async () => {
            const contextSnapshot = context ? JSON.stringify(context).slice(0, 10000) : undefined;
            const sourceType = 'manual';

            if (outlineType === 'master') {
              const result = await masterOutlineService.save({
                projectId,
                title: title || '作品总纲',
                content,
                sourceType,
                contextSnapshot,
                saveAsNewVersion: saveAsNew,
              });
              setCurrentId(result.id);
              setCurrentVersion(result.version);
            } else if (outlineType === 'volume') {
              const result = await volumeOutlineService.save({
                projectId,
                masterOutlineId: parentOutlineId,
                volumeId: targetId,
                volumeIndex: targetIndex || 1,
                title: title || targetTitle || '分卷大纲',
                content,
                sourceType,
                contextSnapshot,
                saveAsNewVersion: saveAsNew,
              });
              setCurrentId(result.id);
              setCurrentVersion(result.version);
            } else {
              const result = await chapterOutlineService.save({
                projectId,
                volumeOutlineId: parentOutlineId,
                chapterId: targetId,
                chapterIndex: targetIndex || 1,
                title: title || targetTitle || '章节大纲',
                content,
                sourceType,
                contextSnapshot,
                saveAsNewVersion: saveAsNew,
              });
              setCurrentId(result.id);
              setCurrentVersion(result.version);
            }

            setIsDirty(false);
            await load();
            onSaved?.();
          },
        );
      } catch {
        // 错误已在弹窗显示
      }
    },
    [
      content,
      context,
      load,
      onSaved,
      outlineType,
      parentOutlineId,
      projectId,
      targetId,
      targetIndex,
      targetTitle,
      title,
      typeLabel,
    ],
  );

  // 设为采用版本
  const handleSetActive = async () => {
    if (!currentId) return;
    try {
      if (outlineType === 'master') {
        await masterOutlineService.setActive(currentId, projectId);
      } else if (outlineType === 'volume') {
        await volumeOutlineService.setActive(currentId, projectId);
      } else {
        await chapterOutlineService.setActive(currentId, projectId);
      }
      await load();
    } catch (error) {
      await reportAndPresentError({
        event: 'OUTLINE_SET_ACTIVE_FAILED',
        error,
        fallbackMessage: '采用大纲版本失败，请重试。',
        title: '采用版本失败',
        testId: 'outline-active-error',
        context: { projectId, outlineType, targetId, outlineId: currentId },
      });
    }
  };

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty) handleSave(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, handleSave]);

  return (
    <OutlineEditorView
      loading={loading}
      typeLabel={typeLabel}
      title={title}
      content={content}
      isDirty={isDirty}
      currentId={currentId}
      currentVersion={currentVersion}
      versions={versions}
      context={context}
      showContext={showContext}
      onAiGenerate={handleAiGenerate}
      onSave={handleSave}
      onSetActive={handleSetActive}
      onToggleContext={() => setShowContext((visible) => !visible)}
      onTitleChange={(nextTitle) => {
        setTitle(nextTitle);
        setIsDirty(true);
      }}
      onContentChange={(nextContent) => {
        setContent(nextContent);
        setIsDirty(true);
      }}
    />
  );
}

export default OutlineEditor;
