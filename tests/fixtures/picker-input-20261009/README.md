# 文档选择器输入保护与保存重开

2026-10-09，内置浏览器localhost:5173，新独立样本。

- `source.vdoc.json` SHA-256：`0a366ef2cb78b6e1aee3b7861f7e5456c7dd3ae6e213bc360c5c65f7623b89a6`。
- 导入ID：`b954eaf0-fa7f-49ae-9ef2-975407bebb8e`。
- 导入标题`QA picker input 2026-10-09`，页面修改为`QA picker input saved 2026-10-09`。
- 最终归档QA · Local workspace（82项）。

通过页面File → Open local document，列表显示最新标题、Workspace路径及Current document。确认Saved locally后选择当前文档，完整document JSON与导入后快照一致；再退出编辑器，从新页面重载同一ID，新session、最新标题及完整正文核对一致。

新增6项组件回归覆盖正文/外部输入、请求前与save/list等待期间的候选状态；修复前6项全部失败，修复后相关5文件94项通过，全套128文件1774项（59.99秒）、类型检查及随后生产构建通过。日志/tmp/vdoc-picker-input-{before,targeted,full,types,build}.log。

页面没有人工注入延迟或候选事件；这部分竞态由自动化复现。未启用系统候选窗，未重验Safari，原七项实机签收仍未关闭。
