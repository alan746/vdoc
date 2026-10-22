"""Check actual UI downloads from the auxiliary recovery workflow."""
import hashlib
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/final-five-20261010'
project = out / 'project-plan'
now = datetime.now(timezone.utc).isoformat()
def read(name): return json.loads((project / name).read_text())
def save(path, data): path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
def color(value):
    match = re.fullmatch(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', value or '')
    return ('#' + ''.join(f'{int(c):02x}' for c in match.groups())) if match else (value or '').lower()
def nodes(node):
    yield node
    for child in node.get('content', []): yield from nodes(child)
def texts(doc): return [n['text'] for n in nodes(doc) if n['type'] == 'text']
def marks(doc, kind):
    return [(n.get('text'), color(m.get('attrs', {}).get('color')))
            for n in nodes(doc) for m in n.get('marks', []) if m['type'] == kind]
def structures(doc, kind):
    return [n for n in nodes(doc) if n['type'] == kind]

baseline = read('after-preview.vdoc.json')
restored = read('after-version-restore.vdoc.json')
before_reactivation = read('before-reactivation.vdoc.json')
word = read('word-roundtrip.vdoc.json')
after_invalid = read('after-invalid-import.vdoc.json')
assert baseline['title'] == restored['title'] == before_reactivation['title']
assert baseline['content'] == restored['content'] == before_reactivation['content']
assert word['content'] == after_invalid['content'] and word['title'] == after_invalid['title']
a, b = baseline['content'], word['content']
assert texts(a) == texts(b)
assert a['attrs'] == b['attrs']
assert [n['type'] for n in nodes(a)] == [n['type'] for n in nodes(b)]
assert [n['attrs']['level'] for n in structures(a, 'heading')] == [n['attrs']['level'] for n in structures(b, 'heading')]
for kind in ['underline', 'highlight']: assert marks(a, kind) == marks(b, kind)
# Word materializes inherited styles. Compare explicit marks without calling
# those default additions JSON equality or exact typography preservation.
for before, after in zip(nodes(a), nodes(b)):
    before_marks = {m['type']: m for m in before.get('marks', [])}
    after_marks = {m['type']: m for m in after.get('marks', [])}
    assert set(before_marks) <= set(after_marks)
    if 'textStyle' in before_marks:
        for key, value in before_marks['textStyle'].get('attrs', {}).items():
            if value is None: continue
            actual = after_marks['textStyle']['attrs'].get(key)
            assert color(value) == color(actual) if key == 'color' else value == actual
    if before['type'] in ['tableCell', 'tableHeader']:
        for key in ['rowspan', 'colspan', 'colwidth']:
            assert before.get('attrs', {}).get(key) == after.get('attrs', {}).get(key)
with zipfile.ZipFile(project / 'restored-export.docx') as archive:
    xml = ET.fromstring(archive.read('word/document.xml'))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    dimensions = {tag: len(xml.findall('.//w:' + tag, ns)) for tag in ['tbl', 'tr', 'tc']}
assert dimensions == {'tbl': 1, 'tr': 4, 'tc': 12}
ime_before = json.loads((out / 'isolated-ime-before.vdoc.json').read_text())
ime_after = json.loads((out / 'isolated-ime-after-probe.vdoc.json').read_text())
assert ime_before['title'] == ime_after['title'] and ime_before['content'] == ime_after['content']
files = ['before-reactivation.vdoc.json', 'after-version-restore.vdoc.json', 'restored-export.docx',
         'word-roundtrip.vdoc.json', 'after-invalid-import.vdoc.json', 'invalid-import.vdoc.json']
audit = {
    'recordedAt': now, 'environment': 'IAB actual UI, localhost:5173; auxiliary preflight, not final joint signoff',
    'sourceCopyId': '3e6de4cf-a868-42e8-a658-2975e131f7af',
    'wordCopyId': '97a39782-8888-4e59-a41f-fbb4c3c53728',
    'versionLabel': 'QA baseline 中文 العربية 2026-10-10',
    'uiResults': {
        'activeDocumentChangeRejectedSave': True,
        'warningBackupDownloadedAndFullContentEqual': True,
        'reopenedSavedLinkThenRetrySaveSucceeded': True,
        'namedVersionCreated': True,
        'operationInsertAppliedOnce': True,
        'undoRestoredFullContent': True,
        'redoRestoredFullModifiedContent': True,
        'namedVersionRestoreFullContentEqual': True,
        'beforeRestoreRecoveryVersionFullModifiedContentEqual': True,
        'baselineRestoredAgainAndReloadedFullContentEqual': True,
        'invalidImportMessage': 'This is not a supported VDoc backup.',
        'invalidImportFullContentAndDocumentIdUnchanged': True,
        'oldSessionOperationRejected': 'STALE: The editing session has changed. Read the document again.',
        'oldSessionRejectionLeavesFullContentAndRevisionUnchanged': True,
        'originalProjectSavedVersions': 'No saved versions yet.'
    },
    'downloadChecks': {'restoredTitleAndFullContentEqual': True, 'wordTextRunsAndNodeTypesEqual': True,
        'wordPageAttributesEqual': True, 'wordExplicitMarksPreserved': True,
        'wordTableCellSpansAndWidthsEqual': True, 'docxStructure': dimensions,
        'invalidImportBackupFullContentEqual': True},
    'wordBoundary': 'Inherited Word styles become explicit: Arial/body 16px, bold heading styles, header defaults, RGB color spelling. Heading 19px becomes 19.3333px due to half-point rounding. Not byte/JSON identical, not a rendered Word/PDF visual signoff.',
    'nativeImeProbe': {'candidateObserved': False, 'typedValue': 'zhong', 'titleRestored': True,
        'actualDownloadedTitleAndFullContentEqualBaseline': True,
        'boundary': 'Isolated WKWebView control recovered; ordinary key entry is not a system candidate pass.'},
    'quotaEnvironment': 'Direct isolated Chrome tab request returned Browser is not available: chrome. No quota writes performed.',
    'files': [{ 'path': str((project / name).relative_to(root)), 'bytes': (project / name).stat().st_size,
        'sha256': hashlib.sha256((project / name).read_bytes()).hexdigest()} for name in files]
}
save(project / 'workflow-audit.json', audit)
print(json.dumps({'actualDownloadChecks': audit['downloadChecks'], 'nativeProbeRestored': True}, ensure_ascii=False))
