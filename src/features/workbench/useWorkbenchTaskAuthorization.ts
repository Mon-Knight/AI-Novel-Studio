import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  IssueTaskAuthorizationInput,
  TaskAuthorization,
  TaskAuthorizationReceipt,
} from '../../types/taskAuthorization';
import { taskAuthorizationService } from '../../services/conversation/taskAuthorizationService';

interface AuthorizationState {
  scope: string;
  authorizations: TaskAuthorization[];
  receipts: TaskAuthorizationReceipt[];
  loading: boolean;
  busy: boolean;
  error: string;
}

const emptyState = (scope: string): AuthorizationState => ({
  scope,
  authorizations: [],
  receipts: [],
  loading: false,
  busy: false,
  error: '',
});
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : '授权操作失败，请重新读取权威记录。';

/** Coordinates only trusted user actions and native facts; it never signs or applies from model text. */
export function useWorkbenchTaskAuthorization(input: {
  conversationId?: string;
  novelId?: string;
  refreshKey?: string;
}) {
  const { conversationId = '', novelId = '', refreshKey } = input;
  const scope = `${novelId}:${conversationId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  const readSequence = useRef(0);
  const mutations = useRef(new Set<string>());
  const [state, setState] = useState(() => emptyState(scope));
  const isCurrent = useCallback(() => mounted.current && currentScope.current === scope, [scope]);
  const refresh = useCallback(async () => {
    if (!conversationId || !novelId || !isCurrent()) return false;
    const request = ++readSequence.current;
    setState((previous) => ({
      ...(previous.scope === scope ? previous : emptyState(scope)),
      loading: true,
      error: '',
    }));
    try {
      const authorizations = await taskAuthorizationService.list(conversationId);
      if (
        authorizations.some(
          (grant) => grant.conversationId !== conversationId || grant.novelId !== novelId,
        )
      )
        throw new Error('原生授权记录与当前作品或任务不匹配，已停止显示。');
      const groups = await Promise.all(
        authorizations.map(async (grant) => {
          const receipts = await taskAuthorizationService.listReceipts(grant.authorizationId);
          if (
            receipts.some(
              (receipt) =>
                receipt.authorizationId !== grant.authorizationId ||
                receipt.conversationId !== conversationId ||
                receipt.novelId !== novelId,
            )
          )
            throw new Error('写入回执与授权作用域不匹配，请重新读取。');
          return receipts;
        }),
      );
      if (!isCurrent() || request !== readSequence.current) return false;
      setState((previous) => ({
        ...previous,
        scope,
        authorizations,
        receipts: groups.flat(),
        loading: false,
        error: '',
      }));
      return true;
    } catch (cause) {
      if (isCurrent() && request === readSequence.current)
        setState((previous) => ({ ...previous, scope, loading: false, error: message(cause) }));
      return false;
    }
  }, [conversationId, isCurrent, novelId, scope]);

  useEffect(() => {
    mounted.current = true;
    setState(emptyState(scope));
    void refresh();
    return () => {
      mounted.current = false;
      readSequence.current += 1;
    };
  }, [scope, refresh, refreshKey]);

  const mutate = useCallback(
    async (operation: () => Promise<TaskAuthorization>, success: string) => {
      if (!conversationId || !novelId || !isCurrent() || mutations.current.has(scope)) return false;
      mutations.current.add(scope);
      readSequence.current += 1;
      setState((previous) => ({ ...previous, scope, busy: true, error: '' }));
      try {
        const grant = await operation();
        if (grant.conversationId !== conversationId || grant.novelId !== novelId)
          throw new Error('授权操作返回了其他作用域，请重新核对权威事实。');
        if (!isCurrent()) return true;
        setState((previous) => ({
          ...previous,
          authorizations: [
            grant,
            ...previous.authorizations.filter(
              (item) => item.authorizationId !== grant.authorizationId,
            ),
          ],
        }));
        if (!(await refresh()) && isCurrent())
          setState((previous) => ({
            ...previous,
            error: `${success}，但授权或写入回执刷新失败；请重新读取，不要重复签发。`,
          }));
        return true;
      } catch (cause) {
        if (isCurrent()) {
          await refresh();
          if (isCurrent())
            setState((previous) => ({
              ...previous,
              error: `${message(cause)} 请核对授权列表与已提交回执；不会自动重试或重签。`,
            }));
        }
        return false;
      } finally {
        mutations.current.delete(scope);
        if (isCurrent()) setState((previous) => ({ ...previous, busy: false }));
      }
    },
    [conversationId, isCurrent, novelId, refresh, scope],
  );

  const issue = useCallback(
    (spec: IssueTaskAuthorizationInput) => {
      if (spec.conversationId !== conversationId || spec.novelId !== novelId)
        return Promise.resolve(false);
      return mutate(() => taskAuthorizationService.issue(spec), '授权已签发');
    },
    [conversationId, mutate, novelId],
  );
  const revoke = useCallback(
    (authorizationId: string) =>
      mutate(
        () => taskAuthorizationService.revoke({ authorizationId, reason: '用户撤销本任务预授权' }),
        '授权已撤销，已提交的写入保持真实结果',
      ),
    [mutate],
  );

  return { ...(state.scope === scope ? state : emptyState(scope)), refresh, issue, revoke };
}
