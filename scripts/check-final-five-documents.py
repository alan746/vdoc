import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1] / 'tools'))
from qa_paths import qa_path, recorded_name
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone
from pypdf import PdfReader

root = Path.cwd()
source = Path('/Users/ph.qian/Desktop/VDoc · 项目计划.pdf')
out = qa_path('final-five-20261010')
reader = PdfReader(source)
data = {
    'source': str(source), 'bytes': source.stat().st_size,
    'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'pages': len(reader.pages),
    'pageSizesPoints': [[float(p.mediabox.width), float(p.mediabox.height)] for p in reader.pages],
    'creator': str(reader.metadata.get('/Creator', '')),
    'created': str(reader.metadata.get('/CreationDate', '')),
    'tailText': reader.pages[-1].extract_text(),
    'tailRendered': recorded_name(qa_path('final-five-20261010/old-project-tail-2.png')),
    'visualObservation': 'Rendered page 2 inspected: completely blank, no visible body, image, header or footer.',
    'boundary': 'Old 2026-10-05 artifact only. Does not establish that current source or current application is fixed.',
}
(out / 'old-project-pdf.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
assert data['pages'] == 2
assert 'Page 2 of 2' in data['tailText']
assert 'print-preview' in data['tailText']
file = root / 'docs/acceptance/final-five-ledger.json'
ledger = json.loads(file.read_text())
now = datetime.now(timezone.utc).isoformat()
def update(id, status, result, evidence, blocker=''):
    row = next(r for r in ledger['rows'] if r['id'] == id)
    row.update(status=status, result=result, evidence=evidence, blocker=blocker, verifiedAt=now,
               next='继续下一必要步骤' if status == '已核验' else '保留阻塞；取得同次原源与原生成品后执行')
evidence = recorded_name(qa_path('final-five-20261010/old-project-pdf.json'))
update('P001', '已核验', f"旧原件存在，{data['bytes']} 字节，SHA-256 {data['sha256']}。", evidence)
update('P002', '已核验', '旧成品为 Safari 生成的 2 页 A4；创建时间 2026-10-05，未当成本次新成品。', evidence)
update('P003', '已核验', '尾页渲染目视为空白；文字抽取只有 Safari 日期、标题、网址与 Page 2 of 2，无文档正文。记录渲染与抽取差别，不称 PDF 没有任何文本对象；只确认旧成品。', evidence)
update('P004', '阻塞', '当前尚未取得可限定访问范围的原项目文档身份及同次源备份。', evidence, '需要原项目文档的当前 ID 与同次导出源；不能用 QA B 代替。')
crash = json.loads((out / 'crash-evidence-recheck.json').read_text())
assert crash['savedCase']['titleAndFullContentEqual'] and crash['immediateCase']['titleAndFullContentEqual']
update('F008', '已核验', '本轮重跑既有强退成品比对，两个样本 title/content 全等。复核历史证据，未重新强退；仍限定隔离 WKWebView 宿主。', recorded_name(qa_path('final-five-20261010/crash-evidence-recheck.json')))
update('F001', '已核验', '本轮生成 166 个应用文件及配置/锁文件快照；其他门槛尚未全部绑定此候选版。', recorded_name(qa_path('final-five-20261010/source-manifest.json')))
for id in ['F003', 'F004', 'F005', 'F006', 'F011']:
    update(id, '阻塞', '前置实机门槛尚未签收，禁止进入最终签收或 AI。', 'docs/acceptance/final-five-ledger.json', '需按 I、P、S、Q 各项完成必要证据。')
ledger['executionLog'].append({'at': now, 'action': '第一项原生前置阻塞期间，推进独立文件核验：旧项目计划 PDF 3 条、候选快照及既有强退证据复核 2 条；最终签收前置保持阻塞。', 'evidence': evidence})
file.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'pages': data['pages'], 'tailTextLength': len(data['tailText']), 'rows': len(ledger['rows'])}))
