import type { FileExporter } from '../../usecases/ports';

/** Keep the large converter lazy and forward its Blob without re-encoding. */
export const wordExporter: FileExporter = {
  async write(source, options) {
    const { exportWord } = await import('../word/word');
    options?.signal?.throwIfAborted();
    let checklist = false;
    source.doc.descendants(node => { if (node.type.name === 'taskList') checklist = true; });
    const blob = await exportWord(source.json, source.title);
    return { blob, notices: checklist ? [{ code: 'static-checklist', message: 'Checklists are exported as static checkbox symbols. Save a VDoc backup to keep interactive checkboxes and their settings.' }] : [] };
  },
};
