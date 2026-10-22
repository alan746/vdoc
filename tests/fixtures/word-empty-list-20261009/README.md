# 空列表项、项目符号与连续编号的文件闭环

2026-10-09，内置浏览器 localhost:5173；两个新独立样本，未改既有文档。

- `source.vdoc.json` 实际首页文件选择导入。源ID `ca15e337-7c52-4ea9-a313-52b1c34aa268`，标题 `QA empty lists roundtrip 2026-10-09`。
- `downloaded.docx` 经 File → Download Word → 下载链接落盘，10633字节；SHA-256 `a0d6c68f3420e07f4544314c111bec1782eb1b1b29605b60d0a9ce5b82ccc99f`。
- 实际文件选择重新导入该成品。副本ID `71b0fdfd-3881-44b8-b66f-b2378c29087d`，标题 `QA empty lists Word reimport 2026-10-09`。
- 两份样本归档 `QA · Local workspace`。

源含五组列表，三组编号起始7/10/7，第二组接续第一组；另两组分别使用空心圆和👩🏽‍💻。五个完全空项，另有一个空首段后接同项续写；一组在合并单元格中。公开数据验证源导出前后完整JSON不变，重导入递归类型/文字/层级一致，所有列表参数除新blockId外一致。

通过公开操作层按明确空段ID插入Filled seventh item 中文 العربية，操作ok且编号参数不变；界面Undo/Redo/Undo完整JSON分别与操作前/后/前快照一致。确认Saved locally后刷新，完整document JSON与恢复快照一致。

新增13项真实DOCX/Mammoth回归；首批8项修复前7失败1通过，随后补同项续写空首段、混合块、6/9层和普通外部Word。相关6文件80项通过，完整124文件1722项通过（maxWorkers=2，55.31秒）。类型检查发现DOM与Cloudflare的prepend声明冲突，改为等价insertBefore后13项专项、类型检查及随后生产构建通过。日志/tmp/vdoc-empty-list-{before,targeted,full,types,build,final-targeted}.log。

范围：普通列表空项/空白内容、编号和结构往返。任务清单仍为静态导出；复杂Word编号继承、超出9层、桌面Word视觉及七项原生签收未在此关闭。公开文字操作不替代系统输入法验收。
