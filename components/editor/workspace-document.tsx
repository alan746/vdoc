'use client';
import { FileText, PanelLeftClose } from 'lucide-react';
import type { Node } from '@tiptap/pm/model';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { documentStatistics, selectionGraphemeCount } from '@/lib/domain/text/unicode';
import { UNTITLED_DOCUMENT } from '@/lib/domain/entities/document';
import { documentDisplaySummary } from '@/lib/editor/document/display-summary';
import { useEngineSelector } from './use-engine-selector';

const characters = (engine: DocumentEngine) => documentStatistics(engine.editor.state.doc).characters;
const words = (engine: DocumentEngine) => documentStatistics(engine.editor.state.doc).words;
const selectedCharacters = (engine: DocumentEngine) => selectionGraphemeCount(engine.editor.state.doc, engine.editor.state.selection);
const outline = (engine: DocumentEngine) => JSON.stringify(documentDisplaySummary(engine.editor.state.doc).headings.map(({ from: position, ...heading }) => {
  const from = engine.editor.state.selection.from;
  return { ...heading, current: from >= position && from <= position + heading.text.length + 2 };
}));
const notesCache = new WeakMap<Node, string>();
const notes = (engine: DocumentEngine) => {
  const doc = engine.editor.state.doc;
  const cached = notesCache.get(doc);
  if (cached !== undefined) return cached;
  const value = JSON.stringify(documentDisplaySummary(doc).notes);
  notesCache.set(doc, value);
  return value;
};

export function DocumentCharacters({ engine }: { engine: DocumentEngine }) {
  const count = useEngineSelector(engine, characters, 0);
  return <span>{count.toLocaleString('en-US')} characters</span>;
}
export function SelectedCharacters({ engine }: { engine: DocumentEngine }) {
  const count = useEngineSelector(engine, selectedCharacters, 0);
  return count > 0 ? <span>{count} characters selected</span> : null;
}
export function DocumentStatistics({ engine }: { engine: DocumentEngine }) {
  const chars = useEngineSelector(engine, characters, 0);
  const count = useEngineSelector(engine, words, 0);
  const selection = useEngineSelector(engine, selectedCharacters, 0);
  return <><p>{count.toLocaleString('en-US')} words · {chars.toLocaleString('en-US')} characters without spaces</p><p>{selection.toLocaleString('en-US')} characters selected</p></>;
}
export function DocumentNotes({ engine }: { engine: DocumentEngine }) {
  const value = useEngineSelector(engine, notes, '[]');
  const entries: { number: number; text: string }[] = JSON.parse(value);
  return entries.length ? <section className="document-notes" aria-label="Footnotes">{entries.map(note => <p key={note.number}><sup>{note.number}</sup> {note.text}</p>)}</section> : null;
}
export function DocumentOutline({ engine, title, close }: { engine: DocumentEngine; title: string; close: () => void }) {
  const value = useEngineSelector(engine, outline, '[]');
  const headings: { id: string; text: string; level: number; current: boolean }[] = JSON.parse(value);
  const editor = engine.editor;
  return <aside className="document-outline" aria-label="Document outline"><div className="outline-heading"><span>Document outline</span><button className="quiet-button" aria-label="Collapse outline" onClick={close}><PanelLeftClose size={16} /></button></div><div className="outline-document"><FileText size={16} /><span>{title || UNTITLED_DOCUMENT}</span></div><div className="outline-links">{headings.map(h => <button key={h.id} className={`outline-item level-${h.level} ${h.current ? 'current' : ''}`} onClick={() => {
    // Positions are resolved at click time: preceding edits need not rerender unchanged headings.
    const range = engine.locateBlock(h.id);
    if (!range) return;
    editor.commands.setTextSelection(range.from + 1); engine.clearSelectionBookmark(); editor.view.focus();
    const element = editor.view.nodeDOM(range.from);
    if (element instanceof Element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }}>{h.text}</button>)}</div><div className="outline-footer"><span className="brand-word">vdoc<span>.</span></span><span>A little room to think.</span></div></aside>;
}
