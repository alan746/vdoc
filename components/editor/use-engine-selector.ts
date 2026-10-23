'use client';
import { useMemo, useSyncExternalStore } from 'react';
import type { DocumentEngine } from '@/lib/usecases/engine';

/** UI-owned, frame-coalesced subscription. Selectors return primitives or immutable values. */
function createEngineSelectorStore<T>(engine: DocumentEngine | null, select: (engine: DocumentEngine) => T, empty: T) {
  let state: DocumentEngine['editor']['state'] | undefined;
  let records: DocumentEngine['records'] | undefined;
  let composing: boolean | undefined;
  let snapshot = empty;
  return {
    getSnapshot() {
      if (engine && (state !== engine.editor.state || records !== engine.records || composing !== engine.editor.view.composing)) {
        state = engine.editor.state;
        records = engine.records;
        composing = engine.editor.view.composing;
        snapshot = select(engine);
      }
      return snapshot;
    },
    subscribe(notify: () => void) {
      if (!engine) return () => {};
      let frame = 0;
      const unsubscribe = engine.subscribe(() => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; notify(); });
      });
      return () => { cancelAnimationFrame(frame); unsubscribe(); };
    },
  };
}

export function useEngineSelector<T>(engine: DocumentEngine | null, select: (engine: DocumentEngine) => T, empty: T): T {
  const store = useMemo(() => createEngineSelectorStore(engine, select, empty), [engine, select, empty]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => empty);
}
