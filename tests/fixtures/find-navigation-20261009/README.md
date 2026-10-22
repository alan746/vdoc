# 查找导航与焦点保护验收

2026-10-09，内置浏览器localhost:5173，新独立样本。

- `source.vdoc.json` SHA-256：`6f6463142574019b7cb623642714d3937cc4435e2bef6c9d8ebe6431ef15f5db`。
- 标题：`QA find navigation 2026-10-09`。
- ID：`20b6cc35-5f24-42cf-9de6-ea39f1bc1ac6`。
- 最终归档QA · Local workspace（87项）。

实际Import，记录read_document完整基线。Find text为`Find input`，Replace with为`保留草稿 العربية`。匹配从标题1/3，经Next到正文2/3，再到列表3/3；Next循环1/3，Previous返回3/3。各次高亮父段文本与预期一致。

再次Edit → Find and replace后，活动输入框为Find text，选区0–10，查询及替换草稿均保留。公开read_document完整JSON仍等于基线；Close后正文contenteditable获得焦点，面板消失。单独确认Saved locally后离开，新页面加载同一ID，新session且完整JSON一致，最后归档QA。

候选期间按钮导航、下一帧聚焦/滚动及正文候选查询变化由11项合成事件回归覆盖；最初10项及后补正文候选查询变化1项分别复现失败后修复。相关4文件85项、全套132文件1824项（72.10秒）、类型检查及随后生产构建通过。日志/tmp/vdoc-find-navigation-{before,body-before,targeted,full,types,build}.log。

实际页面没有开启系统候选窗，仅确认普通导航/焦点及存档无回归，不替代原七项实机签收。
