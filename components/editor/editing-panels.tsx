'use client';
import { useCallback, useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import type { Editor } from '@tiptap/core';
import { CellSelection, selectedRect } from '@tiptap/pm/tables';
import { X, ChevronDown, Table2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { distributeColumnWidths, tableColumnWidths, tablePropertyOperations, type CellProperties } from '@/lib/editor/table/table-properties';
import { columnDelta } from '@/lib/editor/table/table-direction';
import { reorderedTable } from '@/lib/editor/table/table-move';
import { tableContextSelection } from '@/lib/editor/table/table-context-selection';
import { completePinnedBoundary, pinnedRowCount } from '@/lib/editor/table/table-headers';
import { findMatches } from '@/lib/editor/search/search';
import { revealSearchMatch } from '@/lib/editor/search/search-scroll';
import { highlightSearchMatches } from '@/lib/editor/search/search-highlights';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { TableBordersDialog } from './table-borders-dialog';
import { ColorPicker, Menu, type Run } from './toolbar';
import { useInputComposition } from './use-input-composition';
import { applyFromDialog } from './apply-from-dialog';

export function FindPanel({ editor, engine, close, focusRequest = 0, zoom = 100 }: { editor: Editor; engine: DocumentEngine; close: () => void; focusRequest?: number; zoom?: number }) {
  const composition = useInputComposition();
  // A stable callback; effects depend on it rather than on the per-render object.
  const { hasComposition } = composition;
  const scrollFrame = useRef(0);
  const previousZoom = useRef(zoom);
  const findInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusRequest) return; // Initial implicit mounting already uses autoFocus.
    // A menu's focus scope is still active during the selecting render. Wait
    // until it closes before focusing; ordinary document updates do not refocus.
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed || editor.view.composing || hasComposition()) return;
      findInput.current?.focus({ preventScroll: true }); findInput.current?.select();
    });
    const cancel = () => cancelAnimationFrame(frame);
    document.addEventListener('pointerdown', cancel, { once: true, capture: true });
    document.addEventListener('keydown', cancel, { once: true, capture: true });
    return () => { cancel(); document.removeEventListener('pointerdown', cancel, true); document.removeEventListener('keydown', cancel, true); };
  }, [focusRequest, editor, hasComposition]);
  const [query, setQuery] = useState(''), [replacement, setReplacement] = useState('');
  const [sensitive, setSensitive] = useState(false), [wholeWord, setWholeWord] = useState(false), [index, setIndex] = useState(0);
  // The workspace throttles its own renders. Search ranges must instead track
  // the document itself, including changes made by undo or another operation.
  const subscribe = useCallback((notify: () => void) => engine.subscribe(notify), [engine]);
  const getDocument = useCallback(() => editor.state.doc, [editor]);
  const searchDocument = useSyncExternalStore(subscribe, getDocument, getDocument);
  const matches = useMemo(() => findMatches(searchDocument, query, sensitive, wholeWord), [searchDocument, query, sensitive, wholeWord]);
  const currentIndex = Math.min(index, Math.max(0, matches.length - 1));
  const reveal = useCallback((from: number) => {
    cancelAnimationFrame(scrollFrame.current);
    revealSearchMatch(editor, from);
    const document = editor.state.doc;
    // Recheck after the browser has applied input focus and panel layout.
    scrollFrame.current = requestAnimationFrame(() => {
      if (!editor.isDestroyed && editor.state.doc === document && !editor.view.composing && !hasComposition()) revealSearchMatch(editor, from);
    });
  }, [editor, hasComposition]);
  useLayoutEffect(() => { highlightSearchMatches(editor, matches, currentIndex); }, [editor, matches, currentIndex]);
  useLayoutEffect(() => {
    if (previousZoom.current === zoom) return;
    previousZoom.current = zoom;
    // CSS zoom changes the match's screen position without a document update.
    // Keep that match visible without restarting search or moving input focus.
    if (editor.isDestroyed || editor.state.doc !== searchDocument || editor.view.composing || hasComposition()) return;
    const match = matches[currentIndex];
    if (match) reveal(match.from);
  }, [zoom, editor, searchDocument, matches, currentIndex, hasComposition, reveal]);
  useEffect(() => () => {
    cancelAnimationFrame(scrollFrame.current);
    highlightSearchMatches(editor, [], -1);
  }, [editor]);
  // Moves the editor selection to a match; the caller owns the index state.
  const selectMatch = (position: number, explicit: boolean) => {
    if (editor.view.composing || (explicit && hasComposition())) return false;
    if (!matches.length || editor.state.doc !== searchDocument) return false;
    highlightSearchMatches(editor, matches, position);
    engine.clearSelectionBookmark(); editor.commands.setTextSelection(matches[position]); reveal(matches[position].from);
    return true;
  };
  const navigate = (next: number) => {
    const position = (next + matches.length) % matches.length;
    if (selectMatch(position, true)) setIndex(position);
  };
  // New search terms restart at the first match (the handlers reset the index).
  const selectFirstMatch = useEffectEvent(() => { selectMatch(0, false); });
  useEffect(() => { selectFirstMatch(); }, [query, sensitive, wholeWord]);
  const inputReady = () => {
    // Button activation is not always preceded by blur/compositionend. Keep
    // candidate text local until the input method has finished committing it.
    if (!hasComposition()) return true;
    toast.error('Finish composing your text before replacing or closing search.');
    return false;
  };
  const replace = (all: boolean) => {
    if (!inputReady()) return;
    cancelAnimationFrame(scrollFrame.current);
    // Even a synchronous second click can arrive before React commits a render.
    // Never bless a stale range with the engine's newer document revision.
    if (editor.state.doc !== searchDocument) {
      toast.error('The document changed. Review the current match and try again.');
      return;
    }
    const match = matches[currentIndex]; if (!match) return;
    const focused = document.activeElement;
    const result = engine.execute(all ? { source: 'toolbar', expectedRevision: engine.revision, operations: [{ type: 'text.findReplace', query, replacement, caseSensitive: sensitive, wholeWord }] }
      : { source: 'toolbar', expectedRevision: engine.revision, target: { kind: 'range', ...match }, operations: [{ type: 'text.replace', text: replacement }] });
    if (focused instanceof HTMLElement && focused.isConnected && focused.closest('.find-panel')) focused.focus({ preventScroll: true });
    if (!result.ok) { toast.error(result.error); return; }
    const remaining = findMatches(editor.state.doc, query, sensitive, wholeWord);
    const next = all ? 0 : Math.max(0, remaining.findIndex(item => item.from >= match.from + replacement.length));
    setIndex(next);
    highlightSearchMatches(editor, remaining, next);
    if (remaining[next]) {
      engine.clearSelectionBookmark(); editor.commands.setTextSelection(remaining[next]); reveal(remaining[next].from);
    }
  };
  const closePanel = () => {
    if (!inputReady()) return;
    cancelAnimationFrame(scrollFrame.current);
    close();
    // Keep the selected match and make typing possible after the panel leaves.
    if (!editor.isDestroyed) editor.view.focus();
  };
  return <section className="find-panel" aria-label="Find and replace" {...composition.capture} onKeyDown={event => {
    if (event.key !== 'Escape' || composition.isComposing(event.nativeEvent)) return;
    event.preventDefault(); event.stopPropagation(); closePanel();
  }}><Search size={16} /><input ref={findInput} autoFocus aria-label="Find text" placeholder="Find in document" value={query} onChange={e => { setQuery(e.target.value); setIndex(0); }} onKeyDown={e => { if (composition.isComposing(e.nativeEvent)) return; if (e.key === 'Enter') { e.preventDefault(); navigate(currentIndex + (e.shiftKey ? -1 : 1)); } }} /><span role="status">{matches.length ? `${currentIndex + 1} of ${matches.length}` : 'No matches'}</span><button disabled={!matches.length} onClick={() => navigate(currentIndex - 1)}>Previous</button><button disabled={!matches.length} onClick={() => navigate(currentIndex + 1)}>Next</button><input aria-label="Replace with" placeholder="Replace with" value={replacement} onChange={e => setReplacement(e.target.value)} /><button disabled={!matches.length} onClick={() => replace(false)}>Replace</button><button disabled={!matches.length} onClick={() => replace(true)}>Replace all</button><label><input type="checkbox" checked={sensitive} onChange={e => { setSensitive(e.target.checked); setIndex(0); }} />Match case</label><label><input type="checkbox" checked={wholeWord} onChange={e => { setWholeWord(e.target.checked); setIndex(0); }} />Whole word</label><button aria-label="Close find and replace" onClick={closePanel}><X size={16} /></button></section>;
}

// Imported dimensions may be narrower, larger or fractional. Unchanged values
// are preserved; only user edits must satisfy the operation layer's limits.
function dimensionConstraints(value: number, initial: number | undefined, min: number, max: number) {
  return value === initial ? { step: 'any' } : { min, max, step: 1 };
}

export type TableToolsHandle = { openProperties: () => void };

export function TableTools({ editor, engine, run, ref }: { editor: Editor; engine: DocumentEngine; run: Run; ref?: Ref<TableToolsHandle> }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [bordersOpen, setBordersOpen] = useState(false);
  // Values when the properties dialog opened; only fields changed from these apply.
  const [initial, setInitial] = useState<{ properties: CellProperties; rowBreak: string; direction: string; alignment: string; pinnedRows: number } | null>(null);
  const [rowBreak, setRowBreak] = useState('keep');
  const [columnDirection, setColumnDirection] = useState<'ltr' | 'rtl'>('ltr');
  const [pinnedRows, setPinnedRows] = useState(0);
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>('left');
  const [borderStyle, setBorderStyle] = useState<'solid' | 'dashed' | 'dotted'>('solid');
  const [splitOpen, setSplitOpen] = useState(false), [splitRows, setSplitRows] = useState(2), [splitCols, setSplitCols] = useState(2), [height, setHeight] = useState(0);
  const [properties, setProperties] = useState(false), [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [width, setWidth] = useState(160), [padding, setPadding] = useState(10), [border, setBorder] = useState(1), [color, setColor] = useState('#DCE3ED'), [vertical, setVertical] = useState<'top' | 'middle' | 'bottom'>('top');
  useLayoutEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  },[menu]);
  useEffect(() => {
    const open = (x: number, y: number) => {
      engine.captureSelection();
      const maxHeight = Math.min(480, window.innerHeight - 16);
      setMenu({x:Math.max(8,Math.min(x,window.innerWidth - 240)),y:Math.max(8,Math.min(y,window.innerHeight - maxHeight - 8))});
    };
    const context = (e: MouseEvent) => {
      const cell = e.target instanceof Element ? e.target.closest('td,th') : null;
      if (!cell || !editor.view.dom.contains(cell)) return;
      const selection = tableContextSelection(editor.state,editor.view.posAtDOM(cell,0));
      if (!selection) return;
      e.preventDefault();
      if (!selection.eq(editor.state.selection)) editor.view.dispatch(editor.state.tr.setSelection(selection));
      open(e.clientX,e.clientY);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (!(e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) || !editor.isActive('table')) return;
      e.preventDefault();
      const selection=editor.state.selection;
      const dom=selection instanceof CellSelection ? editor.view.nodeDOM(selection.$headCell.pos) : editor.view.domAtPos(selection.from).node;
      const cell=(dom instanceof Element ? dom : dom?.parentElement)?.closest('td,th');
      const bounds=cell?.getBoundingClientRect(); if(bounds) open(bounds.left + 12,bounds.top + 8);
    };
    const dismiss = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const resize = () => setMenu(null);
    editor.view.dom.addEventListener('contextmenu',context);
    editor.view.dom.addEventListener('keydown',keyboard);
    window.addEventListener('pointerdown',dismiss);window.addEventListener('resize',resize);
    return () => { editor.view.dom.removeEventListener('contextmenu',context);editor.view.dom.removeEventListener('keydown',keyboard);window.removeEventListener('pointerdown',dismiss);window.removeEventListener('resize',resize); };
  },[editor,engine]);
  const currentWidths = () => {
    const rect = selectedRect(editor.state);
    const container = editor.view.nodeDOM(rect.tableStart - 1) as HTMLElement | null;
    const element = container?.matches('table') ? container : container?.querySelector('table');
    const scale = element?.offsetWidth ? element.getBoundingClientRect().width / element.offsetWidth : 1;
    const measured = Array.from(element?.querySelectorAll(':scope > colgroup > col') || []).map(col => col.getBoundingClientRect().width / (scale || 1));
    return tableColumnWidths(rect.table, measured);
  };
  const openProperties = () => {
    if (!editor.isActive('table')) return;
    const rect = selectedRect(editor.state);
    engine.captureSelection(); const attrs = editor.getAttributes(editor.isActive('tableHeader') ? 'tableHeader' : 'tableCell');
    let borderColor = attrs.borderColor || '#DCE3ED';
    const rgb = borderColor.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
    if (rgb) borderColor = '#' + rgb.slice(1).map((n:string)=>Number(n).toString(16).padStart(2,'0')).join('');
    const properties: CellProperties = {borderStyle:attrs.borderStyle || 'solid',padding:attrs.padding ?? 10,minHeight:Math.max(attrs.minHeight || 0, rect.table.child(rect.top).attrs.minHeight || 0),borderWidth:attrs.borderWidth ?? 1,borderColor,verticalAlign:attrs.verticalAlign || 'top',width:currentWidths()[rect.left]};
    const breaks = Array.from({ length: rect.bottom - rect.top }, (_, i) => rect.table.child(rect.top + i).attrs.allowSplit === true);
    const next = { properties, rowBreak: breaks.every(value => value === breaks[0]) ? breaks[0] ? 'allow' : 'keep' : 'mixed',
      direction: rect.table.attrs.columnDirection || 'ltr', alignment: rect.table.attrs.alignment || 'left', pinnedRows: pinnedRowCount(rect.table) };
    setInitial(next);
    setRowBreak(next.rowBreak); setColumnDirection(next.direction as 'ltr' | 'rtl'); setPinnedRows(next.pinnedRows);
    setAlignment(next.alignment as typeof alignment); setBorderStyle(properties.borderStyle || 'solid');
    setPadding(properties.padding); setHeight(properties.minHeight); setBorder(properties.borderWidth); setColor(properties.borderColor); setVertical(properties.verticalAlign); setWidth(properties.width); setProperties(true); setMenu(null);
  };
  // Lets the Format menu open the dialog from its own selection event.
  useImperativeHandle(ref, () => ({ openProperties }));
  if (!editor.isActive('table')) return null;
  const rect = selectedRect(editor.state);
  const rtl = rect.table.attrs.columnDirection === 'rtl';
  const pinCount = pinnedRowCount(rect.table);
  const explicitPins = rect.table.attrs.pinnedRows != null;
  const pinThrough = completePinnedBoundary(rect.table, rect.bottom);
  const actions = [['rowBefore', 'Insert row above'], ['rowAfter', 'Insert row below'], ['columnBefore', rtl ? 'Insert column right' : 'Insert column left'], ['columnAfter', rtl ? 'Insert column left' : 'Insert column right'], ['merge', 'Merge cells'], ['split', 'Unmerge cell'], ['headerRow', 'Toggle header row'], ['deleteRow', 'Delete row'], ['deleteColumn', 'Delete column'], ['deleteTable', 'Delete table']] as const;
  const can = (action: string) => action === 'merge' ? !(explicitPins && rect.top < pinCount && rect.bottom > pinCount) && editor.can().mergeCells() : action === 'split' ? editor.can().splitCell() : true;
  const edit = (action: typeof actions[number][0], label: string) => { run({ type: 'table.edit', action }, label); setMenu(null); };
  const distribute = () => {
    const widths = currentWidths();
    const multiple = rect.right - rect.left > 1;
    run({type:'table.widths',widths:distributeColumnWidths(widths,multiple ? rect.left : 0,multiple ? rect.right : widths.length)}, 'Distribute columns');
  };
  const distributeRows = () => {
    const element = editor.view.nodeDOM(rect.tableStart - 1) as HTMLElement | null;
    const rows = Array.from(element?.querySelectorAll(':scope > table > tbody > tr') || []);
    const multiple = rect.bottom - rect.top > 1, from = multiple ? rect.top : 0, to = multiple ? rect.bottom : rect.map.height;
    const crossesBoundary = [...new Set(rect.map.map.slice(from * rect.map.width,to * rect.map.width))].some(offset => {
      const cell = rect.map.findCell(offset); return cell.top < from || cell.bottom > to;
    });
    if (crossesBoundary) { toast.error('Select all rows touched by a merged cell before distributing.'); return; }
    const scale = element?.offsetWidth ? element.getBoundingClientRect().width / element.offsetWidth : 1;
    // Match the tallest selected row so existing content is never compressed.
    const height = Math.ceil(Math.max(...rows.slice(from,to).map(row=>row.getBoundingClientRect().height / (scale || 1)), 1));
    run({type:'table.distributeRows',from,to,height}, 'Distribute rows');
  };
  const openBorders = () => { engine.captureSelection(); setBordersOpen(true); setMenu(null); };
  const openSplit = () => { engine.captureSelection(); setSplitOpen(true); setMenu(null); };
  const selectRegion = (kind: 'row' | 'column' | 'table') => {
    const { map, tableStart, top, left } = selectedRect(editor.state);
    const start = kind === 'row' ? top * map.width : kind === 'column' ? left : 0;
    const end = kind === 'row' ? (top + 1) * map.width - 1 : kind === 'column' ? (map.height - 1) * map.width + left : map.map.length - 1;
    editor.commands.setCellSelection({ anchorCell: tableStart + map.map[start], headCell: tableStart + map.map[end] }); engine.clearSelectionBookmark(); editor.view.focus();
  };
  const commands = [
    {label:'Borders…',action:openBorders}, {label:'Split cell…',action:openSplit},
    ...actions.map(([action,label])=>({label,disabled:!can(action),action:()=>edit(action,label)})),
    ...(['row','column','table'] as const).map(kind=>({label:`Select ${kind}`,action:()=>selectRegion(kind)})),
    {label:'Distribute columns',action:distribute}, {label:'Distribute rows',action:distributeRows},
    {label:`Pin header through row ${pinThrough}`,action:()=>run({type:'table.pinRows',count:pinThrough})},
    {label:'Unpin header rows',disabled:pinCount === 0,action:()=>run({type:'table.pinRows',count:0},'Unpin header rows')},
    {label:'Sort ascending',action:()=>run({type:'table.sort',column:rect.left,descending:false})},
    {label:'Sort descending',action:()=>run({type:'table.sort',column:rect.left,descending:true})},
    ...([['row','up',rect.top,-1],['row','down',rect.top,1],['column','left',rect.left,columnDelta(rect.table.attrs.columnDirection,'left')],['column','right',rect.left,columnDelta(rect.table.attrs.columnDirection,'right')]] as const).map(([axis,label,from,delta])=>({label:`Move ${axis} ${label}`,disabled:!reorderedTable(rect.table,axis,from,from+delta),action:()=>run({type:'table.move',axis,from,to:from+delta})})),
    {label:'Table properties',action:openProperties},
  ];
  return <><div className="table-context" aria-label="Table tools"><span><Table2 size={15} />Table</span><button onMouseDown={e => e.preventDefault()} onClick={() => edit('rowAfter', 'Insert row below')}><Plus size={14} />Row</button><button onMouseDown={e => e.preventDefault()} onClick={() => edit(rtl ? 'columnBefore' : 'columnAfter', 'Insert column right')}><Plus size={14} />Column</button><ColorPicker kind="cell" engine={engine} run={run} /><button onClick={openProperties}>Table properties</button><Menu editor={editor} capture={() => engine.captureSelection()} label={<>More<ChevronDown size={12} /></>}>{commands.map(command=><DropdownMenuItem key={command.label} disabled={'disabled' in command && command.disabled} onSelect={command.action}>{command.label}</DropdownMenuItem>)}</Menu></div>
    {menu && <div ref={menuRef} className="table-right-menu" role="menu" aria-label="Table context menu" style={{left:menu.x,top:menu.y}} onKeyDown={e=>{
      const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index=items.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
        e.preventDefault();e.stopPropagation();
        const next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
        items[next]?.focus();
      } else if(e.key==='Escape'||e.key==='Tab') {e.preventDefault();e.stopPropagation();setMenu(null);editor.view.focus();}
    }}>{commands.map(command=><button role="menuitem" key={command.label} disabled={'disabled' in command && command.disabled} onClick={()=>{setMenu(null);command.action();}}>{command.label}</button>)}</div>}
    <TableBordersDialog engine={engine} open={bordersOpen} close={()=>setBordersOpen(false)} />
    <Dialog open={splitOpen} onOpenChange={setSplitOpen}><DialogContent className="vdoc-dialog"><DialogTitle>Split cell</DialogTitle><DialogDescription>Divide one ordinary cell into a grid. Unmerge merged cells first. Neighboring cells keep their content.</DialogDescription><form className="properties-form" onSubmit={e => { e.preventDefault(); applyFromDialog(engine, [{ type: 'table.split', rows: splitRows, cols: splitCols }], () => setSplitOpen(false)); }}><label>Rows<input type="number" min="1" max="10" value={splitRows} onChange={e => setSplitRows(+e.target.value)} /></label><label>Columns<input type="number" min="1" max="10" value={splitCols} onChange={e => setSplitCols(+e.target.value)} /></label><button type="submit" className="export-button">Split</button></form></DialogContent></Dialog>
    <Dialog open={properties} onOpenChange={setProperties}><DialogContent className="vdoc-dialog"><DialogTitle>Table properties</DialogTitle><DialogDescription>Alignment applies to the whole table. Cell formatting applies to selected cells; width applies to selected columns.</DialogDescription><form className="properties-form" onSubmit={e => { e.preventDefault();
      const operations = tablePropertyOperations(initial!.properties, {width,padding,borderStyle,borderWidth:border,borderColor:color,minHeight:height,verticalAlign:vertical}, currentWidths(),rect.left,rect.right);
      if (rowBreak !== 'mixed' && rowBreak !== initial!.rowBreak) operations.push({type:'table.rowBreak',from:rect.top,to:rect.bottom,allowSplit:rowBreak === 'allow'});
      if (columnDirection !== initial!.direction) operations.push({type:'table.direction',direction:columnDirection});
      if (alignment !== initial!.alignment) operations.push({type:'table.layout',alignment});
      if (pinnedRows !== initial!.pinnedRows) {
        if (completePinnedBoundary(rect.table,pinnedRows) !== pinnedRows) { toast.error('Include all rows touched by merged header cells.'); return; }
        operations.push({type:'table.pinRows',count:pinnedRows});
      }
      if (!operations.length) { setProperties(false); return; }
      applyFromDialog(engine, operations, () => setProperties(false));
    }}><label>Column order<select value={columnDirection} onChange={e => setColumnDirection(e.target.value as typeof columnDirection)}><option value="ltr">Left-to-right</option><option value="rtl">Right-to-left</option></select></label><label>Table alignment<select value={alignment} onChange={e => setAlignment(e.target.value as typeof alignment)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Pinned header rows<input type="number" min="0" max={rect.map.height} value={pinnedRows} onChange={e => setPinnedRows(+e.target.value)} aria-describedby="pinned-header-help" /></label><p id="pinned-header-help" className="field-help">Keep the first rows visible and exclude them from sorting. Enter 0 to unpin. Headers taller than the viewport scroll normally.</p><label className="wide-field">Row page breaks<select aria-describedby="row-break-help" value={rowBreak} onChange={e => setRowBreak(e.target.value)}>{initial?.rowBreak === 'mixed' && <option value="mixed">Mixed — keep existing settings</option>}<option value="keep">Keep each selected row on one page</option><option value="allow">Allow each selected row to split</option></select></label><p id="row-break-help" className="field-help">Applies to each selected row in print and Word export. The editor remains a continuous canvas. Rows taller than a page may still split.</p><label>Column width (px)<input type="number" {...dimensionConstraints(width, initial?.properties.width, 40, 1200)} value={width} onChange={e => setWidth(+e.target.value)} /></label><label>Minimum row height (px)<input type="number" {...dimensionConstraints(height, initial?.properties.minHeight, 0, 1000)} value={height} onChange={e => setHeight(+e.target.value)} /></label><label>Cell padding (px)<input type="number" {...dimensionConstraints(padding, initial?.properties.padding, 0, 40)} value={padding} onChange={e => setPadding(+e.target.value)} /></label><label>Border width (px)<input type="number" {...dimensionConstraints(border, initial?.properties.borderWidth, 0, 8)} value={border} onChange={e => setBorder(+e.target.value)} /></label><label>Border style<select value={borderStyle} onChange={e => setBorderStyle(e.target.value as typeof borderStyle)}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label><label>Border color<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label><label>Vertical alignment<select value={vertical} onChange={e => setVertical(e.target.value as typeof vertical)}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label><button type="submit" className="export-button">Apply</button></form></DialogContent></Dialog>
  </>;
}
