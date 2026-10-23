import type { EditorFeature, EditorFeatureOptions, Ordered } from './feature';
import type { HandlerMap, OperationType } from './commands/types';

type Intersection<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer I) => void ? I : never;
function ordered<T>(items: readonly Ordered<T>[]): T[] {
  return [...items].sort((a, b) => a.order - b.order).map(item => item.value);
}

/** Pure composition: no global registration, editor instance or DOM side effects. */
export function composeEditorFeatures<const F extends readonly EditorFeature[]>(features: F) {
  const ids = new Set<string>();
  const commands: Partial<HandlerMap<OperationType>> = {};
  for (const feature of features) {
    if (ids.has(feature.id)) throw new Error(`Duplicate editor feature: ${feature.id}`);
    ids.add(feature.id);
    for (const name of Object.keys(feature.commands)) {
      if (Object.hasOwn(commands, name)) throw new Error(`Duplicate operation handler: ${name}`);
    }
    Object.assign(commands, feature.commands);
  }
  return {
    // F retains the concrete keys so the application's full Operation coverage is checked by TypeScript.
    commands: Object.freeze(commands) as Readonly<Intersection<F[number]['commands']>>,
    extensions: (options: EditorFeatureOptions = {}) => ordered(features.flatMap(feature => feature.extensions({ ...options, blockIdTypes: features.flatMap(item => item.blockIdTypes ?? []) }))),
    css: ordered(features.flatMap(feature => feature.css ?? [])).join('\n'),
    validation: Object.freeze(ordered(features.flatMap(feature => feature.validation ?? []))),
    validateDocument: (document: Parameters<NonNullable<EditorFeature['validateDocument']>>[0]) => {
      for (const feature of features) feature.validateDocument?.(document);
    },
  };
}
