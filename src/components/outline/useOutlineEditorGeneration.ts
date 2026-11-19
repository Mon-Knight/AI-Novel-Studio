/**
 * AI Novel Studio - 大纲编辑器 AI 生成流程
 * 原生统一任务生成候选；浏览器开发环境保留显式兼容路径。
 * 生成只产生可编辑候选，不保存、不采用。
 */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { cancelLoadingOperation, runWithLoading } from '../../lib/runWithLoading';
import { loadOutlineContext } from '../../services/outlines/outlineService';
import { aiSettingsService, runAiGenerate } from '../../services/ai/aiClient';
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
import { isTauri } from '../../services/database/db';
import { generateNativeOutline } from '../../services/outlines/outlineRuntimeService';
import type { OutlineGenerationEvidence } from '../../types/outlineGeneration';

interface OutlineEditorGenerationOptions {
  projectId: string;
  outlineType: OutlineType;
  targetId?: string;
  targetTitle?: string;
  targetIndex?: number;
  parentOutlineId?: string;
  typeLabel: string;
  scopeRef: MutableRefObject<string>;
  setContext: Dispatch<SetStateAction<OutlineGenerationContext | null>>;
  setContent: Dispatch<SetStateAction<string>>;
  setCandidateSource: Dispatch<SetStateAction<OutlineGenerationEvidence | null>>;
  setIsDirty: Dispatch<SetStateAction<boolean>>;
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

export function useOutlineEditorGeneration({
  projectId,
  outlineType,
  targetId,
  targetTitle,
  targetIndex,
  parentOutlineId,
  typeLabel,
  scopeRef,
  setContext,
  setContent,
  setCandidateSource,
  setIsDirty,
}: OutlineEditorGenerationOptions) {
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
          if (isTauri()) {
            const requestedScope = scopeRef.current;
            setStage('正在通过统一原生任务读取并生成候选……');
            const preview = await loadOutlineContext(projectId);
            if (scopeRef.current !== requestedScope) return;
            setContext(preview);
            const generated = await generateNativeOutline(
              projectId,
              {
                kind: 'outline_generate',
                outlineType,
                format: 'editor_text',
                targetId,
                targetTitle,
                targetIndex,
                parentOutlineId,
              },
              { signal, cancel: () => cancelLoadingOperation(operationId) },
            );
            if (scopeRef.current !== requestedScope) return;
            if (generated.format !== 'editor_text')
              throw new Error('OUTLINE_CANDIDATE_FORMAT_MISMATCH');
            setContent(generated.value);
            setCandidateSource(generated.source);
            setIsDirty(true);
            setStage('候选已生成，尚未保存或采用');
            setMessage('请审阅并编辑候选；保存与采用分别执行原生复验。');
            return;
          }
          // Explicit browser-development compatibility only; no desktop fallback.
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
            setStage(`${warnings.join('、')}，将生成简化版`);
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
            response = await runAiGenerate(
              request,
              {
                signal,
                cancel: () => cancelLoadingOperation(operationId),
              },
              settings,
            );
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

  return { handleAiGenerate };
}
