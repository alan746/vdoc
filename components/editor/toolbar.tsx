'use client';
import { effectiveFormatActive } from '@/lib/editor/format/format-overrides';
import { useInputComposition } from './use-input-composition';

import {absoluteFontPixels} from '@/lib/domain/text/font-size';
import { useEffect, useRef, useState } from 'react';
import { restoreEditorFocusAfterMenu } from '@/lib/editor/menu-focus';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { Editor } from '@tiptap/core';
import { Copy, ClipboardPaste, AlignLeft, AlignCenter, AlignRight, AlignJustify, ArrowDownToLine, Bold, Check, ChevronDown, ChevronsUpDown, Highlighter, Italic, Link2, List, ListOrdered, Minus, Plus, Printer, Redo2, RemoveFormatting, Strikethrough, Table2, Underline, Undo2, Type } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { selectedCellListType } from '@/lib/editor/list/cell-lists';
import { listStyleContext } from '@/lib/editor/list/list-style';
import { colorToHex } from '@/lib/domain/text/color';
import type { Operation } from '@/lib/domain/entities/operation';
import { applyFromDialog } from './apply-from-dialog';

export type Run = (operation: Operation | Operation[], label?: string) => void;
const palette = ['#222F43', '#68778D', '#FFFFFF', '#E65656', '#E99132', '#F0C34A', '#48A881', '#4485D1', '#7965BD', '#D06898'];
const highlights = ['#FFF0AD', '#D8EFDE', '#DDEBFE', '#EADFF6', '#FBDDDC', '#F4DFCA'];

export function ToolButton({ label, children, onClick, active, disabled }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean }) {
  return <Tooltip><TooltipTrigger asChild><button type="button" className={`tool-button ${active ? 'active' : ''}`} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
export function Menu({ label, ariaLabel, children, className = '', capture, editor }: { label: React.ReactNode; ariaLabel?: string; children: React.ReactNode; className?: string; capture: () => void; editor: Editor }) {
  const trigger = useRef<HTMLButtonElement>(null), focusFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  return <DropdownMenu onOpenChange={open => { if (open) { cancelAnimationFrame(focusFrame.current); capture(); } }}><DropdownMenuTrigger asChild><button ref={trigger} aria-label={ariaLabel} className={`menu-trigger ${className}`}>{label}</button></DropdownMenuTrigger><DropdownMenuContent className="vdoc-menu" align="start" onCloseAutoFocus={e => { e.preventDefault(); focusFrame.current = restoreEditorFocusAfterMenu(editor, trigger.current); }}>{children}</DropdownMenuContent></DropdownMenu>;
}
export function ColorPicker({ kind, engine, run }: { kind: 'color' | 'highlight' | 'cell'; engine: DocumentEngine; run: Run }) {
  const [open, setOpen] = useState(false);
  const [customColor, setCustomColor] = useState('#FFF0AD');
  const trigger = useRef<HTMLButtonElement>(null), focusFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  const label = kind === 'color' ? 'Text color' : kind === 'highlight' ? 'Highlight' : 'Cell background';
  const editor = engine.editor;
  const currentColor = kind === 'color' ? editor.getAttributes('textStyle').color
    : kind === 'highlight' ? editor.getAttributes('highlight').color
    : editor.getAttributes(editor.isActive('tableHeader') ? 'tableHeader' : 'tableCell').backgroundColor;
  return <Popover open={open} onOpenChange={value => { if (value) { cancelAnimationFrame(focusFrame.current); engine.captureSelection(); setCustomColor(colorToHex(currentColor) || (kind === 'color' ? '#222F43' : '#FFF0AD')); } setOpen(value); }}>
    <PopoverTrigger asChild><button ref={trigger} className={`tool-button color-trigger ${kind === 'highlight' && editor.isActive('highlight') ? 'active' : ''}`} aria-label={label}>{kind === 'color' ? <Type size={17} /> : <Highlighter size={17} />}<span className="color-bar" style={{ background: currentColor || (kind === 'color' ? '#364152' : 'transparent') }} /></button></PopoverTrigger>
    <PopoverContent className="color-popover" align="start" onCloseAutoFocus={e => { e.preventDefault(); focusFrame.current = restoreEditorFocusAfterMenu(editor, trigger.current); }}><p>{label}</p><div className="color-grid">{(kind === 'color' ? palette : highlights).map(color => <button key={color} aria-label={`${label} ${color}`} aria-pressed={colorToHex(currentColor) === color} style={{ background: color }} onClick={() => { run(kind === 'cell' ? { type: 'table.background', color } : { type: 'text.style', style: { [kind]: color } }, label); setOpen(false); }} />)}</div><form className="custom-color" onSubmit={e => { e.preventDefault(); if (/^#[0-9a-fA-F]{6}$/.test(customColor)) { run(kind === 'cell' ? { type: 'table.background', color: customColor } : { type: 'text.style', style: { [kind]: customColor } }, label); setOpen(false); } }}><label>Custom color<input aria-label={`${label} custom hex`} value={customColor} onChange={e => setCustomColor(e.target.value)} pattern="#[0-9a-fA-F]{6}" maxLength={7} /></label><button type="submit">Apply</button></form><button className="reset-color" onClick={() => { run(kind === 'cell' ? { type: 'table.background', color: null } : { type: 'text.style', style: { [kind]: null } }, `Clear ${label.toLowerCase()}`); setOpen(false); }}><RemoveFormatting size={15} />{kind === 'color' ? 'Default color' : 'Clear color'}</button></PopoverContent>
  </Popover>;
}
export function InsertTableDialog({ engine, open, close }: { engine: DocumentEngine; open: boolean; close: () => void }) {
  const [size, setSize] = useState([3, 3]);
  const [rows, setRows] = useState(3), [cols, setCols] = useState(3), [header, setHeader] = useState(true);
  const insert = (rows: number, cols: number) => {
    applyFromDialog(engine, [{type:'table.insert',rows,cols,header}], close, `Insert ${rows} × ${cols} table`);
  };
  return <Dialog open={open} onOpenChange={value=>{if(!value) close();}}><DialogContent className="vdoc-dialog table-insert-dialog" onCloseAutoFocus={e=>{e.preventDefault();engine.editor.view.focus();}}><DialogTitle>Insert table</DialogTitle><DialogDescription>Choose a size from the grid, or enter up to 30 rows and 20 columns.</DialogDescription>
    <p aria-live="polite">{size[1]} {size[1]===1?'row':'rows'} × {size[0]} {size[0]===1?'column':'columns'}</p>
    <div className="table-picker-grid" role="group" aria-label="Table size grid">{Array.from({length:48},(_,i)=>{
      const col=i%8+1,row=Math.floor(i/8)+1;
      return <button type="button" key={i} tabIndex={col===size[0] && row===size[1]?0:-1} aria-label={`${row} ${row===1?'row':'rows'} by ${col} ${col===1?'column':'columns'}`} className={col<=size[0]&&row<=size[1]?'chosen':''} onFocus={()=>setSize([col,row])} onMouseEnter={()=>setSize([col,row])} onClick={()=>insert(row,col)} onKeyDown={e=>{
        const next=e.key==='ArrowRight'?Math.min(i+1,row*8-1):e.key==='ArrowLeft'?Math.max(i-1,(row-1)*8):e.key==='ArrowDown'?Math.min(i+8,47):e.key==='ArrowUp'?Math.max(i-8,0):e.key==='Home'?(row-1)*8:e.key==='End'?row*8-1:null;
        if(next!==null){e.preventDefault();(e.currentTarget.parentElement!.children[next] as HTMLButtonElement).focus();}
      }} />;
    })}</div>
    <form className="properties-form" onSubmit={e=>{e.preventDefault();insert(rows,cols);}}>
      <label>Rows<input type="number" min="1" max="30" step="1" value={rows} onChange={e=>setRows(+e.target.value)} /></label><label>Columns<input type="number" min="1" max="20" step="1" value={cols} onChange={e=>setCols(+e.target.value)} /></label>
      <label className="wide-field"><input type="checkbox" checked={header} onChange={e=>setHeader(e.target.checked)} />Use first row as header</label>
      <button type="submit" className="export-button">Insert</button>
    </form>
  </DialogContent></Dialog>;
}
export function EditorToolbar({ editor, engine, run, zoom, setZoom, link, insertTable, onPrint, formatting }: { formatting: {copy:()=>void;paste:()=>void;canCopy:boolean;canPaste:boolean}; onPrint: () => void; editor: Editor; engine: DocumentEngine; run: Run; zoom: number; setZoom: (n: number) => void; link: () => void; insertTable: () => void }) {
  const capture = () => engine.captureSelection();
  const heading = editor.getAttributes('heading').level;
  const listType = selectedCellListType(editor.state.selection) ?? listStyleContext(editor.state.doc, editor.state.selection)?.node.type.name;
  // Headings and table cells inherit different sizes from their rendered blocks.
  const domPosition = editor.view.domAtPos(editor.state.selection.from);
  const domNode = domPosition.node.nodeType === Node.TEXT_NODE
    ? domPosition.node.parentElement
    : domPosition.node.childNodes[domPosition.offset] || domPosition.node;
  const fontElement = domNode instanceof Element ? domNode : domNode?.parentElement;
  const inheritedSize = fontElement ? getComputedStyle(fontElement).fontSize : '16px';
  const fontSize = absoluteFontPixels(editor.getAttributes('textStyle').fontSize) ?? absoluteFontPixels(inheritedSize) ?? 16;
  const [sizeInput, setSizeInput] = useState(String(fontSize));
  const sizeComposition = useInputComposition();
  useEffect(() => setSizeInput(String(fontSize)), [fontSize, editor.state.selection.from, editor.state.selection.to]);
  const applySize = () => { const value = Number(sizeInput); if (Number.isInteger(value) && value >= 8 && value <= 96 && value !== fontSize) run({ type: 'text.style', style: { fontSize: value } }, 'Set font size'); else setSizeInput(String(fontSize)); };
  const align = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').textAlign || 'left';
  const AlignmentIcon = align === 'center' ? AlignCenter : align === 'right' ? AlignRight : align === 'justify' ? AlignJustify : AlignLeft;
  const fontFamily = editor.getAttributes('textStyle').fontFamily || 'Arial';
  return <div className="toolbar" role="toolbar" aria-label="Document formatting toolbar">
    <div className="tool-group"><ToolButton label="Undo · ⌘Z" disabled={!engine.canUndo} onClick={() => engine.history('undo')}><Undo2 /></ToolButton><ToolButton label="Redo · ⌘⇧Z" disabled={!engine.canRedo} onClick={() => engine.history('redo')}><Redo2 /></ToolButton><ToolButton label="Print" onClick={onPrint}><Printer /></ToolButton></div><span className="tool-divider" />
    <ToolButton label="Copy text formatting · ⌘⌥C" disabled={!formatting.canCopy} onClick={formatting.copy}><Copy /></ToolButton><ToolButton label="Paste text formatting · ⌘⌥V" disabled={!formatting.canPaste} onClick={formatting.paste}><ClipboardPaste /></ToolButton><span className="tool-divider" />
    <Menu editor={editor} capture={capture} label={<>{zoom}%<ChevronDown size={13} /></>}>{[75, 90, 100, 110, 125].map(n => <DropdownMenuItem key={n} onSelect={() => setZoom(n)}>{n}% {zoom === n && <Check size={14} />}</DropdownMenuItem>)}</Menu><span className="tool-divider" />
    <Menu editor={editor} capture={capture} className="style-select" label={<>{editor.isActive('heading') ? `Heading ${heading}` : 'Normal text'}<ChevronsUpDown size={12} /></>}>{[0, 1, 2, 3, 4, 5, 6].map(level => <DropdownMenuItem key={level} onSelect={() => run({ type: 'paragraph.style', level }, level ? `Heading ${level}` : 'Normal text')}>{level ? `Heading ${level}` : 'Normal text'}<span className="shortcut">⌘⌥{level}</span></DropdownMenuItem>)}</Menu><span className="tool-divider" />
    <Menu editor={editor} capture={capture} className="font-select" label={<><span>{fontFamily}</span><ChevronDown size={12} /></>}>{(['Arial', 'Georgia', 'Times New Roman', 'Noto Sans SC', 'monospace'] as const).map(font => <DropdownMenuItem key={font} style={{ fontFamily: font }} onSelect={() => run({ type: 'text.style', style: { fontFamily: font } }, 'Set font')}>{font}</DropdownMenuItem>)}</Menu>
    <div className="font-size"><button aria-label="Decrease font size" disabled={fontSize <= 8} onMouseDown={e => e.preventDefault()} onClick={() => run({ type: 'text.style', style: { fontSize: Math.max(8, Math.min(96, Math.ceil(fontSize) - 1)) } }, 'Decrease font size')}><Minus size={13} /></button><input {...sizeComposition.capture} className="font-size-input" aria-label="Font size (px)" inputMode="numeric" value={sizeInput} onFocus={capture} onChange={e => setSizeInput(e.target.value)} onBlur={e => { if (e.currentTarget.value === sizeInput) applySize(); }} onKeyDown={e => { if (sizeComposition.isComposing(e.nativeEvent)) return; if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); editor.view.focus(); } if (e.key === 'Escape') { setSizeInput(String(fontSize)); e.currentTarget.value = String(fontSize); e.currentTarget.blur(); editor.view.focus(); } }} /><Menu editor={editor} capture={capture} ariaLabel="Font size presets" label={<ChevronDown size={10} />}>{[10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map(size => <DropdownMenuItem key={size} onSelect={() => run({ type: 'text.style', style: { fontSize: size } }, 'Set font size')}>{size} px</DropdownMenuItem>)}</Menu><button aria-label="Increase font size" disabled={fontSize >= 96} onMouseDown={e => e.preventDefault()} onClick={() => run({ type: 'text.style', style: { fontSize: Math.min(96, Math.max(8, Math.floor(fontSize) + 1)) } }, 'Increase font size')}><Plus size={13} /></button></div><span className="tool-divider" />
    <div className="tool-group">{([{ mark: 'bold', icon: Bold, label: 'Bold · ⌘B' }, { mark: 'italic', icon: Italic, label: 'Italic · ⌘I' }, { mark: 'underline', icon: Underline, label: 'Underline · ⌘U' }, { mark: 'strike', icon: Strikethrough, label: 'Strikethrough' }] as const).map(({ mark, icon: Icon, label }) => <ToolButton key={mark} label={label} active={mark === 'bold' || mark === 'underline' ? effectiveFormatActive(editor.state, mark) : editor.isActive(mark)} onClick={() => run({ type: 'text.toggle', mark }, label.split(' · ')[0])}><Icon /></ToolButton>)}<ColorPicker kind="color" engine={engine} run={run} /><ColorPicker kind="highlight" engine={engine} run={run} /></div><span className="tool-divider" />
    <ToolButton label="Insert link" active={editor.isActive('link')} onClick={link}><Link2 /></ToolButton><ToolButton label="Insert table" onClick={insertTable}><Table2 /></ToolButton><span className="tool-divider" />
    <Menu editor={editor} capture={capture} ariaLabel="Text alignment" label={<><AlignmentIcon size={17} /><ChevronDown size={12} /></>}>{([{ value: 'left', label: 'Align left', icon: AlignLeft }, { value: 'center', label: 'Center', icon: AlignCenter }, { value: 'right', label: 'Align right', icon: AlignRight }, { value: 'justify', label: 'Justify', icon: AlignJustify }] as const).map(({ value, label, icon: Icon }) => <DropdownMenuItem key={value} onSelect={() => run({ type: 'paragraph.style', align: value }, label)}><Icon size={16} />{label}{align === value && <Check size={14} />}</DropdownMenuItem>)}</Menu>
    <Menu editor={editor} capture={capture} ariaLabel="Line spacing" label={<><ArrowDownToLine size={17} /><ChevronDown size={12} /></>}>{(['1', '1.15', '1.25', '1.5', '1.75', '2', '2.5', '3'] as const).map(lineHeight => <DropdownMenuItem key={lineHeight} onSelect={() => run({ type: 'paragraph.style', lineHeight }, 'Set line spacing')}>{lineHeight} ×</DropdownMenuItem>)}</Menu>
    <ToolButton label="Bulleted list" active={listType === 'bulletList'} onClick={() => run({ type: 'list.toggle', kind: 'bullet' }, 'Bulleted list')}><List /></ToolButton><ToolButton label="Numbered list" active={listType === 'orderedList'} onClick={() => run({ type: 'list.toggle', kind: 'ordered' }, 'Numbered list')}><ListOrdered /></ToolButton><ToolButton label="Clear formatting" onClick={() => run({ type: 'text.clear' }, 'Clear formatting')}><RemoveFormatting /></ToolButton>
  </div>;
}
