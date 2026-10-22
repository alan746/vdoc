# 外部 Word 编号标题与大纲级别

2026-10-09，内置浏览器 localhost:5173，使用两份新独立样本。

- `external.docx`：直接使用docx库生成的普通Word样本，不含VDoc专用样式。10021字节，SHA-256 `c9a06f933e4a9ddc64eebcb229ce82473a386c103584be713360ad11afc1ba20`。
- 经首页文件选择导入，源ID `078921cc-71d6-473f-a956-998b72c7ca80`，标题 `QA external headings 2026-10-09`。
- `downloaded.docx`：页面实际Word下载，10523字节，SHA-256 `2b08d0f16ae898c50043ac00d1641f74dbc3843c85da92f3e8bd7ab4fed21d6c`。
- 实际文件选择重导入下载成品，副本ID `becdf9ab-9e9a-4cf2-b06c-f453f41a477a`，标题 `QA headings Word reimport 2026-10-09`。两份文档已归档QA · Local workspace。

源样本有H1、编号H2、空编号H3、基于自定义样式继承的编号H3、合并格中直接outlineLvl=1的H2，以及Heading2样式但直接outlineLvl=9的正文。页面大纲正确显示五个标题（含Untitled heading）；BODY_TEXT仍为普通段落。

公开数据验证：导出前后源完整document JSON不变；重导入递归类型/文字/层级及标题级别一致，编号参数除新blockId外一致；Custom heading 日本語仍为斜体且boldOff=true。通过公开操作层将自定义编号标题从H3改H4，编号不变；界面Undo/Redo/Undo分别与操作前/后/前完整快照一致。确认Saved locally后刷新，完整JSON仍一致。

13项新回归，最初10项均失败；最终相关6文件62项通过，全套125文件1735项通过（maxWorkers=2，58.78秒）。类型检查发现DOM append重载冲突，改为等价逐节点appendChild后13项专项、类型检查及随后生产构建通过。日志/tmp/vdoc-outline-{before,targeted,full,types,build,final-targeted}.log。

范围：标题1–6及明确正文级别9、可识别内置标题样式语义及basedOn继承。更高或非法大纲级别保留内容并提示复核；不声称所有Word格式或桌面视觉保真。七项原生签收未在此关闭。
