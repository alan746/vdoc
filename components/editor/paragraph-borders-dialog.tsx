'use client';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { emptyBorderValues, paragraphBorderChanges, paragraphBorderEdges, selectedParagraphBorders, type BorderValues } from '@/lib/editor/paragraph/paragraph-borders';

export function ParagraphBordersDialog({open,close,editor,engine}:{open:boolean;close:()=>void;editor:Editor;engine:DocumentEngine}) {
  const initial=useRef<BorderValues>(emptyBorderValues);
  const [value,setValue]=useState<BorderValues>(emptyBorderValues);
  useEffect(()=>{if(open){initial.current=selectedParagraphBorders(editor);setValue(initial.current);engine.captureSelection();}},[open,editor,engine]);
  return <Dialog open={open} onOpenChange={next=>{if(!next)close();}}><DialogContent className="vdoc-dialog"><DialogTitle>Paragraph borders</DialogTitle><DialogDescription>Only changed settings apply. Left and right refer to the physical sides of each paragraph.</DialogDescription>
    <form className="properties-form" onSubmit={event=>{
      event.preventDefault();const operation=paragraphBorderChanges(initial.current,value);
      if(!operation){close();return;}
      const result=engine.execute({source:'toolbar',operations:[operation]});if(result.ok)close();else toast.error(result.error);
    }}>
      {([...paragraphBorderEdges,'join'] as const).map(side=><label key={side}>{side==='join'?'Join matching adjacent paragraphs':side==='between'?'Between paragraphs':side[0].toUpperCase()+side.slice(1)+' border'}<select aria-label={`${side==='join'?'Join matching adjacent paragraphs':side==='between'?'Between paragraphs':side[0].toUpperCase()+side.slice(1)+' border'}`} value={value[side]===null?'mixed':String(value[side])} onChange={event=>setValue(current=>({...current,[side]:event.target.value==='mixed'?null:event.target.value==='true'}))}>
        {initial.current[side]===null&&<option value="mixed">Mixed — keep existing</option>}<option value="true">On</option><option value="false">Off</option>
      </select></label>)}
      <label>Border width (px)<input type="number" min="0.01" max="8" step="any" placeholder="Mixed" value={value.width??''} onChange={event=>setValue(current=>({...current,width:event.target.value===''?null:Number(event.target.value)}))}/></label>
      <label>Border line<select aria-label="Border line" value={value.style??'mixed'} onChange={event=>setValue(current=>({...current,style:event.target.value==='mixed'?null:event.target.value as BorderValues['style']}))}>
        {initial.current.style===null&&<option value="mixed">Mixed — keep existing</option>}<option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
      </select></label>
      <label>Border color (HEX)<input aria-label="Border color HEX" pattern="#[0-9a-fA-F]{6}" maxLength={7} placeholder="Mixed" value={value.color??''} onChange={event=>setValue(current=>({...current,color:event.target.value||null}))}/></label>
      <label>Border padding (pt)<input type="number" min="0" max="31" step="1" placeholder="Mixed" value={value.padding??''} onChange={event=>setValue(current=>({...current,padding:event.target.value===''?null:Number(event.target.value)}))}/></label>
      <p className="wide-field">Width, line, color and padding apply to enabled borders. Joining requires matching borders, background and indentation. Between lines appear only inside a joined group.</p>
      <button type="button" className="print-preview-return" onClick={()=>setValue(current=>({...current,top:false,right:false,bottom:false,left:false,between:false,join:false}))}>Remove all borders</button><button className="export-button" type="submit">Apply</button>
    </form>
  </DialogContent></Dialog>;
}
