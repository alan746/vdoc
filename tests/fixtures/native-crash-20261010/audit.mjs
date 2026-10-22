import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const read = name => {
  const bytes = fs.readFileSync(new URL(name, import.meta.url));
  return { document: JSON.parse(bytes), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
};
const compare = (beforeName, afterName) => {
  if (!fs.existsSync(new URL(afterName, import.meta.url))) return { before: beforeName, after: afterName, status: 'pending-download', titleAndFullContentEqual: null };
  const before = read(beforeName), after = read(afterName);
  assert.equal(after.document.title, before.document.title);
  assert.deepEqual(after.document.content, before.document.content);
  const counts = {};
  const walk = node => { counts[node.type] = (counts[node.type] || 0) + 1; node.content?.forEach(walk); };
  walk(after.document.content);
  assert.ok(JSON.stringify(after.document.content).includes('CRASH_SAVED_20261010_A'));
  assert.ok(!JSON.stringify(after.document.content).includes('CRASH_SAVED_20261010_Ax'));
  return { status: 'passed', before: beforeName, after: afterName, beforeSha256: before.sha256, afterSha256: after.sha256,
    titleAndFullContentEqual: true, nodeCounts: counts };
};
console.log(JSON.stringify({
  environment: 'macOS 26.6.2 (25G83), isolated WKWebView host; not Safari',
  storeID: '36A96756-6C93-43C3-932C-A4969A453A88',
  applicationSourceSha256: '8bb79a91f4000eb12f527c5d857edb39d249308c4361b8b033f7727167a93df4',
  savedCase: compare('before.vdoc.json', 'after-saved-crash.vdoc.json'),
  immediateCase: compare('before-immediate.vdoc.json', 'after-immediate-crash.vdoc.json'),
  boundary: 'SIGKILL terminates the isolated host PID. The next real key schedules host termination after 150 ms, before the normal 450 ms idle autosave. No evidence of storage-service termination or interruption inside an IndexedDB transaction.',
}, null, 2));
