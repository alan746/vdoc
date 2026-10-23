'use client';
import { useEffect, useRef, useState } from 'react';
import { FileText, Folder, FolderPlus, Plus, Search, Star, Trash2, LayoutGrid, List, MoreHorizontal, ArrowUpRight, Upload, ChevronRight, HardDrive, Clock3, X } from 'lucide-react';
import { toast } from 'sonner';
import { actionErrorMessage } from '@/lib/shared/error-message';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { readDocumentImport } from '@/lib/composition/import-file';
import { notifyDocumentImport } from './import-feedback';
import { documents, library } from '@/lib/composition/repositories';
import { type LibraryItem, type SavedDocument, blankDocument } from '@/lib/domain/entities/document';
import { useMounted } from './use-mounted';
import { DocumentImportInput } from './document-import-input';

type Scope = 'files' | 'recent' | 'starred' | 'trash';
type LibraryPreferences = { scope: Scope; parentId: string | null; query: string; sort: string; view: 'grid' | 'list' };
const defaultPreferences: LibraryPreferences = { scope: 'files', parentId: null, query: '', sort: 'modified', view: 'grid' };
function readPreferences(): LibraryPreferences {
  try { const value = JSON.parse(sessionStorage.getItem('vdoc.library.view') || 'null');
    return value && ['files','recent','starred','trash'].includes(value.scope) && ['modified','name','oldest'].includes(value.sort) && ['grid','list'].includes(value.view) && typeof value.query === 'string' && (value.parentId === null || typeof value.parentId === 'string') ? value : defaultPreferences;
  } catch { return defaultPreferences; }
}
type Action = { kind: 'folder' } | { kind: 'rename' | 'move'; item: LibraryItem };
export function LibraryHome({ onOpen, recoveryError }: { onOpen: (document: SavedDocument) => void; recoveryError?: string }) {
  const [preferences] = useState(readPreferences);
  const [items, setItems] = useState<LibraryItem[]>([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [actionError, setActionError] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const libraryUnavailable = useRef(true);
  const mounted = useMounted();
  const [scope, setScope] = useState<Scope>(preferences.scope), [parentId, setParentId] = useState<string | null>(preferences.parentId);
  const [query, setQuery] = useState(preferences.query), [sort, setSort] = useState(preferences.sort), [view, setView] = useState<'grid' | 'list'>(preferences.view);
  const [action, setAction] = useState<Action | null>(null), [name, setName] = useState(''), [destination, setDestination] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryItem | null>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  useEffect(() => { try { sessionStorage.setItem('vdoc.library.view', JSON.stringify({ scope, parentId, query, sort, view })); } catch { /* Navigation remains usable without preferences. */ } }, [scope, parentId, query, sort, view]);
  useEffect(() => { if (!loading && !error && parentId && !items.some(item => item.id === parentId && item.kind === 'folder' && !item.trash)) setParentId(null); }, [items, loading, error, parentId]);
  const refresh = async () => { const next = await library.list(); if (mounted.current) { libraryUnavailable.current = false; setItems(next); setError(''); } };
  useEffect(() => { let live = true; library.list().then(data => { if (live) { libraryUnavailable.current = false; setItems(data); setLoading(false); } }).catch(() => { if (live) { libraryUnavailable.current = true; setError('Your local library could not be opened. Retry loading to try again.'); setLoading(false); } }); return () => { live = false; }; }, []);
  // Retrying the list must never replay a mutation that already committed.
  const retryLibrary = async () => {
    if (!mounted.current || pending.current) return;
    pending.current = true; setBusy(true);
    try { await refresh(); if (mounted.current) setActionError(''); }
    catch { /* Keep the original explanation and allow another read attempt. */ }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const perform = async (work: () => Promise<void>) => {
    if (!mounted.current || pending.current || libraryUnavailable.current) return;
    pending.current = true; setBusy(true); setActionError('');
    try {
      await work();
      if (mounted.current) {
        try { await refresh(); }
        catch { if (mounted.current) { libraryUnavailable.current = true; setError('Your change was saved, but the file list could not be refreshed. Retry loading to see the latest files.'); } }
      }
    } catch (e) { if (mounted.current) { const message = actionErrorMessage(e, 'This action could not be completed.'); setActionError(message); toast.error(message, { duration: 8000 }); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const navigate = (next: Scope, folder: string | null = null) => { setScope(next); setParentId(folder); setQuery(''); };
  const openItem = (item: LibraryItem) => { if (item.kind === 'folder') navigate('files', item.id); else void perform(async () => {
    const document = await documents.select(item.id);
    if (mounted.current) onOpen(document);
  }); };
  const createDocument = () => perform(async () => {
    const document = await library.createDocument(blankDocument(), scope === 'files' ? parentId : null);
    if (mounted.current) onOpen(document);
  });
  const breadcrumbs: LibraryItem[] = [];
  let ancestor = parentId;
  const seen = new Set<string>();
  while (ancestor && !seen.has(ancestor)) { seen.add(ancestor); const folder = items.find(item => item.id === ancestor); if (!folder) break; breadcrumbs.unshift(folder); ancestor = folder.parentId; }
  const folderPath = (item: LibraryItem | undefined) => {
    if (!item) return 'Workspace';
    const names: string[] = [item.title]; let current = item.parentId; const visited = new Set([item.id]);
    while (current && !visited.has(current)) { visited.add(current); const folder = items.find(entry => entry.id === current); if (!folder) break; names.unshift(folder.title); current = folder.parentId; }
    return names.join(' / ');
  };
  const childCount = (id: string) => items.filter(child => child.parentId === id && !child.trash).length;
  const normalized = query.trim().normalize('NFC').toLocaleLowerCase();
  const visible = items.filter(item => {
    if (Boolean(item.trash) !== (scope === 'trash')) return false;
    if (normalized) return item.title.normalize('NFC').toLocaleLowerCase().includes(normalized) && (scope !== 'starred' || item.starred) && (scope !== 'recent' || item.kind === 'document');
    if (scope === 'files') return item.parentId === parentId;
    if (scope === 'starred') return item.starred;
    if (scope === 'recent') return item.kind === 'document';
    return true;
  }).sort((a, b) => {
    if (scope === 'files' && a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return sort === 'name' ? a.title.localeCompare(b.title, undefined, { numeric: true }) : sort === 'oldest' ? a.savedAt.localeCompare(b.savedAt) : b.savedAt.localeCompare(a.savedAt);
  });
  const canMoveTo = (folder: LibraryItem) => {
    if (folder.kind !== 'folder' || folder.trash || action?.kind !== 'move') return false;
    let cursor: string | null = folder.id; const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) { if (cursor === action.item.id) return false; visited.add(cursor); cursor = items.find(item => item.id === cursor)?.parentId || null; }
    return true;
  };
  const heading = normalized ? 'Search results' : scope === 'files' ? breadcrumbs.at(-1)?.title || 'Your documents' : scope === 'recent' ? 'Recent documents' : scope === 'starred' ? 'Starred' : 'Trash';
  const libraryMessage = error || (action ? '' : actionError) || recoveryError;
  return <div className="library-shell">
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the brand link intentionally reloads to a clean library state */}
    <aside className="library-sidebar"><a className="library-brand" href="/" aria-label="VDoc home">vdoc<span>.</span></a><span className="library-eyebrow">PERSONAL WORKSPACE</span>
      <button className="library-create" title="New document" onClick={createDocument} disabled={busy || loading || Boolean(error)}><Plus size={18} />New document</button>
      <nav aria-label="Library navigation">{([['files', Folder, 'All files'], ['recent', Clock3, 'Recent'], ['starred', Star, 'Starred'], ['trash', Trash2, 'Trash']] as const).map(([key, Icon, label]) => <button key={key} title={label} aria-current={scope === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon size={18} />{label}{key === 'files' && <span>{items.filter(item => item.kind === 'document' && !item.trash).length}</span>}</button>)}</nav>
      <div className="library-storage"><HardDrive size={19} /><strong>Stored on this device</strong><p>Your files stay in this browser.<br />Export backups to keep a separate copy.</p><span className="library-storage-dot" />Local workspace</div>
    </aside>
    <main className="library-main"><header className="library-topbar"><div className="library-search"><Search size={18} /><input aria-label="Search documents and folders" placeholder="Search your documents and folders" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>}</div><span className="library-person" aria-label="Personal workspace">V</span></header>
      <div className="library-content">{libraryMessage && <div role="alert" className="library-error"><span>{libraryMessage}</span>{error && <button type="button" className="secondary-button" disabled={busy} onClick={() => void retryLibrary()}>Retry loading</button>}</div>}
        <section className="library-intro"><div><span className="library-eyebrow">A LITTLE ROOM TO THINK</span><h1>Your next idea<br /><em>starts here.</em></h1><p>A quiet place for your words, plans, and everything in between.</p></div><button className="library-blank" disabled={busy || loading || Boolean(error)} onClick={createDocument}><span className="blank-paper"><Plus size={26} /><i /><i /><i /></span><strong>Blank document <ArrowUpRight size={16} /></strong></button></section>
        <section aria-label="Document library"><div className="library-section-heading"><div><nav aria-label="Folder path" className="library-breadcrumb"><button onClick={() => navigate('files')}>Workspace</button>{breadcrumbs.map(folder => <span key={folder.id}><ChevronRight size={12} /><button onClick={() => navigate('files', folder.id)}>{folder.title}</button></span>)}</nav><h2>{heading}</h2></div><div className="library-section-actions"><button className="secondary-button" disabled={busy || loading || scope === 'trash' || Boolean(error)} onClick={() => { setActionError(''); setName(''); setAction({ kind: 'folder' }); }}><FolderPlus size={16} />New folder</button><button className="secondary-button" disabled={busy || loading || Boolean(error)} onClick={() => file.current?.click()}><Upload size={16} />Import</button></div></div>
          <div className="library-filterbar"><span aria-live="polite">{loading ? 'Loading…' : `${visible.length} ${visible.length === 1 ? 'item' : 'items'}`}{normalized && ' · searching across folders'}</span><div><select aria-label="Sort files" value={sort} onChange={e => setSort(e.target.value)}><option value="modified">Last modified</option><option value="name">Name A–Z</option><option value="oldest">Oldest first</option></select><div className="library-view"><button aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={16} /></button><button aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={17} /></button></div></div></div>
          {scope === 'trash' && <p className="library-trash-note">Items in Trash stay on this device until you restore them or permanently delete a document. Nothing is deleted automatically.</p>}
          {!loading && !error && !visible.length && <div className="library-empty"><Folder size={34} /><h3>{normalized ? 'No matching files' : scope === 'trash' ? 'Trash is empty' : scope === 'starred' ? 'Keep your favorites close' : 'Room for something new'}</h3><p>{normalized ? 'Try a different name or clear your search.' : scope === 'starred' ? 'Use a file’s menu to add it to Starred.' : scope === 'trash' ? 'Files moved to Trash will appear here.' : 'Create a document or a folder to get started.'}</p></div>}
          <div className={`library-items ${view}`} aria-label="Files">{visible.map(item => <article className={`library-item ${item.kind}`} key={item.id}>
            <button className="library-item-open" disabled={busy || Boolean(error) || Boolean(item.trash)} onClick={() => openItem(item)} aria-label={`Open ${item.kind}: ${item.title}`}><span className="library-item-art">{item.kind === 'folder' ? <Folder size={34} strokeWidth={1.4} /> : <FileText size={32} strokeWidth={1.3} />}</span><span className="library-item-info"><strong title={item.title}>{item.title}</strong><span title={item.kind === 'document' ? new Date(item.savedAt).toLocaleString('en-US') : undefined}>{item.kind === 'folder' ? `${childCount(item.id)} ${childCount(item.id) === 1 ? 'item' : 'items'}` : new Date(item.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{normalized && ` · ${item.parentId ? folderPath(items.find(folder => folder.id === item.parentId)!) : 'Workspace'}`}</span></span>{item.starred && <Star className="library-star" size={14} fill="currentColor" aria-label="Starred" />}</button>
            <DropdownMenu><DropdownMenuTrigger asChild><button className="library-item-menu" disabled={busy || Boolean(error)} aria-label={`Actions for ${item.title}`}><MoreHorizontal size={19} /></button></DropdownMenuTrigger><DropdownMenuContent className="vdoc-menu" align="end">{item.trash ? <><DropdownMenuItem onSelect={() => void perform(async () => { await library.update(item.id, { trash: false }); toast.success('Restored from Trash'); })}>Restore</DropdownMenuItem>{item.kind === 'document' && <DropdownMenuItem onSelect={() => { setActionError(''); setDeleteTarget(item); }}>Delete permanently</DropdownMenuItem>}</> : <>
              <DropdownMenuItem onSelect={() => openItem(item)}>Open</DropdownMenuItem><DropdownMenuItem onSelect={() => { setActionError(''); setName(item.title); setAction({ kind: 'rename', item }); }}>Rename</DropdownMenuItem><DropdownMenuItem onSelect={() => { setActionError(''); setDestination(item.parentId || ''); setAction({ kind: 'move', item }); }}>Move to folder</DropdownMenuItem>{item.kind === 'document' && <DropdownMenuItem onSelect={() => void perform(async () => { await library.copy(item.id); toast.success('Copy created'); })}>Make a copy</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => void perform(async () => { await library.update(item.id, { starred: !item.starred }); })}>{item.starred ? 'Remove from Starred' : 'Add to Starred'}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void perform(async () => { const moved = await library.update(item.id, { trash: true }); if (!mounted.current) return; const group = moved.trash?.group; toast.success('Moved to Trash', { duration: 8000, action: group ? { label: 'Undo', onClick: () => void perform(async () => { await library.update(item.id, { trash: false, expectedTrashGroup: group }); }) } : undefined }); })}>Move to Trash</DropdownMenuItem>
            </>}</DropdownMenuContent></DropdownMenu>
          </article>)}</div>
        </section><footer className="library-footer"><span>VDOC / YOUR WORDS, YOUR SPACE</span><span>Made for a little more clarity.</span></footer>
      </div>
    </main>
    <Dialog open={Boolean(action)} onOpenChange={open => { if (!open && !busy) setAction(null); }}><DialogContent className="vdoc-dialog"><DialogTitle>{action?.kind === 'folder' ? 'New folder' : action?.kind === 'rename' ? 'Rename' : 'Move to folder'}</DialogTitle><DialogDescription>{action?.kind === 'move' ? 'Choose a destination in your local workspace.' : 'Give it a name that is easy to find later.'}</DialogDescription>{actionError && <p role="alert" className="library-error">{actionError}</p>}<form onSubmit={e => { e.preventDefault(); void perform(async () => { if (action?.kind === 'folder') await library.createFolder(name, scope === 'files' ? parentId : null); else if (action?.kind === 'rename') await library.update(action.item.id, { title: name }); else if (action?.kind === 'move') await library.update(action.item.id, { parentId: destination || null }); setAction(null); }); }}>
      {action?.kind === 'move' ? <select aria-label="Destination folder" value={destination} onChange={e => setDestination(e.target.value)}><option value="">Workspace</option>{items.filter(canMoveTo).map(folder => <option value={folder.id} key={folder.id}>{folderPath(folder)}</option>)}</select> : <input aria-label={action?.kind === 'folder' ? 'Folder name' : 'New name'} autoFocus required maxLength={120} value={name} onChange={e => setName(e.target.value)} />}
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setAction(null)}>Cancel</button><button type="submit" className="export-button" disabled={busy || (action?.kind !== 'move' && !name.trim())}>{action?.kind === 'folder' ? 'Create folder' : action?.kind === 'move' ? 'Move here' : 'Save name'}</button></div></form></DialogContent></Dialog>
    <Dialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open && !busy) setDeleteTarget(null); }}><DialogContent className="vdoc-dialog" onOpenAutoFocus={event => { event.preventDefault(); cancelDelete.current?.focus(); }}><DialogTitle>Delete document permanently?</DialogTitle><DialogDescription>“{deleteTarget?.title}” and all its saved versions will be removed from this browser. This cannot be undone. Keep an exported backup if you need this document later.</DialogDescription>{actionError && <p role="alert" className="library-error">{actionError}</p>}<div className="dialog-actions"><button ref={cancelDelete} type="button" className="secondary-button" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="export-button" disabled={busy} onClick={() => { const target = deleteTarget; const trash = target?.trash; if (!target || !trash) return; void perform(async () => { await library.deleteTrashed(target.id, trash); if (!mounted.current) return; setDeleteTarget(null); toast.success('Document permanently deleted'); }); }}>Delete permanently</button></div></DialogContent></Dialog>
    <DocumentImportInput inputRef={file} disabled={busy || loading || Boolean(error)} label="Import file into library" onFile={selected => void perform(async () => {
      const imported = await readDocumentImport(selected); if (!mounted.current) return;
      const active = await library.createDocument(imported.document, scope === 'files' ? parentId : null); if (!mounted.current) return;
      onOpen(active); notifyDocumentImport(imported);
    })} />
  </div>;
}
