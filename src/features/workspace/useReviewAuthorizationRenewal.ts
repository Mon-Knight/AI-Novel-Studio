import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ChapterDraft } from '../../types/ai';
import type { ReviewAuthorization, ReviewCandidateDocument } from '../../types/conversation';
import type { ReviewRenewalPreview } from '../../types/reviewAuthorizationRenewal';
import { reviewAuthorizationRenewalService } from '../../services/conversation/reviewAuthorizationRenewalService';
import { draftVersionService } from '../../services/database/draftVersionService';
import { generateId } from '../../services/database/db';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { normalizeAppError } from '../../types/appError';
import { canPreviewReviewAuthorizationRenewal } from './reviewAuthorizationRenewalPolicy';

interface Options {
  novelId?: string;
  chapterId?: string;
  candidate?: ReviewCandidateDocument | null;
  authorizationId?: string;
  currentDraft?: ChapterDraft | null;
  content: string;
  isDirty: boolean;
  available: boolean;
  saving: boolean;
  adopting: boolean;
  scope: MutableRefObject<{ epoch: number }>;
  adoptInFlightRef: MutableRefObject<number | null>;
  save: () => Promise<ChapterDraft | null>;
  onRenewed?: (authorization: ReviewAuthorization) => void;
}
interface Context {
  sequence: number;
  scopeVersion: number;
  contentVersion: number;
  epoch: number;
  sourceAuthorizationId: string;
  draft: ChapterDraft;
  operationId: string;
  preview: ReviewRenewalPreview | null;
  formalContent: string;
  uncertain: boolean;
}
interface State {
  scopeVersion: number;
  open: boolean;
  busy: boolean;
  committing: boolean;
  error: string;
  notice: string;
  conflictCode: string;
  effectiveAuthorization?: ReviewAuthorization;
}
const idle = (scopeVersion: number): State => ({
  scopeVersion,
  open: false,
  busy: false,
  committing: false,
  error: '',
  notice: '',
  conflictCode: '',
});

/** Explicit human preview/consent only; never mutates the editor, navigates, signs on load or invokes a model. */
export function useReviewAuthorizationRenewal(options: Options) {
  const live = useRef(options);
  live.current = options;
  const sourceKey = JSON.stringify([
    options.novelId,
    options.chapterId,
    options.candidate?.artifactId,
    options.candidate?.authorizationId ?? options.authorizationId,
  ]);
  const stamp = useRef({ sourceKey, scopeVersion: 0, content: options.content, contentVersion: 0 });
  if (stamp.current.sourceKey !== sourceKey) {
    stamp.current.sourceKey = sourceKey;
    stamp.current.scopeVersion += 1;
  }
  if (stamp.current.content !== options.content) {
    stamp.current.content = options.content;
    stamp.current.contentVersion += 1;
  }
  const mounted = useRef(true);
  const request = useRef(0);
  const inFlight = useRef<number | null>(null);
  const signing = useRef<number | null>(null);
  const context = useRef<Context | null>(null);
  const [state, setState] = useState(() => idle(stamp.current.scopeVersion));
  const stateRef = useRef(state);
  stateRef.current = state;
  const currentScope = useCallback(
    (scopeVersion: number) => mounted.current && stamp.current.scopeVersion === scopeVersion,
    [],
  );
  const release = useCallback((value: Context | null) => {
    if (value && live.current.adoptInFlightRef.current === value.epoch)
      live.current.adoptInFlightRef.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    release(context.current);
    context.current = null;
    setState(idle(stamp.current.scopeVersion));
    return () => {
      mounted.current = false;
      request.current += 1;
      release(context.current);
    };
  }, [sourceKey, release]);

  const matchesBuffer = useCallback(
    (value: Context) => {
      const input = live.current;
      const current = input.currentDraft;
      return (
        context.current === value &&
        request.current === value.sequence &&
        currentScope(value.scopeVersion) &&
        stamp.current.contentVersion === value.contentVersion &&
        input.available &&
        !input.isDirty &&
        input.novelId === value.draft.novelId &&
        input.chapterId === value.draft.chapterId &&
        input.content === value.draft.content &&
        current?.id === value.draft.id &&
        current.versionNo === value.draft.versionNo &&
        current.content === value.draft.content
      );
    },
    [currentScope],
  );
  const accept = useCallback(
    async (authorization: ReviewAuthorization, value: Context) => {
      const preview = value.preview;
      const binding = authorization.reviewDraftBinding;
      if (
        !preview ||
        authorization.authorizationId === value.sourceAuthorizationId ||
        authorization.status === 'expired' ||
        authorization.novelId !== preview.novelId ||
        authorization.chapterId !== preview.chapterId ||
        authorization.artifactId !== preview.artifactId ||
        authorization.renewedFromAuthorizationId !== value.sourceAuthorizationId ||
        !binding ||
        binding.draftId !== value.draft.id ||
        binding.draftVersion !== value.draft.versionNo ||
        binding.contentHash !== preview.savedDraft?.contentHash
      )
        throw new Error('原生重新授权结果与候选、目标或已保存稿绑定不一致，请核对权威记录。');
      if (!matchesBuffer(value))
        throw new Error('新授权已为先前保存稿签发，但当前正文已变化；编辑未被替换，请重新核对。');
      const hash = await computeContentSha256(live.current.content);
      if (!matchesBuffer(value) || hash !== binding.contentHash)
        throw new Error('当前正文不再匹配确认时的已保存稿，已保留编辑并停止切换授权。');
      release(value);
      context.current = null;
      setState((previous) => ({
        ...previous,
        open: false,
        busy: false,
        error: '',
        conflictCode: '',
        effectiveAuthorization: authorization,
        notice:
          authorization.status === 'consumed'
            ? '新的审阅授权已有采用回执，请核对正式正文；当前编辑未被替换。'
            : '新的审阅授权已签发，当前草稿和正文未被替换；尚未采用，请再次明确确认采用。',
      }));
      live.current.onRenewed?.(authorization);
    },
    [matchesBuffer, release],
  );

  const lookup = useCallback(async () => {
    const value = context.current;
    if (
      !value?.uncertain ||
      !currentScope(value.scopeVersion) ||
      inFlight.current === value.scopeVersion
    )
      return;
    inFlight.current = value.scopeVersion;
    value.sequence = ++request.current;
    const sequence = value.sequence;
    setState((previous) => ({ ...previous, open: true, busy: true, error: '' }));
    try {
      const authorization = await reviewAuthorizationRenewalService.getResult({
        authorizationId: value.sourceAuthorizationId,
        operationId: value.operationId,
      });
      if (!currentScope(value.scopeVersion) || request.current !== sequence) return;
      if (!authorization)
        throw new Error('尚未查到该操作的签发回执；不会重复签发，请稍后再次核对。');
      await accept(authorization, value);
    } catch (cause) {
      if (currentScope(value.scopeVersion))
        setState((previous) => ({ ...previous, error: normalizeAppError(cause).message }));
    } finally {
      if (inFlight.current === value.scopeVersion) inFlight.current = null;
      if (currentScope(value.scopeVersion)) setState((previous) => ({ ...previous, busy: false }));
    }
  }, [accept, currentScope]);

  const begin = useCallback(async () => {
    if (context.current?.uncertain && currentScope(context.current.scopeVersion)) {
      await lookup();
      return;
    }
    const input = live.current;
    const version = stamp.current.scopeVersion;
    const currentState =
      stateRef.current.scopeVersion === version ? stateRef.current : idle(version);
    if (
      !reviewAuthorizationRenewalService.isSupported() ||
      !input.available ||
      input.saving ||
      input.adopting ||
      !input.candidate ||
      !canPreviewReviewAuthorizationRenewal(currentState.conflictCode, input.candidate) ||
      inFlight.current === version ||
      input.adoptInFlightRef.current === input.scope.current.epoch
    )
      return;
    const contentVersion = stamp.current.contentVersion;
    const originalContent = input.content;
    const expectedAuthorization =
      currentState.effectiveAuthorization?.authorizationId ??
      input.candidate.authorizationId ??
      input.authorizationId;
    if (!expectedAuthorization) return;
    const sequence = ++request.current;
    inFlight.current = version;
    setState((previous) => ({
      ...previous,
      scopeVersion: version,
      open: true,
      busy: true,
      error: '',
      notice: '',
    }));
    try {
      const draft =
        input.currentDraft && !input.isDirty && input.currentDraft.content === originalContent
          ? input.currentDraft
          : await input.save();
      if (!currentScope(version) || request.current !== sequence) return;
      if (
        !draft ||
        draft.novelId !== input.novelId ||
        draft.chapterId !== input.chapterId ||
        draft.content !== originalContent ||
        stamp.current.contentVersion !== contentVersion ||
        live.current.content !== originalContent
      )
        throw new Error('草稿未完整保存或预览期间正文已变化；编辑已保留，请先保存后重新预览。');
      const epoch = live.current.scope.current.epoch;
      live.current.adoptInFlightRef.current = epoch;
      const value: Context = {
        sequence,
        scopeVersion: version,
        contentVersion,
        epoch,
        sourceAuthorizationId: expectedAuthorization,
        draft,
        operationId: `manual-review-${generateId()}`,
        preview: null,
        formalContent: '',
        uncertain: false,
      };
      context.current = value;
      const hash = await computeContentSha256(originalContent);
      if (
        !currentScope(version) ||
        request.current !== sequence ||
        stamp.current.contentVersion !== contentVersion
      )
        return;
      if (hash.startsWith('fallback_')) throw new Error('无法取得可靠的全文指纹，已停止重新授权。');
      const preview = await reviewAuthorizationRenewalService.preview({
        authorizationId: expectedAuthorization,
        savedDraftId: draft.id,
      });
      if (
        !currentScope(version) ||
        request.current !== sequence ||
        stamp.current.contentVersion !== contentVersion
      )
        return;
      if (
        preview.authorizationId !== expectedAuthorization ||
        preview.novelId !== input.novelId ||
        preview.chapterId !== input.chapterId ||
        preview.artifactId !== input.candidate.artifactId ||
        preview.artifactHash !== input.candidate.contentHash ||
        preview.savedDraft?.draftId !== draft.id ||
        preview.savedDraft.draftVersion !== draft.versionNo ||
        preview.savedDraft.contentHash !== hash
      )
        throw new Error('原生预览与当前候选或已保存编辑稿不一致，未签发授权。');
      value.preview = preview;
      if (preview.adoptedDraftId) {
        const formal = await draftVersionService.getById(preview.chapterId, preview.adoptedDraftId);
        const formalHash = formal ? await computeContentSha256(formal.content) : '';
        if (
          !formal ||
          formal.novelId !== preview.novelId ||
          formal.chapterId !== preview.chapterId ||
          !formal.isAdopted ||
          formalHash !== preview.adoptedContentHash
        )
          throw new Error('当前正式稿全文无法与原生预览核对，未签发授权。');
        value.formalContent = formal.content;
      }
      if (
        !currentScope(version) ||
        request.current !== sequence ||
        stamp.current.contentVersion !== contentVersion
      )
        return;
      setState((previous) => ({ ...previous, open: true, busy: false, error: '' }));
    } catch (cause) {
      if (currentScope(version))
        setState((previous) => ({ ...previous, error: normalizeAppError(cause).message }));
    } finally {
      if (inFlight.current === version) inFlight.current = null;
      if (currentScope(version))
        setState((previous) => ({
          ...previous,
          busy: false,
          error:
            previous.error ||
            (stamp.current.contentVersion !== contentVersion
              ? '预览期间正文已变化，旧预览不能授权；编辑已保留，请取消后重新预览。'
              : ''),
        }));
    }
  }, [currentScope, lookup]);

  const confirm = useCallback(async () => {
    const value = context.current;
    if (
      !value?.preview ||
      value.uncertain ||
      stateRef.current.error ||
      !currentScope(value.scopeVersion) ||
      inFlight.current === value.scopeVersion
    )
      return;
    if (!matchesBuffer(value)) {
      setState((previous) => ({
        ...previous,
        error: '正文或已保存稿已变化，旧预览不能授权；编辑已保留，请取消并重新预览。',
      }));
      return;
    }
    inFlight.current = value.scopeVersion;
    signing.current = value.scopeVersion;
    setState((previous) => ({ ...previous, busy: true, committing: true, error: '' }));
    let responseReturned = false;
    try {
      const hash = await computeContentSha256(live.current.content);
      if (!matchesBuffer(value) || hash !== value.preview.savedDraft?.contentHash)
        throw new Error('确认期间正文指纹变化，未签发授权。');
      const authorization = await reviewAuthorizationRenewalService.renew({
        authorizationId: value.sourceAuthorizationId,
        operationId: value.operationId,
        expectedPreviewHash: value.preview.previewHash,
        savedDraftId: value.draft.id,
      });
      responseReturned = true;
      if (currentScope(value.scopeVersion)) await accept(authorization, value);
    } catch (cause) {
      if (!currentScope(value.scopeVersion)) return;
      const error = normalizeAppError(cause);
      if (
        responseReturned ||
        error.code === 'DATABASE_COMMIT_UNKNOWN' ||
        error.code === 'OPERATION_IN_PROGRESS'
      ) {
        value.uncertain = true;
        setState((previous) => ({
          ...previous,
          error: '签发结果尚未确认；请核对同一操作回执，不会重复签发。',
        }));
      } else setState((previous) => ({ ...previous, error: error.message }));
    } finally {
      if (inFlight.current === value.scopeVersion) inFlight.current = null;
      if (signing.current === value.scopeVersion) signing.current = null;
      if (currentScope(value.scopeVersion))
        setState((previous) => ({ ...previous, busy: false, committing: false }));
    }
  }, [accept, currentScope, matchesBuffer]);
  const dismiss = useCallback(() => {
    if (signing.current === stamp.current.scopeVersion) return;
    request.current += 1;
    const uncertain = context.current?.uncertain;
    release(context.current);
    if (!uncertain) context.current = null;
    setState((previous) => ({
      ...previous,
      open: false,
      error: '',
      notice: uncertain
        ? '已关闭核对；签发结果仍待核对，不会重复签发。'
        : '已取消预览，人工编辑与已有草稿均保留；未签发新授权。',
    }));
  }, [release]);
  const reportAdoptionError = useCallback(
    (code: string) =>
      setState((previous) => ({
        ...(previous.scopeVersion === stamp.current.scopeVersion
          ? previous
          : idle(stamp.current.scopeVersion)),
        conflictCode: code,
      })),
    [],
  );
  const activeContext =
    context.current?.scopeVersion === stamp.current.scopeVersion ? context.current : null;
  const visible =
    state.scopeVersion === stamp.current.scopeVersion ? state : idle(stamp.current.scopeVersion);
  return {
    ...visible,
    preview: activeContext?.preview ?? null,
    savedContent: activeContext?.draft.content ?? '',
    formalContent: activeContext?.formalContent ?? '',
    uncertain: activeContext?.uncertain ?? false,
    resumedDraftChanged: options.candidate?.changedSinceRenewal === true,
    effectiveAuthorizationId: visible.effectiveAuthorization?.authorizationId,
    canRenew:
      reviewAuthorizationRenewalService.isSupported() &&
      options.available &&
      canPreviewReviewAuthorizationRenewal(visible.conflictCode, options.candidate),
    begin,
    confirm,
    lookup,
    dismiss,
    reportAdoptionError,
  };
}
