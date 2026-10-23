import type { AnyExtension } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import type { NodeRule } from '../domain/rules/document-validation';
import type { Operation } from '../domain/entities/operation';
import type { HandlerMap, OperationType } from './commands/types';
import type { CommitTableResize } from './table/table-resize';

export type EditorFeatureOptions = {
  onShortcut?: (operation: Operation | 'undo' | 'redo') => boolean;
  onResize?: CommitTableResize;
  /** Supplied by the composer from all enabled features. */
  blockIdTypes?: readonly string[];
  onFormat?: (action: 'copy' | 'paste') => boolean;
};
/** Ascending order preserves schema rank, plugin precedence, CSS cascade and first-error reporting. */
export type Ordered<T> = { readonly order: number; readonly value: T };
export type EditorFeature = {
  readonly id: string;
  readonly extensions: (options: EditorFeatureOptions) => readonly Ordered<AnyExtension>[];
  readonly commands: Partial<HandlerMap<OperationType>>;
  readonly blockIdTypes?: readonly string[];
  readonly css?: readonly Ordered<string>[];
  readonly validation?: readonly Ordered<NodeRule>[];
  /** Runs after schema validation, for constraints such as occupied table grids. */
  readonly validateDocument?: (document: DocumentNode) => void;
};
