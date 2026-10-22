'use client';
import { toast } from 'sonner';
import type { DocumentImport } from '@/lib/composition/import-file';

// Both entry points report only after the imported document has opened successfully.
export function notifyDocumentImport(result: DocumentImport) {
  if (result.format !== 'word') return;
  const hasWarnings = result.warnings.length > 0;
  toast.info(hasWarnings ? 'Word imported — review formatting' : 'Word imported', {
    duration: hasWarnings ? Infinity : 8000,
    closeButton: true,
    description: <div><p>Check page layout and formatting; complex Word features may differ.</p>{hasWarnings && <ul tabIndex={0} aria-label="Word import details" style={{ maxHeight: '35vh', overflowY: 'auto', paddingLeft: '1.2em', listStyleType: 'disc', marginTop: '0.5em' }}>{result.warnings.map(message => <li key={message}>{message}</li>)}</ul>}</div>,
  });
}
