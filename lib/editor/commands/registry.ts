import type { CommandProps } from '@tiptap/core';
import type { Operation } from '../../domain/entities/operation';
import type { CommandContext, HandlerMap, OperationHandler, OperationType } from './types';
import { editorBundle } from '../feature-list';

// Keep compile-time coverage of every validated Operation after feature composition.
export const operationHandlers: Readonly<HandlerMap<OperationType>> = editorBundle.commands;

/** Built once per request, not per operation. Tiptap's chainable state refreshes
 *  its cached doc/selection when `tr` is read, so every command call reads it
 *  first; the wrappers are created lazily and reused for the whole batch. */
export function commandContext(props: CommandProps, onRejected?: (message: string) => void): CommandContext {
  const { state } = props;
  const wrapped = new Map<PropertyKey, unknown>();
  const c = new Proxy(props.commands, {
    get(target, key: keyof CommandProps['commands']) {
      let command = wrapped.get(key);
      if (!command) {
        command = (...args: unknown[]) => { void state.tr; return Reflect.apply(target[key], target, args); };
        wrapped.set(key, command);
      }
      return command;
    },
  });
  return { state, c, reject(message) { onRejected?.(message); return false; } };
}

export function applyOperation(op: Operation, context: CommandContext): boolean {
  // Handlers may read state.doc/selection before their first command call.
  void context.state.tr;
  return (operationHandlers[op.type] as OperationHandler<typeof op.type>)(op as never, context);
}
