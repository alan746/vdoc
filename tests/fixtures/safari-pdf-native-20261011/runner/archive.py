from pathlib import Path
import json,hashlib,datetime,collections,re
root=Path('tests/fixtures/safari-pdf-native-20261011');now=datetime.datetime.now(datetime.timezone.utc).isoformat();sha='0a2386834f95c86adf6c8fd8fafbd0ab5b43ec6f281749da6eaaea9c85cb5ffd'
read=lambda p:json.loads(p.read_text())
analysis=read(root/'pdf-analysis.json');before=read(root/'source-before-scale-matrix.vdoc.json');after=read(root/'source-after-scale-matrix.vdoc.json');assert before['content']==after['content']
def norm(v):
 if isinstance(v,dict):return {k:norm(x) for k,x in v.items() if k!='blockId'}
 if isinstance(v,list):return [norm(x) for x in v]
 return v
fixed=read(Path('tests/fixtures/safari-preview/source.vdoc.json'));assert norm(before['content'])==norm(fixed['content'])
settings=[]
for item in analysis:
 f=Path(item['file']);assert hashlib.sha256(f.read_bytes()).hexdigest()==item['sha256']
 n=f.stem;setting=root/(n+'-print-settings.json') if n!='b-100' else root/'ax-sheet.json'
 assert setting.exists(),setting
 def walk(v):
  yield v
  for c in v.get('children',[]):yield from walk(c)
 nodes=list(walk(read(setting)['focused']));label=next(v['AXTitle'] for v in nodes if v.get('AXRole')=='AXRadioButton' and v.get('AXTitle','').startswith('All '));match=re.search(r'All (\d+) Pages',label);count=int(match[1]) if match else 1;assert count==item['pages'],(n,count,item['pages'])
 scales=[v['AXValue'] for v in nodes if v.get('AXRole')=='AXTextField' and str(v.get('AXValue','')).endswith('%')];assert len(scales)==1
 settings.append({'pdf':item['file'],'settings':str(setting),'scale':scales[0],'panelPageLabel':label,'parsedPages':item['pages'],'matched':True})
 # Standalone control capture did not access an editor snapshot; correct earlier helper's unconditional field.
 result=root/(n+'-result.json')
 if n.startswith('diagnostic') and result.exists():
  data=read(result);data['sourceUnchanged']=None;data['sourceCheck']='Standalone fixed HTML control; no editor snapshot applies';result.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
(root/'native-settings-correspondence.json').write_text(json.dumps(settings,ensure_ascii=False,indent=2)+'\n')
updates={}
def verified(ids,msg):
 for rid in ids.split():updates[rid]=('已核验',msg)
def failed(ids,msg):
 for rid in ids.split():updates[rid]=('未通过',msg)
verified('S021','本候选打印矩阵前实际Safari下载完整B备份；标题为隔离QA副本，除导入blockId外完整content与固定B相同。打印后再次实际下载全文相同；不是重命名旧PDF充当本次结果。')
verified('S022','本次源参数A4/portrait/20mm，页眉VDoc system acceptance 中文、页脚Local document acceptance、页码开启；实际系统A4纵向与预览一致。')
verified('S023 S030','100%首份、从93%恢复的100%重复份、搜索/编辑器125%/预览末页组合后的100%均为系统5页、成品5页；三份各页900px栅格像素完全相同，排除元数据差异。')
verified('S024','原生设置Print headers and footers=0；100%成品保留文档自己的页眉和1/5至5/5，不含Safari附加网址日期。')
verified('S025','原生Print backgrounds=1；100%/101%成品蓝橙图像和表头底色可见。其他比例的排版失败另列，不以背景正确代表整体通过。')
verified('S026','每次保存都读取并断言原生All Pages/All N Pages选中，非Range/Selection。组合验收从预览第5页保存的100%文件仍含全部36行及首末页。')
verified('S027','取得本候选新的Safari原生100% PDF，97181字节、5页，保存设置/哈希/源备份/全页渲染；未使用WebDriver PDF替代。')
verified('S028 S029','保持A4纵向、全部页面、背景开启、附加页眉关闭，只把原生缩放改101%；实际面板12页，原生保存PDF也12页并归档哈希。这是完成失败取证，不表示101%排版通过。')
verified('S031','20份实际PDF的解析页数均与各自原生面板一致；B的100%为5页匹配预览，101%为12页不匹配预览，失败保留。')
verified('S032 S033','8份B成品（100/101/99/93/100重复/101重复/102/组合100）抽取ROW01至ROW36均各一次且顺序完全一致。仅签正文标记完整与顺序，不掩盖页脚裁切/空白页。')
verified('S034 S035','100%全部5页逐页视觉检查，101%全部12页联系表及异常页复查：18组GROUP分别对应两行，续表重复表头在有表格的页中出现，无重复正文伪行。101%空页及页脚错页另列失败；此行不覆盖93%的切页。')
verified('S036','100%/101%第一页嵌入蓝橙色块可见且比例保持；实际PDF渲染已检查，无缺图占位。')
verified('S037','100%第5页和101%第9页均有完整FINAL PAGE CHECK与结尾段落，仅一次；100%末页不是空白页。101%另有装饰尾页/空页，不签整份布局。')
failed('S038 S039','101%两份成品稳定12页：2/4/6/8/10/12是全白页，页脚从第3逻辑页起出现裁切或移动，第11页仅末页页脚/5/5；物理12页与文档5页页码不一致。100%无此问题。不得删偶数页或按文本为空盲裁。')
verified('S040','100%逐页及101%正文页渲染检查了中、日、阿拉伯、印地语、希伯来字形，无方框/缺字；Unicode抽取的兼容字形差异与视觉分开记录。只签本样本这些字形，不代表所有语言排版通过。')
failed('S041','99%成品仍5页且36行标记完整，但视觉检查发现逻辑页眉/页脚贴边与跨页裁切，不能只凭页数和正文标记判全量版式通过。')
verified('S042','实际93%成品5页（本候选不是历史9页）；36行均一次，但逻辑页面混排、结尾移到第4物理页、第5页仅页脚。该行完成历史比例诊断，93%不是修复或合格导出。')
verified('S043','两份100%成品每页栅格像素完全一致，均5页，正文36行和末页稳定；文件哈希因PDF元数据不同而不同。')
verified('S044','两份101%成品每页栅格像素完全一致，均12页、同6张全白页，异常可重复。诊断通过，不签排版质量。')
failed('S045','102%实际12页、36行标记完整，但页脚发生进一步移动/缺失及6张全白页，不满足完整成品边界。')
verified('S046','无CSS单页纯HTML：原生100%=1页，101%=2页且第2页全白，保存两份实际PDF与原HTML。证明额外空页可在VDoc/Paged.js之外复现，不自动豁免产品责任。')
verified('S047','无表格两页普通块：100%=2页，101%=4页，2/4页全白；两个START/END正文标记均完整。排除表格是此类空页的必要条件。')
verified('S048 S049','固定210×297mm纸张两页对照100%=2页/101%=6页；仅覆盖paper/sheet高度为auto的同源对照100%=2页/101%=4页。HTML/CSS已存档。auto能减少一类尾部空页但未解决101%的额外页，未改产品。')
verified('S050','已证明范围：真实Safari非100%打印会在无CSS/无表格对照增页；固定纸张高度进一步增加尾页。尚未证明Safari内部具体机制，也没有可接受修复；单纯auto高度、窄根宽、overflow:hidden均不能称修复。')
failed('S059','实际验证仅100%成品版式匹配预览；99/93/101/102均有不同排版问题。保持S未签收，不自行删去非100%支持要求，也不把系统对照复现当产品豁免。')
verified('S061','实际PDF后重新载入B，完整JSON与打印前相同；首次开Print成功准备5页，末页正文/36行仍在。')
verified('S062','本轮从打印后编辑、真实刷新、首次预览再返回编辑、搜索和125%后重开预览，两次完成5页；无此次流程的卡住或旧内容回流。此项是有界真实流程观察，非任意长时无泄漏证明。')
verified('S064','实际原生PDF保存后回B，系统物理空格输入改变正文且结构不变；原生Undo后全文精确相同。随后实际备份与刷新均一致。')
verified('S065 S066 S067','真实查找ROW 36命中1 of 1，编辑器选125%，预览选Go to page=5，再原生100%/全部页面保存。成品5页、36行全量、每页像素与基线100%完全相同；恢复编辑器100%。')
verified('S068','打印矩阵前后两份实际Safari下载的VDoc备份，完整content逐对象比较相同；最后真实刷新后再次全文相同。')
verified('S069','本轮20份原生成品均有原生设置快照、解析页数对应、SHA-256及渲染；B有源备份/固定样本关联与未变候选哈希，诊断HTML与脚本归档。失败、未执行附加变体及候选视觉/历史A缺口显式保留；不表示全清单完备。')
ledger=Path('docs/acceptance/final-five-ledger.json');x=read(ledger);new=[]
for row in x['rows']:
 if row['id'] not in updates:continue
 status,result=updates[row['id']]
 if status=='已核验' and row['status']!='已核验':new.append(row['id'])
 row.update(status=status,result=result,evidence=str(root/'audit.json'),verifiedAt=now,blocker='原生非100%排版缺陷仍存在' if status=='未通过' else '',next='只重验对应缺陷修复后的原生成品；不重复计算本轮既有证据。' if status=='未通过' else '该行限定范围已有实际证据；S整项仍未签收。')
x['currentLimitations']='Q签收；I/P/S/F未签收。已突破Safari原生PDF保存和系统尺度取证：20份实际PDF/94页已生成与渲染。100%稳定，非100%空页/页脚错页已真实复现且尚无修复。仍缺输入法候选可见证据、准确历史A源稿及联合签收。已关闭自有1713，4188已停，无原生按键任务。'
x['nextAction']='优先修复已归档的Safari非100%成品缺陷；用无CSS/固定高/auto高最小原生对照区分机制，勿重复之前无效CSS当修复。保留100%真实基线，候选窗与历史A缺失仍补证；没有AI准入。下一次测试须新建/绑定自有窗口，旧1713已关闭。'
x.setdefault('executionLog',[]).append({'at':now,'action':f'实际Safari原生PDF取证突破；20份PDF/94页，新增{len(new)}条限定范围核验，{sum(s=="未通过" for s,_ in updates.values())}条记录实测失败；未修改产品、未签AI准入。','evidence':str(root/'audit.json')})
ledger.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
audit={'at':now,'applicationSha256':sha,'productCodeChanged':False,'sourceManifest':'tests/fixtures/safari-pinned-paint-20261010/source-manifest.json','environment':read(root/'cleanup-request.json'),'scope':'Local single-user VDoc; actual native Safari NSPrintPanel→PDF→Save. No WebDriver PDF endpoint, no AI.','source':{'fixedFixture':'tests/fixtures/safari-preview/source.vdoc.json','before':str(root/'source-before-scale-matrix.vdoc.json'),'after':str(root/'source-after-scale-matrix.vdoc.json'),'beforeAfterFullContentEqual':True,'fixedFixtureEqualIgnoringImportedBlockIds':True,'renamedIsolatedTitle':before['title'],'pageAttributes':before['content']['attrs']},'pdfCount':len(analysis),'physicalPageCount':sum(a['pages'] for a in analysis),'nativeSettingCorrespondence':str(root/'native-settings-correspondence.json'),'analysis':str(root/'pdf-analysis.json'),'renderEquivalence':str(root/'render-equivalence.json'),'newlyVerified':new,'failedIds':[i for i,(s,_) in updates.items() if s=='未通过'],'statusCounts':dict(collections.Counter(r['status'] for r in x['rows'])),'findings':['100%: three native PDFs, five pages each, all raster pages pixel-identical, all36 body rows once/in order; final page has real heading and paragraph.','101%: two native PDFs, twelve pages each, pixel-identical; six truly white pages and displaced/clipped footers. 102% has same12-page pattern.','99% and93% keep5 physical pages but do not preserve logical page layout. 93% produces a footer-only last page.','No-CSS single page100→1 /101→2; plain two blocks2→4; fixed sheets2→6; intrinsic-height sheets2→4. These bound the diagnosis, do not prove internal Safari root cause or waive requirements.','Post-PDF native edit/Undo, actual backup download, exact reload, first preview, searchROW36/editor125/previewpage5/native100 all verified.','New focused Swift accessibility works for native Safari print/save. Same method during trusted Pinyin composition found SCIM but no exposed windows/children/focus; candidate visibility remains unsigned.'], 'visualReview':['100% pages1–5 individually at1100px.','101% all12 contact sheet plus full blank page2, body/end page9, footer-only page11.','99%,93%,102% all-page contacts show mixed/clipped boundaries; not approved.','Combined100% five-page contact reviewed; entire raster equal to baseline; repeated100/101 entire raster equal to originals.','No-CSS101, plain101, fixed101, intrinsic101 contacts reviewed. Every native PDF rendered; machine-white-only detection is not used to classify gray/background-only pages as content.'],'harnessNotes':['AXValue without focus did not commit Scaling. Corrected to focus+native keyboard+Tab and assert both field and resulting page count. Initial failed attempt not a101 result.','Foreground identity guards halted on focus change. Inspected the existing Save dialog before resuming; no blind PDF button retry.','Two extra root-auto-paper/root-contained diagnostics were prepared but did not run; no claims for them.','A helper generated an empty resume body; corrected before the pending Save was completed. Native source dialog remained associated with the prior clipped control.','ASCII query attempts in Pinyin did not match expected field; aborted before printing. Switched temporarily to existing ABC, entered exactROW36, then restored original Pinyin.','All diagnostic sourceUnchanged fields corrected to null: standalone HTML does not have an editor snapshot.','PDF parser emitted warnings for some unused xref offsets; Poppler rendered all pages, actual content checks archived. No regenerated/repaired PDF replaced the native outputs.'],'limits':['No valid non100% repair. S038/S039/S041/S045/S059 failed. S051/S052/S054/S055/S057 remain open.','Historical exact project-plan source A still missing; old PDFs and later277-character backup are not equivalent sources.','Native candidate-window pixels/visible content still unavailable, despite real IME edit/cancel and persistence proofs.','Q signed; I/P/S/F unsigned. Do not report AI ready or reinterpret row count as product completion percentage.','139 files/1958 tests/typecheck/build are prior candidate evidence, not rerun this batch. --check confirmed unchanged source only.'],'cleanup':read(root/'cleanup.json')}
(root/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
index=[]
for base in [root,Path('output/pdf/safari-native-20261011')]:
 for f in sorted(base.rglob('*')):
  if f.is_file() and f.name!='file-hashes.json':index.append({'file':str(f),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
(root/'file-hashes.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
print('newVerified',len(new),'failed',audit['failedIds'],'totals',audit['statusCounts'])
