import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hasActiveModal } from '../../../components/common/useModalAccessibility';
import { isComposingKeyboardEvent } from '../../../utils/keyboardEvent';

import type { WorkbenchTemplateUndo } from '../WorkbenchTemplateUndoNotice';

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Transient controls never own or clear the conversation draft. */
export function useWorkbenchComposerDisclosure(scopeKey: string) {
  const composerRef = useRef<HTMLElement>(null);
  const extrasRef = useRef<HTMLDivElement>(null);
  const [templateUndo, setTemplateUndo] = useState<WorkbenchTemplateUndo | null>(null);
  const [assetScopeOpen, setAssetScopeOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const assetButtonRef = useRef<HTMLButtonElement>(null);
  const assetPanelRef = useRef<HTMLDivElement>(null);
  const focusComposer = () =>
    composerRef.current
      ?.querySelector<HTMLTextAreaElement>('[data-testid="workbench-composer-input"]')
      ?.focus({ preventScroll: true });

  useClientLayoutEffect(() => {
    setAttachOpen(false);
    setAssetScopeOpen(false);
    setTemplateUndo(null);
  }, [scopeKey]);

  useEffect(() => {
    if (!attachOpen) return;
    if (extrasRef.current) extrasRef.current.scrollTop = 0;
    attachMenuRef.current
      ?.querySelector<HTMLElement>('button:not(:disabled), summary')
      ?.focus({ preventScroll: true });
    const handlePointerDown = (event: PointerEvent) => {
      if (hasActiveModal()) return;
      const target = event.target as Node;
      if (attachMenuRef.current?.contains(target) || attachButtonRef.current?.contains(target))
        return;
      setAttachOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        hasActiveModal() ||
        isComposingKeyboardEvent(event)
      )
        return;
      event.preventDefault();
      // The template confirm strip handles its own Escape first and stops propagation.
      setAttachOpen(false);
      attachButtonRef.current?.focus();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (hasActiveModal()) return;
      const target = event.target as Node;
      if (!attachMenuRef.current?.contains(target) && !attachButtonRef.current?.contains(target)) {
        setAttachOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [attachOpen]);

  useEffect(() => {
    if (!assetScopeOpen) return;
    assetPanelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (hasActiveModal()) return;
      const target = event.target as Node;
      if (assetPanelRef.current?.contains(target) || assetButtonRef.current?.contains(target))
        return;
      setAssetScopeOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        hasActiveModal() ||
        isComposingKeyboardEvent(event)
      )
        return;
      event.preventDefault();
      setAssetScopeOpen(false);
      assetButtonRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [assetScopeOpen]);
  return {
    composerRef,
    extrasRef,
    attachMenuRef,
    attachButtonRef,
    assetButtonRef,
    assetPanelRef,
    attachOpen,
    setAttachOpen,
    assetScopeOpen,
    setAssetScopeOpen,
    templateUndo,
    setTemplateUndo,
    focusComposer,
  };
}
