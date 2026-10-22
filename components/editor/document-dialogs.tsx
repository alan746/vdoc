'use client';
import { selectedParagraphBackground, type ParagraphBackground } from '@/lib/editor/paragraph/paragraph-background';
import { ParagraphBackgroundFields } from './paragraph-background-fields';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { paragraphPropertyOperation, type ParagraphProperties } from '@/lib/editor/paragraph/paragraph-properties';
import { selectedPagination, paginationOperation, paginationKeys, type PaginationValues } from '@/lib/editor/paragraph/paragraph-pagination';
import { selectedIndent, indentOperation, type IndentValues } from '@/lib/editor/paragraph/paragraph-indent';
import { selectedParagraphs } from '@/lib/editor/paragraph/paragraph-selection';
import { selectedTabInterval } from '@/lib/editor/paragraph/paragraph-tabs';
import { IndentFields } from './indent-fields';

export function ImageDialog({ open, close, editor, engine }: { open: boolean; close: () => void; editor: Editor; engine: DocumentEngine }) {
  const [src, setSrc] = useState(''), [alt, setAlt] = useState(''), [width, setWidth] = useState(320), [loading, setLoading] = useState(false);
  const reader = useRef<FileReader | null>(null), generation = useRef(0), altEdited = useRef(false);
  const cancelRead = useCallback(() => { generation.current++; const pending = reader.current; reader.current = null; pending?.abort(); }, []);
  const editing = editor.isActive('image');
  useEffect(() => {
    if (open) { setSrc(''); setLoading(false); altEdited.current = false; setAlt(editor.getAttributes('image').alt || ''); setWidth(editor.getAttributes('image').width || 320); }
    return cancelRead;
  }, [open, editor, cancelRead]);
  const closeDialog = () => { cancelRead(); setLoading(false); close(); };
  const chooseImage = async (file: File) => {
    cancelRead(); setSrc(''); setLoading(false);
    if (file.size > 2_000_000 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { toast.error('Choose a supported image smaller than 2 MB.'); return; }
    const token = generation.current;
    setLoading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const pending = new FileReader(); reader.current = pending;
        pending.onload = () => resolve(String(pending.result)); pending.onerror = reject;
        pending.onabort = () => reject(new Error('Image reading was cancelled.'));
        pending.readAsDataURL(file);
      });
      if (token !== generation.current) return;
      setSrc(data); if (!altEdited.current) setAlt(file.name);
    } catch { if (token === generation.current) toast.error('The image could not be read.'); }
    finally { if (token === generation.current) { reader.current = null; setLoading(false); } }
  };
  return <Dialog open={open} onOpenChange={value => { if (!value) closeDialog(); }}><DialogContent className="vdoc-dialog"><DialogTitle>{editing ? 'Image properties' : 'Insert image'}</DialogTitle><DialogDescription>Images are embedded in your local document. PNG, JPEG, GIF and WebP up to 2 MB.</DialogDescription><form className="properties-form" onSubmit={e => { e.preventDefault(); if (reader.current || loading || (!editing && !src)) return; const result = engine.execute({ source: 'toolbar', operations: [src ? { type: 'image.insert', src, alt, width } : { type: 'image.update', alt, width }] }); if (result.ok) closeDialog(); else toast.error(result.error); }}>
    {!editing && <label className="wide-field">Choose image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void chooseImage(file); }} /></label>}
    <label className="wide-field">Alternative text<input value={alt} maxLength={500} onChange={e => { altEdited.current = true; setAlt(e.target.value); }} /></label><label>Width (px)<input type="number" min="40" max="1200" value={width} onChange={e => setWidth(+e.target.value)} /></label>{src && <img className="image-preview" src={src} alt={alt} />}<button className="export-button" type="submit" disabled={loading || (!editing && !src)}>{editing ? 'Apply' : 'Insert image'}</button>
  </form></DialogContent></Dialog>;
}

export function PageDialog({ open, close, editor, engine }: { open: boolean; close: () => void; editor: Editor; engine: DocumentEngine }) {
  const [header, setHeader] = useState(''), [footer, setFooter] = useState(''), [pageNumbers, setPageNumbers] = useState(false);
  const [size, setSize] = useState<'a4' | 'letter'>('a4'), [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait'), [margin, setMargin] = useState(20), [color, setColor] = useState('#FFFFFF');
  useEffect(() => { if (open) { const a = editor.state.doc.attrs; setSize(a.pageSize); setOrientation(a.orientation); setMargin(a.pageMargin); setColor(a.pageColor); setHeader(a.header || ''); setFooter(a.footer || ''); setPageNumbers(Boolean(a.pageNumbers)); } }, [open, editor]);
  return <Dialog open={open} onOpenChange={v => { if (!v) close(); }}><DialogContent className="vdoc-dialog"><DialogTitle>Page setup</DialogTitle><DialogDescription>Set paper size and margins for Page preview and printing. The editor uses a continuous canvas.</DialogDescription><form className="properties-form" onSubmit={e => { e.preventDefault(); const result = engine.execute({ source: 'toolbar', operations: [{ type: 'document.layout', pageSize: size, orientation, pageMargin: margin, pageColor: color, header, footer, pageNumbers }] }); if (result.ok) close(); else toast.error(result.error); }}><label>Paper size<select value={size} onChange={e => setSize(e.target.value as typeof size)}><option value="a4">A4</option><option value="letter">Letter</option></select></label><label>Orientation<select value={orientation} onChange={e => setOrientation(e.target.value as typeof orientation)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label>Margins (mm)<input type="number" min="5" max="50" value={margin} onChange={e => setMargin(+e.target.value)} /></label><label>Page color<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label><label className="wide-field">Header<input value={header} maxLength={500} onChange={e => setHeader(e.target.value)} /></label><label className="wide-field">Footer<input value={footer} maxLength={500} onChange={e => setFooter(e.target.value)} /></label><label className="wide-field"><input type="checkbox" checked={pageNumbers} onChange={e => setPageNumbers(e.target.checked)} />Page numbers in preview and Word</label><button className="export-button" type="submit">Apply</button></form></DialogContent></Dialog>;
}

export function ParagraphDialog({ open, close, editor, engine }: { open: boolean; close: () => void; editor: Editor; engine: DocumentEngine }) {
  const initialBackground = useRef<ParagraphBackground>(null);
  const [background, setBackground] = useState<ParagraphBackground>(null);
  const initial = useRef<ParagraphProperties>({spaceBefore:0,spaceAfter:10,indent:0});
  const [before, setBefore] = useState(0), [after, setAfter] = useState(10), [indent, setIndent] = useState(0);
  const initialPagination = useRef<PaginationValues>({keepWithNext:false,keepLinesTogether:false,preventSingleLines:true});
  const [pagination,setPagination] = useState<PaginationValues>(initialPagination.current);
  const initialTab = useRef<number | null>(48);
  const [tabInterval, setTabInterval] = useState<number | null>(48);
  const initialIndent=useRef<IndentValues>({indentStart:0,indentEnd:0,firstLineIndent:0});
  const [indentation,setIndentation]=useState<IndentValues>(initialIndent.current);
  useEffect(() => { if (open) {
    const first = selectedParagraphs(editor.state.doc, editor.state.selection)[0];
    if (first) {
      const { node, pos } = first;
      const element = editor.view.nodeDOM(pos);
      const style = element instanceof Element ? getComputedStyle(element) : null;
      initial.current = {spaceBefore:node.attrs.spaceBefore ?? (parseFloat(style?.marginTop || '') || 0),spaceAfter:node.attrs.spaceAfter ?? (parseFloat(style?.marginBottom || '') || 0),indent:node.attrs.indent || 0};
    }
    setBefore(initial.current.spaceBefore); setAfter(initial.current.spaceAfter); setIndent(initial.current.indent); engine.captureSelection();
    initialPagination.current = selectedPagination(editor); setPagination(initialPagination.current);
    initialBackground.current = selectedParagraphBackground(editor); setBackground(initialBackground.current);
    initialTab.current = selectedTabInterval(editor); setTabInterval(initialTab.current);
    initialIndent.current=selectedIndent(editor);setIndentation(initialIndent.current);
  } }, [open,editor,engine]);
  return <Dialog open={open} onOpenChange={v => { if (!v) close(); }}><DialogContent className="vdoc-dialog"><DialogTitle>Paragraph layout</DialogTitle><DialogDescription>Spacing shows the first selected paragraph. Only fields you change apply to the selection.</DialogDescription><form className="properties-form" onSubmit={e => {
    e.preventDefault();
    const spacing = paragraphPropertyOperation(initial.current, {spaceBefore:before,spaceAfter:after,indent});
    const paging = paginationOperation(initialPagination.current,pagination);
    const indents=indentOperation(initialIndent.current,indentation);
    const tabs = tabInterval !== null && tabInterval !== initialTab.current ? { tabInterval } : null;
    const shading = background !== 'mixed' && background !== initialBackground.current ? { paragraphBackground: background } : null;
    if (!spacing && !paging && !indents && !tabs && !shading) { close(); return; }
    const result = engine.execute({ source:'toolbar', operations:[{...spacing,...paging,...indents,...tabs,...shading,type:'paragraph.style'}] });
    if (result.ok) close(); else toast.error(result.error);
  }}><label>Before (px)<input type="number" min="0" max="96" value={before} onChange={e => setBefore(+e.target.value)} /></label><label>After (px)<input type="number" min="0" max="96" value={after} onChange={e => setAfter(+e.target.value)} /></label>
    <ParagraphBackgroundFields value={background} change={setBackground} mixed={initialBackground.current === 'mixed'}/>
    <IndentFields value={indentation} change={setIndentation}/>
    <label>Tab interval (px)<input type="number" min="8" max="480" step="1" placeholder="Mixed" value={tabInterval ?? ''} onChange={e => setTabInterval(e.target.value === '' ? null : Number(e.target.value))}/></label>
    <p className="wide-field">Equal tab spacing from the paragraph start. Use Insert → Tab character inside lists or tables.</p>
    <p className="wide-field">Page breaks apply in Page preview, printing and Word. Paragraphs taller than a page may still split.</p>
    {paginationKeys.map(key=><label key={key} className="wide-field">{{keepWithNext:'Keep with next',keepLinesTogether:'Keep lines together',preventSingleLines:'Prevent single lines'}[key]}<select value={String(pagination[key])} onChange={e=>setPagination(current=>({...current,[key]:e.target.value==='mixed'?'mixed':e.target.value==='true'}))}>{initialPagination.current[key]==='mixed' && <option value="mixed">Mixed — keep existing</option>}<option value="true">On</option><option value="false">Off</option></select></label>)}
    <button className="export-button" type="submit">Apply</button></form></DialogContent></Dialog>;
}
