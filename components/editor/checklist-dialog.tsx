'use client';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { checklistTargets } from '@/lib/editor/list/checklist';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { applyFromDialog } from './apply-from-dialog';

export function ChecklistDialog({open,close,editor,engine}:{open:boolean;close:()=>void;editor:Editor;engine:DocumentEngine}) {
  const [strike,setStrike]=useState('true'), initial=useRef('true');
  const targets=checklistTargets(editor.state.doc,editor.state.selection);
  useEffect(()=>{if(open){const modes=checklistTargets(editor.state.doc,editor.state.selection).map(({node})=>String(node.attrs.strikeCompleted!==false));initial.current=modes.every(mode=>mode===modes[0])?(modes[0]??'true'):'mixed';setStrike(initial.current);}},[open,editor]);
  return <Dialog open={open} onOpenChange={value=>{if(!value)close();}}><DialogContent className="vdoc-dialog">
    <DialogTitle>Checklist options</DialogTitle><DialogDescription>{targets.length>1?'Applies to checklists in selected cells. Nested checklists and unselected cells keep their settings. Mixed values stay unchanged unless edited.':'Applies to this checklist. Nested checklists keep their own setting.'}</DialogDescription>
    <form className="properties-form" onSubmit={event=>{
      event.preventDefault();if(strike==='mixed' || strike===initial.current){close();return;}
      applyFromDialog(engine, [{type:'list.checklistStyle',strikeCompleted:strike==='true'}], close);
    }}>
      <label className="wide-field">Completed items<select value={strike} onChange={event=>setStrike(event.target.value)}>{initial.current==='mixed' && <option value="mixed">Mixed — keep unchanged</option>}<option value="true">Strike through completed items</option><option value="false">Keep completed text unchanged</option></select></label>
      {strike==='mixed' ? <p className="wide-field">Choose a display mode to preview completed items.</p> : <div className="wide-field checklist-preview" aria-label="Checklist preview"><div><input type="checkbox" checked={false} disabled aria-label="Incomplete example" /><span>Item to complete</span></div><div><input type="checkbox" checked disabled aria-label="Completed example" /><span style={strike==='true'?{textDecoration:'line-through',color:'#7d899b'}:undefined}>Completed item</span></div></div>}
      <button type="button" className="quiet-button" onClick={close}>Cancel</button><button type="submit" className="export-button" disabled={!targets.length}>Apply</button>
    </form>
  </DialogContent></Dialog>;
}
