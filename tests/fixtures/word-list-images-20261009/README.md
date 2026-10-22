# 列表图片的 Word 往返与编辑恢复

2026-10-09，在内置浏览器 localhost:5173 使用两个新独立样本，未改既有文档。

- 源文件 `source.vdoc.json` 经首页真实文件选择导入。ID `e1e2d3cc-fed5-491e-88b2-5a911f9c13ed`；标题 `QA list images roundtrip 2026-10-09`。
- `downloaded.docx` 由 File → Download Word → 实际下载链接生成，11521字节；SHA-256 `4d6c21a0bc149dfadfdaeb85e6b12218e65eff5e85abdb9b4f699f320f85e09a`。
- 该成品经文件选择器重新导入，ID `01eedecc-5592-40a9-87a6-cf08b9d53bd0`；标题 `QA list images Word reimport 2026-10-09`。
- 两个样本移入 `QA · Local workspace`。

样本含普通编号列表、引用内列表、合并单元格内列表，各有一张12×6像素的蓝橙测试图，显示尺寸180×90。源导出前后公开完整document JSON不变；源与重导入递归节点类型、文字、层级及图片src/宽高/替代文字全部一致。编号参数除新blockId外一致（7/9、罗马I、括号前后缀、继续编号）。DOCX XML有三个VDocListImage0段落、三幅图和正确尺寸。

实际点击合并格图片 → Insert → Image properties，将宽180改360、替代文字改为Updated merged image 中文，公开JSON确认高同步90→180；Undo完整JSON等于操作前、Redo等于操作后，再Undo恢复。确认Saved locally后刷新，完整JSON仍等于恢复快照，三图均正常解码且保持列表归属。

新增9项回归，最初7项均复现失败；修复后相关5文件44项通过，完整122文件1700项通过（maxWorkers=2，54.80秒）。类型检查和随后生产构建通过。日志/tmp/vdoc-list-images-{before,targeted,full,types,build}.log。自动化仅为jsdom补已知图片解码尺寸，页面使用实际图片解码。

范围：普通列表图片归属、尺寸及编辑恢复。空替代文字在导入时可规范为null，按无替代文字等价核对。外部软件去掉专用样式后的归属、桌面Word视觉、任务清单结构及七项原生签收未在此关闭。
