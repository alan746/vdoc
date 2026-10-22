'use client';
import type { IndentValues } from '@/lib/editor/paragraph-indent';

export function IndentFields({value,change}:{value:IndentValues;change:(next:IndentValues)=>void}) {
  const mode=value.firstLineIndent===null?'mixed':value.firstLineIndent>0?'first':value.firstLineIndent<0?'hanging':'none';
  return <>
    <label>Start indent (px)<input type="number" step="any" min="-10000" max="10000" placeholder="Mixed" value={value.indentStart ?? ''} onChange={e=>change({...value,indentStart:e.target.value===''?null:+e.target.value})}/></label>
    <label>End indent (px)<input type="number" step="any" min="-10000" max="10000" placeholder="Mixed" value={value.indentEnd ?? ''} onChange={e=>change({...value,indentEnd:e.target.value===''?null:+e.target.value})}/></label>
    <label>Special indent<select value={mode} onChange={e=>change({...value,firstLineIndent:e.target.value==='mixed'?null:e.target.value==='none'?0:(e.target.value==='hanging'?-1:1)*(Math.abs(value.firstLineIndent || 24))})}>
      {mode==='mixed' && <option value="mixed">Mixed — keep existing</option>}<option value="none">None</option><option value="first">First line</option><option value="hanging">Hanging</option>
    </select></label>
    <label>Indent amount (px)<input type="number" min="0" max="10000" step="any" disabled={mode==='mixed'||mode==='none'} value={Math.abs(value.firstLineIndent || 0)} onChange={e=>change({...value,firstLineIndent:(mode==='hanging'?-1:1)*+e.target.value})}/></label>
    <p className="wide-field">Start follows the paragraph’s writing direction. Hanging indents shift every line except the first.</p>
  </>;
}
