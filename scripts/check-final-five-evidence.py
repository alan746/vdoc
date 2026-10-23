"""Reconcile retained evidence; never execute or claim new native acceptance."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1] / 'tools'))
from qa_paths import qa_path, recorded_name
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = qa_path('final-five-20261010')


def read(path):
    return json.loads(path.read_text())


def fingerprint(path):
    return {'path': recorded_name(path), 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


manifest = read(OUT / 'source-manifest.json')
expected = {item['file']: item['sha256'] for item in manifest['files']}
actual_paths = {recorded_name(p) for folder in ['app', 'components', 'lib']
                for p in (ROOT / folder).rglob('*') if p.is_file()}
assert actual_paths == set(expected), 'Added or removed application files require evidence review'
for item in manifest['files'] + manifest['configurations']:
    assert fingerprint(ROOT / item['file'])['sha256'] == item['sha256'], item['file']

search_dir = qa_path('safari-search-20261010')
search = read(search_dir / 'audit.json')
source = (search_dir / search['source']).resolve()
download = search_dir / search['download']
assert fingerprint(source)['sha256'] == search['sourceSha256']
assert fingerprint(download)['sha256'] == search['downloadSha256']
before, after = read(source), read(download)
assert before['title'] == after['title'] and before['content'] == after['content']

# Preserve existing successful logs before /tmp cleanup. These are historical
# executions, not new checks or proof of a native-browser acceptance result.
logs = OUT / 'retained-baseline-logs'
logs.mkdir(exist_ok=True)
for name in ['targeted', 'full', 'types', 'build']:
    original = Path(f'/tmp/vdoc-handshake-{name}.log')
    destination = logs / f'{name}.log'
    if original.exists():
        if destination.exists():
            assert destination.read_bytes() == original.read_bytes(), 'Baseline log changed'
        else:
            destination.write_bytes(original.read_bytes())
    assert destination.exists(), f'Missing retained baseline {name}'
assert '1899 passed (1899)' in (logs / 'full.log').read_text()
assert '133 passed (133)' in (logs / 'full.log').read_text()
assert '64 passed (64)' in (logs / 'targeted.log').read_text()
assert 'Build complete.' in (logs / 'build.log').read_text()

report = {
    'checkedAt': datetime.now(timezone.utc).isoformat(),
    'scope': 'Retained evidence review only; no new native actions or test executions',
    'search': {
        'bSourceAndDownloadedTitleAndFullContentEqual': True,
        'bScope': '100% ROW 36 visible and highlighted was previously observed; downloaded B full content is unchanged.',
        'aScope': 'Prior 100%/125% navigation and replace/undo UI observations only; not the B full-backup comparison.',
        'visualEvidenceLimit': 'Screenshots were observed in tool output; no standalone screenshot files retained.',
        'sources': [fingerprint(source), fingerprint(download), fingerprint(search_dir / 'audit.json')],
    },
    'applicability': {
        'applicationFiles': len(expected), 'applicationAndConfigurationFilesUnchanged': True,
        'manifest': fingerprint(OUT / 'source-manifest.json'),
        'historicalAggregateHash': 'Older aggregation algorithm unspecified; not compared to new manifest aggregate.',
        'currentBaseline': '133 files / 1899 tests, typecheck and build previously passed; retained logs are copies, not reruns.',
        'nativeRecheckRequired': [
            'Preview handshake changed after historical Safari 100% PDF; current native preview must be rechecked.',
            'No actual Safari 101% PDF or complete OS IME matrix exists.',
            'Current project source differs from the old PDF; one-page IAB result does not close the old-source case.',
            'Quota error mocks and isolated-host crash do not prove real quota refusal or storage-service interruption.',
        ],
    },
    'baselineLogs': [fingerprint(p) for p in sorted(logs.glob('*.log'))],
}
path = OUT / 'retained-evidence-review.json'
path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'sourceFiles': len(expected), 'searchBackupEqual': True,
                  'retainedLogs': len(report['baselineLogs']), 'report': str(path)}))
