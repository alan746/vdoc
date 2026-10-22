"""Record bounded, real UI observations; never promote them to native signoff."""
import hashlib
import json
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/final-five-20261010'
now = datetime.now(timezone.utc).isoformat()
def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def text(node):
    return node.get('text', '') + '\n'.join(text(c) for c in node.get('content', []))

project = out / 'project-plan'
download = Path('/Users/ph.qian/Downloads/QA project plan closure 2026-10-10.vdoc.json')
shutil.copyfile(download, project / 'after-preview.vdoc.json')
source = json.loads((project / 'source.vdoc.json').read_text())
after = json.loads((project / 'after-preview.vdoc.json').read_text())
assert source['content'] == after['content']
old_pdf = Path('/Users/ph.qian/Desktop/VDoc · 项目计划.pdf')
old_text = unicodedata.normalize('NFKC', PdfReader(old_pdf).pages[0].extract_text())
source_text = text(source['content'])
differences = [token for token in ['克隆', 'jjkkklk', '刚刚', 'dd'] if token in old_text and token not in source_text]
assert len(differences) == 4
save(project / 'audit.json', {
    'recordedAt': now,
    'sourceDocumentId': '027b7591-48eb-44ac-84c9-1ec66a4e18d8',
    'copyDocumentId': '3e6de4cf-a868-42e8-a658-2975e131f7af',
    'environment': 'Codex in-app browser, localhost:5173; not native Safari',
    'sourceSha256': digest(project / 'source.vdoc.json'),
    'afterPreviewSha256': digest(project / 'after-preview.vdoc.json'),
    'oldPdfSha256': digest(old_pdf),
    'oldPdfPage1Text': old_text,
    'oldPdfOnlyTokens': differences,
    'sourceAndCopyFullContentEqual': True,
    'uiObservations': [
        'Normal UI imported the downloaded source into a separate document; only copy title changed.',
        'First preview showed 1 page, A4 portrait, enabled Print / Save PDF.',
        'Final heading and complete final paragraph were visually visible after scrolling; no extra page.',
        'Closing preview left complete public read_document content unchanged.',
        'After reload public read_document content remained identical; Saved locally was visible.',
        'Second preview showed the final paragraph; returned to editing with Saved locally visible.'
    ],
    'boundary': 'Current-version auxiliary verification only. Different source from old PDF; no new native PDF and no closure of the original blank-tail gate.'
})
manifest = json.loads((out / 'source-manifest.json').read_text())
changed = [e['file'] for e in manifest['files'] if digest(root / e['file']) != e['sha256']]
assert not changed
pkg = json.loads((root / 'package.json').read_text())
lock = json.loads((root / 'package-lock.json').read_text())
versions = {}
for name in {**pkg['dependencies'], **pkg['devDependencies']}:
    installed = json.loads((root / 'node_modules' / name / 'package.json').read_text())['version']
    pinned = lock['packages']['node_modules/' + name]['version']
    assert installed == pinned, name
    versions[name] = installed
save(out / 'followup-environment.json', {
    'recordedAt': now, 'unchangedApplicationFiles': len(manifest['files']),
    'lockfileSha256': digest(root / 'package-lock.json'), 'nodeObserved': 'v24.13.0',
    'directDependenciesMatchLockfile': versions,
    'previewComponentLog': 'tests/fixtures/final-five-20261010/preview-components.log',
    'previewComponentTests': {'files': 2, 'tests': 64, 'reusedExistingRun': True},
    'nativeIme': {
        'baseline': 'tests/fixtures/final-five-20261010/isolated-ime-before.vdoc.json',
        'baselineSha256': digest(out / 'isolated-ime-before.vdoc.json'),
        'documentId': 'bf5a4d3c-6c75-4f74-8880-5f1cf8dd0ccd',
        'environment': 'Isolated WKWebView host; not Safari private window',
        'blocker': 'Native accessibility state remained at File menu after download; screenshot unavailable. No new candidate input or persistence claim.'
    },
    'quota': {
        'dataWritten': False, 'capApplied': False,
        'blocker': 'Chrome application entry rejected by automatic approval review; explicit broader entry permission pending. Available isolated WKWebView host has no verified public bounded quota control.',
        'references': ['https://developer.chrome.com/blog/new-in-devtools-88/#storage', 'https://webkit.org/blog/14403/updates-to-storage-policy/'],
        'boundary': 'No synthetic QuotaExceededError or disk filling counted as a real quota test.'
    }
})

ledger_path = root / 'docs/acceptance/final-five-ledger.json'
ledger = json.loads(ledger_path.read_text())
def update(id, status, result, evidence, blocker='', next_step='继续下一必要步骤'):
    row = next(r for r in ledger['rows'] if r['id'] == id)
    row.update(status=status, result=result, evidence=evidence, blocker=blocker, verifiedAt=now)
    row['next'] = next_step

project_evidence = 'tests/fixtures/final-five-20261010/project-plan/audit.json'
env_evidence = 'tests/fixtures/final-five-20261010/followup-environment.json'
update('P004', '阻塞', '已下载当前 IAB 项目计划并建立独立副本，但旧 PDF 有当前源不存在的四组修改，尚不能认定为对应版本。', project_evidence,
       '缺少旧 PDF 对应的源版本；当前副本检查不能代替原件尾页验收。', '取得可配对的原源或恢复旧版本，再执行原生成品验收')
update('P010', '已核验', '已比较当前源与旧 PDF，识别“克隆”“jjkkklk”“刚刚”“dd”四组差异，明确保留为不同版本；未宣布旧尾页问题修复。', project_evidence)
for n in range(2, 18):
    update(f'S{n:03}', '组件通过', '对应场景已在两份预览组件测试中覆盖；复用本日 64 条通过日志，166 个应用文件哈希未变化。不是本轮新增执行，也不代替原生 Safari。',
           'tests/fixtures/final-five-20261010/preview-components.log; ' + env_evidence,
           next_step='继续限定 Safari 窗口的原生观察，保留组件与实机证据边界')
for id in ['Q001', 'Q003']:
    update(id, '阻塞', '核对官方限额能力；尚无已获准且可控制上限的隔离环境。没有填充数据、修改个人存储或模拟异常作为通过依据。', env_evidence,
           'Chrome 应用入口被自动审批拒绝，扩大入口授权问题待答复。', '取得授权后建立专用测试资料并验证真实限额；不能执行无上限写入')
update('F002', '已核验', '实际 Node v24.13.0；所有直接依赖安装版本与 lockfile v3 一致，锁文件和 166 个应用文件哈希未变化。', env_evidence)
ledger['executionLog'].append({'at': now, 'action': '完成当前项目计划独立副本往返与源版本差异核对；登记 16 条现有预览组件证据和依赖核验。原生授权、原源配对及真实配额仍阻塞，未进入 AI。', 'evidence': project_evidence + '; ' + env_evidence})
save(ledger_path, ledger)
print(json.dumps({'projectContentEqual': True, 'oldPdfOnlyTokens': differences, 'unchangedFiles': len(manifest['files']), 'directDependencies': len(versions)}, ensure_ascii=False))
