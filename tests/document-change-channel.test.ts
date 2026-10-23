import { afterEach, expect, it, vi } from 'vitest';
import { createDocumentChanges } from '../lib/infrastructure/persistence/document-change-channel';

// vdoc#69: real BroadcastChannel between two "tabs" (two instances with
// distinct tab IDs on one channel name), with real timers.
let channelName = '';
const tab = (id: string) => createDocumentChanges(id, channelName);
const delivered = () => new Promise(resolve => setTimeout(resolve, 30));
afterEach(() => vi.unstubAllGlobals());

it('notifies another tab watching the same document, not other documents', async () => {
  channelName = `vdoc.test.${crypto.randomUUID()}`;
  const writer = tab('tab-1'), reader = tab('tab-2');
  const same = vi.fn(), other = vi.fn();
  reader.watch('doc-a', same); reader.watch('doc-b', other);
  writer.announce('doc-a');
  await delivered();
  expect(same).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();
});

it('never notifies the tab that wrote', async () => {
  channelName = `vdoc.test.${crypto.randomUUID()}`;
  const self = tab('tab-1'), listener = vi.fn();
  self.watch('doc-a', listener);
  self.announce('doc-a');
  await delivered();
  expect(listener).not.toHaveBeenCalled();
});

it('stops notifying after unsubscribe', async () => {
  channelName = `vdoc.test.${crypto.randomUUID()}`;
  const writer = tab('tab-1'), reader = tab('tab-2'), listener = vi.fn();
  const stop = reader.watch('doc-a', listener);
  stop();
  writer.announce('doc-a');
  await delivered();
  expect(listener).not.toHaveBeenCalled();
});

it('falls back to a localStorage record and storage events without BroadcastChannel', () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  const writer = tab('tab-1'), reader = tab('tab-2'), listener = vi.fn();
  reader.watch('doc-a', listener);
  writer.announce('doc-a');
  const record = localStorage.getItem('vdoc.documents.changed')!;
  expect(JSON.parse(record)).toMatchObject({ documentId: 'doc-a', tabId: 'tab-1' });
  // Browsers fire `storage` only in other tabs; deliver it as the reader's tab would see it.
  window.dispatchEvent(new StorageEvent('storage', { key: 'vdoc.documents.changed', newValue: record }));
  expect(listener).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new StorageEvent('storage', { key: 'vdoc.documents.changed', newValue: JSON.stringify({ documentId: 'doc-a', tabId: 'tab-2' }) }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'vdoc.documents.changed', newValue: '{not json' }));
  expect(listener).toHaveBeenCalledTimes(1);
});
