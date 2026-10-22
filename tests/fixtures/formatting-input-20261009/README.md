# 工具栏输入保护与普通格式编辑

2026-10-09，内置浏览器localhost:5173；仅新独立样本。

- `source.vdoc.json` SHA-256：`ee4f8c6fc8530b17e330eb75d41f6944f233981be6405fc0f88c51a1ac228749`。
- 文件选择导入ID：`7a3c028b-2cbc-49e7-a4de-4dc7de7740d5`。
- 标题：`QA formatting input 2026-10-09`；最终归档QA · Local workspace（81项）。

实际页面通过Edit → Select all选中正文，逐项应用文字颜色#334455、荧光笔#FFF0AD、输入字号24并失焦应用。每一项的实际marks值核对正确，全部文字未变；界面Undo与原始完整JSON相等，Redo与对应修改快照相等，最后Undo恢复全文。确认Saved locally并退出后，新页面重载同一ID，新session全文JSON与原始相等。

本次没有在浏览器发送合成IME事件；候选保护在组件/编辑器回归里验证。新增11项颜色组件集成与2项字号集成，修复前11失败2通过；相关6文件74项通过，全套127文件1761项（60.29秒）、类型检查和随后生产构建通过。日志/tmp/vdoc-color-ime-{before,targeted,full,types,build}.log。

这不是系统候选窗、Safari、真实崩溃或配额签收；原七项实机门槛保持未关闭。
