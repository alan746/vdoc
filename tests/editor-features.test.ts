import { expect, it, vi } from 'vitest';
import { Node, flattenExtensions, getSchema, type JSONContent } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { editorBundle, editorFeatures } from '../lib/editor/feature-list';
import { composeEditorFeatures } from '../lib/editor/compose-features';
import type { EditorFeature } from '../lib/editor/feature';
import { operationHandlers } from '../lib/editor/commands/registry';
import { operationSchema } from '../lib/domain/entities/operation';
import { validateDocumentTree } from '../lib/domain/rules/document-validation';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import baseline from './support/editor-schema-baseline.json';

it('preserves the pre-refactor extension order, compiled schema, attributes and operation handler set', () => {
  const extensions = createExtensions(), schema = getSchema(extensions);
  const specs = (types: typeof schema.nodes | typeof schema.marks) => Object.entries(types).map(([name, type]) => ({ name, spec: JSON.parse(JSON.stringify(type.spec)) }));
  expect(flattenExtensions(extensions).map(extension => extension.name)).toEqual(baseline.extensions);
  expect(specs(schema.nodes)).toEqual(baseline.nodes);
  expect(specs(schema.marks)).toEqual(baseline.marks);
  expect(Object.keys(operationHandlers).sort()).toEqual(baseline.commands);
  expect([...operationSchema.optionsMap.keys()].sort()).toEqual(baseline.commands);
  expect(flattenExtensions(createExtensions(() => true)).map(extension => extension.name)).toEqual([...baseline.extensions, 'vdocShortcuts']);
});

it('enables extensions, commands, styles and both validation phases by adding one feature', () => {
  const command = vi.fn(() => true), validate = vi.fn();
  const sample = {
    id: 'sample',
    extensions: () => [{ order: 900, value: Node.create({ name: 'sample', group: 'block', content: 'inline*' }) }],
    blockIdTypes: ['sample'],
    commands: { 'text.findReplace': command },
    css: [{ order: 900, value: '.sample { color: red; }' }],
    validation: [{ order: 900, value: (node: JSONContent) => { if (node.attrs?.sample === false) throw new Error('Invalid sample'); } }],
    validateDocument: validate,
  } satisfies EditorFeature;
  // Replace the search feature's operation with a sample implementation, using only the feature list.
  const features = editorFeatures.filter(feature => feature.id !== 'search');
  const disabled = composeEditorFeatures(features), enabled = composeEditorFeatures([...features, sample]);
  expect(disabled.commands).not.toHaveProperty('text.findReplace');
  expect(enabled.commands['text.findReplace']).toBe(command);
  expect(enabled.extensions().some(extension => extension.name === 'sample')).toBe(true);
  expect(disabled.css).not.toContain('.sample');
  expect(enabled.css).toContain('.sample { color: red; }');
  expect(() => validateDocumentTree({ type: 'doc', attrs: { sample: false } }, disabled.validation)).not.toThrow();
  expect(() => validateDocumentTree({ type: 'doc', attrs: { sample: false } }, enabled.validation)).toThrow('Invalid sample');
  const schema = getSchema(enabled.extensions());
  expect(schema.nodes.sample.create().attrs).toEqual({ blockId: null });
  expect(getSchema(disabled.extensions()).nodes.sample).toBeUndefined();
  const doc = schema.node('doc', null, [schema.node('sample')]);
  enabled.validateDocument(doc);
  expect(validate).toHaveBeenCalledWith(doc);
});

it('rejects duplicate features and handlers instead of silently overwriting another team’s contribution', () => {
  expect(() => composeEditorFeatures([...editorFeatures, editorFeatures[0]])).toThrow('Duplicate editor feature: document');
  expect(() => composeEditorFeatures([...editorFeatures, { ...editorFeatures[0], id: 'other' }])).toThrow('Duplicate operation handler');
});

it('preserves first-error order across feature boundaries and validates parents before children', () => {
  const node: JSONContent = { type: 'doc', attrs: {
    pageSize: 'bad', paragraphBorderJoin: 'bad', direction: 'bad', backgroundColor: 'bad',
  }, marks: [{ type: 'link', attrs: { href: 'javascript:bad' } }], content: [{ type: 'image', attrs: { src: 'bad' } }] };
  for (const [key, error] of [
    ['pageSize', 'unsupported page size'], ['paragraphBorderJoin', 'invalid paragraph border grouping'],
    ['direction', 'invalid text direction'], ['backgroundColor', 'invalid color'],
  ]) {
    expect(() => validateDocumentTree(node, editorBundle.validation)).toThrow(error);
    delete node.attrs![key];
  }
  expect(() => validateDocumentTree(node, editorBundle.validation)).toThrow('unsupported link');
  delete node.marks;
  expect(() => validateDocumentTree(node, editorBundle.validation)).toThrow('Images must be embedded');
});

it.each([
  [{ type: 'orderedList', attrs: { start: -1, paragraphBorders: 'bad' } }, 'invalid list start'],
  [{ type: 'paragraph', attrs: { paragraphBackground: 'bad', keepWithNext: 'bad' } }, 'invalid paragraph background'],
  [{ type: 'tableRow', attrs: { allowSplit: 'bad', direction: 'bad' } }, 'invalid row page-break setting'],
  [{ type: 'table', attrs: { pinnedRows: -1, columnDirection: 'bad' } }, 'invalid pinned row count'],
  [{ type: 'doc', attrs: { language: '!', alignment: 'bad' } }, 'invalid document language'],
  [{ type: 'tableCell', attrs: { borders: 'bad', padding: -1 } }, 'invalid cell borders'],
  [{ type: 'tableCell', attrs: { colspan: 0, padding: -1 } }, 'invalid layout value'],
  [{ type: 'tableCell', attrs: { colspan: 0 }, marks: [{ type: 'link', attrs: { href: 'bad' } }] }, 'invalid cell span'],
])('keeps validation precedence for %j', (node, error) => {
  expect(() => validateDocumentTree(node as JSONContent, editorBundle.validation)).toThrow(error);
});

it('uses feature rules in the actual backup parser before schema normalization', () => {
  const backup = { version: 1, title: 'Invalid', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { tabInterval: 0 } }] } };
  expect(() => parseDocument(JSON.stringify(backup))).toThrow('invalid tab interval');
});
