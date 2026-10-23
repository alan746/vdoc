import type { RefObject } from 'react';

/** File types accepted by document import (VDoc backup, Word, plain text). */
export const IMPORT_ACCEPT = '.json,.docx,.txt';

/** Hidden file picker for document import. Clears its value so the same file can be chosen again. */
export function DocumentImportInput({ inputRef, disabled, label, onFile }: { inputRef: RefObject<HTMLInputElement | null>; disabled: boolean; label: string; onFile: (file: File) => void }) {
  return <input ref={inputRef} type="file" hidden accept={IMPORT_ACCEPT} disabled={disabled} aria-label={label} onChange={e => {
    const selected = e.target.files?.[0]; e.target.value = '';
    if (selected) onFile(selected);
  }} />;
}
