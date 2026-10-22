'use client';
import { useCallback, useEffect, useRef, type SyntheticEvent } from 'react';
import { isCompositionKey } from '@/lib/editor/keyboard-composition';

// Some candidate-window keys omit keyboard composition flags. Track the
// composing field too, without consuming the key the input method needs.
export function useInputComposition() {
  const target = useRef<EventTarget | null>(null);
  const observer = useRef<MutationObserver | null>(null);
  const listeners = useRef(new Set<() => void>());
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  const finish = useCallback(() => {
    observer.current?.disconnect(); observer.current = null;
    target.current = null;
    // Let the target input/editor process its final text before saving it.
    queueMicrotask(() => listeners.current.forEach(listener => listener()));
  }, []);
  const onCompositionStartCapture = useCallback((event: SyntheticEvent) => {
    observer.current?.disconnect(); observer.current = null;
    const current = event.target;
    target.current = current;
    // Removing a focused field need not emit blur or compositionend. Observe
    // only while composing, including fields rendered in a dialog portal.
    if (current instanceof Node && current.isConnected) {
      observer.current = new MutationObserver(() => {
        if (target.current === current && !current.isConnected) finish();
      });
      observer.current.observe(current.ownerDocument!, { childList: true, subtree: true });
    }
    listeners.current.forEach(listener => listener());
  }, [finish]);
  const clear = useCallback((event: SyntheticEvent) => {
    if (target.current === event.target) finish();
  }, [finish]);
  useEffect(() => () => {
    observer.current?.disconnect(); observer.current = null;
    target.current = null;
  }, []);
  const isComposing = useCallback((event: KeyboardEvent) => (
    isCompositionKey(event) || (target.current !== null && target.current === event.target)
  ), []);
  const hasComposition = useCallback(() => target.current instanceof Node && target.current.isConnected, []);
  return {
    isComposing,
    hasComposition,
    subscribe,
    capture: { onCompositionStartCapture, onCompositionEndCapture: clear, onBlurCapture: clear },
  };
}
