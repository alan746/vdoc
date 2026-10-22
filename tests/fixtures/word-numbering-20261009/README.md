# Word段落样式编号继承实测

2026-10-09，内置浏览器localhost:5173；两份新独立样本。

- `external.docx`：docx库创建编号定义，再写入普通Word段落样式和basedOn关系，不含VDoc专用编号样式。34642字节，SHA-256 `ef6462b459cf8b81fc2a368736d624e70c72b3da801e8443c7f5e91caf26c47e`。
- 页面实际Import源ID `4cc158c0-0f89-407b-8bb7-26347935532c`，标题 `QA inherited numbering 2026-10-09`。
- `downloaded.docx`：实际页面下载，10533字节，SHA-256 `d71a304e825e959fbb9d3644fde20b30b3ea6d31d88b51370ce8e52b942c89df`。
- 文件选择重导入ID `91036686-fcba-4dea-9ce9-d370c2f806b9`，标题 `QA numbering Word reimport 2026-10-09`。两样本归档QA · Local workspace（80项）。

五组列表分别为：外层罗马7、内层罗马7、取消编号后外层续号10、直接覆盖为字母20、表格内罗马11。空首项、中文/阿拉伯文/日文和取消编号正文保留。嵌套样式故意设ilvl=2，而编号定义lvl/pStyle关联为1，以验证关联优先。

公开数据验证：源导出前后完整JSON相等；重导入递归节点类型/文字/嵌套相等，五组编号属性除新blockId外相等。公开操作将内层起始值7改12，仅目标列表变化；界面Undo/Redo/Undo与操作前/后/前完整快照分别相等。确认Saved locally并退出后，用新页面重新载入重导入ID，新session与原完整JSON一致。

最初外部导入保留一条自定义Child正文样式未识别提示；VDoc下载重导入无新格式警告。该提示未被抑制，不承诺自定义样式完全视觉保真。支持范围和标准依据见docs/VALIDATION.md最新记录；复杂编号样式链接、复合编号、桌面Word视觉及原七项原生门槛不在本轮验收完成范围。

13项新回归，相关5文件58项通过；全套126文件1748项（57.13秒）、类型检查、随后生产构建通过。日志/tmp/vdoc-numbering-inherit-{before,after,targeted,full,types,build}.log。
