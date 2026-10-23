import { qaPath } from '../tools/qa-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = process.cwd(), out = qaPath('final-five-20261010');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => JSON.parse(fs.readFileSync(name, 'utf8'));
function describe(file) {
  const bytes = fs.readFileSync(file), value = JSON.parse(bytes);
  const nodes = {}, text = [];
  const walk = n => { nodes[n.type] = (nodes[n.type] || 0) + 1; if (n.text) text.push(n.text); n.content?.forEach(walk); };
  walk(value.content);
  return { file, sha256: sha(bytes), bytes: bytes.length, title: value.title, version: value.version,
    attributes: value.content.attrs, nodes, containsClockCharacter: text.join('').includes('钟') };
}
const A = describe('examples/final-native-acceptance.vdoc.json');
const B = describe(qaPath('safari-preview/source.vdoc.json'));
const after = describe(qaPath('safari-search-20261010/after-search.vdoc.json'));
for (const doc of [A, B]) {
  assert.equal(doc.nodes.doc, 1); assert.ok(doc.nodes.table && doc.nodes.image && doc.nodes.bulletList);
  assert.ok(doc.attributes.header);
}
const original = read(B.file), saved = read(after.file);
assert.equal(saved.title, original.title); assert.deepEqual(saved.content, original.content);
const entries = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) walk(file); else if (e.isFile()) entries.push({ file, sha256: sha(fs.readFileSync(file)) });
  }
}
for (const dir of ['app', 'components', 'lib']) walk(dir);
entries.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
const snapshot = {
  algorithm: 'SHA-256 of UTF-8 JSON.stringify(sorted array of {file,sha256}), paths relative to repository. This is a new explicit manifest, not the older undocumented aggregate algorithm.',
  applicationSha256: sha(JSON.stringify(entries)), files: entries,
  configurations: ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'vitest.config.ts'].map(file => ({ file, sha256: sha(fs.readFileSync(file)) })),
};
fs.writeFileSync(`${out}/source-manifest.json`, JSON.stringify(snapshot, null, 2) + '\n');
const mappingSpec = [
  ['正文', 'components/editor/workspace.tsx', 'compositionCapture', 'lib/usecases/autosave.ts', 'const composing'],
  ['列表', 'lib/editor/list/list-editing.ts', 'editor.view.composing', 'lib/usecases/autosave.ts', 'const composing'],
  ['表格', 'lib/editor/table/table-resize.ts', 'view.composing', 'lib/usecases/engine.ts', 'COMPOSING'],
  ['文档标题', 'components/editor/workspace.tsx', 'aria-label="Document title"', 'components/editor/use-input-composition.ts', 'onCompositionStartCapture'],
  ['查找替换', 'components/editor/editing-panels.tsx', 'composition.isComposing', 'components/editor/editing-panels.tsx', 'Replace with'],
  ['页眉', 'components/editor/document-dialogs.tsx', 'Header<input', 'components/ui/dialog.tsx', 'onSubmitCapture={event'],
  ['图片说明', 'components/editor/document-dialogs.tsx', 'Alternative text<input', 'components/ui/dialog.tsx', 'onSubmitCapture={event'],
  ['版本名称', 'components/editor/version-history.tsx', 'Version name<input', 'components/ui/dialog.tsx', 'onSubmitCapture={event'],
];
const mappings = mappingSpec.map(([context, ...pairs]) => {
  const refs = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const [file, needle] = pairs.slice(i, i + 2), lines = fs.readFileSync(file, 'utf8').split('\n');
    const index = lines.findIndex(line => line.includes(needle)); assert.ok(index >= 0, `${file}: ${needle}`);
    refs.push({ file, line: index + 1, needle });
  }
  return { context, refs, limit: 'Source mapping only; does not prove operating-system IME behavior.' };
});
const logFile = `${out}/ime-components.log`, log = fs.readFileSync(logFile, 'utf8');
assert.match(log, /Test Files\s+6 passed/); assert.match(log, /Tests\s+59 passed/);
const now = new Date().toISOString();
const audit = { date: now, fixtures: { A, B, afterSearch: after }, titleAndFullContentEqual: true,
  sourceManifest: `${out}/source-manifest.json`, applicationFiles: entries.length, mappings,
  componentTests: { command: 'npm test -- tests/color-composition.test.ts tests/composition-storage.test.ts tests/dialog-composition.test.ts tests/workspace-composition.test.ts tests/dialog-composition-editing.test.ts tests/composition-autosave-integration.test.ts --maxWorkers=2', files: 6, tests: 59, log: logFile, sha256: sha(log) },
  imeReconciliation: 'User confirmed exactly one 钟, no extra newline and candidate cancellation; the later B backup equals original and has no added 钟. Current persistence is unverified; no assumed data-loss finding.',
  nativeBlock: 'Current getApp(com.apple.Safari) was rejected by automatic approval because it could read other windows. Existing permission covers only the two-tab independent VDoc window. No workaround used.',
};
fs.writeFileSync(`${out}/preflight.json`, JSON.stringify(audit, null, 2) + '\n');
const file = 'docs/acceptance/final-five-ledger.json', ledger = read(file);
function set(id, status, result, evidence, blocker = '') {
  Object.assign(ledger.rows.find(r => r.id === id), { status, result, evidence, blocker, verifiedAt: now,
    next: status === '已核验' || status === '组件通过' ? '保留此行证据；继续后续必要步骤' : '解决所列差异/阻塞后按原步骤实测' });
}
const evidence = `${out}/preflight.json`;
set('I001', '已核验', `A 可解析；${A.bytes} 字节；SHA-256 ${A.sha256}`, evidence);
set('I002', '已核验', `B 可解析；${B.bytes} 字节；SHA-256 ${B.sha256}`, evidence);
set('I003', '已核验', `A/B 均有正文、列表、表格、图片和页眉；标题来自备份字段。查找框、版本名称须通过 UI 单独打开，不能由节点存在证明可用。`, evidence);
set('I004', '已核验', '八个入口及共用 composition/提交保护、保存路径已定位；正文依赖编辑器原生处理，原生候选行为仍待验。', evidence);
set('I005', '组件通过', '本轮实际运行 6 文件 / 59 测试通过；属于合成事件及组件回归，不是 OS IME 验收。', logFile);
set('I006', '已核验', audit.imeReconciliation, `${evidence}; ${qaPath('native-ime-20261010/observations.json')}`);
set('I007', '已核验', `${entries.length} 个应用文件已生成可复算的逐文件快照；采用明示的新聚合算法，不与旧哈希直接混比。`, `${out}/source-manifest.json`);
set('I008', '已核验', '查找后真实 B 备份的 title 与完整 content 等于原 B；不含新增“钟”。', evidence);
set('I009', '阻塞', '限定窗口授权已存在；当前工具入口的范围超过该窗口，自动审批拒绝，未取得本轮原生状态。', evidence, audit.nativeBlock);
set('I010', '阻塞', '尚未在本轮确认目标并取得输入前新备份。', evidence, '依赖 I009；不在身份未确认的窗口输入。');
set('I011', '用户已确认', '历史用户确认已切换系统输入法且候选窗出现；非当前代码快照重新实测。', qaPath('native-ime-20261010/observations.json'));
set('I012', '用户已确认', '历史用户确认只增加一个“钟”，无额外换行；持久化另验。', qaPath('native-ime-20261010/observations.json'));
set('I014', '用户已确认', '历史用户确认候选取消正确；未外推其余七个位置。', qaPath('native-ime-20261010/observations.json'));
set('I019', '待对应存档', '现有 B 备份未含用户确认的“钟”，不能签收该次字符保存/刷新。', evidence, '需确认同一文档、同次输入及后续备份；不直接判定产品丢字。');
for (const row of ledger.rows) {
  if (row.gate === 'I' && row.status === '待执行') row.blocker = '原生步骤依赖 I009/I010；组件通过不可替代。';
}
ledger.executionLog = [{ at: now, action: '第一批 I001–I010 核验：7 行已核验，1 行组件通过，2 行实机前置阻塞；归并三条既有用户确认，一条持久化待对应。', evidence }];
fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ fixtures: { A: A.nodes, B: B.nodes }, files: entries.length, componentTests: 59, rows: ledger.rows.length, output: path.join(root, evidence) }, null, 2));
