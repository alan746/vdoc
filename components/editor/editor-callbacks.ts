import type { Operation } from '@/lib/domain/entities/operation';
import type { createExtensions } from '@/lib/editor/extensions';

type Shortcut = NonNullable<Parameters<typeof createExtensions>[0]>;
type Resize = NonNullable<Parameters<typeof createExtensions>[1]>;
type Format = NonNullable<Parameters<typeof createExtensions>[2]>;
export type EditorCallbackHandlers = { shortcut: Shortcut; resize: Resize; format: Format };

/**
 * Editor extensions are built once, before the engine exists, but only call
 * back from ProseMirror events. This forwards those calls to the handlers the
 * workspace attaches after mount, so building extensions never reads a ref.
 */
export class EditorCallbacks {
  private handlers: EditorCallbackHandlers | null = null;
  attach(handlers: EditorCallbackHandlers) {
    this.handlers = handlers;
    return () => { if (this.handlers === handlers) this.handlers = null; };
  }
  readonly shortcut = (op: Operation | 'undo' | 'redo') => this.handlers?.shortcut(op) ?? false;
  readonly resize: Resize = request => this.handlers?.resize(request);
  readonly format = (action: 'copy' | 'paste') => this.handlers?.format(action) ?? false;
}
