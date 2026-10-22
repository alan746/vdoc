# 版本输入保护与完整恢复验收

2026-10-09，内置浏览器localhost:5173，新独立样本。

- `source.vdoc.json` SHA-256：`1259ae7ff75b63a745488cd64ef6d97daac61460d75f00ff5a525ec1cd56c269`。
- 导入ID：`eae744e4-2970-4ede-bd89-051a08ae87a4`。
- 标题：`QA version input 2026-10-09`。
- 最终归档QA · Local workspace（83项）。

通过Edit history → Saved versions保存`Baseline 中文 العربية`（页面时间10/9/2026, 2:31:24 AM），完整正文不变。通过公开操作层将标题段改为`VERSION_CHANGED 中文`、页眉改为`Changed header 日本語`，记录修改后完整快照并确认Saved locally。

从界面恢复命名基线，完整document JSON精确等于导入后基线。再恢复自动产生的`Before restoring a version`（2:32:40 AM），完整JSON精确等于修改稿；再恢复原基线并单独确认Saved locally，退出编辑器，从新页面加载同一ID，新session及完整document JSON均正确。罗马编号列表起始7、前后缀、rowspan合并表格、图片、多语言文字、页眉页脚均包含在完整比较中。

新增8项组件测试覆盖正文/注册字段候选时打开窗口、保存检查点，以及初次保存等待期间开始候选后阻止检查点/恢复并可重试。修复前8项失败；相关5文件69项通过，全套128文件1782项（62.36秒）、类型检查及随后生产构建通过。日志/tmp/vdoc-version-input-{before,targeted,full,types,build}.log。

候选事件和慢保存竞态由自动化复现；实际页面没有启用系统候选窗。本轮不是Safari、真实进程崩溃或真实配额耗尽验收，原七项实机签收仍未关闭。
