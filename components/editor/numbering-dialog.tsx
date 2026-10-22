'use client';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { DocumentEngine } from '@/lib/editor/engine';
import { CellSelection } from '@tiptap/pm/tables';
import { MAX_LIST_START, canRestartNumbering, validListStart, cellRestartOverflows } from '@/lib/editor/list-numbering';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

export function NumberingDialog({ open, close, editor, engine }: { open: boolean; close: () => void; editor: Editor; engine: DocumentEngine }) {
  const [start, setStart] = useState('1');
  useEffect(() => { if (open) setStart('1'); }, [open]);
  const available = canRestartNumbering(editor.state.doc, editor.state.selection);
  const valid = start.trim() !== '' && validListStart(Number(start));
  const overflow = valid && cellRestartOverflows(editor.state.selection, Number(start));
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}><DialogContent className="vdoc-dialog">
    <DialogTitle>Restart numbering</DialogTitle>
    <DialogDescription>{editor.state.selection instanceof CellSelection ? 'Each independent numbered series in selected cells starts here. Continued sections stay connected. Nested lists keep their numbering.' : 'Set the number for this item. Following items at the same level will count from here.'}</DialogDescription>
    <form className="properties-form" onSubmit={event => {
      event.preventDefault();
      if (!valid || overflow) return;
      const result = engine.execute({ source: 'toolbar', operations: [{ type: 'list.restart', start: Number(start) }] });
      if (result.ok) close(); else toast.error(result.error);
    }}>
      <label className="wide-field">Start at<input autoFocus required type="number" min="0" max={MAX_LIST_START} step="1" value={start} onChange={event => setStart(event.target.value)} /></label>
      {overflow && <p className="wide-field" role="alert">A continued section would exceed the maximum start number. Choose a lower starting number.</p>}
      <button type="button" className="quiet-button" onClick={close}>Cancel</button>
      <button type="submit" className="export-button" disabled={!available || !valid || overflow}>Apply</button>
    </form>
  </DialogContent></Dialog>;
}
