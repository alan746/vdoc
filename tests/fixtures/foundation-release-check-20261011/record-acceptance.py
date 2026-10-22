"""Record this bounded recheck without promoting pending native gates."""
import collections
import datetime
import hashlib
import json
from pathlib import Path

root = Path(__file__).parent
for name in ('tests-final.log', 'tests-confirmation.log'):
    text = (root / name).read_text()
    assert '139 passed (139)' in text and '2010 passed (2010)' in text
    assert ' FAIL ' not in text and 'Unhandled Errors' not in text
at = datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest = json.loads((root / 'source-manifest.json').read_text())
for item in manifest['files']:
    assert hashlib.sha256(Path(item['file']).read_bytes()).hexdigest() == item['sha256']
results = json.loads((root / 'run-results.json').read_text())
results['confirmationFullRun'] = {'exitCode': 0, 'filesPassed': 139, 'testsPassed': 2010, 'log': 'tests-confirmation.log', 'defaultTestTimeoutMs': 15000, 'retry': 0}
results['nativeGatesRemainOpen'] = True
(root / 'run-results.json').write_text(json.dumps(results, indent=2))
audit_files = sorted(p for p in root.iterdir() if p.is_file() and p.name != 'audit.json')
audit_files += [Path('tests/file-roundtrip.test.ts'), Path('vitest.config.ts')]
(root / 'audit.json').write_text(json.dumps({
    'at': at, 'candidate': manifest['applicationSha256'],
    'scope': 'Two complete functional suites, production preflight, and preserved failed/diagnostic runs. No native PDF or IME candidate-window signoff.',
    'files': [{'file': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in audit_files],
}, indent=2))

evidence = str(root / 'audit.json')
pdf_evidence = 'tests/fixtures/pdf-reversed-chars-20261011/audit.json'
updates = {
    'F001': '本轮候选99d783b5的174文件逐一复核；相对d4d031f5仅vitest.config.ts变化。运行时代码和依赖相同，生产构建及烟测仍明确绑定d4，未冒称重新运行Safari原生验收。',
    'F046': '本轮普通全量命令连续两次139文件/2010项通过，未启用失败重试。此前多轮默认5秒超时及诊断失败完整保留；独立主进程/工作进程定时器同时停顿约6.54秒、CPU使用很少，具体系统原因未确定。框架单项上限改为15秒，产品时限及显式性能断言未改。40语言原有循环拆成40例，增加39个计数，不是新增39项功能。',
    'F047': '本轮测试整改后的tsc --noEmit及两处正式变更文件ESLint均退出0，日志留档。',
    'F048': '本轮生产构建退出0，95份构建文件已记录哈希；构建时为d4候选，后续只改测试配置与测试文件，运行时代码未变。',
    'F049': '隔离Chrome生产预检10项通过：完整导入、版本冲突拒绝、精确撤销/重做、多语言编辑刷新、旧会话拒绝、查找可见、五页预览含末段、关闭无污染、真实备份下载全量一致。控制台/页面错误与外部请求均为0。不是原生PDF或最终联合签收。',
    'F051': '本轮源指纹、构建文件清单、原失败日志、时序诊断、两次成功全量和生产下载/截图均已归档并计算哈希。',
    'S054': '新增ReversedChars两份最小对照仍未达到Chrome/PDF.js同时全文正确；22次Chrome整词选择通过不足以签收。图像和绘制操作与基线相同，方案未接入正式导出。',
}
ledger_path = Path('docs/acceptance/final-five-ledger.json')
ledger = json.loads(ledger_path.read_text())
before = collections.Counter(row['status'] for row in ledger['rows'])
for row in ledger['rows']:
    if row['id'] not in updates:
        continue
    row['result'] += ' 本轮收尾预检：' + updates[row['id']]
    new_evidence = pdf_evidence if row['id'] == 'S054' else evidence
    row['evidence'] += '; ' + new_evidence
    row['verifiedAt'] = at
ledger['executionLog'].append({'at': at, 'action': '生产预检10项通过；40语言独立化；定位跨进程停顿后调整测试框架时限，全量2010项连续两次通过；PDF标准方向标记对照仍拒绝。未提升原生门槛状态。', 'evidence': evidence + '; ' + pdf_evidence})
ledger['currentLimitations'] = 'Q保留签收，I/P/S/F未签，AI未进入。当前候选99d783b5仅改变测试配置，运行时代码与d4相同；2010项连续两轮通过，生产预检10项通过。Safari非100%打印、多语言PDF文字、历史A对应原源和7个IME候选窗画面仍开放。此前超时及PDF失败未删，不声称所有平台或所有语言全面一致。'
ledger['nextAction'] = '继续处理固定页PDF导出及跨阅读器文字兼容性，不扩展已失败的字符空间补丁。历史项目计划对应原源已发出资料确认，尚未收到答复；原生IME候选窗仍缺实机画面。前置门槛未闭，不启动AI或最终联合签收。'
assert collections.Counter(row['status'] for row in ledger['rows']) == before
ledger_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')

heading = '## 2026-10-12 UTC：生产预检、多语言独立验收与运行器超时定位（最新）'
section = f'''{heading}

当前运行时代码未改。生产构建、类型检查及变更文件ESLint通过；隔离Chrome在生产服务完成10项预检：完整导入、多语言编辑、精确撤销/重做、刷新保存、旧版本及旧会话拒绝、查找定位、五页预览与末段、关闭后源不变、实际下载备份全量一致。无控制台/页面错误或外部请求。生产测试会话已关闭；没有访问私人Safari窗口，也没有执行原生打印。

此前默认5秒全量运行出现不同用例超时及一次模块RPC错误，全部日志保留。时序诊断捕获主进程与工作进程的独立100ms定时器同时延迟约6.54秒，主进程仅消耗790微秒CPU；具体系统调度原因未确定。框架单项等待改为15秒，产品保存/预览时限和显式性能断言不变，无失败重试。40语言元数据往返由一条循环拆为40条独立用例，原文与语言断言完整保留，原有40语言混排样本仍在。普通全量命令随后连续两次139文件/2010项通过；新增39个测试计数不代表新增39项功能。诊断脚本初次路径错误及假时钟造成的无效大跨度记录也留档，后者未作为根因证据。

另对两份最小PDF添加ReversedChars方向标记，绘制操作及900px栅格与基线一致；Chrome整词22次通过，但两种排列仍分别只能通过一个阅读器的全文检查，未采用。该对照不是规范符合性认证，不豁免文字兼容性。证据：`{pdf_evidence}`。

174文件候选由d4变为`{manifest['applicationSha256']}`，唯一受跟踪变化是vitest.config.ts；生产构建/烟测仍绑定运行时代码相同的d4并记录差异。证据：`{evidence}`。320行状态不变，Q保留签收，I/P/S/F未签、AI未进入。原生非100%打印、多语言PDF、历史原文配对和7个输入法候选窗画面继续开放；已询问旧原文是否仍保留，尚未收到答复。

当前候选只读检查：`python3 tools/native-qa/safari_acceptance.py --check --manifest tests/fixtures/foundation-release-check-20261011/source-manifest.json`。不重复已通过的普通预览，继续上述必要缺口。

'''
for filename in ('docs/VALIDATION.md', 'docs/acceptance/NEXT_NATIVE_RUN.md', 'docs/acceptance/FINAL_FIVE_ACCEPTANCE.md'):
    path = Path(filename)
    text = path.read_text().replace('（最新）', '（历史记录）')
    first, remainder = text.split('\n', 1)
    text = first + '\n\n' + section + remainder.lstrip('\n')
    if filename.endswith('FINAL_FIVE_ACCEPTANCE.md'):
        lines = text.splitlines()
        by_id = {row['id']: row for row in ledger['rows']}
        for i, line in enumerate(lines):
            for row_id in updates:
                if line.startswith('| ' + row_id + ' / '):
                    cols = line.split('|')
                    assert len(cols) == 10
                    row = by_id[row_id]
                    cols[7] = ' ' + row['result'] + '<br>' + row['evidence'] + ' '
                    lines[i] = '|'.join(cols)
        text = '\n'.join(lines) + '\n'
    assert text.count('（最新）') == 1
    path.write_text(text)
print(json.dumps({'candidate': manifest['applicationSha256'], 'statusCountsUnchanged': dict(before), 'auditFiles': len(audit_files)}, ensure_ascii=False))
