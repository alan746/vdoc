'use client';
import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { FolderOpen, FilePlus2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { actionErrorMessage } from '@/lib/shared/error-message';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Menu } from './toolbar';
import { useDocumentNavigation } from './use-document-navigation';
import { assertAutosaveActive, type SaveBlock } from '@/lib/usecases/document-navigation';
import { readDocumentImport } from '@/lib/composition/import-file';
import { notifyDocumentImport } from './import-feedback';
import { documents as documentRepository, library as libraryRepository } from '@/lib/composition/repositories';
import { type DocumentSummary, type LibraryItem, type SavedDocument, blankDocument, documentTitle, UNTITLED_DOCUMENT } from '@/lib/domain/entities/document';
import { useMounted } from './use-mounted';
import { DocumentImportInput } from './document-import-input';
import { ExportMenuItems } from './export-menu-items';

function documentLocation(document: LibraryItem, items: Map<string, LibraryItem>) {
  const names: string[] = [], visited = new Set([document.id]);
  let parent = document.parentId;
  while (parent) {
    const folder = items.get(parent);
    if (visited.has(parent) || !folder || folder.kind !== 'folder' || folder.trash) {
      return ['Unavailable folder', ...names].join(' / ');
    }
    visited.add(parent); names.unshift(folder.title); parent = folder.parentId;
  }
  return ['Workspace', ...names].join(' / ');
}

export function LocalDocuments({ exportBusy = false, editor, title, blocked, documentId, onOpen, capture, exportDoc, onLanguage, onPrint }: { exportBusy?: boolean; onPrint: () => void; onLanguage: () => void; documentId: string; capture: () => void; exportDoc: (format: string) => void; editor: Editor; title: string; blocked: SaveBlock; onOpen: (document: SavedDocument) => void }) {
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<(DocumentSummary & { location: string })[]>([]);
  const { navigation, busy } = useDocumentNavigation(editor);
  const file = useRef<HTMLInputElement>(null);
  const mounted = useMounted(), current = useRef({ title, blocked });
  current.current = { title, blocked };
  const perform = async (work: () => Promise<void>, fallback = 'The document could not be opened.') => {
    // A ref closes the same-event gap before React commits disabled controls.
    if (!mounted.current || !navigation!.acquire()) return;
    try { await work(); }
    catch (error) { if (mounted.current) toast.error(actionErrorMessage(error, fallback)); }
    finally { navigation!.release(); }
  };
  const ensureWritable = () => { assertAutosaveActive(current.current.blocked); };
  const preserve = async () => {
    ensureWritable();
    await documentRepository.save(documentTitle(current.current.title), editor.getJSON(), documentId);
    // A conflict may arrive while the final save is still pending.
    ensureWritable();
  };
  const load = async (document: SavedDocument | string, onLoaded?: () => void) => {
    if (!mounted.current || editor.isDestroyed) return;
    navigation!.freeze();
    await preserve(); if (!mounted.current || editor.isDestroyed) return;
    // Read existing documents after the final save, including reopening this
    // document. Only newly created/imported content uses the writing path.
    const next = typeof document === 'string' ? await documentRepository.select(document) : await documentRepository.activate(document);
    if (!mounted.current) return;
    ensureWritable();
    setOpen(false); onOpen(next); onLoaded?.();
  };
  const openLibrary = () => perform(async () => {
    const protectInput = () => {
      if (navigation!.isComposing()) throw new Error('Finish composing your text before opening the document list.');
    };
    protectInput();
    await preserve(); if (!mounted.current) return;
    protectInput();
    const library = await libraryRepository.list(); if (!mounted.current) return;
    // Reading may be slow while the editor remains usable. A late dialog's
    // autofocus must not interrupt a candidate started during either await.
    protectInput();
    const byId = new Map(library.map(item => [item.id, item]));
    setDocuments(library.filter(item => item.kind === 'document' && !item.trash)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .map(item => ({ ...item, location: documentLocation(item, byId) })));
    setOpen(true);
  }, 'The document library could not be read. Download a backup first.');
  return <>
    <Menu editor={editor} capture={capture} label={busy ? 'File…' : 'File'} ariaLabel="File"><DropdownMenuItem disabled={busy} onSelect={() => perform(() => load({ ...blankDocument(), id: crypto.randomUUID() }))}><FilePlus2 />New document</DropdownMenuItem>
    <DropdownMenuItem disabled={busy} onSelect={openLibrary}><FolderOpen />Open local document</DropdownMenuItem>
    <DropdownMenuItem disabled={busy} onSelect={() => file.current?.click()}><Upload />Import document</DropdownMenuItem>
    <DropdownMenuItem onSelect={onLanguage}>Language…</DropdownMenuItem><DropdownMenuSeparator />
    <ExportMenuItems onExport={exportDoc} onPrint={onPrint} busy={exportBusy} /></Menu>
    <span role="status" className="sr-only">{busy ? 'Opening local file…' : ''}</span>
    <DocumentImportInput inputRef={file} disabled={busy} label="Import document file" onFile={selected => void perform(async () => {
      const imported = await readDocumentImport(selected); if (!mounted.current) return;
      await load({ ...imported.document, id: crypto.randomUUID() }, () => notifyDocumentImport(imported));
    }, 'This document could not be read.')} />
    <Dialog open={open} onOpenChange={value => { if (navigation!.getSnapshot() === 'idle') setOpen(value); }}><DialogContent className="vdoc-dialog"><DialogTitle>Documents on this device</DialogTitle><DialogDescription>Your documents stay in this browser. Download backups to keep a separate copy.</DialogDescription><div className="local-documents" aria-busy={busy}>{documents.map(doc => <button key={doc.id} disabled={busy} aria-current={doc.id === documentId ? 'true' : undefined} onClick={() => perform(async () => { await load(doc.id); }, 'This saved document could not be opened.')}><strong>{doc.title || UNTITLED_DOCUMENT}</strong><span>{doc.location}</span><span>{new Date(doc.savedAt).toLocaleString()}{doc.id === documentId ? ' · Current document' : ''}</span></button>)}{!documents.length && <p>No saved documents yet.</p>}</div></DialogContent></Dialog>
  </>;
}
