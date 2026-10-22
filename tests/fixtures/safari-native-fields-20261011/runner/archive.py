from pathlib import Path
from datetime import datetime,timezone
import json,shutil
root=Path('tests/fixtures/safari-native-fields-20261011');now=datetime.now(timezone.utc).isoformat();sha='0a2386834f95c86adf6c8fd8fafbd0ab5b43ec6f281749da6eaaea9c85cb5ffd'
def read(name):return json.loads((root/(name+'.json')).read_text())
for name in ['dialog-field-cases','image-field-cases','field-boundary-cases']:assert read(name)['allPassed']
blurs=['body','list','table','Document-title','Find-text','Header','Alternative-text','Version-name']
for name in blurs:
 d=read(name+'-native-blur');assert d['before']['snapshot']['document']==d['restored']['snapshot']['document'];assert any(e['trusted'] and e['type']=='compositionupdate' for e in d['candidate']['events'])
assert read('named-version-baseline-restore')['passed']
for name in ['edited-download-check','final-download-check']:
 d=read(name);assert d['downloaded'] and d['matchedFullDocument'] and d['matchedTitle']
final=json.loads((root/'native-final-backup.vdoc.json').read_text());assert final['content']==read('Version-name-persisted')['saved']['snapshot']['document']
src=Path('tmp/safari-native-fields');dest=root/'runner';dest.mkdir(exist_ok=True)
for f in src.iterdir():
 if f.suffix in ['.py','.js','.cjs']:shutil.copy(f,dest/f.name)
shutil.copy('tests/fixtures/safari-pinned-paint-20261010/source-manifest.json',root/'source-manifest.json')
updates={}
def add(ids,evidence,result):
 for i in ids:updates[f'I{i:03}']=(str(root/evidence),result)
add([82,83,84,85,89],'dialog-field-cases.json','实际 Safari 系统拼音的取消、空格、Enter、退格通过；候选确认未误创建版本。明确点击保存后仅生成一个中文命名检查点，真实刷新重开名称一致。见 Version-name-persisted.json；不表示候选窗像素已核验。')
add([72,73,74,75,78,79],'image-field-cases.json','实际 Safari 图片 Alternative text 的四种候选路径通过；输入期间正文不变，明确 Apply 后完整文档仅 alt 改动，原生 Undo/Redo、真实刷新和重开字段一致。')
for a,b,n in [(46,48,'Document-title'),(56,58,'Find-text'),(66,68,'Header'),(76,78,'Alternative-text'),(86,88,'Version-name')]:
 add([a,b],n+'-alternate-history.json','实际系统按键 Down+Right+Space 选中 🀄️；原生 CmdZ/CmdShiftZ/CmdZ 精确恢复该字段，正文完整 JSON 不变，未误执行操作或创建版本。')
for i,n in zip([17,27,37,47,57,67,77,87],blurs):
 d=read(n+'-native-blur');detail='版本对话框非输入区域点击后系统保留候选，真实点回并 Escape 取消，版本列表和正文不变。' if n=='Version-name' else '真实鼠标点击其他安全输入位置后，系统保留一次 zhong；真实返回/原生 Undo 后完整文档或字段恢复，无重复或误操作。'
 add([i],n+'-native-blur.json',detail+' 保留 trusted composition、点击坐标和完整前后快照；失败尝试另存，不作为通过证据。')
for i in [50,60,70,80,90]:
 add([i],'final-download-check.json','字段测试后关闭草稿并通过中文命名版本恢复基线。Safari 实际新下载 QA Safari native IME 20261010.vdoc-4.json 的 title/content 与恢复后全文及初始检查点一致；命名恢复同时保留恢复前的自动检查点。中间含图片 alt 修改的 .vdoc-3.json 亦已单独归档核对。')
f=Path('docs/acceptance/final-five-ledger.json');ledger=json.loads(f.read_text());new=[]
for r in ledger['rows']:
 if r['id'] in updates:
  if r['status']!='已核验':new.append(r['id'])
  ev,result=updates[r['id']];r.update(status='已核验',result=result,evidence=ev,blocker='',next='保留当前候选的原生事件与完整存档；候选窗视觉及整项门槛另行核验。',verifiedAt=now)
assert len(ledger['rows'])==320 and len({r['id'] for r in ledger['rows']})==320
f.write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
audit={'at':now,'applicationSha256':sha,'productCodeChanged':False,'scope':'Actual Safari, own QA window1296 and isolated origin127.0.0.1:4185; no AI, no multiplayer.','method':'Bounded local proxy added telemetry and import/focus preparation. IME input and candidate selection used physical System Events keys; blur cases used native clicks within verified VDoc content. Complete trusted events/JSON, native Undo/Redo, actual reload, named-version restore and real Safari downloaded files were compared. No synthetic composition events.','completed':{'versionName':5,'imageDescription':5,'fiveFieldAlternateAndHistory':5,'eightLocationNativeBlur':8,'namedCheckpointRestore':'Original whole document restored, one safety checkpoint added, real reload exact.','downloads':['native-edited-backup.vdoc.json (.vdoc-3.json)','native-final-backup.vdoc.json (.vdoc-4.json)']},'ledger':{'updatedRows':len(updates),'newlyVerifiedRows':len(new),'newIds':new,'ids':sorted(updates)},'harnessCorrections':['Safari duplicate downloads use .vdoc-N.json; narrow *.vdoc.json matching missed real files. Fixed matcher and verified timestamp/title/full JSON without manufacturing another export.','Native mouse return after blur avoids scripted focus/OS input-context mismatch; completed reruns retained.','Refresh now waits for a nonempty new editor session rather than a fixed delay or an undefined transient snapshot.','Activate Safari before raising the exact owned window; sending keys to a different front window remained blocked.','Added timeouts/stage logging; early attempts preserved. Initial blur assertion incorrectly required nonempty compositionend.data, but Safari retains raw Pinyin on some native blur paths; exact full-document comparison now checks only one actual system commit/cancel.'],'limits':['Native candidate pixels unavailable. SCIM bundle found via accessibility while composing, but exposed zero windows. Prior screen capture preflight false; candidate visual rows not promoted.','Actual current-candidate Safari PDF, exact historical project-plan source pairing and final joint signoff remain incomplete.','Current application unchanged. Prior 139 files/1958 tests/build/typecheck remain previous evidence; no duplicate full run claimed.','Q signed; I/P/S/F still unsigned. No AI connected.'],'cleanup':{'window':read('cleanup-window') if (root/'cleanup-window.json').exists() else 'pending','proxy4185':'Stopped own session94479 after evidence capture','nativeJobs':'Completed; no keys still being sent'},'evidence':['dialog-field-cases.json','image-field-cases.json','field-boundary-cases.json']+[n+'-native-blur.json' for n in blurs]+['named-version-baseline-restore.json','edited-download-check.json','final-download-check.json','native-candidate-accessibility.json']}
(root/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
intro=f'''## 2026-10-11 UTC：Safari 字段与失焦验收补齐（最新）

候选仍为 `{sha}`，产品代码未修改，未重复计算此前139文件/1958项测试。独立 Safari 实机完成版本名称5组、图片说明5组、五个字段另选候选与撤销重做5组、八处真实鼠标失焦8组，共23组系统输入流程。中文命名版本恢复全文、恢复前自动检查点、真实刷新通过；两份实际 Safari 下载分别核对修改后文档和恢复基线。Safari 重名文件为 `.vdoc-3.json` / `.vdoc-4.json`，已修复验收脚本的窄文件名匹配。另改进真实点击返回焦点、刷新就绪等待、窗口激活顺序与原生超时诊断；中断尝试均保留。

本轮更新{len(updates)}条清单，其中{len(new)}条由未核验转为已核验。证据 `tests/fixtures/safari-native-fields-20261011/audit.json`。原生候选窗视觉仍未签收：找到 SCIM 进程但辅助功能未暴露窗口，未把事件数据冒充可视观察。Safari实际PDF、准确历史源稿和最终联合签收仍缺；Q已签收，I/P/S/F未签收，AI未接入。仅关闭核对过地址的QA标签；清理结果见audit，4185代理已停，无原生按键任务运行。旧的Safari远程自动化设置阻塞已解除，不重复要求启用。后续优先补缺失原生/源稿证据，不再重复这些通过项。

'''
for file in ['docs/VALIDATION.md','docs/ACCEPTANCE_GATE.md','docs/acceptance/NEXT_NATIVE_RUN.md']:
 f=Path(file);s=f.read_text();first,sep,rest=s.partition('\n');f.write_text(first+'\n\n'+intro+rest.lstrip('\n'))
print(json.dumps(audit['ledger'],ensure_ascii=False));print('320 unique ledger rows retained; I/P/S/F gates remain unsigned.')
