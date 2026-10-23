'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Editor } from '@tiptap/core';
import type { DocumentEngine } from '@/lib/usecases/engine';
import type { Operation } from '@/lib/domain/entities/operation';
import { bulletStyles, orderedStyles, type ListStyle } from '@/lib/domain/rules/list-styles';
import { currentListStyle, listStyleTargets } from '@/lib/editor/list/list-style';
import { validNumberAffix, validBulletText } from '@/lib/domain/rules/list-markers';
import { markerCssString } from '@/lib/editor/list/list-markers';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

type MarkerStyle = ListStyle | 'custom' | 'mixed';
type Values = {style:MarkerStyle; prefix:string|null; suffix:string|null; bullet:string|null};
const labels: Record<MarkerStyle, string> = {mixed:'Mixed — keep unchanged',decimal:'1, 2, 3', 'lower-alpha':'a, b, c', 'upper-alpha':'A, B, C', 'lower-roman':'i, ii, iii', 'upper-roman':'I, II, III', disc:'Solid circle •', circle:'Open circle ○', square:'Square ▪', custom:'Custom character…'};
const common = <T,>(values:T[]):T|null => values.length && values.every(value=>value===values[0]) ? values[0] : null;
function selectedValues(editor:Editor):Values {
  const nodes=listStyleTargets(editor.state.doc,editor.state.selection).map(target=>target.node);
  return {
    style:common(nodes.map(node=>node.type.name==='bulletList' && node.attrs.bulletText ? 'custom' as const : currentListStyle(node))) ?? 'mixed',
    prefix:common(nodes.map(node=>node.attrs.numberPrefix ?? '')),
    suffix:common(nodes.map(node=>node.attrs.numberSuffix ?? '.')),
    bullet:common(nodes.map(node=>node.attrs.bulletText || '★')),
  };
}
export function ListStyleDialog({open, close, editor, engine}: {open:boolean; close:()=>void; editor:Editor; engine:DocumentEngine}) {
  const [values,setValues]=useState<Values>({style:'decimal',prefix:'',suffix:'.',bullet:'★'}), initial=useRef(values);
  const {style,prefix,suffix,bullet}=values;
  const targets=listStyleTargets(editor.state.doc,editor.state.selection), ordered=targets[0]?.node.type.name==='orderedList';
  useEffect(()=>{if(open){initial.current=selectedValues(editor);setValues(initial.current);}},[open,editor]);
  const options:readonly MarkerStyle[]=ordered?orderedStyles:[...bulletStyles,'custom'], Preview=ordered?'ol':'ul';
  const error=ordered ? (prefix!==null && !validNumberAffix(prefix) || suffix!==null && !validNumberAffix(suffix)) ? 'Use up to 8 characters per field. Line breaks and %1–%9 placeholders are not supported.' : ''
    : style==='custom' && bullet!==null && !validBulletText(bullet) ? 'Enter one visible character or emoji.' : '';
  const previewStyle=style==='mixed' ? (ordered?'decimal':'disc') : style;
  const previewPrefix=prefix??'',previewSuffix=suffix??'.',previewBullet=bullet??'★';
  const customNumber=ordered && (previewPrefix!=='' || previewSuffix!=='.'), customBullet=!ordered && style==='custom';
  return <Dialog open={open} onOpenChange={value=>{if(!value)close();}}><DialogContent className="vdoc-dialog">
    <DialogTitle>List style</DialogTitle><DialogDescription>{targets.length>1 ? 'Applies to the lists in selected cells. Nested lists and unselected cells keep their settings. Mixed fields stay unchanged unless edited.' : ordered ? 'Applies to this list and lists connected by continued numbering. Nested lists keep their own style.' : 'Applies to this bulleted list. Nested lists keep their own style.'}</DialogDescription>
    <form className="properties-form" onSubmit={event=>{
      event.preventDefault();if(error)return;
      const operations:Operation[]=[];
      if(style!=='mixed' && style!=='custom' && style!==initial.current.style)operations.push({type:'list.style',style});
      const prefixChanged=prefix!==null && prefix!==initial.current.prefix,suffixChanged=suffix!==null && suffix!==initial.current.suffix;
      if(ordered && (prefixChanged || suffixChanged))operations.push({type:'list.marker',...(prefixChanged?{prefix:prefix!}:{}),...(suffixChanged?{suffix:suffix!}:{})});
      if(customBullet && bullet!==null && (style!==initial.current.style || bullet!==initial.current.bullet))operations.push({type:'list.marker',bullet});
      if(!operations.length){close();return;}
      const result=engine.execute({source:'toolbar',operations});if(result.ok)close();else toast.error(result.error);
    }}>
      <label className="wide-field">Marker style<select value={style} onChange={event=>{const next=event.target.value as MarkerStyle;setValues(v=>({...v,style:next,...(next==='custom' && v.bullet===null?{bullet:'★'}:{})}));}}>{initial.current.style==='mixed' && <option value="mixed">{labels.mixed}</option>}{options.map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label>
      {ordered && <><label>Before number<input value={prefix??''} placeholder={prefix===null?'Mixed — keep unchanged':undefined} maxLength={64} onChange={event=>setValues(v=>({...v,prefix:event.target.value}))} /></label><label>After number<input value={suffix??''} placeholder={suffix===null?'Mixed — keep unchanged':undefined} maxLength={64} onChange={event=>setValues(v=>({...v,suffix:event.target.value}))} /></label><button className="quiet-button wide-field" type="button" onClick={()=>setValues(v=>({...v,prefix:'',suffix:'.'}))}>Reset prefix and suffix</button></>}
      {customBullet && <label className="wide-field">Custom character<input value={bullet??''} placeholder={bullet===null?'Mixed — keep unchanged':undefined} maxLength={32} onChange={event=>setValues(v=>({...v,bullet:event.target.value}))} aria-invalid={Boolean(error)} aria-describedby={error?'list-marker-error':undefined} /></label>}
      {error && <p id="list-marker-error" className="wide-field" role="alert">{error}</p>}
      <div className="wide-field" aria-label="List style preview">{(style==='mixed' || prefix===null || suffix===null || customBullet && bullet===null) && <p>Example preview. Mixed values are preserved until you change them.</p>}<Preview data-number-prefix={customNumber?previewPrefix:undefined} data-bullet-text={customBullet?previewBullet:undefined} style={{listStyleType:previewStyle==='custom'?'disc':previewStyle,paddingInlineStart:80,margin:'8px 0',lineHeight:2,'--vdoc-counter-style':previewStyle,'--vdoc-prefix':markerCssString(previewPrefix),'--vdoc-suffix':markerCssString(previewSuffix),'--vdoc-bullet':markerCssString(previewBullet)} as CSSProperties}><li>First item</li><li>Second item</li><li>Third item</li></Preview></div>
      <button type="button" className="quiet-button" onClick={close}>Cancel</button><button type="submit" className="export-button" disabled={!targets.length || Boolean(error)}>Apply</button>
    </form>
  </DialogContent></Dialog>;
}
