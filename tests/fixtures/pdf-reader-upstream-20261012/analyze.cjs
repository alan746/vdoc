const fs = require('node:fs');
const crypto = require('node:crypto');
const dir = 'tests/fixtures/pdf-reader-upstream-20261012';
const read = name => JSON.parse(fs.readFileSync(dir + '/' + name));
const collapse = s => s.replace(/\s+/gu, ' ').trim();
const hindi = s => [...s.matchAll(/[\p{Script=Devanagari}]+/gu)].map(x => x[0]);
const old = JSON.parse(fs.readFileSync('tests/fixtures/pdf-direct-readers-20261012/copy-readers.json'));
const initial = read('repaired-results.json'), ready = read('repaired-ready-results.json');
const oldControl = read('old-control.json');
const control = initial.results.find(r => r.label === 'upstream-td');
if (control.copiedText !== 'सप्रणाम' || oldControl.actual !== 'सप्र णाम') throw Error('Reader control did not reproduce expected distinction');
const comparisons = ready.results.map(r => {
  if (r.error || r.errors.length) throw Error('Reader failed');
  const before = old.results.find(x => x.label === r.label);
  if (r.sha256 !== before.pdfSha256) throw Error('PDF changed between readers');
  const e = hindi(r.sourceText), b = hindi(before.pdfjs.copiedText), a = hindi(r.copiedText);
  const body = r.copiedText.replace(/^VDoc system acceptance [^\n]*\n/gm, '').replace(/^Local document acceptance \d+ \/ \d+\n/gm, '');
  return { label: r.label, sha256: r.sha256, sourceHindiRuns: e.length, oldHindiRuns: b.length, newHindiRuns: a.length,
    exactHindiSequenceMatch: JSON.stringify(e) === JSON.stringify(a),
    canonicalHindiSequenceMatchDiagnosticOnly: JSON.stringify(e.map(s => s.normalize('NFC'))) === JSON.stringify(a.map(s => s.normalize('NFC'))),
    bodyExactCollapsedMatch: collapse(r.sourceText) === collapse(body),
    rtlSequenceReversed: body.includes('עברית العربية'),
    note: 'NFC is recorded only to distinguish canonical-equivalent nukta encodings; it does not replace the exact comparison, change source text, remove internal spaces, or pass G3.' };
});
const audit = { at: new Date().toISOString(), productChanged: false, aiStarted: false,
  currentProductCandidate: 'fd601855bbd545ad14fe3a59e1a2138cd7ae61eb1589465d0bcc09f2ddd70011',
  officialIssue: 'https://github.com/mozilla/pdf.js/issues/21890', officialFix: 'https://github.com/mozilla/pdf.js/pull/21960',
  bundledVersion: '5.6.205', npmLatestChecked: '6.4.299', npmLatestContainsFix: false,
  officialDemoVersion: '6.5.128', officialDemoBuild: 'e1412d3a5', officialDemoContainsFix: true,
  positiveControl: { expected: control.sourceText, oldExtraction: oldControl.actual, newOfficialCopy: control.copiedText }, comparisons,
  initialHarnessErrors: initial.results.filter(r => r.error).map(r => ({ label: r.label, error: r.error })),
  harnessCorrection: 'Wait for the official endOfContent marker, appended when text rendering completes and the copy handler is bound. Only the two incomplete runs were repeated; original errors retained.',
  conclusion: 'The upstream update removes 192 spurious Hindi run splits per contextual long-document reference. Full body copy still fails on mixed RTL word order; stock production PDF still loses Hindi characters. Upgrading the reader alone does not close G3. Stop treating the old unanchored-regex bug as an exporter defect; retain old-reader incompatibility explicitly.',
  next: 'Use the fixed official reader alongside the installed stock Chrome for exporter diagnosis, preserving version labels. Address remaining font/Unicode mappings and mixed RTL order; do not weaken expected text or change G4/G5 evidence gates.',
  limits: ['No new PDF authored', 'No installed browser upgraded', 'No product dependency or reader source patched', 'Synthetic in-memory copy, not native clipboard', 'Screenshots cover representative rendered pages, not a new visual signoff of every page'],
  artifacts: ['demo-results.json', 'repaired-results.json', 'repaired-ready-results.json', 'old-control.json', 'check-demo.cjs', 'analyze.cjs'].map(name => ({ file: dir + '/' + name, sha256: crypto.createHash('sha256').update(fs.readFileSync(dir + '/' + name)).digest('hex') })) };
fs.writeFileSync(dir + '/audit.json', JSON.stringify(audit, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ positiveControl: audit.positiveControl, comparisons }, null, 2));
