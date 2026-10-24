'use client';
import type { Editor } from '@tiptap/core';
import type { SaveBlock } from '@/lib/usecases/document-navigation';
import { AccountMenu } from './account-menu';
import { useSaveBeforeLeave } from './use-save-before-leave';

export function DocumentAccountMenu(props: { editor: Editor; title: string; documentId: string; blocked: SaveBlock }) {
  const { leave, busy, saving } = useSaveBeforeLeave(props);
  return <><AccountMenu beforeLeave={leave} disabled={busy} /><span role="status" className="sr-only">{saving ? 'Saving before opening your account…' : ''}</span></>;
}
