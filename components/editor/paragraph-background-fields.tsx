'use client';
import type { ParagraphBackground } from '@/lib/editor/paragraph/paragraph-background';

export function ParagraphBackgroundFields({value, change, mixed}: {value: ParagraphBackground; change: (value: ParagraphBackground) => void; mixed: boolean}) {
  const mode = value === 'mixed' ? 'mixed' : value !== null ? 'color' : 'none';
  return <>
    <label className="wide-field">Paragraph background<select value={mode} onChange={event => change(event.target.value === 'mixed' ? 'mixed' : event.target.value === 'none' ? null : '#FFF2CC')}>
      {mixed && <option value="mixed">Mixed — keep existing</option>}
      <option value="none">None</option><option value="color">Custom color</option>
    </select></label>
    {mode === 'color' && <><label>Background color<input aria-label="Paragraph background color" type="color" value={/^#[\da-f]{6}$/i.test(value || '') ? value! : '#FFF2CC'} onChange={event => change(event.target.value.toUpperCase())}/></label>
      <label>Background HEX<input aria-label="Paragraph background HEX" value={value || ''} required pattern="#[0-9a-fA-F]{6}" maxLength={7} onChange={event => change(event.target.value)}/></label></>}
  </>;
}
