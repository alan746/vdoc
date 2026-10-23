import { Extension } from '@tiptap/core';
import type { Operation } from '../../domain/entities/operation';
import { selectedListItemType, availableIndentCommand } from '../list/list-editing';
import type { EditorFeatureOptions } from '../feature';

export function createShortcuts({ onShortcut, onFormat }: EditorFeatureOptions) {
  const Shortcuts = Extension.create({
    name: 'vdocShortcuts', priority: 1000,
    addKeyboardShortcuts() {
      const run = (op: Operation | 'undo' | 'redo') => () => onShortcut?.(op) ?? false;
      const format = (action:'copy'|'paste') => () => {
        if (!onFormat || this.editor.view.composing || !this.editor.isEditable) return false;
        onFormat(action);return true;
      };
      const indent = (direction: 'in' | 'out') => () => {
        if (this.editor.view.composing || !this.editor.isEditable) return false;
        const type = availableIndentCommand(this.editor, direction);
        // The editor owns these keys even at a boundary, avoiding browser history navigation.
        return type ? onShortcut?.({type, direction}) ?? false : true;
      };
      return {
        'Mod-Alt-c': format('copy'),
        'Mod-Alt-v': format('paste'),
        'Mod-]': indent('in'),
        'Mod-[': indent('out'),
        Tab: () => {
          if (this.editor.isActive('table') || this.editor.isActive('codeBlock')) return false;
          if (selectedListItemType(this.editor.state.selection)) return onShortcut?.({ type: 'list.indent', direction: 'in' }) ?? false;
          if (this.editor.isActive('listItem') || this.editor.isActive('taskItem')) return false;
          if (!this.editor.state.selection.$from.parent.isTextblock || this.editor.view.composing) return false;
          return onShortcut?.({ type: 'text.insert', text: '\t' }) ?? false;
        },
        'Shift-Tab': () => {
          if (this.editor.isActive('table') || this.editor.isActive('codeBlock') || !selectedListItemType(this.editor.state.selection)) return false;
          return onShortcut?.({ type: 'list.indent', direction: 'out' }) ?? false;
        },
        'Mod-b': run({ type: 'text.toggle', mark: 'bold' }),
        'Mod-i': run({ type: 'text.toggle', mark: 'italic' }),
        'Mod-u': run({ type: 'text.toggle', mark: 'underline' }),
        'Mod-Shift-x': run({ type: 'text.toggle', mark: 'strike' }),
        'Mod-z': run('undo'), 'Mod-Shift-z': run('redo'), 'Mod-y': run('redo'),
        'Mod-Alt-0': run({ type: 'paragraph.style', level: 0 }),
        'Mod-Alt-1': run({ type: 'paragraph.style', level: 1 }),
        'Mod-Alt-2': run({ type: 'paragraph.style', level: 2 }),
        'Mod-Alt-3': run({ type: 'paragraph.style', level: 3 }),
        'Mod-Shift-7': run({ type: 'list.toggle', kind: 'ordered' }),
        'Mod-Shift-8': run({ type: 'list.toggle', kind: 'bullet' }),
        'Mod-Shift-l': run({ type: 'paragraph.style', align: 'left' }),
        'Mod-Shift-e': run({ type: 'paragraph.style', align: 'center' }),
        'Mod-Shift-r': run({ type: 'paragraph.style', align: 'right' }),
        'Mod-Shift-j': run({ type: 'paragraph.style', align: 'justify' }),
      };
    },
  });
  return Shortcuts;
}
