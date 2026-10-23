import type { DocumentEngine } from '@/lib/usecases/engine';
import { copyTextFormat, canPasteTextFormat } from '@/lib/editor/format/format-copy';
import { availableIndentCommand } from '@/lib/editor/list/list-editing';
import { canContinueNumbering, canRestartNumbering } from '@/lib/editor/list/list-numbering';

/** Values consumed by menus, toolbar and page chrome, without caret offsets during typing. */
export function workspaceSelection(engine: DocumentEngine): string {
  const { editor } = engine;
  const { doc, selection, storedMarks } = editor.state;
  const parents = Array.from({ length: selection.$from.depth }, (_, index) => {
    const node = selection.$from.node(index + 1);
    return [node.type.name, node.attrs];
  });
  return JSON.stringify({
    page: doc.attrs,
    parents,
    marks: (storedMarks ?? selection.$from.marks()).map(mark => mark.toJSON()),
    // Non-caret selections can span arbitrary content/marks; retain full invalidation there.
    selection: selection.empty ? selection.toJSON().type : [selection.toJSON(), engine.revision],
    undo: engine.canUndo, redo: engine.canRedo, records: engine.records,
    copy: copyTextFormat(editor) !== null, paste: canPasteTextFormat(editor),
    indent: availableIndentCommand(editor, 'in'), outdent: availableIndentCommand(editor, 'out'),
    restart: canRestartNumbering(doc, selection), continue: canContinueNumbering(doc, selection),
  });
}
