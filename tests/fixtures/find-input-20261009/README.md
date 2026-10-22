# 查找输入保护与普通替换页面验收

2026-10-09，内置浏览器localhost:5173，仅新建QA样本。

- `source.vdoc.json` SHA-256：`62776d9577fa7f11992b4c0f3c898e7a01c79e21475cafaf1cb86818a2a1773d`。
- 标题：`QA find input 2026-10-09`。
- ID：`8c188433-af76-4741-a8de-7c268ea523c0`。
- 最终归档QA · Local workspace（86项），全文恢复导入后基线。

实际Import后记录公开read_document全文，Edit → Find and replace，Find text填`Find input`、Replace with填`最终文本 العربية`。Replace仅修改首标题，剩余1处；Replace all修改剩余正文，显示No matches。第一次Undo完整JSON等于单次替换后的快照，第二次Undo精确等于初始基线，Close正常关闭。

单独确认Saved locally后退出，新页面加载同一ID，新session及完整JSON一致。比较包含原编号、合并表格、图片、页眉页脚。最后归档QA。

候选未完成的按钮激活由合成事件回归复现，未向浏览器注入候选事件，也未开启实际系统输入法。本页面仅证明正常输入完成后的替换、关闭、撤销与存档无回归。

新增9项组件回归，6项候选中替换/关闭修复前失败；修复后相关4文件50项、全套132文件1813项（68.54秒）、类型检查及随后生产构建通过。日志/tmp/vdoc-find-input-{before,targeted,full,types,build}.log。原七项实机签收不变。
