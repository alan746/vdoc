'use client';
import { useState } from 'react';
import { selectedRect } from '@tiptap/pm/tables';
import { toast } from 'sonner';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { cellBorder, tableBorderChanges, type BorderScope } from '@/lib/editor/table/table-borders';
import { colorToHex } from '@/lib/domain/text/color';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { applyFromDialog } from './apply-from-dialog';

export function TableBordersDialog({ engine, open, close }: { engine: DocumentEngine; open: boolean; close: () => void }) {
  return <Dialog open={open} onOpenChange={value=>{if(!value)close();}}><DialogContent className="vdoc-dialog"><TableBordersForm engine={engine} close={close} /></DialogContent></Dialog>;
}

// Mounted only while the dialog is open, so each opening reads the selected cell.
function TableBordersForm({ engine, close }: { engine: DocumentEngine; close: () => void }) {
  const [border] = useState(() => { const editor=engine.editor; return cellBorder(editor.getAttributes(editor.isActive('tableHeader')?'tableHeader':'tableCell'),'top'); });
  const [scope, setScope] = useState<BorderScope>('all');
  const [color, setColor] = useState(colorToHex(border.color)||'#DCE3ED'), [width, setWidth] = useState(border.width), [style, setStyle] = useState<'solid' | 'dashed' | 'dotted'>(border.style);
  return <><DialogTitle>Table borders</DialogTitle><DialogDescription>Choose borders around or inside the selected cells. Shared edges update on both sides. Set width to 0 to remove a border.</DialogDescription>
    <form className="properties-form" onSubmit={e=>{
      e.preventDefault(); const rect=selectedRect(engine.editor.state), changes=tableBorderChanges(rect.table,rect,scope,{color,width,style});
      if(!changes){toast.error('This border touches part of a merged cell. Expand the selection or unmerge it first.');return;}
      if(!changes.size){toast.error('Select two or more adjacent cells to change inner borders.');return;}
      applyFromDialog(engine, [{type:'table.border',scope,color,width,style}], close);
    }}>
      <label>Apply to<select value={scope} onChange={e=>setScope(e.target.value as BorderScope)}>{(['all','outer','inner','top','right','bottom','left'] as const).map(value=><option key={value} value={value}>{value==='all'?'All borders':value==='outer'?'Outer border':value==='inner'?'Inner borders':`${value[0].toUpperCase()}${value.slice(1)} border`}</option>)}</select></label>
      <label>Border width (px)<input type="number" min="0" max="8" step="1" value={width} onChange={e=>setWidth(+e.target.value)} /></label>
      <label>Border style<select value={style} onChange={e=>setStyle(e.target.value as typeof style)}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
      <label>Border color<input type="color" value={color} onChange={e=>setColor(e.target.value)} /></label>
      <button type="submit" className="export-button">Apply</button>
    </form>
  </>;
}
