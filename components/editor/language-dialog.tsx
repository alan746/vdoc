'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { canonicalLanguage, documentLanguages } from '@/lib/editor/language';
import type { DocumentEngine } from '@/lib/editor/engine';
export function LanguageDialog({open, close, engine}: {open: boolean; close: () => void; engine: DocumentEngine}) {
  const [language, setLanguage] = useState('und');
  useEffect(() => { if(open) setLanguage(engine.editor.state.doc.attrs.language || 'und'); }, [open, engine]);
  const valid = canonicalLanguage(language);
  return <Dialog open={open} onOpenChange={value => {if(!value) close();}}><DialogContent className="vdoc-dialog"><DialogTitle>Document language</DialogTitle><DialogDescription>Set the language of this document for browsers and exported files. Spelling support depends on your browser’s installed dictionaries.</DialogDescription><form className="properties-form" onSubmit={e => { e.preventDefault(); if(!valid) return; const result = engine.execute({source:'toolbar',operations:[{type:'document.language',language:valid}]}); if(result.ok) close(); else toast.error(result.error); }}>
    <label className="wide-field">Language<select aria-label="Document language" value={documentLanguages.some(([tag])=>tag===language) ? language : 'custom'} onChange={e=>{setLanguage(e.target.value==='custom' ? '' : e.target.value);}}>{documentLanguages.map(([tag,name])=><option key={tag} value={tag}>{name}</option>)}<option value="custom">Custom language tag</option></select></label>
    <label className="wide-field">Language tag<input aria-label="Language tag" value={language} maxLength={100} onChange={e=>setLanguage(e.target.value)} placeholder="For example: en-GB, fr-CA, zh-Hant-TW" aria-invalid={!valid} /></label>
    {!valid && <p role="alert" className="wide-field">Enter a valid language tag, such as en-GB or ar.</p>}
    <div className="dialog-actions wide-field"><button className="secondary-button" type="button" onClick={close}>Cancel</button><button className="export-button" type="submit" disabled={!valid}>Apply language</button></div>
  </form></DialogContent></Dialog>;
}
