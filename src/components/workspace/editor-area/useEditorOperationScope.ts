import { useCallback, useEffect, useRef } from 'react';

/** A visit identity, not just an ID comparison: A -> B -> A invalidates the first A request. */
export function useEditorOperationScope(scopeKey: string) {
  const scope = useRef({ key: scopeKey, epoch: 0, mounted: true });
  if (scope.current.key !== scopeKey) {
    scope.current = { key: scopeKey, epoch: scope.current.epoch + 1, mounted: true };
  }
  useEffect(() => {
    scope.current.mounted = true;
    return () => {
      scope.current.mounted = false;
      scope.current.epoch += 1;
    };
  }, []);
  const isCurrent = useCallback(
    (epoch: number) => scope.current.mounted && scope.current.epoch === epoch,
    [],
  );
  return { scope, isCurrent };
}
