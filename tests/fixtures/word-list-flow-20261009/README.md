# 列表中的代码块与手动分页：实际文件闭环

2026-10-09，内置浏览器 localhost:5173。使用新独立文档，未改既有文档。

- `source.vdoc.json`：实际首页文件选择导入；源 ID `09c69ed8-16d8-44ef-9882-474b3aab12d6`，标题 `QA list flow roundtrip 2026-10-09`。
- `downloaded.docx`：通过 File → Download Word → 下载链接实际落盘，再复制到此处。10671 字节，SHA-256 `dd7f65fbaff3f6b2def9dc60654536263890abf2268a9e18d766dcac3d1cefac`。
- 文件选择器重新导入该下载成品，副本 ID `19da76d0-5e08-4b7f-bbda-d17033d1ebf5`，标题 `QA list flow Word reimport 2026-10-09`。
- 两个样本均移入 `QA · Local workspace`，页面确认两个标题存在。

公开 read_document 比较：导出前后源完整 JSON 一致；源与重导入递归节点类型、文字、层级一致；两组列表除新生成 blockId 外全部参数一致（7/9、I、括号前后缀、第二组 continuePrevious=true）。DOM 确认多语言代码、tab、空行及末尾换行逐字一致，合并格 colspan=2。ZIP 确认两个 VDocListCode0 段落、一个 VDocListPageBreak0 段落及一个真实 page break。确认 Saved locally 后刷新，公开完整 document JSON 与刷新前一致。

自动化新增13项，相关5文件53项专项通过；完整121文件1691项、类型检查及随后生产构建通过。日志 `/tmp/vdoc-list-code-{full,types,build,targeted}.log`。代码回归修复前8项失败；分页回归加入后5项失败、既有8项通过，修复后全部通过。

范围：已有普通列表的 DOCX 结构往返。任务清单仍沿用静态导出；未验证桌面 Word 视觉或外部软件删除专用样式后的结构恢复。本轮不替代 Safari 原生打印、系统输入法、真实崩溃/配额等七项签收。
