'use client';
import { restoreEditorFocusAfterMenu } from '@/lib/editor/menu-focus';
import { useInputComposition } from './use-input-composition';
import { PARAGRAPH_BORDER_GROUP_CSS } from '@/lib/editor/paragraph/paragraph-border-groups';
import { ParagraphBordersDialog } from './paragraph-borders-dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { ArrowDownToLine, Check, ChevronRight, CloudOff, FileText, History, Link2, ListTree, Minus, PanelLeftClose, Redo2, RemoveFormatting, Table2, Undo2, X, Quote, Keyboard, CheckCheck } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { DialogFocusReturnProvider, Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster, toast } from 'sonner';
import { createExtensions } from '@/lib/editor/extensions';
import { DocumentEngine } from '@/lib/usecases/engine';
import { registerDocumentTools } from '@/lib/usecases/browser-tools';
import type { OperationResult } from '@/lib/domain/entities/operation';
import { documentStatistics, selectionGraphemeCount } from '@/lib/domain/text/unicode';
import { initialContent } from '@/lib/editor/sample';
import { exportLocalDocument } from './local-export';
import { PrintPreview, type PrintSnapshot } from './print-preview';
import { VersionHistory } from './version-history';
import { ImageDialog, PageDialog, ParagraphDialog } from './document-dialogs';
import { TableHandles } from './table-handles';
import { ParagraphRuler } from './paragraph-ruler';
import { ChecklistDialog } from './checklist-dialog';
import { checklistTargets } from '@/lib/editor/list/checklist';
import { ListStyleDialog } from './list-style-dialog';
import { listStyleTargets } from '@/lib/editor/list/list-style';
import { NumberingDialog } from './numbering-dialog';
import { availableIndentCommand } from '@/lib/editor/list/list-editing';
import { copyTextFormat, canPasteTextFormat } from '@/lib/editor/format/format-copy';
import type { TextFormat } from '@/lib/domain/rules/text-format';
import { canContinueNumbering, canRestartNumbering } from '@/lib/editor/list/list-numbering';
import { FindPanel, TableTools } from './editing-panels';
import { LanguageDialog } from './language-dialog';
import { LibraryHome } from './library-home';
import { LocalDocuments } from './local-documents';
import { BackToDocuments } from './back-to-documents';
import { useDocumentNavigation } from './use-document-navigation';
import { useDocumentAutosave } from './use-document-autosave';
import { useWordExport, WordExportFeedback } from './word-export';
import { documentNavigation } from '@/lib/usecases/document-navigation';
import { InsertTableDialog, EditorToolbar, Menu, type Run } from './toolbar';
import { documents } from '@/lib/composition/repositories';
import { type SavedDocument, UNTITLED_DOCUMENT } from '@/lib/domain/entities/document';
import type { ActiveDocumentRead } from '@/lib/usecases/ports';
import { applyFromDialog } from './apply-from-dialog';

declare global { interface Window { vdoc?: { execute: DocumentEngine['execute']; snapshot: DocumentEngine['snapshot']; undo: () => OperationResult; redo: () => OperationResult }; } }

type Summary = { headings: { id: string; text: string; level: number; pos: number }[]; chars: number; words: number; notes: { number: number; text: string }[] };
const summaryCache = new WeakMap<import('@tiptap/pm/model').Node, Summary>();
function documentSummary(doc: import('@tiptap/pm/model').Node): Summary {
  const cached = summaryCache.get(doc); if (cached) return cached;
  const headings: Summary['headings'] = [];
  const notes: Summary['notes'] = [];
  doc.descendants((node, pos) => { if (node.type.name === 'footnote') notes.push({ number: node.attrs.number, text: node.attrs.text }); if (node.type.name === 'heading') headings.push({ id: node.attrs.blockId || `${pos}`, text: node.textContent || 'Untitled heading', level: node.attrs.level, pos }); });
  const statistics = documentStatistics(doc);
  const result = { headings, notes, chars: statistics.characters, words: statistics.words };
  summaryCache.set(doc, result); return result;
}

function Workspace({ saved, recoveryError, onOpen, onHome }: { saved: SavedDocument | null; recoveryError?: string; onOpen: (document: SavedDocument) => void; onHome: () => void }) {
  const { isComposing, hasComposition, subscribe: subscribeComposition, capture: compositionCapture } = useInputComposition();
  const documentId = useRef(saved?.id || crypto.randomUUID()).current;
  const [title, setTitle] = useState(saved?.title || 'VDoc · Project plan');
  const [saveStatus, setSaveStatus] = useState('Saved locally');
  const [warning, setWarning] = useState(recoveryError || '');
  const [engine, setEngine] = useState<DocumentEngine | null>(null);
  const engineRef = useRef<DocumentEngine | null>(null);
  const formatClipboard = useRef<TextFormat | null>(null);
  const [hasCopiedFormat,setHasCopiedFormat] = useState(false);
  const copyFormatting = useCallback(() => {
    const bus=engineRef.current;if(!bus)return false;
    const format=copyTextFormat(bus.editor);if(!format)return false;
    formatClipboard.current=format;setHasCopiedFormat(true);
    toast.success('Text formatting copied. Select target text, then paste formatting.');return true;
  },[]);
  const pasteFormatting = useCallback((source:'toolbar'|'keyboard'='toolbar') => {
    const bus=engineRef.current,format=formatClipboard.current;
    if(!bus||!format||!canPasteTextFormat(bus.editor))return false;
    const result=bus.execute({source,operations:[{type:'format.apply',format}]});
    if(!result.ok)toast.error(result.error);return result.ok;
  },[]);
  const [, refresh] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [rulerOpen, setRulerOpen] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false), [noteText, setNoteText] = useState('');
  const [tableOpen, setTableOpen] = useState(false);
  const [tablePropertiesRequest, setTablePropertiesRequest] = useState(0);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [listStyleOpen, setListStyleOpen] = useState(false);
  const [numberingOpen, setNumberingOpen] = useState(false);
  const [bordersOpen, setBordersOpen] = useState(false);
  const [paragraphOpen, setParagraphOpen] = useState(false);
  const [printSnapshot, setPrintSnapshot] = useState<PrintSnapshot | null>(null);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false), [pageOpen, setPageOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findRequest, setFindRequest] = useState(0);
  const openFind = useCallback(() => { setFindOpen(true); setFindRequest(request => request + 1); }, []);
  const [spellcheck, setSpellcheck] = useState(true);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('https://');
  const blocked = useRef(Boolean(recoveryError));
  const titleRef = useRef(title); titleRef.current = title;

  const editor = useEditor({
    extensions: createExtensions(op => {
      const bus = engineRef.current;
      if (!bus) return false;
      const result = typeof op === 'string' ? bus.history(op, 'keyboard') : bus.execute({ source: 'keyboard', operations: [op] });
      if (!result.ok && result.code === 'COMPOSING') return false;
      return true;
    }, request => {
      const result = engineRef.current?.execute(request);
      if (result && !result.ok) toast.error(result.error || 'Could not resize the table.');
    }, action => action==='copy'?copyFormatting():pasteFormatting('keyboard')),
    content: (saved?.content || initialContent) as JSONContent,
    immediatelyRender: false, shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'document-editor', spellcheck: 'false', 'aria-label': 'Document body', role: 'textbox', 'aria-multiline': 'true' } },
  });

  const { committing, busy: navigationBusy } = useDocumentNavigation(editor);
  const wordExport = useWordExport(editor, title);

  useEffect(() => {
    if (editor) return documentNavigation(editor).registerCompositionGuard(hasComposition);
  }, [editor, hasComposition]);

  useEffect(() => {
    if (!editor) return;
    const bus = new DocumentEngine(editor); engineRef.current = bus; setEngine(bus);
    let frame = 0;
    const unsubscribe = bus.subscribe(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => refresh(n => n + 1)); });
    const unregister = registerDocumentTools(bus);
    window.vdoc = { execute: input => bus.executeExternal(input), snapshot: () => bus.snapshot(), undo: () => bus.history('undo', 'api'), redo: () => bus.history('redo', 'api') };
    return () => { cancelAnimationFrame(frame); unsubscribe(); unregister(); bus.destroy(); engineRef.current = null; delete window.vdoc; };
  }, [editor]);

  const retrySave = useDocumentAutosave(editor, documentId, title, blocked, (status, message) => {
    setSaveStatus(status); if (message !== undefined) setWarning(message);
  }, { active: hasComposition, subscribe: subscribeComposition });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isComposing(event) || editor?.view.composing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p' && editor) { event.preventDefault(); setPrintSnapshot({title:titleRef.current,html:editor.getHTML(),content:editor.getJSON()}); return; }
      if ((event.metaKey || event.ctrlKey) && ['f', 'h'].includes(event.key.toLowerCase())) { event.preventDefault(); openFind(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [editor, openFind, isComposing]);
  useEffect(() => { if (editor) editor.view.dom.setAttribute('spellcheck', String(spellcheck)); }, [editor, spellcheck]);

  const run: Run = useCallback((operation, label) => {
    const result = engineRef.current?.execute({ source: 'toolbar', label, operations: Array.isArray(operation) ? operation : [operation] });
    if (result && !result.ok) toast.error(result.error);
  }, []);

  if (!editor || !engine) return <div className="loading-editor"><FileText size={28} /><p>Opening document…</p></div>;
  const indentType = availableIndentCommand(editor, 'in');
  const outdentType = availableIndentCommand(editor, 'out');
  const canCopyFormat = copyTextFormat(editor)!==null;
  const canPasteFormat = hasCopiedFormat&&canPasteTextFormat(editor);
  const capture = () => engine.captureSelection();
  const openPrint = () => setPrintSnapshot({title,html:editor.getHTML(),content:editor.getJSON()});
  const openLink = () => { capture(); setHref(editor.getAttributes('link').href || 'https://'); setLinkOpen(true); };
  const exportDoc = async (format: 'json' | 'html' | 'docx' | 'txt') => {
    if (format === 'docx') { await wordExport.request(); return; }
    exportLocalDocument(editor, title, format);
  };
  const { headings, chars, notes, words } = documentSummary(editor.state.doc);
  const documentLanguage = editor.state.doc.attrs.language || 'und';
  const selectionLength = selectionGraphemeCount(editor.state.doc, editor.state.selection);


  return <DialogFocusReturnProvider value={event => { event.preventDefault(); restoreEditorFocusAfterMenu(editor, null); }}><TooltipProvider delayDuration={500}><div className="workspace" {...compositionCapture}>
    <header className="app-header"><BackToDocuments editor={editor} title={title} documentId={documentId} blocked={blocked} onHome={onHome} /><div className="document-heading"><div className="title-line"><input aria-label="Document title" disabled={committing} value={title} maxLength={120} onChange={e => { if (documentNavigation(editor).getSnapshot() !== 'committing') setTitle(e.target.value); }} onKeyDown={e => { if (e.key === "Enter" && !isComposing(e.nativeEvent)) { e.preventDefault(); e.currentTarget.blur(); editor.commands.focus(); } }} onBlur={() => { if (documentNavigation(editor).getSnapshot() !== 'committing') setTitle(title.trim() || "Untitled document"); }} /><span className="save-indicator" title={saveStatus}><CheckCheck size={16} /><span>{saveStatus}</span></span></div>
      <nav aria-label="Document menu" className="menubar">
        <LocalDocuments wordExportBusy={wordExport.busy} editor={editor} title={title} blocked={blocked} documentId={documentId} onOpen={onOpen} capture={capture} exportDoc={exportDoc} onLanguage={() => setLanguageOpen(true)} onPrint={openPrint} />
        <Menu editor={editor} capture={capture} label="Edit"><DropdownMenuItem disabled={!canCopyFormat} onSelect={copyFormatting}>Copy text formatting</DropdownMenuItem><DropdownMenuItem disabled={!canPasteFormat} onSelect={()=>pasteFormatting()}>Paste text formatting</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={openFind}>Find and replace<span className="shortcut">⌘F</span></DropdownMenuItem><DropdownMenuItem disabled={!engine.canUndo} onSelect={() => engine.history('undo')}><Undo2 />Undo<span className="shortcut">⌘Z</span></DropdownMenuItem><DropdownMenuItem disabled={!engine.canRedo} onSelect={() => engine.history('redo')}><Redo2 />Redo<span className="shortcut">⌘⇧Z</span></DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { editor.commands.selectAll(); editor.view.focus(); engine.clearSelectionBookmark(); }}>Select all<span className="shortcut">⌘A</span></DropdownMenuItem></Menu>
        <Menu editor={editor} capture={capture} label="View"><DropdownMenuItem onSelect={() => setRulerOpen(v => !v)}>{rulerOpen ? 'Hide ruler' : 'Show ruler'}</DropdownMenuItem><DropdownMenuItem onSelect={openPrint}>Page preview</DropdownMenuItem><DropdownMenuItem onSelect={() => setStatisticsOpen(true)}>Word count</DropdownMenuItem><DropdownMenuItem onSelect={() => setSpellcheck(value => !value)}>{spellcheck ? "Disable" : "Enable"} spelling check</DropdownMenuItem><DropdownMenuItem onSelect={() => setOutlineOpen(v => !v)}><ListTree />{outlineOpen ? 'Hide document outline' : 'Show document outline'}</DropdownMenuItem><DropdownMenuItem disabled={navigationBusy} onSelect={() => { if (documentNavigation(editor).getSnapshot() === 'idle') setHistoryOpen(v => !v); }}><History />Edit history</DropdownMenuItem><DropdownMenuItem onSelect={() => setShortcutsOpen(true)}><Keyboard />Keyboard shortcuts</DropdownMenuItem></Menu>
        <Menu editor={editor} capture={capture} label="Insert"><DropdownMenuItem onSelect={() => run({ type: 'text.insert', text: '\t' }, 'Insert tab character')}>Tab character</DropdownMenuItem><DropdownMenuItem onSelect={() => { capture(); setNoteText(editor.isActive('footnote') ? editor.getAttributes('footnote').text : ''); setNoteOpen(true); }}>Footnote</DropdownMenuItem><DropdownMenuItem onSelect={() => run({ type: 'block.toc' })}>Table of contents</DropdownMenuItem><DropdownMenuItem onSelect={() => run({ type: 'block.code' })}>Code block</DropdownMenuItem><DropdownMenuItem onSelect={() => { capture(); setImageOpen(true); }}>{editor.isActive("image") ? "Image properties" : "Image from device"}</DropdownMenuItem><DropdownMenuItem onSelect={() => { capture(); setTableOpen(true); }}><Table2 />Table…</DropdownMenuItem><DropdownMenuItem onSelect={openLink}><Link2 />Link</DropdownMenuItem><DropdownMenuItem onSelect={() => run({ type: 'block.pageBreak' })}>Page break</DropdownMenuItem><DropdownMenuItem onSelect={() => run({ type: 'block.rule' }, 'Insert divider')}><Minus />Divider</DropdownMenuItem><DropdownMenuItem onSelect={() => run({ type: 'block.quote' }, 'Blockquote')}><Quote />Blockquote</DropdownMenuItem></Menu>
        <Menu editor={editor} capture={capture} label="Format"><DropdownMenuItem disabled={!editor.isActive('table')} onSelect={() => setTablePropertiesRequest(n => n + 1)}><Table2 />Table properties</DropdownMenuItem><DropdownMenuSeparator />{(['auto','ltr','rtl'] as const).map(direction=><DropdownMenuItem key={direction} onSelect={()=>run({type:'paragraph.style',direction})}>{direction==='auto'?'Automatic paragraph direction':direction==='rtl'?'Right-to-left paragraph':'Left-to-right paragraph'}</DropdownMenuItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setParagraphOpen(true)}>Paragraph layout</DropdownMenuItem><DropdownMenuItem onSelect={() => setBordersOpen(true)}>Paragraph borders…</DropdownMenuItem><DropdownMenuItem onSelect={() => setPageOpen(true)}>Page setup</DropdownMenuItem><DropdownMenuItem onSelect={() => run({ type: 'list.toggle', kind: 'task' })}>Checklist</DropdownMenuItem><DropdownMenuItem disabled={!checklistTargets(editor.state.doc,editor.state.selection).length} onSelect={() => setChecklistOpen(true)}>Checklist options…</DropdownMenuItem><DropdownMenuItem disabled={!listStyleTargets(editor.state.doc,editor.state.selection).length} onSelect={() => setListStyleOpen(true)}>List style…</DropdownMenuItem><DropdownMenuItem disabled={!canRestartNumbering(editor.state.doc,editor.state.selection)} onSelect={() => setNumberingOpen(true)}>Restart numbering…</DropdownMenuItem><DropdownMenuItem disabled={!canContinueNumbering(editor.state.doc,editor.state.selection)} onSelect={() => run({ type: 'list.continue' })}>Continue previous numbering</DropdownMenuItem><DropdownMenuItem disabled={!indentType} onSelect={() => { if (indentType) run({type:indentType,direction:'in'}); }}>Increase indent</DropdownMenuItem><DropdownMenuItem disabled={!outdentType} onSelect={() => { if (outdentType) run({type:outdentType,direction:'out'}); }}>Decrease indent</DropdownMenuItem><DropdownMenuItem onSelect={() => run({ type: 'text.toggle', mark: 'superscript' }, 'Superscript')}>Superscript</DropdownMenuItem><DropdownMenuItem onSelect={() => run({ type: 'text.toggle', mark: 'subscript' }, 'Subscript')}>Subscript</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => run({ type: 'text.clear' }, 'Clear formatting')}><RemoveFormatting />Clear formatting</DropdownMenuItem></Menu>
      </nav></div><div className="header-actions"><button disabled={navigationBusy} aria-label="Edit history" title="Edit history" className={`quiet-button ${historyOpen ? 'selected' : ''}`} onClick={() => { if (documentNavigation(editor).getSnapshot() === 'idle') setHistoryOpen(v => !v); }}><History size={20} /></button><span className="local-badge"><span />Local workspace</span><button className="export-button" onClick={() => exportDoc('html')}><ArrowDownToLine size={16} />Export</button><div className="avatar" aria-label="Local user">V</div></div></header>
    <EditorToolbar formatting={{copy:copyFormatting,paste:()=>pasteFormatting(),canCopy:canCopyFormat,canPaste:canPasteFormat}} onPrint={openPrint} editor={editor} engine={engine} run={run} zoom={zoom} setZoom={setZoom} link={openLink} insertTable={()=>{capture();setTableOpen(true);}} />
    <InsertTableDialog engine={engine} open={tableOpen} close={()=>setTableOpen(false)} />
    {findOpen && <FindPanel editor={editor} engine={engine} zoom={zoom} focusRequest={findRequest} close={() => setFindOpen(false)} />}
    <WordExportFeedback state={wordExport} />
    {warning && <div className="warning-banner" role="alert"><CloudOff size={16} />{warning}{!blocked.current && <button disabled={navigationBusy || saveStatus !== 'Save failed. Download a backup.'} onClick={retrySave}>Retry save</button>}<button onClick={() => exportDoc('json')}>Download backup</button></div>}
    <div className="work-area">
      {outlineOpen && <aside className="document-outline" aria-label="Document outline"><div className="outline-heading"><span>Document outline</span><button className="quiet-button" aria-label="Collapse outline" onClick={() => setOutlineOpen(false)}><PanelLeftClose size={16} /></button></div><div className="outline-document"><FileText size={16} /><span>{title || UNTITLED_DOCUMENT}</span></div><div className="outline-links">{headings.map(h => <button key={h.id} className={`outline-item level-${h.level} ${editor.state.selection.from >= h.pos && editor.state.selection.from <= h.pos + h.text.length + 2 ? 'current' : ''}`} onClick={() => { editor.commands.setTextSelection(h.pos + 1); engine.clearSelectionBookmark(); editor.view.focus(); editor.view.dom.querySelector(`[data-block-id="${h.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>{h.text}</button>)}</div><div className="outline-footer"><span className="brand-word">vdoc<span>.</span></span><span>A little room to think.</span></div></aside>}
      <main className="canvas-scroll" aria-label="Document canvas"><div className="canvas-topline"><button className="breadcrumb" onClick={() => setOutlineOpen(v => !v)}><ListTree size={15} />Document<ChevronRight size={13} /><span>{title || UNTITLED_DOCUMENT}</span></button><span className="editing-label"><span />{committing ? 'Opening document…' : 'Editing'}</span></div><div className="paper-wrap" style={{ zoom: zoom / 100, width: editor.state.doc.attrs.orientation === 'landscape' ? '1120px' : '794px' }}>{rulerOpen && <ParagraphRuler editor={editor} engine={engine} zoom={zoom} />}<div className="paper" lang={documentLanguage === 'und' ? '' : documentLanguage} style={{ background: editor.state.doc.attrs.pageColor }}>{editor.state.doc.attrs.header && <div className="print-header">{editor.state.doc.attrs.header}</div>}<style>{PARAGRAPH_BORDER_GROUP_CSS}</style><EditorContent editor={editor} />{editor.state.doc.attrs.footer && <div className="print-footer">{editor.state.doc.attrs.footer}</div>}{notes.length > 0 && <section className="document-notes" aria-label="Footnotes">{notes.map(note => <p key={note.number}><sup>{note.number}</sup> {note.text}</p>)}</section>}<div className="paper-bottom" aria-hidden="true"><span>VDOC</span><span>Write freely. Think clearly.</span></div></div><p className="canvas-note"><Check size={13} />{blocked.current || warning ? saveStatus : "Changes are saved automatically in this browser"}</p></div></main>
      {historyOpen && <aside className="history-panel"><div className="outline-heading"><span>Edit history</span><button className="quiet-button" aria-label="Close edit history" disabled={navigationBusy} onClick={() => { if (documentNavigation(editor).getSnapshot() === 'idle') setHistoryOpen(false); }}><X size={16} /></button></div><VersionHistory editor={editor} title={title} documentId={documentId} blocked={blocked} onOpen={onOpen} /><p className="panel-description">Formatting and structure changes in this session</p>{engine.records.length ? engine.records.map(record => <div className="history-item" key={record.id}><div className="history-mark"><Check size={12} /></div><div><strong>{record.label}</strong><span>{new Date(record.time).toLocaleTimeString('en-US', { hour12: false })} · {record.source === 'toolbar' ? 'Toolbar' : record.source === 'keyboard' ? 'Shortcuts' : 'API'}</span></div></div>) : <div className="history-empty"><History size={26} /><p>Start with an edit</p><span>Format text or insert a table.<br />Your changes will appear here.</span></div>}</aside>}
    </div>
    <TableHandles editor={editor} engine={engine} />
    <TableTools editor={editor} engine={engine} run={run} propertiesRequest={tablePropertiesRequest} />
    <footer className="statusbar"><div><button aria-label="Toggle outline" onClick={() => setOutlineOpen(v => !v)}><ListTree size={15} /></button><span>{chars.toLocaleString("en-US")} characters</span>{selectionLength > 0 && <span>{selectionLength} characters selected</span>}</div><div><span className="local-status">{saveStatus}</span><span className="status-divider" /><button onClick={() => setShortcutsOpen(true)}><Keyboard size={14} />Shortcuts</button><span>{zoom}%</span></div></footer>
    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent className="vdoc-dialog"><DialogTitle>Insert link</DialogTitle><DialogDescription>Add a web or email address to the selected text.</DialogDescription><form onSubmit={e => { e.preventDefault(); applyFromDialog(engine, [{ type: 'link.set', href }], () => setLinkOpen(false), 'Insert link'); }}><label htmlFor="link-url">Link address</label><input id="link-url" autoFocus value={href} onChange={e => setHref(e.target.value)} /><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { run({ type: 'link.unset' }, 'Remove link'); setLinkOpen(false); }}>Remove link</button><button className="export-button" type="submit">Apply link</button></div></form></DialogContent></Dialog>
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}><DialogContent className="vdoc-dialog"><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>On Windows and Linux, use Ctrl instead of ⌘ and Alt instead of ⌥.</DialogDescription><div className="shortcut-list">{[['Tab in body text', 'Tab'], ['Tab in a list or table', 'Insert → Tab character'], ['Increase indent', '⌘ ]'], ['Decrease indent', '⌘ ['], ['List level (outside tables)', 'Tab / ⇧ Tab'], ['Table cell navigation', 'Tab / ⇧ Tab'], ['Copy text formatting', '⌘ ⌥ C'], ['Paste text formatting', '⌘ ⌥ V'], ['Bold', '⌘ B'], ['Italic', '⌘ I'], ['Underline', '⌘ U'], ['Undo', '⌘ Z'], ['Redo', '⌘ ⇧ Z'], ['Heading 1 / 2 / 3', '⌘ ⌥ 1 / 2 / 3'], ['Numbered list', '⌘ ⇧ 7'], ['Bulleted list', '⌘ ⇧ 8']].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div></DialogContent></Dialog>
    <Dialog open={noteOpen} onOpenChange={setNoteOpen}><DialogContent className="vdoc-dialog"><DialogTitle>Insert footnote</DialogTitle><DialogDescription>References are numbered in document order. Notes appear at the end of the continuous canvas and export as Word footnotes.</DialogDescription><form onSubmit={e => { e.preventDefault(); applyFromDialog(engine, [{ type: editor.isActive('footnote') ? 'footnote.update' : 'footnote.insert', text: noteText }], () => setNoteOpen(false)); }}><textarea aria-label="Footnote text" value={noteText} maxLength={5000} required onChange={e => setNoteText(e.target.value)} /><button className="export-button" type="submit">Insert footnote</button></form></DialogContent></Dialog>
    <Dialog open={statisticsOpen} onOpenChange={setStatisticsOpen}><DialogContent className="vdoc-dialog"><DialogTitle>Word count</DialogTitle><DialogDescription>Counts cover the document body. Characters count visible text clusters; words use browser Unicode segmentation. Results may vary by browser.</DialogDescription><p>{words.toLocaleString('en-US')} words · {chars.toLocaleString('en-US')} characters without spaces</p><p>{selectionLength.toLocaleString('en-US')} characters selected</p></DialogContent></Dialog>

    {printSnapshot && <PrintPreview snapshot={printSnapshot} close={() => setPrintSnapshot(null)} />}
    <LanguageDialog open={languageOpen} close={() => setLanguageOpen(false)} engine={engine} />
    <ImageDialog open={imageOpen} close={() => setImageOpen(false)} editor={editor} engine={engine} />
    <ChecklistDialog open={checklistOpen} close={() => setChecklistOpen(false)} editor={editor} engine={engine} />
    <ListStyleDialog open={listStyleOpen} close={() => setListStyleOpen(false)} editor={editor} engine={engine} />
    <NumberingDialog open={numberingOpen} close={() => setNumberingOpen(false)} editor={editor} engine={engine} />
    <ParagraphBordersDialog open={bordersOpen} close={() => setBordersOpen(false)} editor={editor} engine={engine} />
    <ParagraphDialog open={paragraphOpen} close={() => setParagraphOpen(false)} editor={editor} engine={engine} />
    <PageDialog open={pageOpen} close={() => setPageOpen(false)} editor={editor} engine={engine} />
    <style>{`@media print { @page { size: ${editor.state.doc.attrs.pageSize === 'letter' ? 'letter' : 'A4'} ${editor.state.doc.attrs.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: ${Number(editor.state.doc.attrs.pageMargin) || 20}mm; } .print-header { top: -${Math.max(0, Math.min(12, (Number(editor.state.doc.attrs.pageMargin) || 20) - 3))}mm; } .print-footer { bottom: -${Math.max(0, Math.min(12, (Number(editor.state.doc.attrs.pageMargin) || 20) - 3))}mm; } }`}</style>
  </div></TooltipProvider></DialogFocusReturnProvider>;
}

export default function VdocWorkspace() {
  const [loaded, setLoaded] = useState<ActiveDocumentRead | null>(null);
  const [home, setHome] = useState(true);
  // A save timestamp is metadata, not a unique editor-session identity. Every
  // successful open/restore must discard the previous editor and undo history.
  const [documentSession, setDocumentSession] = useState(0);
  useEffect(() => {
    let live = true;
    const hash = window.location.hash;
    const requestedId = new URLSearchParams(hash.slice(1)).get('document');
    void documents.readActive(requestedId ?? undefined).then(value => {
      if (!live) return;
      setLoaded(value);
      if (requestedId && value.data?.id === requestedId && window.location.hash === hash) setHome(false);
    });
    return () => { live = false; };
  }, []);
  if (!loaded) return <div className="loading-editor"><FileText size={28} /><p>Opening workspace…</p></div>;
  const open = (data: SavedDocument) => { setLoaded({ data }); setDocumentSession(session => session + 1); setHome(false); window.history.replaceState(null, "", `#document=${data.id}`); };
  return <>{home ? <LibraryHome recoveryError={loaded.error} onOpen={open} /> : <Workspace key={documentSession} saved={loaded.data} recoveryError={loaded.error} onOpen={open} onHome={() => { window.history.replaceState(null, "", window.location.pathname + window.location.search); setHome(true); }} />}<Toaster position="bottom-right" richColors /></>;
}
