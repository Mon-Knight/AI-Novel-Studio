import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type {
  EditorCommandRequest,
  EditorCommandType,
} from '../../components/workspace/EditorArea';
import {
  DocumentApplyIdempotencyGuard,
  validateDocumentApplication,
  validateDraftDocumentTarget,
} from './documentSafety';
import type { ChapterDraft } from '../../types/ai';
import type {
  AiTextApplyPayload,
  AiTextApplyRequest,
  DraftResultMetadata,
  EditorContentSnapshot,
} from '../../types/workspaceSafety';
import { hashTextContent } from '../../utils/contentHash';
import { confirmInfo, showError, showInfo } from '../../utils/nativeDialog';
import { CHAPTER_DOCUMENT_LOAD_ERROR } from './workspaceDocumentMessages';

interface WorkspaceTargetRefs {
  activeNovelId: MutableRefObject<string>;
  activeChapterId: MutableRefObject<string>;
  currentDraft: MutableRefObject<ChapterDraft | null>;
  editorSnapshot: MutableRefObject<EditorContentSnapshot>;
  documentBlocked: MutableRefObject<boolean>;
}

interface UseWorkspaceDraftApplicationInput {
  refs: WorkspaceTargetRefs;
  setCurrentDraft(value: ChapterDraft | null): void;
  setDraftWordCount(value: number): void;
  setDirty(value: boolean): void;
  setEditorSnapshot(value: EditorContentSnapshot): void;
  clearRecovery(target: { novelId: string; chapterId: string }): Promise<void>;
}

export function useWorkspaceDraftApplication({
  refs,
  setCurrentDraft,
  setDraftWordCount,
  setDirty,
  setEditorSnapshot,
  clearRecovery,
}: UseWorkspaceDraftApplicationInput) {
  const [applyTextRequest, setApplyTextRequest] = useState<AiTextApplyRequest | null>(null);
  const [editorCommandRequest, setEditorCommandRequest] = useState<EditorCommandRequest | null>(
    null,
  );
  const applyGuardRef = useRef(new DocumentApplyIdempotencyGuard());
  const pendingApplyKeysRef = useRef(new Map<string, AiTextApplyPayload>());

  const handleDraftApplied = useCallback(
    (draft: ChapterDraft, metadata?: DraftResultMetadata) => {
      if (refs.documentBlocked.current) {
        void showError({
          title: '完整正文尚未载入',
          message: CHAPTER_DOCUMENT_LOAD_ERROR,
          testId: 'error-notice',
        });
        return false;
      }
      const liveTarget = {
        novelId: refs.activeNovelId.current,
        chapterId: refs.activeChapterId.current,
      };
      const draftDecision = validateDraftDocumentTarget(draft, liveTarget);
      if (!draftDecision.ok) {
        if (metadata) {
          void showInfo({
            title: 'AI 候选已保存到原章节',
            message: `${draftDecision.message}\n当前编辑器未被切换。`,
          });
        }
        return false;
      }
      if (draft.contentState?.status === 'unavailable') {
        void showInfo({
          title: '完整正文不可用',
          message: '该草稿只能读取预览，已阻止载入编辑器。请在草稿历史中重试读取。',
        });
        return false;
      }
      if (metadata) {
        if (metadata.resultId !== draft.id) {
          void showInfo({
            title: 'AI 候选已保存',
            message: '结果标识与草稿不一致，当前编辑器未被切换。',
          });
          return false;
        }
        if (
          refs.editorSnapshot.current.isDirty &&
          hashTextContent(draft.content) !== refs.editorSnapshot.current.contentHash
        ) {
          void showInfo({
            title: 'AI 候选已保存',
            message: '当前正文存在未保存修改，候选结果仍可在草稿历史中查看，编辑器内容未被覆盖。',
          });
          return false;
        }
        const applicationDecision = validateDocumentApplication(
          {
            resultId: metadata.resultId,
            target: { novelId: metadata.novelId, chapterId: metadata.chapterId },
            baseContentHash: metadata.baseContentHash,
            mode: 'replace_all',
          },
          { ...liveTarget, contentHash: refs.editorSnapshot.current.contentHash },
        );
        if (!applicationDecision.ok) {
          void showInfo({
            title: 'AI 候选已保存',
            message: `${applicationDecision.message}\n结果仍可在原章节草稿历史中查看，当前正文未被覆盖。`,
          });
          return false;
        }
        const liveDraft = refs.currentDraft.current;
        if (metadata.sourceDraftId && liveDraft?.id !== metadata.sourceDraftId) {
          void showInfo({
            title: 'AI 候选已保存',
            message: '基础草稿已切换，结果仍可在原章节草稿历史中查看，当前正文未被覆盖。',
          });
          return false;
        }
        if (
          metadata.sourceRevision !== undefined &&
          liveDraft?.versionNo !== metadata.sourceRevision
        ) {
          void showInfo({
            title: 'AI 候选已保存',
            message: '基础草稿版本已变化，结果仍可在原章节草稿历史中查看，当前正文未被覆盖。',
          });
          return false;
        }
      }

      setCurrentDraft(draft);
      refs.currentDraft.current = draft;
      setDraftWordCount(draft.wordCount);
      setDirty(false);
      const nextSnapshot: EditorContentSnapshot = {
        chapterId: draft.chapterId,
        draftId: draft.id,
        draftVersion: draft.versionNo,
        content: draft.content,
        wordCount: draft.wordCount,
        isDirty: false,
        contentHash: hashTextContent(draft.content),
        contentAvailable: true,
        persistedContentHash:
          draft.contentState?.status === 'ready' ? draft.contentState.contentHash : undefined,
        contentState: draft.contentState,
      };
      refs.editorSnapshot.current = nextSnapshot;
      setEditorSnapshot(nextSnapshot);
      return true;
    },
    [refs, setCurrentDraft, setDirty, setDraftWordCount, setEditorSnapshot],
  );

  const handlePersistentDraftSaved = useCallback(
    async (draft: ChapterDraft) => {
      if (!handleDraftApplied(draft)) return;
      await clearRecovery({ novelId: draft.novelId, chapterId: draft.chapterId });
    },
    [clearRecovery, handleDraftApplied],
  );

  const applyAiTextToEditor = useCallback(
    async (payload: AiTextApplyPayload) => {
      if (refs.documentBlocked.current) {
        await showError({
          title: '无法应用 AI 输出',
          message: CHAPTER_DOCUMENT_LOAD_ERROR,
          testId: 'error-notice',
        });
        return false;
      }
      const text = payload.text.trim();
      if (!text) return false;
      if (
        !refs.editorSnapshot.current.contentAvailable ||
        refs.currentDraft.current?.contentState?.status === 'unavailable'
      ) {
        await showError({
          title: '无法应用 AI 输出',
          message: '完整正文暂时无法读取，已阻止覆盖。',
        });
        return false;
      }
      const liveTarget = {
        novelId: refs.activeNovelId.current,
        chapterId: refs.activeChapterId.current,
        contentHash: refs.editorSnapshot.current.contentHash,
      };
      const identity = {
        resultId: payload.resultId,
        target: { novelId: payload.novelId, chapterId: payload.chapterId },
        baseContentHash: payload.baseContentHash,
        mode: payload.mode,
      } as const;
      const decision = validateDocumentApplication(identity, liveTarget);
      if (!decision.ok) {
        await showError({
          title: '无法应用 AI 输出',
          message: decision.message,
          testId: 'error-notice',
        });
        return false;
      }
      const liveDraft = refs.currentDraft.current;
      if (payload.sourceDraftId && liveDraft?.id !== payload.sourceDraftId) {
        await showError({
          title: '无法应用 AI 输出',
          message: '基础草稿已切换，请重新生成结果。',
          testId: 'error-notice',
        });
        return false;
      }
      if (payload.sourceRevision !== undefined && liveDraft?.versionNo !== payload.sourceRevision) {
        await showError({
          title: '无法应用 AI 输出',
          message: '基础草稿版本已变化，请重新生成结果。',
          testId: 'error-notice',
        });
        return false;
      }
      if (payload.mode === 'replace_all') {
        const ok = await confirmInfo({
          title: '应用 AI 输出',
          message: `${refs.editorSnapshot.current.isDirty ? '当前正文存在未保存修改。\n\n' : ''}将用 AI 输出替换当前正文，是否继续？`,
          testId: 'apply-confirm',
        });
        if (!ok) return false;
      }
      const claim = applyGuardRef.current.claim(identity);
      if (!claim.accepted) {
        await showInfo({
          title: '结果已应用',
          message: '同一 AI 结果已经应用到这个正文版本，已阻止重复操作。',
        });
        return false;
      }
      const request: AiTextApplyRequest = {
        ...payload,
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text,
      };
      pendingApplyKeysRef.current.set(request.id, payload);
      setApplyTextRequest(request);
      return true;
    },
    [refs],
  );

  const handleApplyTextConsumed = useCallback((request: AiTextApplyRequest) => {
    pendingApplyKeysRef.current.delete(request.id);
  }, []);

  const handleApplyTextRejected = useCallback((request: AiTextApplyRequest, reason: string) => {
    const payload = pendingApplyKeysRef.current.get(request.id);
    if (payload) {
      applyGuardRef.current.release({
        resultId: payload.resultId,
        target: { novelId: payload.novelId, chapterId: payload.chapterId },
        baseContentHash: payload.baseContentHash,
        mode: payload.mode,
      });
    }
    pendingApplyKeysRef.current.delete(request.id);
    void showError({ title: 'AI 输出未应用', message: reason, testId: 'error-notice' });
  }, []);

  const runEditorCommand = useCallback(
    (type: EditorCommandType) => {
      if (refs.documentBlocked.current) return;
      setEditorCommandRequest({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type,
      });
    },
    [refs],
  );

  return {
    applyTextRequest,
    editorCommandRequest,
    handleDraftApplied,
    handlePersistentDraftSaved,
    applyAiTextToEditor,
    handleApplyTextConsumed,
    handleApplyTextRejected,
    runEditorCommand,
  };
}
