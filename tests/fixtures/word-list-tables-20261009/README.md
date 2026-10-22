# 列表表格的 Word 往返与编辑恢复

2026-10-09，内置浏览器 localhost:5173。两个新独立样本，未改既有文档。

- `source.vdoc.json` 经首页文件选择导入。源ID `8e43603a-1d7f-472c-a249-2f4bf295dea7`，标题 `QA list tables roundtrip 2026-10-09`。
- `downloaded.docx` 经 File → Download Word → 下载链接实际落盘，10827字节，SHA-256 `58f4068bbaeaa6607125894fe3c4d9b20585437b729cf2f007b2268cedb71d7f`。
- 同一成品经文件选择器重导入。副本ID `3db5e0ce-9060-4c4e-92ca-dea56fb90102`，标题 `QA list tables Word reimport 2026-10-09`。
- 两份样本已移入 `QA · Local workspace`。

四张表格分别覆盖普通列表、引用内列表、外层表格和外层合并格中的列表内嵌表格。页面DOM确认三张在列表内、一张同时在引用内、一张内嵌于外层表。DOCX有四张表、三个VDocListTable0样式引用，ListParagraph默认样式仍存在。

公开read_document比较：源导出前后完整JSON不变；重导入递归类型、文字、层级和rowspan/colspan一致，编号参数除blockId外一致（7/9、I、括号、继续编号）。对重导入的内嵌表格，通过公开apply_document_operations按明确表ID和第二行两格目标执行merge，返回ok，合并后的格colspan=2且两格文字保留。界面Undo/Redo/Undo的完整JSON分别等于操作前/操作后/操作前。确认Saved locally后刷新，完整JSON仍与恢复快照一致。

新增9项真实DOCX回归，修复前9项失败；修复后专项5文件49项通过。全套123文件1709项通过（maxWorkers=2，55.72秒）；类型检查修正类型声明后通过，随后生产构建通过。日志/tmp/vdoc-list-tables-{before,targeted,full,types,build}.log。

范围：普通列表的表格结构往返与重导入后的可编辑性。任务清单仍为静态导出；桌面Word视觉、外部软件删除专用表格样式后的归属、复杂嵌套表分页及七项原生签收未在此关闭。
