# 统一文档操作接口

网页初始化后可以在浏览器控制台使用 `window.vdoc`。业务层不直接操作 DOM，也不生成任意 JavaScript。

## 读取文档

```js
const snapshot = window.vdoc.snapshot();
// { schemaVersion, sessionId, revision, selection: {from, to}, blocks, tables, document }
```

`document` 是编辑器的结构化 JSON；`blocks` 提供段落、标题和表格的稳定 ID、`version`、类型、内容与位置。版本在同一编辑会话内单调分配，内容、格式或属性变化会更新；无关块的输入和位置移动不改变它。文档文字是数据，不应作为未来 AI 的执行指令。

外部及 agent 请求可用 `expectedBlocks: [{ id, version }]` 代替全局 `expectedRevision`，但仍必须携带 `expectedSessionId`。`block` / `text` 目标需覆盖该块，`cell` / `cells` 需覆盖所属表格；缺失覆盖、块被删除或版本不符均返回 `STALE`。同时提供两类条件时全部检查。绝对 `range`、全文替换、文档属性和块移动仍需全局 revision。

`{ kind: 'text', blockId, start, end }` 使用 snapshot 中该块 `text` 的 UTF-16 偏移。边界不得拆开字素；脚注等 inline atom 不计入纯文本偏移，边界不吞掉相邻对象，跨对象的文字范围返回 `TARGET`。输入新版本前需重新读取目标；同一成功请求的相同 `id` 重试仍返回原结果。

## 对读取时的文字范围应用一个批次

```js
const state = window.vdoc.snapshot();
window.vdoc.execute({
  expectedSessionId: state.sessionId,
  expectedRevision: state.revision,
  id: 'format-001',
  source: 'api',
  label: '强调当前文字',
  target: { kind: 'range', from: state.selection.from, to: state.selection.to },
  operations: [
    { type: 'text.style', style: { underline: true } },
    { type: 'text.style', style: { highlight: '#FFF0AD' } }
  ]
});
```

无选区时，文字样式修改光标处的后续输入样式。这种只改变 stored marks 的操作不产生文档修订号或可独立撤销的正文变更；输入文字后按编辑器原生历史撤销。

## 按块定位

```js
const state = window.vdoc.snapshot();
const block = state.blocks.find(b => b.type === 'heading');
if (block) window.vdoc.execute({
  expectedSessionId: state.sessionId,
  expectedRevision: state.revision,
  target: { kind: 'block', id: block.id },
  operations: [{ type: 'paragraph.style', level: 2, align: 'center' }]
});
```

块目标选择该块内部文字范围。表格和其他容器使用其内部的首尾可编辑位置；图片等原子块使用 NodeSelection；精细表格操作使用 cells 目标。

## 按文字位置定位

```js
const state = window.vdoc.snapshot();
const block = state.blocks.find(b => b.type === 'paragraph' && b.text.length >= 2);
if (block) window.vdoc.execute({
  expectedSessionId: state.sessionId,
  expectedRevision: state.revision,
  target: { kind: 'range', from: block.from, to: block.from + 2 },
  operations: [{ type: 'text.style', style: { bold: true } }]
});
```

位置是 ProseMirror 文档位置，不是纯文本字符串偏移；文本部分使用UTF-16偏移。显式范围边界不得切开字素簇、组合字符或emoji。显式范围必须携带 `expectedRevision`；任何正文事务都会使旧修订号失效。块 ID 允许跨编辑定位；外部请求必须携带会话与版本。

## 精确选择表格单元格

```js
const state = window.vdoc.snapshot();
const table = state.blocks.find(b => b.type === 'table');
if (table) window.vdoc.execute({
  expectedSessionId: state.sessionId,
  expectedRevision: state.revision,
  target: { kind: 'cells', tableId: table.id, row: 1, col: 0, endRow: 2, endCol: 1 },
  operations: [{ type: 'table.background', color: '#FFF0AD' }]
});
```

行列从 0 开始，endRow/endCol 包含终点，省略时选择一个单元格。超界不得修改文档；合并单元格按实际 TableMap 定位。

## 按 Agent 轮次撤销

`engine.undoTurn(turnId, { actor, turnId: newTurnId })` 撤销一个 agent turn 的全部保留操作。新 turn ID 必须不同且未使用；撤销本身记录为新的 agent turn，因此可继续撤销它。AI 操作不进入用户原生撤销栈；普通工具栏、键盘和 `api` undo/redo 的入口及分组规则保持一致。

实现使用有界步骤日志与位置映射，不恢复整篇旧快照。它保留其他轮次和用户在之后输入的文字；反向删除会绕过后续插入，用户仍可用普通撤销删除自己的输入。对同一属性的后续写入优先保留。恢复被替换的文字且替换区内有后来插入的文字时，旧文字放在这些保留文字之前。未知、已撤销、已被移除或超出日志范围的轮次返回 `UNAVAILABLE`，文档不变；日志默认最多 1000 个修改步骤，可通过 `new DocumentEngine(editor, { undoStepLimit })` 配置。部分淘汰的轮次也不会只撤销剩余一半。

所有反向步骤先在临时事务中验证，再一次提交。无法安全处理的结构冲突（例如 AI 新增表格后用户已在其中写入，撤销将删除这些内容）会拒绝整轮撤销；不会丢弃用户输入。组字期间返回 `COMPOSING`，关闭后的引擎返回 `UNAVAILABLE`。成功撤销保留用户选区、焦点和输入样式，并发一次 `onApplied`。

## 操作清单

引擎消费者可用 `engine.onApplied(listener)` 订阅修改事件，并调用返回的函数取消订阅。每个成功且有实际文档或输入样式变化的请求只发一次：`{ id, label, source, actor?, turnId?, revision, changedBlockIds, documentChanged }`。事件在 stable ID 补全后发出，包含新增或删除的块 ID；普通编辑定位到最内层文字块或原子对象，表格结构修改报告表格 ID。`documentChanged` 表示正文结构/内容/属性变化，只有 stored marks 变化时为 false；根文档属性变化时为 true，块列表可为空。失败、过期、无变化和幂等重试不发事件。原 `subscribe` 行为保留；原生输入继续使用编辑器 transaction 事件。

| type | 参数 |
|---|---|
| `text.style` | `style`: bold、italic、underline、strike；color、highlight 为六位 HEX 或 null；fontSize 8–96 px；fontFamily 为支持的字体；script normal/superscript/subscript |
| `text.toggle` | `mark`: bold/italic/underline/strike/superscript/subscript |
| `text.insert` | `text`: 纯文本，换行成为 hardBreak，不解析 HTML |
| `text.delete` | 删除非空选区 |
| `text.replace` | text，可为空字符串 |
| `text.findReplace` | query、replacement、caseSensitive、wholeWord；全文字面匹配，支持NFC规范等价；命中不切开字素，wholeWord使用浏览器Unicode词边界 |
| `block.move` | id、beforeId（null 表示移至文档末尾）；顶层块 |
| `text.clear` | 清除当前选区的文字 marks |
| `paragraph.style` | direction auto/ltr/rtl、level 0–6（0 为正文）、align left/center/right/justify、lineHeight 1/1.15/1.25/1.5/1.75/2/2.5/3；indent 0–8（兼容等级）；indentStart/indentEnd/firstLineIndent 有限数值±10000px；spaceBefore/spaceAfter 0–96px；keepWithNext/keepLinesTogether/preventSingleLines 布尔值 |
| `list.indent` | direction in/out |
| `list.toggle` | kind bullet/ordered/task |
| `block.quote` | 切换引用 |
| `block.rule` | 插入分隔线 |
| `table.insert` | rows 1–30、cols 1–20、header 默认 true |
| `table.edit` | action rowBefore/rowAfter/columnBefore/columnAfter/deleteRow/deleteColumn/deleteTable/merge/split/headerRow |
| `table.split` | rows/cols 1–10；细分一个普通单元格；不同于 table.edit split 取消合并 |
| `table.style` | borderStyle solid/dashed/dotted、borderColor、borderWidth 0–8、padding 0–40、minHeight 0–1000、verticalAlign top/middle/bottom |
| `table.border` | scope all/outer/inner/top/right/bottom/left，color六位HEX，width 0–8，style solid/dashed/dotted；围绕所选矩形设置指定边，共边双侧同步。宽度0删除；部分合并边和不存在的内边框原子拒绝 |
| `table.layout` | alignment left/center/right；设置整表位置，保留单元格与列宽 |
| `table.distributeRows` | from/to为0基起止行（to不含），height为1–1000px统一最小行高；跨边界合并格原子拒绝；UI按所选最高行取值，单行光标时默认全表 |
| `table.widths` | widths 数组，长度等于实际列数；每列40–1200px，最多30列 |
| `table.sort` | column（0基）、descending；保留表头；拒绝合并表格 |
| `table.move` | axis row/column，from/to（0基） |
| `table.background` | color 六位 HEX 或 null |
| `document.layout` | pageSize a4/letter、orientation portrait/landscape、pageMargin 5–50mm、pageColor；可选 header/footer/pageNumbers |
| `image.insert` | src 为本地 data image；alt；width 40–1200 |
| `image.update` | alt/width，需选中图片节点 |
| `footnote.insert` / `footnote.update` | text；更新时选择脚注原子节点 |
| `block.pageBreak` / `block.toc` / `block.code` | 分页符、实时目录、切换代码块 |
| `link.set` | href，允许 http://、https://、mailto: |
| `link.unset` | 移除选区中的链接 |

支持字体：Arial、Georgia、Times New Roman、Noto Sans SC、monospace。使用本机已有字体，没有外部字体请求。

## 结果与错误

```js
{ ok: true, id: '...', revision: 5 }
{ ok: false, id: '...', revision: 5, code: 'STALE', error: '文档已变化，请重新获取目标' }
```

错误码：INVALID（参数无效）、STALE（过期版本或编辑会话）、TARGET（目标不存在）、UNAVAILABLE（上下文不适用）、COMPOSING（输入法正在组合）、DUPLICATE（重复 ID 对应不同请求）。

任何步骤失败，整个批次都不提交。一个批次最多 100 步；步骤使用前一步完成后的事务状态和当前选区。目标只在批次开始时解析一次。

相同 ID 和相同已解析请求在当前页面会话内返回原结果，不重复执行；不同请求复用 ID 会被拒绝。缓存仅保存最近 200 个成功请求，刷新后重置；它不提供跨会话的 exactly-once 保证。

```js
window.vdoc.undo(); // 撤销一个命令批次，或编辑器的一组连续键入
window.vdoc.redo();
```

## 浏览器工具

浏览器支持 `document.modelContext` 时注册 `read_document` 和 `apply_document_operations`，并在组件销毁时注销。不支持该实验接口也可以完整使用编辑器和 `window.vdoc`。

## 持久化与后续接口

DocumentEngine 管理内容变更。本地库、文件导入和版本恢复通过 document-store 的原子持久化入口完成，切换文档会新建编辑器会话。原生文本输入、粘贴、表格／图片拖动复用 ProseMirror 状态与撤销，不伪装成逐键 API 命令。

下一阶段为异步文字／语音任务加入取消令牌、任务状态和目标重新定位。尚未实现语音或模型调用。

### 文档语言

`document.language`：`language` 为浏览器Intl.Locale可识别的BCP47语言标签，例如 `en-GB`、`zh-Hant-TW`、`ar`；`und` 表示未指定。操作层规范化大小写，非法标签导致整批原子拒绝。支持撤销/重做，设置保存在doc.attrs.language并写入HTML根lang和Word默认run语言。它不代表安装词典、提供输入法或翻译能力。

## 单行与单列尺寸（2026-09-29）

- `table.rowHeight {row,height}`：零起始行索引，高度1–1000px。设置该行最小高度，清除只属于该行的旧cell高度，保留跨行单元格高度约束和其他行。内容仍可撑高。
- `table.columnWidth {column,width}`：零起始列索引，宽度40–1200px。同步该逻辑列覆盖的每个单元格，在colspan数组中只改对应项，保留其他列宽（包括导入的窄列或未指定宽度0）。
- 两者使用cells目标的tableId定位表格，索引相对整张表；越界整批拒绝，一次Undo撤销整个请求。鼠标拖动以CSS缩放比例换算屏幕差值，预览不产生文档修订，松开调用此操作。

## 独立固定表头（2026-09-29，第七轮）

`table.pinRows {count}` 通过cells目标定位表格，count为前N行（0解除，整数且不得超出当前行数或10000）；不得切开rowspan，非法请求整批拒绝。数值保存在table.attrs.pinnedRows；旧值null兼容推导连续th。显式0与null不同。

固定范围控制排序保护、连续画布吸顶及Word重复标记；不改正文单元格样式。明确固定后跨区域合并/移动行拒绝，固定区内增删行会按稳定ID调整数量并与原操作一同撤销。API同批明确设置固定数优先保留该选择，历史恢复不会重新推导覆盖已恢复值。滚动显示不增加修订。

`table.sort` 使用文档语言进行numeric比较；固定区允许合并，参与排序的数据区不允许合并。前N行不排序，显式解除后原th行也可参与。Word节点样式与编辑器的pin元数据并非完整双向同构，详见表格主清单边界。

## 外部调用协议与稳定单元格（2026-10-01）

`window.vdoc.execute` 与 WebMCP 的 `apply_document_operations` 共用 `executeExternal`。必填 `expectedSessionId`、`expectedRevision`、明确的 `range/block/cell/cells` 目标；不接受隐式 selection 或伪装 toolbar 来源。内部同步 UI 继续用 execute。旧外部调用必须升级，缺参数返回 INVALID。

`sessionId` 是本次编辑器生命周期标识，不是文件 ID。切换、重开或刷新会改变它；不同文档即使 revision 都是0也不会接受彼此的请求。已关闭引擎拒绝新请求、历史操作及缓存重试。相同成功请求在有效会话内可幂等重试；返回首次执行的结果和修订号，而不是当前状态，当前状态需再次读取。

`tables` 返回每张表的稳定ID、逻辑行列数、固定数，以及去重后的单元格列表（id、rowId、row、column、rowspan、colspan、text）。合并格只出现一次；嵌套表独立记录。不要用相同文字代替身份。

```js
const state = window.vdoc.snapshot();
const table = state.tables[0];
const cell = table?.cells[0];
if (cell) window.vdoc.execute({
  expectedSessionId: state.sessionId,
  expectedRevision: state.revision,
  target: { kind: 'cell', tableId: table.id, cellId: cell.id },
  operations: [{ type: 'table.background', color: '#FFF0AD' }]
});
```

cell 定位选择完整单元格，可对其格式或表格结构操作。单格文字子范围仍用 block/range。删除/合并消失的ID返回TARGET，不自动套用原坐标的新格。行列移动保留存活节点ID；跨编辑仍须重新读取并重新判断意图，不能只替换旧请求的revision强行重试。

`table.move` 移动一条逻辑行/列，保留行高、列宽、单元格类型、内容、marks及属性。不会自动扩大为合并组移动；若重排打断跨度或越过显式固定区边界，整批拒绝。菜单、拖动与API共用规则。

未来AI还需要任务取消、执行预览、意图重新确认/定位与流式插入状态机；本轮仅补接口基础，未接入模型或语音。当前 window.vdoc.undo/redo 是同步调试入口；不得把它们作为异步AI的无条件回滚接口。

## 拖放自动滚屏（2026-10-01，第九轮）

滚动属于视图行为，不生成操作记录、修订或持久化内容。鼠标释放时基于最后的滚动几何重新判断落点，再执行原有table.move；没有新增可让外部调用绕过合并/固定区校验的命令。滚动帧和全局监听随拖动取消或组件销毁清理；外部AI仍应读取会话/修订和明确目标。


## RTL 表格操作（2026-10-02，第十轮）

`table.direction` 接收 `direction: 'ltr' | 'rtl'`，必须定位目标表格内的单元格；外部调用继续要求当前 `expectedSessionId`、`expectedRevision` 与明确目标。同一批次可与格式操作一起撤销。

`read_document().tables[].columnDirection` 返回表格列序，独立于段落 `direction`。API 的 `column`、`col`、`from/to` 和 `columnBefore/columnAfter` 始终是逻辑网格顺序；RTL 下逻辑0列显示在右侧，增加索引意味着向物理左侧移动。UI 已将左右菜单映射到逻辑坐标。外部代理应优先使用稳定 `cellId`，方向切换不改变 ID 或重排内容。

`table.border` 的 left/right 是屏幕物理边；RTL 共享边按镜像邻接计算。拖宽与拖放也转换屏幕方向，预览不改变版本，释放只提交一次。当前不承诺所有双向混排光标/嵌套表、已有非对称边框切换方向和各浏览器完全一致。


## 逐行跨页（2026-10-02，第十一轮）

操作 `table.rowBreak`：`from` 为起始逻辑行（含），`to` 为结束逻辑行（不含），`allowSplit` 为布尔值。范围必须满足 `0 <= from < to <= 行数`；任一操作失败整批不落地。只更新目标表格的直接行，不递归到单元格内的嵌套表；保持行ID、内容、行高和其他属性。行移动时设置跟随原行。外部请求仍要求会话、修订和明确目标；可使用目标表格中的稳定cellId定位。

`read_document().tables[].rowBreaks` 为 `{id, row, allowSplit}[]`。这是排版意图，不是实际分页结果；PDF/Word可能因行内容超过可用页高等原因拆行。新建和旧VDoc缺省false；Word导入无cantSplit标记按true解释。当前恢复直接行属性，不承诺覆盖全部Word表样式继承规则。



## 分页预览隔离（2026-10-02，第十二轮）

Page preview使用当前标题、序列化HTML及JSON的只读快照，不调用execute、不增加revision、不改变稳定ID或history。Paged.js及其排版DOM只存在于独立同源iframe；关闭时停止任务并清理。窗口消息校验origin、source和实例token；打印仅在完整性检查通过后允许。预览内修改不受支持；重新打开取得新快照。

重复表头使用已有pinnedRows，逐行跨页沿用allowSplit，纸张/页眉/页脚/页码沿用document.layout。本轮不增加AI命令，也不把渲染页号写回文档模型。`tables[].rowBreaks`仍是排版意图，复杂结构的最终PDF行为继续需要视觉验收。页码现在同时用于只读预览和Word。


## 段落分页（2026-10-02，第十四轮）

paragraph.style 新增 keepWithNext、keepLinesTogether、preventSingleLines 可选布尔值，false 也是有效修改。仍使用现有选区/明确目标与原子批次，不增加 AI 专属执行系统。省略字段保持各段原值。

模型 keepWithNext 缺省 null（标题默认与下段同页、正文默认不约束）；keepLinesTogether=false，preventSingleLines=true。HTML同时保留data属性与CSS；Word映射keepNext/keepLines/widowControl。分页预览与输出应用约束；编辑区仍连续画布。内容超页等无法满足约束时可能拆分，不承诺强制同页。


## 段落缩进（2026-10-02，第十五轮）

paragraph.style 的 indentStart/indentEnd 是逻辑起止边距基准，单位px，可含小数；firstLineIndent正数=首行内缩，负数=除首行外其他行内缩其绝对值，零=无特殊缩进。渲染正文起点=indentStart+max(0,-firstLineIndent)，CSS text-indent=firstLineIndent。模型indentStart=null时回退旧indent等级×24；显式设置旧indent会清除精确起点覆盖，同批显式indentStart优先。

paragraph.indent 接收direction in/out，按每个选中段落自己的起点分别±24px，in上限10000，out到0停止；已是负值的导入段落out不再外移。保持末端与特殊缩进。仍走现有原子批次与版本校验，没有新增AI任务接口。


## 标尺增量操作（2026-10-02，第十六轮）

`paragraph.adjustIndent`：`handle: 'start' | 'firstLine' | 'end'`，`delta` 为 −20000 到 20000 的有限数字，单位文档 px。依段落逻辑方向增量调整选中段落；不改文本、列表层级或选区外单元格。start 移动整段并保留特殊缩进；firstLine 保持正文行位置，只移动首行（可跨为悬挂）；end 只改尾端。结果各缩进属性须在 ±10000 内，否则整批拒绝。

原有 `paragraph.style`、`paragraph.indent` 与标尺共用多范围段落选择器，确保表格跨行选列可覆盖全部选中格；布局面板混合值读取亦遵循同样范围。

标尺按当前容器尺寸约束拖动边界，拖动期间只渲染标记/导线，释放才提交一条带 expectedRevision 的操作；取消／无位移不提交。外部调用仍须 session、revision 和明确 target；本轮未增加 AI 专用通道。


## 等距制表（2026-10-02，第十七轮）

`paragraph.style.tabInterval`：8–480整数像素，默认48。段落／标题属性通过HTML、备份、预览及可表达的Word等距制表定位往返。多格选区逐范围应用，Mixed只有显式修改后才覆盖。

`text.insert` 的 `text: "\t"` 写入真实U+0009。正文Tab快捷键和Insert → Tab character复用这一操作；列表／表格原有Tab导航优先。未变化的光标不再被重复setSelection，以保留当前输入marks。

本轮未增加任意制表位模型；不能将tabInterval解释为左中右对齐或固定多个坐标。外部接口仍使用原有版本与目标保护。


## 列表编号（2026-10-02，第十八轮）

- `list.restart`：`start`为0–2147483647整数。从当前条目开始；中途操作拆分当前列表包装，保留段落ID、条目结构与格式；清除此段动态续接。
- `list.continue`：无额外参数。接同一父容器内最近的前方编号列表；在中间条目执行则接拆分前半列表。无来源拒绝；跨列表、多格或非编号列表选区拒绝。
- `orderedList.continuePrevious`为boolean，默认false；`start`存储当前有效起始值。结构变化后的归一化仅更新派生起始值，保持一个操作一次撤销；普通文字／mark编辑不触发列表遍历。若不存在前一同级列表则保留原start；恢复来源后重新计算。
- HTML使用`data-continue-numbering="true"`及原生`start`，备份严格校验；Word共享numId对应动态续接。Word的同条目多段输出为无额外编号的续段样式，导入恢复同条目层级。

所有调用仍走原有原子批次、composition保护、session/revision与明确target约束；没有另建AI专用写入路径。


## 列表样式（2026-10-02，第十九轮）

`list.style`：`style`枚举decimal、lower-alpha、upper-alpha、lower-roman、upper-roman、disc、circle、square。必须选中单一层级的编号或项目符号列表，且style与列表类型一致；不负责转换类型。编号修改同一父容器内整组动态续接列表，项目符号仅修改当前列表；保留起始计数、文本和段落属性。相同样式不改revision。

编号沿用orderedList.type（null或1表示数字，a/A/i/I为其他样式）；bulletList新增bulletStyle，默认disc。导出HTML内联list-style-type以覆盖默认CSS，备份校验类型白名单。动态续接归一化同时采用前一列表的标记类型，避免画面与Word同一numId表达不一致。模型的非关联列表及嵌套层级互不影响。所有操作沿用原有版本、显式目标、组合输入保护及原子撤销约束。


## 自定义列表标记（2026-10-02，第二十轮）

`list.marker`参数为`prefix?`、`suffix?`或`bullet?`，字段不可跨类型混用且至少一项。编号列表前后缀按同一续接组应用，每项0–8个字素、最多64 UTF-16单元，拒绝控制字符、孤立代理项和%1–%9占位符。项目符号的bullet为一个可见字素、最多32 UTF-16单元；null清除自定义符号，回到原预设。`list.style`选择项目符号预设也会清除bullet。

模型属性：orderedList.numberPrefix默认空、numberSuffix默认句点；bulletList.bulletText默认null。HTML携带data-number-prefix／data-number-suffix或data-bullet-text，CSS变量经过逐码点转义。续接归一化同步前后缀；重启可拆成独立标记组。Word使用原生lvlText表达；导入只接受当前层级单一占位符，其余复杂编号保留计数并提示外观变化。外部接口继续遵守session／revision、显式target、组合输入保护与原子批次。


## 列表缩进语义（2026-10-02，第二十一轮）

现有list.indent按TextSelection两端所在的最近同层列表确定listItem／taskItem，不再根据任意祖先taskList猜测。跨无关列表或从表格内操作表格外列表拒绝。新建子列表继承来源标记，重置blockId、start=1、continuePrevious=false；移入已有同类子列表采用目标属性。顶层编号列表中间项退出后，尾段continuePrevious=true且接续剩余前段；超出计数上限拒绝。原生列表命令复用同一实现；列表Tab／Shift+Tab通过统一操作层隔离撤销，表格Tab优先保持单元格导航。组合输入、原子回滚、外部版本／目标约束继续有效。


## 清单完成项显示（2026-10-02，第二十二轮）

list.checklistStyle参数strikeCompleted为必填boolean。作用于选区最近同层taskList；支持同清单多项TextSelection及taskList NodeSelection。普通编号／项目符号、表格边界、跨清单选择拒绝；同值成功但不写入。taskList.strikeCompleted默认true，HTML属性data-strike-completed携带true／false；备份严格校验，checked也必须为boolean。原子回滚、组合输入保护、稳定ID与外部session／revision约束沿用原接口。新缩进层级继承模式，已有目标采用目标设置。Word将其映射为静态完成外观并提示交互结构限制。


## 列表转换范围（2026-10-02，第二十三轮）

list.toggle仍使用kind=bullet／ordered／task，无新增AI写入路径。已有列表在光标处转换当前条目，同层TextSelection转换所含连续条目；支持整个列表NodeSelection及只有一个列表和尾随空段的AllSelection。相同类型仍执行退出列表。目标item仅更换包装，保留原内容、段落ID和子结构；转换为task时该层checked默认false。未选前后列表独立保留，编号前后段按剩余条目续接。新编号系列或整段来源移除可能改变后方续接来源时，后方原系列转为独立编号并保留当前计数／标记，可用list.continue显式重接。不同标记相邻列表不自动合并；跨无关列表混合选区拒绝。全部沿用原子批次、撤销、composition及外部版本保护。


## 列表选区边界与标题首行（2026-10-02，第二十四轮）

list.toggle拒绝CellSelection、跨tableCell／tableHeader边界的TextSelection、非列表对象NodeSelection，以及会把整个表格隐式包进列表的混合选区；返回UNAVAILABLE并在多格情形说明先选单格文字。其余原子／版本／撤销规则不变。listItem／taskItem首块schema扩展为paragraph或heading，普通列表默认新项仍为paragraph；无需存档版本迁移。Word普通列表首行标题以基于Heading的VDoc List Heading样式及原生numPr表达，导入按样式恢复；这不改变清单的静态Word表示限制。


## 多格列表类型设置（2026-10-02，第二十五轮；更新上一轮范围）

list.toggle支持CellSelection及显式target.kind=cells，参数仍为kind=bullet／ordered／task。对每个所选格的直接正文／标题和列表应用类型，连续段落分为一个列表的多个项；对象块原位保留，原列表子内容不展开。任意可转换块不同于目标类型时统一应用；所有可转换块已经同类则取消该层，子列表保持。已有目标列表设置／checked保持，新taskItem未勾选，新编号每格独立从1开始。新系列可能改变续接来源时将旧后续系列解除动态续接且保留start和marker。

所有格计划成功后一次写入，保留单元格节点、属性／ID、网格及选区方向；外部session／revision、composition、原子回滚和一次撤销约束不变。纯对象选区无可转换内容则UNAVAILABLE。table插件把整表NodeSelection归一为CellSelection时可以转换；跨格普通TextSelection、非列表对象节点和跨无关列表的混合正文选择仍拒绝。list.style／marker／restart／continue／indent／checklistStyle的多格支持不在本轮范围，原适用边界不变。


## 多格列表样式（2026-10-02，第二十六轮；扩展上一轮范围）

list.style／list.marker／list.checklistStyle现在接受CellSelection与显式cells目标。只枚举所选格的直接列表，不深入嵌套列表或表格。普通样式目标要求同一普通列表类型；同选编号与项目符号时UNAVAILABLE且批次不提交；普通段落和任务清单跳过。清单显示仅枚举直接taskList，保留checked及条目内容。

编号类型与前后缀仍沿同父级续接组设置；多格情况下各格的起始值和continuePrevious保持，不能跨格形成续接。marker的prefix／suffix仍是可选字段，未传字段保持；面板Mixed映射为未传字段，避免仅改一侧时改写另一侧。已有相同值不写入revision／历史。单列表原有行为及外部session／revision、composition、原子撤销约束不变。list.restart／continue／indent的多格能力仍未扩展。


## 多格重新编号（2026-10-02，第二十七轮）

list.restart的start范围仍为整数0..2147483647，新增CellSelection和显式cells目标支持。按每个格的直接orderedList顺序处理：continuePrevious=true且本格已有前序编号时跟随该前序结束值；否则作为独立组从请求start开始并设continuePrevious=false。各格用文档位置隔离，不跨格计数。子列表和其他类型不枚举；编号类型、前后缀、ID和内容保持。

所有计算出的列表起始值先验证；任一续接start越界则返回不可用且无部分写入。通过后同一事务更新全部起始值，供同批次后续操作读取。无可用直接编号列表拒绝，同值不写入；保留原composition、外部版本、原子回滚与一次撤销规则。单个TextSelection仍按当前条目重启／拆分；格内文字不能越界定位外层编号。list.continue与list.indent对多格仍未扩展。


## 多格主动续接（2026-10-02，第二十八轮）

list.continue扩展到CellSelection／显式cells目标。每个格按直接orderedList顺序处理：第一段保持原attrs，后续start取本格前段start+childCount，continuePrevious设true，并继承本格前段type／numberPrefix／numberSuffix。先规划所有格的完整链，再写入；任一续接起始越界整批不可用，无目标也不可用。单段格、其他节点、嵌套列表／表格不改，绝不跨格寻找来源。已正确续接为成功no-op。菜单可用性复用规划结果。

计数和样式在当前事务内即完成，后续同批次操作可读取；原动态更新、版本／composition保护、稳定ID、失败回滚与一次撤销规则不变。多格list.indent仍未支持。


## 嵌套列表提升与菜单路由（2026-10-02，第二十九轮）

list.indent仍限定同一最近列表内的TextSelection，不支持CellSelection。嵌套提升先在临时事务规划：剩余尾段保持独立列表，orderedList.start=原start+range.startIndex，continuePrevious=false，清除新包装的blockId供稳定ID插件补齐；提升项原有子列表不自动与尾段合并。尾段编号越界时can和实际命令均false且无部分写入。成功时映射选区并将计划步骤合入原事务，沿用原子批次和一次Undo。

菜单共享indentCommandType：同列表文字选区走list.indent；端点属于不同列表／正文，或选区包含列表但不满足局部操作条件时返回null、禁用菜单；其他选区走paragraph.indent。显式paragraph.indent接口本身不移除，界面不再以其替代不支持的结构缩进。普通表格格内段落不会被外层列表捕获。


## 多格列表减少一级（2026-10-02，第三十轮）

list.indent direction=out新增CellSelection及显式cells目标支持。liftCellLists枚举所选格的直接orderedList／bulletList／taskList，移除其列表及条目包装，将每条目原有内容按序提升到格内；子列表不递归展开。最外层清单标记随条目退出列表移除，子清单checked保持。普通格不改；无直接列表返回false。

对子条目内部的编号序列，原父项中已有前序orderedList时保留continuePrevious，首个子orderedList若带该标记则清除，防止更换父容器后串接其他条目。所有格内容规划及validContent检查通过后才逆序写入，映射保留原CellSelection；dry run不写入，原子批次、外部session／revision、composition与一次Undo沿用。

indentCommandType新增direction参数：含直接列表的多格out路由list.indent，in返回null。纯段落选格继续路由paragraph.indent。多格in仍不支持，局部文字列表缩进与表格Tab规则不变。本次新增的是统一操作层及菜单范围，未扩展原生Tiptap多格liftListItem接口。


## 局部退出列表的编号计划（2026-10-02，第三十一轮）

list.indent out在当前列表不处于同类型父列表项时，调用liftRootItems。按原父容器构造编号属性计划，再在临时EditorState执行原生liftListItem；确认结果的父容器结构后将计划属性与结构步骤合入原事务。can不写入，结构失败／编号越界不留下部分步骤。

原列表保留头尾片段，尾段start=source.start+range.startIndex。提升内容中有直接orderedList时尾段解除与前序列表的自动连接；子项内部首个孤立continuePrevious解除，原条目内有效子续号保留。第一段后续原编号按原列表剩余条目数更新，来源不再相邻时解除动态连接；原组全部移除则后续编号独立从原组起点开始。对结果父容器中的有效编号链立即求值，后续同批操作可读取最终计数和样式。

同类型父项内的嵌套提升继续使用第二十九轮逻辑，多格out沿用第三十轮。增加层级规则及多格in不支持的边界未改变。


## 缩进能力查询及键盘路由（2026-10-02，第三十二轮）

availableIndentCommand(editor,direction)只读返回list.indent、paragraph.indent或null。先检查可编辑／composition，再用indentCommandType划定范围；局部列表委托editor.can().sinkListItem／liftListItem，多格out委托liftCellLists(tr,false)，普通段落通过selectedParagraphs及共享stepParagraphIndent确认至少一段会改变。查询不提交事务、不改变选区或历史。

Format菜单和Mod-[／Mod-]共用查询；不可用键盘边界消费按键而不提交操作，composition／不可编辑时交还事件。实际成功仍走DocumentEngine原子命令；原API对合法无变化paragraph.indent的成功no-op语义保持。快捷键不替代表格Tab导航，整格list.indent in仍未支持。


## 文字格式快照（2026-10-02，第三十三轮）

新增format.apply操作，format为textFormatSchema严格对象：bold／italic／underline／strike布尔，color／highlight为六位HEX或null，fontFamily为五种支持字体或null，fontSize为8..96有限数字（允许小数）或null，script为normal／superscript／subscript。全部字段必需，无额外键；null／false用于移除相应目标格式，而非保持旧值。

applyTextFormat基于当前事务的TextSelection／AllSelection／CellSelection收集paragraph／heading中的文字片段，跳过代码和对象；仅替换已列文字marks，保留link等非目标marks。先比较mark集合，同值不写入。无目标返回false；成功仍经DocumentEngine一次原子历史，沿用外部版本、去重、composition和回滚规则。显式范围继续受Unicode边界校验。

copyTextFormat是本地只读取样，不作为写命令，也不进入操作历史。界面快照放在当前Workspace内存，刷新／切换销毁；不访问系统剪贴板。混合源按文档顺序起点取样；caret使用待输入marks和段落继承样式。代码源、无法表示的显式字体／超限字号返回null。粘贴必须有非空可用文字目标；不复制段落布局、列表／表格／对象结构。


## 全选／多格取样与无变化记录（2026-10-02，第三十四轮）

copyTextFormat扩展到AllSelection／CellSelection。对ranges按from排序，取首个支持的paragraph／heading位置；首个空段落使用默认取样，不借用其他格或storedMarks。普通TextSelection沿用当前位置／selection.from逻辑。取样始终只读，不重新设置选区。

DocumentEngine仍返回成功no-op并缓存请求结果，但仅在revision或有效待输入marks变化时新增可见操作记录；不将显式化相同隐含marks误记为修改。paragraph.style的直接布局属性写入前比较同值。此更新未改变撤销分隔、请求去重、版本约束或实际格式操作的原子性。


## 取样边界及绝对字号换算（2026-10-02，第三十五轮）

非空TextSelection与AllSelection／CellSelection按ranges文档顺序寻找实际选中文字，跳过inline atoms／hardBreak和未选文字；结构选区首个空paragraph／heading仍可采样默认样式，普通空TextSelection沿用待输入marks。选中代码文字仍不可复制。DOM使用domAtPos(pos,1)，不借用前一格式片段。

共享absoluteFontPixels解析CSS绝对单位px／pt／pc／in／cm／mm／q并换算px，保留至六位小数，用于copyTextFormat、字号工具栏和Word半磅转换。format.apply参数仍为px，schema与外部版本／目标协议不变。相对字号仅可在非空取样有浏览器计算像素证据时读取，光标待输入相对字号不靠DOM猜测；Word导出相对／非法字号直接抛出可读错误，不生成静默失真的文件。


## 导入字号加减边界（2026-10-02，第三十六轮）

工具栏对减小的ceil(size)-1、增大的floor(size)+1同时施加8与96上下限，因此外部120px首次减小得到96px，6px首次增大得到8px。text.style仍仅接受8–96整数，未放宽外部接口。原始导入值保留至用户主动修改；一次Undo恢复原始属性，Redo重放新值。


## 原生备份读取与异步导入（2026-10-02，第三十七轮）

parseDocument(raw,maxLength=Infinity)默认与IndexedDB读取保持同一大小政策，有限maxLength仍供转换调用显式使用。原生.json文件入口不再使用20MB file.size限制；DOCX／TXT转换入口仍有20MB字节限制，DOCX转为JSON后的调用显式传20_000_000长度上限。所有原有schema／属性／嵌套深度校验保持；可移除开头BOM后解析，损坏根／节点／marks给出可读错误。

LocalDocuments以mounted引用保护读取及旧文档保存之后的继续动作，卸载后不触发新激活／onOpen；currentTitle引用确保异步读取期间的改名不会被旧闭包覆盖。检查不取消已开始的IndexedDB事务。文档操作协议与API参数无变更，尚未接入AI。


## 文件动作重入保护（2026-10-02，第三十八轮）

LocalDocuments.perform在首个await前设置pending.current，busy仅负责视图反馈；新建、列出文档、读取并打开文档、导入均复用此入口。锁在finally释放，失败显示错误但不继续激活。File显示进行中状态，冲突入口和本地文档按钮禁用，导出备份不进入该锁。mounted检查覆盖列出／读取的异步结果。

LibraryHome.perform同样以同步pending引用判断并在finally释放，避免同事件React状态尚未更新时重复存档。两处锁作用域均为组件实例，不改变DocumentEngine写操作／版本协议，不提供跨标签页协调或已提交事务回滚。


## 返回首页的最终保存关口（2026-10-02，第三十九轮）

BackToDocuments独立处理返回首页：pending引用防重入；每次saveDocument前捕获editor.state.doc和最新规范化标题，await后核对两者，变化则继续保存。选区不改变doc对象，因此不重复写入。mounted／isDestroyed／blocked／view.composing保护异步返回，失败保留当前页面。保存后确认一致至onHome之间无await。此流程不冻结编辑，不取消已提交事务，不修改DocumentEngine接口；未将File激活与首页离开统一为全局导航锁，相关切换竞态仍待后续整改。


## 同一编辑器的文档切换保护（2026-10-02，第四十轮）

documentNavigation(editor)以WeakMap共享idle／reading／committing阶段。acquire为同步检查，release恢复原编辑状态并通知订阅者。freeze仅允许reading且无组合输入，注册文档变更过滤插件并设为不可编辑；统一操作层已有isEditable检查，因此提交期间API／历史请求返回UNAVAILABLE。标题与自动保存入口也检查committing。File切换及版本恢复从最终快照之前持锁到激活结果处理完成；返回首页仍补存最新快照。历史面板和弹窗关闭检查同步阶段，备份导出不受导航锁限制。

接口不增添AI能力或跨标签页协调；不取消已开始的IndexedDB事务。自动化覆盖范围见复杂流程第四十轮，页面实机仍待验。


## 自动保存控制器（2026-10-02，第四十一轮）

startAutosave持有单个写入中的请求与450ms防抖，捕获ProseMirror文档对象和标题后写入，成功时核对当前快照、blocked及导航阶段再报告Saved locally。dispose取消定时器和监听，迟到结果不更新UI；不取消已提交事务。useDocumentAutosave仅在editor／documentId变化时替换控制器，title变化调用schedule。导航committing暂停新请求，释放后以防抖恢复，成功切换的卸载会取消该恢复。失败报告实际存储错误并保留备份提示；无新编辑／事件时不无限重试。保存协议和AI接口不变。


## 原子版本恢复（2026-10-02，第四十二轮）

restoreVersion(key,current)在一个versions／documents／summaries／settings读写事务内读取并验证版本，检查目标内嵌ID与当前ID一致、活动文档未切换，然后创建Before restoring a version快照、维护40份保留、写入目标正文和摘要。检查／写入失败统一abort，无恢复前快照或保留清理的部分提交。输入当前稿与目标版本均执行parseDocument；函数参数和返回SavedDocument不变。调用方仍负责第四十轮导航与编辑保护。


## 图片显示比例与Word尺寸（2026-10-02，第四十三轮）

image.update接口参数不变；当旧width和height都为正时，修改width同步计算height=newWidth×oldHeight/oldWidth，超过10000px则拒绝，未指定width时保持高度。无显式height时维持原图比例。LocalImage输出数值height和显式宽高的aspect-ratio；Word导入读取cx／cy，导出优先使用显式高。版本、备份与撤销重做沿用现有schema；并未增加裁剪或浮动布局。


## Word表格格式映射（2026-10-02，第四十四轮）

restoreWordFormatting匹配单元格前排除vMerge continuation，保留restart与未合并格；gridWidths仍基于包含占位格的原Word列位置。tblPr／trPr／tcPr及其属性读取改用限定命名空间的直接子节点查询，嵌套表格独立处理。格式映射数量不一致时仍不按错误下标强行写入。统一编辑操作接口和schema无变更。


## Word导出生命周期（2026-10-02，第四十五轮）

usePreparedExport（components/editor/prepared-export.tsx，Word 以 docx 格式 id 调用）以pending引用防止同步重复调用，保存ProseMirror文档对象与标题后异步经格式注册表调用exportWord。generation序号及mounted／editor.isDestroyed保护迟到结果；URL只在有效完成后创建，close／重生成／cleanup显式释放。结果含changedSinceStart，比较正文对象及标题变化；重生成重新捕获快照，静态清单标记与文件名也绑定该快照。导出不占导航锁，不更改DocumentEngine协议，也不取消已启动的转换计算。


## 文件导入报告与通知生命周期（2026-10-02，第四十六轮）

readDocumentImport(file)返回{document,format,warnings}，document遵守原SavedDocument schema，转换提示去重、过滤空值后单独返回，不写入正文或存档。importDocumentFile(file)保留只返回document的兼容接口。两UI入口读取报告，在成功打开后统一notifyDocumentImport；失败沿用错误路径，不发成功提示。Word报告有具体警告时持续显示，默认仅一般格式提醒。稳定外层VdocWorkspace挂载唯一Toaster，使通知跨文档key和首页切换保留。操作层协议及文档schema未变；报告不代表支持或检测所有Word特性。


## Word复杂段落格式映射（2026-10-03，第四十七轮）

Word导入在Mammoth转换前对主文档XML的w:cr做等价w:br规范化，原输入buffer不修改。restoreWordFormatting使用排除生成脚注标签的HTML文本匹配段落／列表，并对复杂段落按文字片段和DOM文本节点长度进行完整校验后逐片段恢复直接格式，保留链接、换行和脚注节点。普通纯文字段落沿用原恢复路径，含drawing段落继续跳过文字格式恢复；没有改变操作接口、文档schema和脚注纯文字模型。


## 自动保存最长等待（2026-10-03，第四十八轮）

startAutosave以performance.now记录pendingSince；每次调度取min(450ms, max(0, 2000ms - 已等待时间))，持续输入不重置pendingSince。实际写入开始时开启下一批计时，慢写入期间到期请求只记录待处理，完成后保存最新快照；失败重试重置截止以避免快速循环。导航committing、恢复／冲突保护及dispose清除截止。快照一致性使用正文Node.eq及标题判断。文档schema、统一操作接口不变；不保证操作系统终止、主线程阻塞或磁盘迟缓时在2秒内完成持久化。

## Agent 来源（2026-10-15，#26）

`engine.executeAgent(input, { actor, turnId })` 供自动化调用方（后续的实时适配层）使用。输入遵循外部调用规则（必填 `expectedSessionId`、版本前置条件和明确目标），但不得自带 `source`；引擎写入 `source: 'agent'`、`actor` 与 `turnId`，并标记到事务 meta `vdoc` 和操作记录。

Agent 编辑在目标位置执行后，把用户原来的选区（经本次映射）和待输入样式（stored marks）放回，不聚焦编辑器，也不清除工具栏对话框保存的选区书签。用户可以在 agent 修改其他段落时继续输入。

`window.vdoc` 与 WebMCP 仍走 `executeExternal`：携带 `source: 'agent'`、`actor` 或 `turnId` 一律 INVALID；内部 `execute` 中只有 agent 来源可以且必须携带 actor 与 turn，且不接受隐式 selection 目标。


## Realtime document tools

The optional vRT integration offers `read_document`, `apply_document_operations`, and `undo_turn`. The browser-standard bridge retains its existing API-origin behavior. Shared metadata/schema bindings live in `lib/usecases/document-tools.ts`; only the infrastructure adapter imports the vRT SDK.

Writing tools execute only inside SDK `run()` callbacks. The model supplies an explicit target and the session/revision or block-version preconditions it read; it cannot supply `id`, `source`, `actor`, or the executing `turnId`. The connection maps trusted SDK call/turn IDs to connection-scoped local IDs, stable across resume. `read_document` includes recent `agentEdits` with these turn IDs for `undo_turn`.

`undo_turn` takes `{ targetTurnId, expectedSessionId, expectedRevision }`. The new undo origin is supplied by the connection, and the existing selective history preserves unrelated typing. A retry of a successful call returns its prior result. Reusing an ID with different arguments returns `DUPLICATE`. Successful IDs are retained for the connection lifetime; after 10,000 successful calls, new writes require a new connection rather than silently forgetting IDs.

Composition waits are bounded to five seconds and honor both call cancellation and document teardown. After waiting, the executor rechecks cancellation and document identity; the synchronous engine validates live version preconditions. No await separates that final check and the write. `STALE`, `TARGET`, `INVALID`, `UNAVAILABLE` and other operation failures remain structured `{ ok: false, code, error, revision, id }` tool outputs; these are document-level failures inside a successfully transported SDK result, not invented wire failure codes. The agent should reread and replan after `STALE`.

Stop/Esc call the SDK interrupt immediately. Escape is left to open dialogs/menus and active IME composition. Stopping leaves committed edits intact; `undo_turn` is the explicit reversal path. Document switch, return to the library and unmount cancel pending work and close the SDK session, including a pending handshake.
