import { forwardRef, useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import { draftVersionService } from '../../services/database/draftVersionService';
import { chapterRepository } from '../../services/database/chapterRepository';
import { ChapterStatusLabels } from '../../types/chapter';
import { formatDateTime } from '../../utils/date';
import { formatNumber } from '../../utils/format';
import { runWithLoading } from '../../lib/runWithLoading';
import { countTextWords, hashTextContent } from '../../utils/contentHash';
import { confirmInfo } from '../../utils/nativeDialog';
import type { AiTextApplyRequest } from '../../types/workspaceSafety';
import type { DraftContentState } from '../../types/draftContentState';
import ContentUnavailableState from './ContentUnavailableState';
import { logWorkspaceWarning } from '../../services/workspace/workspaceErrorService';
import { getAppErrorUserMessage, normalizeAppError } from '../../types/appError';

export type { AiTextApplyMode, AiTextApplyPayload, AiTextApplyRequest } from '../../types/workspaceSafety';

export interface EditorContentSnapshot {
  chapterId?: string;
  draftId?: string;
  draftVersion?: number;
  content: string;
  wordCount: number;
  isDirty: boolean;
  contentHash: string;
  contentAvailable: boolean;
  persistedContentHash?: string;
  contentState?: DraftContentState;
  /** v1.0.45: 选中文本起止位置 */
  selectionStart?: number;
  selectionEnd?: number;
}

export type EditorDocumentState = 'ready' | 'loading' | 'error';

export type EditorDraftContentResolution =
  | { action: 'preserve'; reason?: string }
  | { action: 'replace'; content: string; draft?: ChapterDraft | null };

/**
 * Keeps the last known complete editor value until the target draft has been
 * fully hydrated and its ownership has been verified.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveEditorDraftContent(input: {
  documentState: EditorDocumentState;
  novelId?: string;
  chapterId?: string;
  draft?: ChapterDraft | null;
}): EditorDraftContentResolution {
  if (input.documentState !== 'ready') return { action: 'preserve' };

  if (!input.draft) return { action: 'replace', content: '', draft: null };
  if (!input.novelId || !input.chapterId
    || input.draft.novelId !== input.novelId
    || input.draft.chapterId !== input.chapterId) {
    return { action: 'preserve', reason: '草稿与当前章节不一致，已阻止载入' };
  }

  return { action: 'replace', content: input.draft.content, draft: input.draft };
}

/**
 * The persistence service has already verified whether an update kept its ID
 * or atomically forked because adoption won the race. At the editor boundary
 * only live document ownership is checked; comparing against the preflight
 * draft ID would reject that valid fork using stale adoption state.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function isDraftSaveResultForDocument(
  draft: ChapterDraft | null | undefined,
  novelId: string,
  chapterId: string,
): draft is ChapterDraft {
  return Boolean(draft && draft.novelId === novelId && draft.chapterId === chapterId);
}

export type EditorCommandType = 'save' | 'format' | 'adopt-current';

export interface EditorCommandRequest {
  id: string;
  type: EditorCommandType;
}

interface EditorAreaProps {
  chapter?: Chapter;
  novelTitle?: string;
  novelId?: string;
  currentDraft?: ChapterDraft | null;
  documentState?: EditorDocumentState;
  contentStateOverride?: DraftContentState;
  onDraftChange?: (wordCount: number, isDirty: boolean) => void;
  onEditorContentChange?: (snapshot: EditorContentSnapshot) => void;
  onDraftSaved?: (draft: ChapterDraft) => void | Promise<void>;
  applyTextRequest?: AiTextApplyRequest | null;
  onApplyTextConsumed?: (request: AiTextApplyRequest) => void;
  onApplyTextRejected?: (request: AiTextApplyRequest, reason: string) => void;
  commandRequest?: EditorCommandRequest | null;
  onChapterUpdated?: (chapterId: string) => void;
  /** 定位目标：设置后自动在正文中搜索并高亮指定文本 */
  locateTarget?: { startOffset: number; endOffset: number; quote?: string; paragraphIndex?: number } | null;
  onLocateDone?: (result?: { found: boolean; message?: string }) => void;
  onRetryContent?: () => void;
  retryingContent?: boolean;
  onOpenDraftHistory?: () => void;
  onBackToChapters?: () => void;
}

export interface EditorAreaHandle {
  save: () => Promise<ChapterDraft | null>;
  restoreRecovery: (content: string, selectionStart?: number, selectionEnd?: number) => boolean;
}

const EditorArea = forwardRef<EditorAreaHandle, EditorAreaProps>(function EditorArea({
  chapter,
  novelId,
  currentDraft,
  documentState = 'ready',
  contentStateOverride,
  onDraftChange,
  onEditorContentChange,
  onDraftSaved,
  applyTextRequest,
  onApplyTextConsumed,
  onApplyTextRejected,
  commandRequest,
  onChapterUpdated,
  locateTarget,
  onLocateDone,
  onRetryContent,
  retryingContent,
  onOpenDraftHistory,
  onBackToChapters,
}: EditorAreaProps, ref) {
  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [lastSaved, setLastSaved] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastApplyRequestId = useRef('');
  const lastCommandRequestId = useRef('');
  const liveDocumentRef = useRef({ novelId, chapterId: chapter?.id });
  const liveDraftIdRef = useRef(currentDraft?.id);
  const liveContentRef = useRef(content);
  const loadedChapterIdRef = useRef<string>();
  const saveInFlightRef = useRef<Promise<ChapterDraft | null> | null>(null);

  liveDocumentRef.current = { novelId, chapterId: chapter?.id };
  liveDraftIdRef.current = currentDraft?.id;
  liveContentRef.current = content;
  const effectiveContentState = contentStateOverride ?? currentDraft?.contentState;

  // v1.0.35 章节大纲行内编辑状态
  const [isEditingOutline, setIsEditingOutline] = useState(false);
  const [outlineDraft, setOutlineDraft] = useState('');
  const [outlineSaveMsg, setOutlineSaveMsg] = useState('');

  const emitContentSnapshot = useCallback((value: string, dirty: boolean, draft: ChapterDraft | null | undefined = currentDraft) => {
    const draftContentState = contentStateOverride ?? draft?.contentState;
    const unavailable = draftContentState?.status === 'unavailable';
    const safeValue = unavailable ? '' : value;
    const wc = countTextWords(safeValue);
    const ta = textareaRef.current;
    onDraftChange?.(wc, dirty);
    onEditorContentChange?.({
      chapterId: chapter?.id,
      draftId: draft?.id,
      draftVersion: draft?.versionNo,
      content: safeValue,
      wordCount: wc,
      isDirty: unavailable ? false : dirty,
      contentHash: hashTextContent(safeValue),
      contentAvailable: !unavailable,
      persistedContentHash: draftContentState?.status === 'ready'
        ? draftContentState.contentHash
        : undefined,
      contentState: draftContentState,
      // v1.0.45: 传递选中文本位置
      selectionStart: ta?.selectionStart ?? 0,
      selectionEnd: ta?.selectionEnd ?? 0,
    });
  }, [chapter?.id, contentStateOverride, currentDraft, onDraftChange, onEditorContentChange]);

  // 加载当前草稿
  useEffect(() => {
    const resolution = resolveEditorDraftContent({
      documentState,
      novelId,
      chapterId: chapter?.id,
      draft: currentDraft,
    });
    if (resolution.action === 'replace') {
      const unavailable = effectiveContentState?.status === 'unavailable';
      const safeContent = unavailable ? '' : resolution.content;
      setContent(safeContent);
      setIsDirty(false);
      setSaveMsg('');
      setLastSaved(resolution.draft ? formatDateTime(resolution.draft.updatedAt) : '');
      loadedChapterIdRef.current = chapter?.id;
      emitContentSnapshot(safeContent, false, resolution.draft);
    } else if (resolution.reason) {
      setSaveMsg(resolution.reason);
    }
    // 切换章节时重置大纲编辑状态
    setIsEditingOutline(false);
    setOutlineDraft('');
    setOutlineSaveMsg('');
  }, [currentDraft, chapter?.id, novelId, documentState, effectiveContentState, emitContentSnapshot]);

  // 定位正文功能 (v1.7.16: 多级策略 + 明显高亮)
  const [_highlightRange, setHighlightRange] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!locateTarget || !textareaRef.current) return;
    const ta = textareaRef.current;
    const { startOffset, endOffset, quote, paragraphIndex } = locateTarget;
    let found = false;
    let selStart = 0;
    let selEnd = 0;

    // 策略1: offset 精确定位
    if (startOffset >= 0 && endOffset >= 0 && startOffset < ta.value.length) {
      selStart = startOffset;
      selEnd = Math.min(endOffset, ta.value.length);
      found = true;
    }
    // 策略2: paragraph_index 段落定位
    else if (paragraphIndex !== undefined && paragraphIndex >= 0) {
      const paragraphs = ta.value.split(/\n\n+/);
      let pos = 0;
      for (let i = 0; i < Math.min(paragraphIndex, paragraphs.length); i++) {
        if (i > 0) pos += 2; // paragraph separator
        pos += paragraphs[i].length;
      }
      const paraText = paragraphs[Math.min(paragraphIndex, paragraphs.length - 1)] || '';
      selStart = Math.max(0, pos - paraText.length);
      selEnd = Math.min(pos, ta.value.length);
      found = true;
    }
    // 策略3: quote 精确搜索
    else if (quote && quote.length >= 3) {
      const idx = ta.value.indexOf(quote);
      if (idx >= 0) {
        selStart = idx;
        selEnd = idx + quote.length;
        found = true;
      } else {
        // 策略4: 模糊搜索（取 quote 的前 20 个字符）
        const shortQuote = quote.slice(0, Math.min(20, quote.length));
        if (shortQuote.length >= 3) {
          const fuzzyIdx = ta.value.indexOf(shortQuote);
          if (fuzzyIdx >= 0) {
            selStart = fuzzyIdx;
            selEnd = fuzzyIdx + shortQuote.length;
            found = true;
          }
        }
      }
    }

    if (found) {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
      setHighlightRange({ start: selStart, end: selEnd });
      // 滚动到选中位置
      const lineHeight = 24;
      const linesBefore = ta.value.substring(0, selStart).split('\n').length;
      ta.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight);
    }

    // 2.5秒后清除高亮
    const timer = setTimeout(() => {
      setHighlightRange(null);
      onLocateDone?.({ found, message: found ? undefined : '原文片段可能已被修改，无法精确定位' });
    }, 2500);
    return () => clearTimeout(timer);
  }, [locateTarget, onLocateDone]);

  // v1.0.35 大纲保存处理
  const handleStartEditOutline = () => {
    setOutlineDraft(chapter?.outline || '');
    setIsEditingOutline(true);
    setOutlineSaveMsg('');
  };

  const handleCancelEditOutline = () => {
    setIsEditingOutline(false);
    setOutlineDraft('');
    setOutlineSaveMsg('');
  };

  const handleSaveOutline = useCallback(async () => {
    if (!chapter || !novelId || documentState !== 'ready') return;
    try {
      await runWithLoading(
        {
          title: '正在保存章节大纲',
          initialMessage: '正在写入数据库……',
          successMessage: '章节大纲已保存',
          errorMessage: '保存失败',
          successAutoCloseMs: 800,
        },
        async () => {
          await chapterRepository.update(chapter.id, {
            outline: outlineDraft,
          });
          onChapterUpdated?.(chapter.id);
        },
      );
      setIsEditingOutline(false);
      setOutlineSaveMsg('✅ 已保存');
      setTimeout(() => setOutlineSaveMsg(''), 3000);
    } catch {
      setOutlineSaveMsg('❌ 保存失败');
      setTimeout(() => setOutlineSaveMsg(''), 3000);
    }
  }, [chapter, novelId, outlineDraft, onChapterUpdated, documentState]);

  // Ctrl+S 保存大纲（编辑模式时）
  useEffect(() => {
    if (!isEditingOutline) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveOutline();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isEditingOutline, handleSaveOutline]);

  const handleContentChange = useCallback((value: string) => {
    if (documentState !== 'ready') return;
    setContent(value);
    const dirty = value !== (currentDraft?.content || '');
    setIsDirty(dirty);
    emitContentSnapshot(value, dirty);
  }, [currentDraft, documentState, emitContentSnapshot]);

  // v1.0.45: 选中文本变化时也通知父组件（不改变 content/dirty）
  const handleSelectionChange = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    onEditorContentChange?.({
      chapterId: chapter?.id,
      draftId: currentDraft?.id,
      draftVersion: currentDraft?.versionNo,
      content: content,
      wordCount: countTextWords(content),
      isDirty,
      contentHash: hashTextContent(content),
      contentAvailable: effectiveContentState?.status !== 'unavailable',
      persistedContentHash: effectiveContentState?.status === 'ready'
        ? effectiveContentState.contentHash
        : undefined,
      contentState: effectiveContentState,
      selectionStart: ta.selectionStart,
      selectionEnd: ta.selectionEnd,
    });
  }, [chapter?.id, currentDraft, content, effectiveContentState, isDirty, onEditorContentChange]);

  useEffect(() => {
    if (!applyTextRequest) return;
    if (lastApplyRequestId.current === applyTextRequest.id) return;
    lastApplyRequestId.current = applyTextRequest.id;
    const incoming = applyTextRequest.text.trim();
    if (!incoming) return;
    if (documentState !== 'ready' || effectiveContentState?.status === 'unavailable') {
      const reason = documentState !== 'ready'
        ? '完整正文尚未安全载入，已阻止应用 AI 输出'
        : '完整正文不可用，已阻止应用 AI 输出';
      setSaveMsg(reason);
      onApplyTextRejected?.(applyTextRequest, reason);
      return;
    }
    if (!chapter || !novelId
      || applyTextRequest.novelId !== novelId
      || applyTextRequest.chapterId !== chapter.id) {
      const reason = 'AI 输出目标不是当前作品章节，已阻止应用';
      setSaveMsg(reason);
      onApplyTextRejected?.(applyTextRequest, reason);
      return;
    }
    if (hashTextContent(content) !== applyTextRequest.baseContentHash) {
      const reason = '正文已在 AI 结果生成后发生变化，已阻止覆盖';
      setSaveMsg(reason);
      onApplyTextRejected?.(applyTextRequest, reason);
      return;
    }
    if (applyTextRequest.sourceDraftId && currentDraft?.id !== applyTextRequest.sourceDraftId) {
      const reason = '基础草稿已切换，已阻止应用旧结果';
      setSaveMsg(reason);
      onApplyTextRejected?.(applyTextRequest, reason);
      return;
    }
    if (applyTextRequest.sourceRevision !== undefined
      && currentDraft?.versionNo !== applyTextRequest.sourceRevision) {
      const reason = '基础草稿版本已变化，已阻止应用旧结果';
      setSaveMsg(reason);
      onApplyTextRejected?.(applyTextRequest, reason);
      return;
    }
    setContent((prev) => {
      const nextContent = applyTextRequest.mode === 'append'
        ? [prev.trimEnd(), incoming].filter(Boolean).join('\n\n')
        : incoming;
      setIsDirty(true);
      emitContentSnapshot(nextContent, true);
      return nextContent;
    });
    setSaveMsg('未保存');
    onApplyTextConsumed?.(applyTextRequest);
    textareaRef.current?.focus();
  }, [applyTextRequest, chapter, novelId, content, currentDraft, documentState, effectiveContentState, emitContentSnapshot, onApplyTextConsumed, onApplyTextRejected]);

  const performSave = useCallback(async (): Promise<ChapterDraft | null> => {
    if (!chapter || !novelId || documentState !== 'ready') return null;
    if (effectiveContentState?.status === 'unavailable') {
      setSaveMsg('正文不可用，已阻止保存');
      return null;
    }
    setSaving(true);
    const requestNovelId = novelId;
    const requestChapterId = chapter.id;
    const requestDraftId = currentDraft?.id;
    const requestContent = content;
    try {
      const savedDraft = await runWithLoading(
        {
          title: '正在保存草稿',
          initialMessage: '正在保存正文……',
          successMessage: '草稿已保存',
          errorMessage: '保存失败',
          successAutoCloseMs: 800,
        },
        async ({ setMessage }) => {
          if (currentDraft && !currentDraft.isAdopted) {
            setMessage('正在更新草稿……');
            return await draftVersionService.update(
              currentDraft.id,
              requestChapterId,
              requestContent,
              'user_edited',
              undefined,
              currentDraft,
            );
          }
          setMessage('正在创建草稿……');
          return await draftVersionService.create({
            novelId: requestNovelId,
            chapterId: requestChapterId,
            content: requestContent,
            source: 'user_edited',
          });
        },
      );
      if (!isDraftSaveResultForDocument(savedDraft, requestNovelId, requestChapterId)) {
        throw new Error('草稿保存结果与当前章节不一致');
      }
      const liveDocument = liveDocumentRef.current;
      if (liveDocument.novelId !== requestNovelId
        || liveDocument.chapterId !== requestChapterId
        || liveDraftIdRef.current !== requestDraftId) {
        return null;
      }
      if (liveContentRef.current !== requestContent) {
        setSaveMsg('正文已变化，请再次保存');
        setTimeout(() => setSaveMsg(''), 3000);
        return null;
      }
      setIsDirty(false);
      setSaveMsg('已保存');
      setLastSaved(formatDateTime(new Date()));
      try {
        await onDraftSaved?.(savedDraft);
      } catch (error) {
        // The authoritative draft is already committed. Recovery cleanup and
        // UI refresh are post-commit maintenance and must not report a false
        // save failure that would encourage a duplicate submission.
        logWorkspaceWarning('post_save_callback_failed', {
          novelId: requestNovelId,
          chapterId: requestChapterId,
          draftId: savedDraft.id,
          errorCode: error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : 'UNKNOWN_ERROR',
        });
      }
      emitContentSnapshot(savedDraft.content, false, savedDraft);
      setTimeout(() => setSaveMsg(''), 2000);
      return savedDraft;
    } catch (error) {
      const liveDocument = liveDocumentRef.current;
      if (liveDocument.novelId === requestNovelId && liveDocument.chapterId === requestChapterId) {
        const appError = normalizeAppError(error, '正文保存失败。');
        setSaveMsg(`❌ ${getAppErrorUserMessage(appError)}`);
        setTimeout(() => setSaveMsg(''), 3000);
      }
      return null;
    } finally {
      setSaving(false);
    }
  }, [chapter, novelId, content, currentDraft, documentState, effectiveContentState, onDraftSaved, emitContentSnapshot]);

  const handleSave = useCallback((): Promise<ChapterDraft | null> => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const save = performSave();
    saveInFlightRef.current = save;
    void save.finally(() => {
      if (saveInFlightRef.current === save) saveInFlightRef.current = null;
    });
    return save;
  }, [performSave]);

  const restoreRecovery = useCallback((
    recoveryContent: string,
    selectionStart = 0,
    selectionEnd = selectionStart,
  ): boolean => {
    if (!chapter || effectiveContentState?.status === 'unavailable') return false;
    setContent(recoveryContent);
    setIsDirty(true);
    setSaveMsg('未保存（已恢复）');
    emitContentSnapshot(recoveryContent, true);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = Math.max(0, Math.min(selectionStart, recoveryContent.length));
      const end = Math.max(start, Math.min(selectionEnd, recoveryContent.length));
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
    return true;
  }, [chapter, effectiveContentState, emitContentSnapshot]);

  useImperativeHandle(ref, () => ({ save: handleSave, restoreRecovery }), [handleSave, restoreRecovery]);

  const handleFormat = useCallback(() => {
    if (documentState !== 'ready') return;
    handleContentChange(content.replace(/\n{3,}/g, '\n\n').trim());
    setSaveMsg('已排版');
    setTimeout(() => setSaveMsg(''), 2000);
  }, [content, documentState, handleContentChange]);

  const handleAdoptCurrent = useCallback(async () => {
    if (!chapter || !novelId || documentState !== 'ready') return;
    if (adopting || saving) return;
    if (effectiveContentState?.status === 'unavailable') {
      setSaveMsg('正文不可用，已阻止采用');
      return;
    }
    const requestNovelId = novelId;
    const requestChapterId = chapter.id;
    let draftToAdopt = currentDraft;

    if (!draftToAdopt || draftToAdopt.content !== content || isDirty) {
      const ok = await confirmInfo({
        title: '保存并采用',
        message: '当前正文存在未保存修改。需要先保存为草稿，再将该草稿确认为正式正文。是否继续？',
        testId: 'apply-confirm',
      });
      if (!ok) return;
      draftToAdopt = await handleSave();
    } else {
      const existingDraft = draftToAdopt;
      if (existingDraft.isAdopted) {
        setSaveMsg('已采用');
        setTimeout(() => setSaveMsg(''), 2000);
        return;
      }
      if (!(await confirmInfo({
        title: '采用草稿',
        message: `确认采用草稿 v${existingDraft.versionNo} 作为正式正文？`,
        testId: 'apply-confirm',
      }))) {
        return;
      }
    }

    if (!draftToAdopt) {
      setSaveMsg('采用失败');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }
    const draftForAdoption = draftToAdopt;

    setAdopting(true);
    try {
      const adopted = await runWithLoading(
        {
          title: '正在确认采用',
          initialMessage: '正在更新正式正文版本……',
          successMessage: '已采用为正式正文',
          errorMessage: '采用失败',
          successAutoCloseMs: 800,
        },
        async () => await draftVersionService.adopt(draftForAdoption.id, requestChapterId),
      );
      if (adopted.id !== draftForAdoption.id
        || adopted.novelId !== requestNovelId
        || adopted.chapterId !== requestChapterId
        || !adopted.isAdopted) {
        throw new Error('正文采用结果与当前章节不一致');
      }
      const liveDocument = liveDocumentRef.current;
      if (liveDocument.novelId !== requestNovelId
        || liveDocument.chapterId !== requestChapterId
        || liveContentRef.current !== draftForAdoption.content) {
        return;
      }
      const nextDraft = adopted;
      setSaveMsg('已采用');
      onDraftSaved?.(nextDraft);
      emitContentSnapshot(nextDraft.content, false, nextDraft);
      onChapterUpdated?.(requestChapterId);
      setTimeout(() => setSaveMsg(''), 2000);
    } catch {
      const liveDocument = liveDocumentRef.current;
      if (liveDocument.novelId === requestNovelId && liveDocument.chapterId === requestChapterId) {
        setSaveMsg('采用失败');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } finally {
      setAdopting(false);
    }
  }, [chapter, novelId, content, currentDraft, documentState, effectiveContentState, emitContentSnapshot, handleSave, isDirty, onChapterUpdated, onDraftSaved, adopting, saving]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (isDirty) handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, handleSave]);

  useEffect(() => {
    if (!commandRequest) return;
    if (lastCommandRequestId.current === commandRequest.id) return;
    lastCommandRequestId.current = commandRequest.id;
    if (commandRequest.type === 'save') {
      void handleSave();
    } else if (commandRequest.type === 'format') {
      handleFormat();
    } else if (commandRequest.type === 'adopt-current') {
      void handleAdoptCurrent();
    }
  }, [commandRequest, handleAdoptCurrent, handleFormat, handleSave]);

  if (!chapter) {
    return (
      <div className="editor-content">
        <div className="editor-empty">
          <div className="editor-empty-icon">📝</div>
          <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>选择章节开始写作</div>
          <div className="text-sm text-muted">请从左侧目录树中选择一个章节</div>
        </div>
      </div>
    );
  }

  if (documentState !== 'ready') {
    const isLoading = documentState === 'loading';
    return (
      <div className="editor-content" data-document-state={documentState}>
        <div className="editor-chapter-title">第{chapter.chapterNumber}章：{chapter.title}</div>
        <div
          role="status"
          style={{
            width: 'min(100%, 1180px)', maxWidth: 1180, margin: '0 auto 10px', padding: '9px 12px',
            color: isLoading ? 'var(--color-text-secondary)' : 'var(--color-error)',
            background: 'var(--color-bg-hover)', border: '1px solid var(--color-border-light)', borderRadius: 6,
            fontSize: 13,
          }}
        >
          {isLoading
            ? '正在校验并读取完整正文，下方保留切换前内容且暂不可编辑。'
            : '完整正文不可用。下方仅保留切换前的安全内容供参考，不会写入当前章节。'}
        </div>
        <div className="editor-paper">
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            data-testid="chapter-editor"
            data-document-state={documentState}
            data-chapter-id={loadedChapterIdRef.current ?? ''}
            data-target-chapter-id={chapter.id}
            data-draft-id={currentDraft?.id ?? ''}
            data-draft-version={currentDraft?.versionNo ?? ''}
            data-content-hash={hashTextContent(content)}
            data-adopted={currentDraft?.isAdopted ? 'true' : 'false'}
            data-word-count={countTextWords(content)}
            data-dirty={isDirty ? 'true' : 'false'}
            data-saving="false"
            aria-disabled="true"
            readOnly
            value={content}
            onSelect={handleSelectionChange}
            spellCheck={false}
          />
        </div>
      </div>
    );
  }

  const draftSourceLabel: Record<string, string> = {
    ai_generated: 'AI 初稿', ai_regenerated: 'AI 重生成',
    user_edited: '用户编辑', ai_polished: 'AI 润色',
    imported: '导入', manual_placeholder: '手动占位',
  };

  return (
    <div className="editor-content">
      <div className="editor-chapter-title">第{chapter.chapterNumber}章：{chapter.title}</div>

      {/* 草稿版本信息 */}
      {currentDraft && (
        <div style={{
          width: 'min(100%, 1180px)', maxWidth: 1180, margin: '0 auto 10px', padding: '7px 12px',
          background: currentDraft.isAdopted ? '#e8f5e9' : 'var(--color-bg-hover)',
          borderRadius: 6, fontSize: 13, display: 'flex', alignItems: 'center', gap: 16,
          border: currentDraft.isAdopted ? '1px solid #c8e6c9' : '1px solid var(--color-border-light)',
        }}>
          <span>📄 草稿 v{currentDraft.versionNo}</span>
          <span>来源：{draftSourceLabel[currentDraft.source] || currentDraft.source}</span>
          <span>字数：{formatNumber(currentDraft.wordCount)}</span>
          {currentDraft.isAdopted && <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>✅ 已采用</span>}
          {saveMsg && <span style={{ color: saveMsg.startsWith('❌') || saveMsg.includes('失败') ? 'var(--color-error)' : 'var(--color-success)', fontWeight: 600 }}>{saveMsg}</span>}
        </div>
      )}

      {/* 章节信息卡片 */}
      {(chapter.outline || chapter.goal) && (
        <div className="editor-info-card">
          {chapter.outline && (
            <div className="editor-info-section">
              <div className="editor-info-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>📋 章节大纲</span>
                {!isEditingOutline ? (
                  <button className="btn btn-secondary btn-sm" onClick={handleStartEditOutline} style={{ fontSize: 11 }}>
                    ✏️ 编辑
                  </button>
                ) : (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveOutline} disabled={saving} style={{ fontSize: 11 }}>
                      💾 保存
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={handleCancelEditOutline} style={{ fontSize: 11 }}>
                      取消
                    </button>
                  </span>
                )}
              </div>
              {isEditingOutline ? (
                <textarea
                  className="form-textarea"
                  value={outlineDraft}
                  onChange={(e) => setOutlineDraft(e.target.value)}
                  style={{ width: '100%', height: 120, resize: 'vertical', fontSize: 14, lineHeight: 1.8, fontFamily: 'var(--font-family-editor)', marginTop: 8 }}
                  placeholder="编辑章节大纲..."
                  autoFocus
                />
              ) : (
                <div className="editor-info-text">{chapter.outline}</div>
              )}
              {outlineSaveMsg && (
                <div style={{ fontSize: 11, marginTop: 4, color: outlineSaveMsg.startsWith('✅') ? 'var(--color-success)' : 'var(--color-error)' }}>
                  {outlineSaveMsg}
                </div>
              )}
            </div>
          )}
          {chapter.goal && <div className="editor-info-section"><div className="editor-info-label">🎯 本章目标</div><div className="editor-info-text">{chapter.goal}</div></div>}
          <div className="editor-info-meta">
            <span>状态：{ChapterStatusLabels[chapter.status]}</span>
            <span>目标字数：{formatNumber(chapter.targetWordCount || 0)} 字</span>
            {lastSaved && <span>上次保存：{lastSaved}</span>}
          </div>
        </div>
      )}

      {!chapter.outline && !isEditingOutline && (
        <div className="editor-hint-banner">
          💡 当前章节还没有大纲，建议补充章节大纲，AI 将根据大纲生成正文。
          <button className="btn btn-secondary btn-sm" onClick={handleStartEditOutline} style={{ marginLeft: 8, fontSize: 11 }}>
            ✏️ 手动编写
          </button>
        </div>
      )}

      {/* 大纲编辑模式（无现有大纲时） */}
      {isEditingOutline && !chapter.outline && (
        <div className="editor-info-card" style={{ marginTop: 8 }}>
          <div className="editor-info-section">
            <div className="editor-info-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>📋 编写章节大纲</span>
              <span style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveOutline} disabled={saving} style={{ fontSize: 11 }}>
                  💾 保存
                </button>
                <button className="btn btn-secondary btn-sm" onClick={handleCancelEditOutline} style={{ fontSize: 11 }}>
                  取消
                </button>
              </span>
            </div>
            <textarea
              className="form-textarea"
              value={outlineDraft}
              onChange={(e) => setOutlineDraft(e.target.value)}
              style={{ width: '100%', height: 120, resize: 'vertical', fontSize: 14, lineHeight: 1.8, fontFamily: 'var(--font-family-editor)', marginTop: 8 }}
              placeholder="编写章节大纲..."
              autoFocus
            />
            {outlineSaveMsg && (
              <div style={{ fontSize: 11, marginTop: 4, color: outlineSaveMsg.startsWith('✅') ? 'var(--color-success)' : 'var(--color-error)' }}>
                {outlineSaveMsg}
              </div>
            )}
          </div>
        </div>
      )}

      {effectiveContentState?.status === 'unavailable' ? (
        <ContentUnavailableState
          state={effectiveContentState}
          retrying={retryingContent}
          onRetry={() => onRetryContent?.()}
          onOpenHistory={onOpenDraftHistory}
          onBackToChapters={onBackToChapters}
        />
      ) : (
        <div className="editor-paper">
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            data-testid="chapter-editor"
            data-chapter-id={chapter.id}
            data-draft-id={currentDraft?.id ?? ''}
            data-draft-version={currentDraft?.versionNo ?? ''}
            data-content-hash={hashTextContent(content)}
            data-adopted={currentDraft?.isAdopted ? 'true' : 'false'}
            data-word-count={countTextWords(content)}
            data-dirty={isDirty ? 'true' : 'false'}
            data-saving={saving ? 'true' : 'false'}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onSelect={handleSelectionChange}
            placeholder="在这里输入或粘贴正文内容...&#10;&#10;点击右侧 AI 生成面板，AI 将根据章节大纲生成正文。"
            spellCheck={false} />
        </div>
      )}

      {!content && effectiveContentState?.status !== 'unavailable' && (
        <div className="editor-empty-state">
          <div className="editor-empty-icon">✍️</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>当前章节还没有正文</div>
          <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            正文为空。
          </div>
        </div>
      )}
    </div>
  );
});

export default EditorArea;
