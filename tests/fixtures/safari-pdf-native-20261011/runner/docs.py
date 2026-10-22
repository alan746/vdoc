from pathlib import Path
import json,re
ledger=json.loads(Path('docs/acceptance/final-five-ledger.json').read_text())
summary='''## 2026-10-11 UTC：实际 Safari PDF 取证完成，非标准缩放仍失败（最新）

本轮取得 **20 份 Safari 26.6.2 原生保存 PDF，共 94 页**，不是 WebDriver 模拟导出。系统设置、完整源、每份哈希、逐页渲染与分析位于 `tests/fixtures/safari-pdf-native-20261011/audit.json`；PDF 位于 `output/pdf/safari-native-20261011/`。新增 **34 条限定范围已核验**，清单现为187已核验、58组件通过、1用户确认、63待执行、5阻塞、5未通过、1不适用；不是产品完成百分比。

| 实际操作 | 成品结果 | 判定 |
|---|---|---|
| 100%，首次/重复/搜索第36行＋编辑器125%＋预览末页后三次导出 | 都是5页，每页渲染像素完全相同，36行各一次，末页有完整正文 | 当前B标准比例通过 |
| 101%，两次导出 | 都是12页，每页像素相同；6张全白页，页脚裁切/错页，另有仅页脚的尾页 | 未修复 |
| 102% | 12页，空白页及页脚缺失/错页 | 未通过 |
| 99% / 93% | 都是5页，但有逻辑页混排、页眉页脚边界裁切；93%末页仅页脚 | 不能按页数判通过 |
| 无CSS单页 / 普通两页 / 固定纸张两页 / 仅改auto高度两页 | 100%为1/2/2/2页；101%为2/4/6/4页 | 固定高有贡献，原生HTML缩放在应用外也增页；不豁免产品 |
| PDF后原生输入＋撤销、实际备份、刷新、首次预览 | 全JSON一致，预览5页 | 通过限定操作 |

**尚无非100%的合格修复**。未把高度auto、根宽缩小、overflow:hidden这种未成功的诊断写入产品；没有删空页、隐藏溢出或缩小正式文档掩盖失败。100%成品逐页已看；101/102/99/93异常已渲染留存，不作为合格交付物。S038/S039/S041/S045/S059记未通过，S051/S052/S054/S055/S057及S整项签收仍开放。原生CSS最小对照只证明已列观察，尚未定位Safari内部具体机制。

新可用能力：Swift直接AXFocusedWindow/AXMainWindow能读到原生打印与保存sheet；须先匹配独有VDoc窗口标题，字段必须focus后真实按键/Tab提交并读回值。AXValue单独赋值不算真正改变系统比例。打印PDF按钮偶尔超时但实际已打开保存框，应读取当前状态再行动，禁止盲重复。测试代码在证据目录runner；硬编码的旧窗口ID不可复用。普通Safari测试窗口1713已确认关闭，WebDriver1708也在此前恢复步骤确认关闭，4188代理已停止，待执行命令删除；原输入法拼音、编辑器100%与原生打印100%已恢复。未接触个人窗口。localhost5173保留。

候选源码哈希仍为 `0a2386834f95c86adf6c8fd8fafbd0ab5b43ec6f281749da6eaaea9c85cb5ffd`；本轮产品代码未改，139文件/1958测试及类型/构建是既有证据，未重复计数。`safari_acceptance.py --check`仅确认未变指纹。

**Q已签收，I/P/S/F未签收，AI未接入。** 新Swift接口在真实拼音候选期间仍只读到SCIM空窗口/空子树，未取得可见候选内容，不能把事件当视觉证明。准确历史项目计划A仍缺源，之前的路径询问保留且不重复问。当前优先研究非100%打印的可验证修复路径，再补候选可见证据与历史A同源复验，最后做联合签收。下面旧记录中的“拿不到实际PDF/AX打印控件”已被本段替代，其历史结果保留。

'''
for name in ['docs/acceptance/NEXT_NATIVE_RUN.md','docs/VALIDATION.md']:
 p=Path(name);s=p.read_text();head,rest=s.split('\n',1);p.write_text(head+'\n\n'+summary+rest.lstrip('\n'))
p=Path('docs/acceptance/FINAL_FIVE_ACCEPTANCE.md');s=p.read_text();rows={r['id']:r for r in ledger['rows']}
def cell(v):return str(v).replace('|','&#124;').replace('\n','<br>')
def rowline(m):
 r=rows[m[1]];deps=', '.join(r['depends']) or '本组独立准备'
 return '| '+' | '.join(map(cell,[r['id']+' / '+r['status'],r['title'],r['setup']+'<br>依赖：'+deps,r['action'],r['expected'],r['evidenceRequired'],(r['result'] or '尚未执行')+'<br>'+(r['evidence'] or '执行后登记'),(r['blocker'] or '无已知独立阻塞')+'<br>'+r['next']]))+' |'
s=re.sub(r'^\| ([IPSQF]\d{3}) /.*$',rowline,s,flags=re.M)
head,rest=s.split('\n',1);s=head+'\n\n'+summary+rest.lstrip('\n');s=s.replace('[筛选版 Excel]','[历史快照 Excel（本轮状态以此表/JSON为准）]');p.write_text(s)
print('Synced all 320 Markdown rows with canonical ledger; latest docs supersede previous blocked evidence.')
