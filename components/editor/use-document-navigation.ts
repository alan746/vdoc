'use client';
import { useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { documentNavigation } from '@/lib/usecases/document-navigation';

const subscribeIdle = () => () => {};
const idle = () => 'idle' as const;
export function useDocumentNavigation(editor: Editor | null) {
  const navigation = editor ? documentNavigation(editor) : null;
  const phase = useSyncExternalStore(navigation?.subscribe ?? subscribeIdle, navigation?.getSnapshot ?? idle, idle);
  return { navigation, busy: phase !== 'idle', committing: phase === 'committing' };
}
