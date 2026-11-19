/**
 * AI Novel Studio - 大纲编辑器组件
 * 支持：手动编辑、AI 生成、保存、版本管理、设置为采用版本
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { runWithLoading } from '../../lib/runWithLoading';
import {
  masterOutlineService,
  volumeOutlineService,
  chapterOutlineService,
} from '../../services/outlines/outlineService';
import type { MasterOutline, OutlineGenerationContext, OutlineType } from '../../types/outline';
import { reportAndPresentError } from '../../utils/reportAndPresentError';
import { OutlineEditorView } from './OutlineEditorView';
import { useOutlineEditorGeneration } from './useOutlineEditorGeneration';
import { isTauri } from '../../services/database/db';
import {
  applyNativeOutlineCandidate,
  outlineSourceFromSnapshot,
} from '../../services/outlines/outlineCandidateApplicationService';
import type { OutlineGenerationEvidence } from '../../types/outlineGeneration';
import { computeContentSha256 } from '../../utils/contentIntegrity';

interface OutlineEditorProps {
  projectId: string;
  outlineType: OutlineType;
  targetId?: string; // volumeId or chapterId
  targetTitle?: string; // display title
  targetIndex?: number; // order index
  parentOutlineId?: string; // for chapter -> volume outline, for volume -> master outline
  onSaved?: () => void;
}

type OutlineVersion = Pick<
  MasterOutline,
  'id' | 'version' | 'isActive' | 'title' | 'content' | 'contextSnapshot' | 'sourceType'
>;

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
  const [versions, setVersions] = useState<OutlineVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<OutlineGenerationContext | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [candidateSource, setCandidateSource] = useState<OutlineGenerationEvidence | null>(null);
  const scopeKey = JSON.stringify([projectId, outlineType, targetId]);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const liveContent = useRef(content);
  liveContent.current = content;
  const liveTitle = useRef(title);
  liveTitle.current = title;

  const typeLabel =
    outlineType === 'master' ? '总纲' : outlineType === 'volume' ? '分卷大纲' : '章节大纲';

  const { handleAiGenerate } = useOutlineEditorGeneration({
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
  });

  // 加载当前大纲
  const load = useCallback(
    async (preferred?: OutlineVersion) => {
      const requestedScope = JSON.stringify([projectId, outlineType, targetId]);
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
        // 加载版本列表
        let versionList;
        if (outlineType === 'master') {
          versionList = await masterOutlineService.getVersions(projectId);
        } else if (outlineType === 'volume') {
          versionList = await volumeOutlineService.getVersions(projectId, targetId);
        } else {
          versionList = await chapterOutlineService.getVersions(projectId, targetId);
        }
        if (scopeRef.current !== requestedScope) return;
        setVersions(versionList);
        setCandidateSource(null);
        const selected =
          versionList.find((version) => version.id === preferred?.id) || preferred || result;
        setContent(selected?.content || '');
        setTitle(selected?.title || '');
        setCurrentVersion(selected?.version || 0);
        setCurrentId(selected?.id || null);
        setIsDirty(false);
      } catch (error) {
        if (scopeRef.current !== requestedScope) return;
        await reportAndPresentError({
          event: 'OUTLINE_EDITOR_LOAD_FAILED',
          error,
          fallbackMessage: '大纲及版本记录加载失败，请重试。',
          title: '大纲加载失败',
          testId: 'outline-load-error',
          context: { projectId, outlineType, targetId },
        });
      } finally {
        if (scopeRef.current === requestedScope) setLoading(false);
      }
    },
    [projectId, outlineType, targetId],
  );

  useEffect(() => {
    load();
  }, [load]);

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
            // The existing save command updates the active version; edits of a historical
            // version must stay separate until the user explicitly adopts them.
            const saveAsNewVersion =
              saveAsNew ||
              Boolean(currentId && !versions.find((v) => v.id === currentId)?.isActive);
            let saved: OutlineVersion;
            const requestedScope = scopeRef.current;
            const savedVersion = versions.find((version) => version.id === currentId);
            const nativeSource = isTauri()
              ? (candidateSource ?? outlineSourceFromSnapshot(savedVersion?.contextSnapshot))
              : null;
            if (nativeSource) {
              if (
                nativeSource.novelId !== projectId ||
                nativeSource.request.outlineType !== outlineType ||
                nativeSource.request.targetId !== targetId
              )
                throw new Error('OUTLINE_SOURCE_SCOPE_MISMATCH: 当前编辑范围已变化，正文已保留。');
              const result = await applyNativeOutlineCandidate(nativeSource, {
                kind: 'outline_version',
                outlineType,
                targetId,
                parentOutlineId,
                targetIndex,
                title: title || targetTitle || typeLabel,
                content,
                saveAsNewVersion,
              });
              if (!result.outline)
                throw new Error(
                  'OUTLINE_APPLICATION_RECEIPT_INVALID: 原生保存已返回回执，但缺少版本，请读取权威事实。',
                );
              saved = result.outline;
            } else if (outlineType === 'master') {
              const result = await masterOutlineService.save({
                projectId,
                title: title || '作品总纲',
                content,
                sourceType,
                contextSnapshot,
                saveAsNewVersion,
              });
              saved = result;
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
                saveAsNewVersion,
              });
              saved = result;
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
                saveAsNewVersion,
              });
              saved = result;
            }

            if (scopeRef.current !== requestedScope) return;
            setCurrentId(saved.id);
            setCurrentVersion(saved.version);
            setVersions((previous) => [saved, ...previous.filter((v) => v.id !== saved.id)]);
            if (liveContent.current === content && liveTitle.current === title) {
              setContent(saved.content);
              setTitle(saved.title);
              setCandidateSource(null);
              setIsDirty(false);
              await load(saved);
            }
            onSaved?.();
          },
        );
      } catch {
        // 错误已在弹窗显示
      }
    },
    [
      content,
      candidateSource,
      context,
      currentId,
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
      versions,
    ],
  );

  // 设为采用版本
  const handleSetActive = async () => {
    if (!currentId || isDirty) return;
    try {
      const selected = versions.find((version) => version.id === currentId);
      const source = isTauri() ? outlineSourceFromSnapshot(selected?.contextSnapshot) : null;
      if (source && selected) {
        if (
          source.novelId !== projectId ||
          source.request.outlineType !== outlineType ||
          source.request.targetId !== targetId
        )
          throw new Error('OUTLINE_SOURCE_SCOPE_MISMATCH');
        const current = versions.find((version) => version.isActive);
        await applyNativeOutlineCandidate(source, {
          kind: 'adopt_outline_version',
          outlineType,
          targetId,
          outlineId: selected.id,
          expectedVersion: selected.version,
          expectedContentHash: await computeContentSha256(selected.content),
          expectedActive: current
            ? {
                id: current.id,
                version: current.version,
                contentHash: await computeContentSha256(current.content),
              }
            : null,
        });
      } else if (outlineType === 'master') {
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
      onSelectVersion={(id) => {
        const selected = versions.find((version) => version.id === id);
        if (!selected || isDirty) return;
        setContent(selected.content);
        setTitle(selected.title);
        setCurrentId(selected.id);
        setCurrentVersion(selected.version);
      }}
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
