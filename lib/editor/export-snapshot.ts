import { getHTMLFromFragment, type JSONContent } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import type { DocumentExportSource } from '../usecases/ports';

/** One immutable document revision per export. Representations are computed only
 * when a strategy reads them, and never consult the live editor after capture. */
export function createExportSnapshot(doc: Node, title: string): DocumentExportSource {
  let json: JSONContent | undefined;
  let html: string | undefined;
  return {
    title, doc,
    get json() { return json ??= doc.toJSON(); },
    get html() { return html ??= getHTMLFromFragment(doc.content, doc.type.schema); },
  };
}
