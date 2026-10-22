// Diagnostic evidence: keep exact results; NFC does not replace G3 acceptance.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const dir = 'tests/fixtures/pdf-cluster-visual-20261012';
const compact = s => s.replace(/\s+/gu, ' ').trim();
const equivalent = (a, b) => compact(a.normalize('NFC')) === compact(b.normalize('NFC'));
const controls = [
  ['canonical accent', 'é', 'e\u0301', true],
  ['combining order', 'שָׁ', 'שָׁ', true],
  ['lost mark', 'שָׁ', 'שׁ', false],
  ['mark on another letter', 'شَك', 'شكَ', false],
  ['word order', 'שלום עולם', 'עולם שלום', false],
  ['internal space inserted', 'हिन्दी', 'हि न्दी', false],
  ['space deleted', 'שלום עולם', 'שלוםעולם', false],
  ['different Yeh', 'ي', 'ی', false],
  ['compatibility radical', '文', '⽂', false],
  ['compatibility width', 'Ａ', 'A', false],
  ['letter missing', 'हिन्दी', 'ही', false],
];
for (const [name, a, b, expected] of controls) assert.equal(equivalent(a, b), expected, name);
const chrome = JSON.parse(fs.readFileSync(dir + '/copy.json'));
const pdfjs = JSON.parse(fs.readFileSync(dir + '/demo-results.json'));
const results = chrome.results.map(c => {
  const p = pdfjs.results.find(p => p.label === c.label);
  assert.equal(c.sha256, p.sha256);
  assert.equal(c.expected, p.sourceText);
  const result = { label: c.label, chromeExact: compact(c.expected) === compact(c.actual), chromeCanonical: equivalent(c.expected, c.actual), pdfjsExact: compact(c.expected) === compact(p.copiedText), pdfjsCanonical: equivalent(c.expected, p.copiedText) };
  assert.equal(result.chromeCanonical, true);
  assert.equal(result.pdfjsExact, true);
  return result;
});
fs.writeFileSync(dir + '/canonical-check.json', JSON.stringify({ unicodeStandard: 'https://www.unicode.org/reports/tr15/tr15-58.html', scope: 'Canonical-equivalence diagnostic only. Original exact mismatches remain recorded; no NFKC, letters removed, word reordering or internal-space deletion. G3 remains open.', controls: controls.map(([name, , , expected]) => ({ name, expected, passed: true })), results }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ controlsPassed: controls.length, results }));
