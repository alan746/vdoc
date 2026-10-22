"""Verify retained reader evidence; passing this audit does not accept a PDF exporter."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[3]
folder = Path(__file__).resolve().parent
initial = json.loads((folder / 'readers.json').read_text())
corrected = json.loads((folder / 'copy-readers.json').read_text())
baseline_path = root / 'tests/fixtures/reader-control-20261011/pdfjs-browser-marked-boxes-copy-handler.json'
baseline = json.loads(baseline_path.read_text())
assert len(initial['results']) == len(corrected['results']) == 3
assert len(baseline['results']) == 7
rows = []
for old, new, pages in zip(initial['results'], corrected['results'], [4, 4, 5]):
    assert old['label'] == new['label'] and 'error' not in new
    assert old['pdfSha256'] == new['pdfSha256']
    assert hashlib.sha256((root / new['file']).read_bytes()).hexdigest() == new['pdfSha256']
    assert old['source'] == new['source']
    assert old['chrome']['selectedText'] == new['chrome']['selectedText']
    assert old['pdfjs']['selectedText'] == new['pdfjs']['selectedText']
    assert len(new['pdfjs']['copies']) == len(new['pdfjs']['copyEvents']) == pages
    assert all(not e['isTrusted'] and e['defaultPrevented'] and 'text/plain' in e['types']
               for e in new['pdfjs']['copyEvents'])
    for reader in ['chrome', 'pdfjs']:
        body = new[reader]['body']
        assert len(body['removedHeaders']) == len(body['removedFooters']) == pages
        assert not body['match']  # Preserve the observed negative result.
        rows.append({'fixture': new['label'], 'reader': reader, 'pages': pages,
                     'bodyMatch': body['match'], 'firstDifference': body['firstDifference'],
                     'expectedContext': body['expectedContext'], 'actualContext': body['actualContext']})

# The official copy handler removes the Latin ligature mismatch but not Hindi
# word-internal spaces. Do not "repair" these strings in the test itself.
flow = corrected['results'][0]['pdfjs']
assert 'Font ﬂow stress' in flow['selectedText']
assert 'Font flow stress' in flow['copiedText']
assert 'दस्तावे ज़' in flow['copiedText']
assert 'हि न्दी' in corrected['results'][0]['chrome']['selectedText']
assert 'ةيبرعلا' in corrected['results'][2]['chrome']['selectedText']
assert sum(x['copyMatchCollapsed'] for x in baseline['results']) == 1
for row in baseline['results']:
    assert not row['errors']
    assert row['copyEvent']['defaultPrevented'] and not row['copyEvent']['isTrusted']
    assert row['matchCollapsed'] == row['copyMatchCollapsed']
    assert hashlib.sha256((root / row['file']).read_bytes()).hexdigest() == row['pdfSha256']

summary = {'scope': 'Evidence consistency and negative controls, not product acceptance',
           'directFullDocuments': rows,
           'baselineSinglePageCopyPass': 1, 'baselineSinglePageCopyTotal': 7,
           'newProductPasses': 0,
           'noNativeClipboardTest': True,
           'finding': 'Raw DOM selection is not the PDF.js copy result. Official normalization fixes the Latin ligature but does not resolve the retained Hindi spacing or RTL failures.'}
(folder / 'analysis.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'evidenceConsistency': 'passed', 'directBodyPass': '0/6',
                  'singlePageCopyPass': '1/7', 'newProductPasses': 0}))
