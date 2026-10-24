import type { CommandProps } from '@tiptap/core';
import type { Operation } from '../../domain/entities/operation';

export type OperationType = Operation['type'];
export type CommandContext = { state: CommandProps['state']; c: CommandProps['commands']; reject(message: string): false };
/** Applies one validated operation inside the engine's transaction; false rejects the whole request. */
export type OperationHandler<T extends OperationType> = (op: Extract<Operation, { type: T }>, context: CommandContext) => boolean;
export type HandlerMap<T extends OperationType> = { [K in T]: OperationHandler<K> };
/** Declares a feature's handlers. The handled operation types are inferred from
 *  the keys (no separate list to keep in sync), each handler's `op` is typed from
 *  its key, and an unknown key is a compile error. Full coverage across features
 *  is still enforced where they are composed (commands/registry.ts). */
export function defineHandlers<const T extends OperationType>(handlers: HandlerMap<T>): HandlerMap<T> { return handlers; }
/** An operation's payload without its discriminator, for spreading into node or document attributes. */
export function operationFields<T extends { type: string }>(op: T): Omit<T, 'type'> {
  const fields: Partial<T> = { ...op };
  delete fields.type;
  return fields as Omit<T, 'type'>;
}
