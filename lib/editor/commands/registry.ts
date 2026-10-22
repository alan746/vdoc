import type { CommandProps } from '@tiptap/core';
import type { Operation } from '../../domain/entities/operation';
import type { HandlerMap, OperationHandler, OperationType } from './types';
import { textCommands } from './text-commands';
import { tableCommands } from './table-commands';
import { paragraphCommands } from './paragraph-commands';
import { listCommands } from './list-commands';
import { blockCommands } from './block-commands';

// Command registry: adding an operation means adding one handler to its family
// module. The mapped type makes a missing handler a compile error.
const handlers: HandlerMap<OperationType> = { ...textCommands, ...tableCommands, ...paragraphCommands, ...listCommands, ...blockCommands };

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
  return (handlers[op.type] as OperationHandler<typeof op.type>)(op as never, { state, c });
}
