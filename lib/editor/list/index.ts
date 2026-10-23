import { styles } from './styles';
import { ListItem, TaskItem, ListKeymap } from '@tiptap/extension-list';
import { VdocOrderedList } from './list-numbering';
import { VdocBulletList } from './list-style';
import { VdocTaskList } from './checklist';
import { ListEditing } from './list-editing';
import { ListConversion } from './list-conversion';
import { listCommands } from './commands';
import { listRule } from './validation';
import type { EditorFeature } from '../feature';

export const listFeature = {
  id: 'list',
  blockIdTypes: ['bulletList', 'orderedList', 'taskList', 'taskItem'],
  extensions: () => [
    { order: 610, value: ListKeymap },
    { order: 900, value: VdocOrderedList },
    { order: 1000, value: VdocBulletList },
    { order: 1100, value: ListItem.extend({ content: '(paragraph | heading) block*' }) },
    { order: 1200, value: ListEditing },
    { order: 1300, value: ListConversion },
    { order: 2200, value: VdocTaskList },
    { order: 2300, value: TaskItem.extend({ content() { return this.options.nested ? '(paragraph | heading) block*' : '(paragraph | heading)+'; } }).configure({ nested: true }) },
  ],
  css: styles,
  commands: listCommands,
  validation: [{ order: 200, value: listRule }],
} satisfies EditorFeature;
