'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { canonicalLanguage, documentLanguages } from '@/lib/domain/text/language';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { applyFromDialog } from './apply-from-dialog';
export function LanguageDialog({open, close, engine}: {open: boolean; close: () => void; engine: DocumentEngine}) {
  return <Dialog open={open} onOpenChange={value => {if(!value) close();}}><DialogContent className="vdoc-dialog"><LanguageForm close={close} engine={engine} /></DialogContent></Dialog>;
}
// Mounted only while the dialog is open, so each opening reads the current document.
function LanguageForm({close, engine}: {close: () => void; engine: DocumentEngine}) {
  const [language, setLanguage] = useState<string>(() => engine.editor.state.doc.attrs.language || 'und');
  const valid = canonicalLanguage(language);
  return <><DialogTitle>Document language</DialogTitle><DialogDescription>Set the language of this document for browsers and exported files. Spelling support depends on your browser’s installed dictionaries.</DialogDescription><form className="properties-form" onSubmit={e => { e.preventDefault(); if(!valid) return; applyFromDialog(engine, [{type:'document.language',language:valid}], close); }}>
    <label className="wide-field">Language<select aria-label="Document language" value={documentLanguages.some(([tag])=>tag===language) ? language : 'custom'} onChange={e=>{setLanguage(e.target.value==='custom' ? '' : e.target.value);}}>{documentLanguages.map(([tag,name])=><option key={tag} value={tag}>{name}</option>)}<option value="custom">Custom language tag</option></select></label>
    <label className="wide-field">Language tag<input aria-label="Language tag" value={language} maxLength={100} onChange={e=>setLanguage(e.target.value)} placeholder="For example: en-GB, fr-CA, zh-Hant-TW" aria-invalid={!valid} /></label>
    {!valid && <p role="alert" className="wide-field">Enter a valid language tag, such as en-GB or ar.</p>}
    <div className="dialog-actions wide-field"><button className="secondary-button" type="button" onClick={close}>Cancel</button><button className="export-button" type="submit" disabled={!valid}>Apply language</button></div>
  </form></>;
}
