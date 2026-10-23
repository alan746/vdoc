import type { CommandProps } from '@tiptap/core';
import type { Operation } from '../../domain/entities/operation';
import type { HandlerMap, OperationHandler, OperationType } from './types';
import { editorBundle } from '../feature-list';

// Keep compile-time coverage of every validated Operation after feature composition.
export const operationHandlers: Readonly<HandlerMap<OperationType>> = editorBundle.commands;

export function applyOperation(op: Operation, props: CommandProps): boolean {
  const { state } = props;
  void state.tr;
  // Tiptap's chainable state refreshes its cached doc/selection when `tr` is read.
  // Refresh before every command, including several commands within one operation.
  const c = new Proxy(props.commands, {
    get(target, key: keyof CommandProps['commands']) {
      const command = target[key];
      return (...args: unknown[]) => { void state.tr; return Reflect.apply(command, target, args); };
    },
  });
  return (operationHandlers[op.type] as OperationHandler<typeof op.type>)(op as never, { state, c });
}
