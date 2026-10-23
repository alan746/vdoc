# VDoc 语音实时 Agent 方案

更新：2026-10-15。范围：语音控制 AI、实时操作文档。核心要求：agent 工作时用户可随时用语音打断；agent 每一次 tool call 对文档的修改都实时反馈到前端界面。

现状基础：[`DocumentEngine.executeExternal`](../lib/usecases/engine.ts) 已具备 zod 校验的 50+ operation、稳定 block/cell ID 定位、session/revision 防过期、批量原子执行（一次撤销）、op id 幂等；[`browser-tools.ts`](../lib/usecases/browser-tools.ts) 已暴露 `read_document` / `apply_document_operations`。本方案在其上叠加语音层与实时层，并改造引擎以适应持续写入、可被打断的 agent。

## 已落地：vRT 客户端接入（2026-10-16）

以下接入约定取代本文早期草案中自建 WebSocket 协议、队列和 epoch gate 的建议。

- 使用 npm 的 `@vrealtime/client@0.1.0`，仅 `lib/infrastructure/realtime/vrt-adapter.ts` 导入 SDK。应用不维护 seq、ack、重放队列或另一个 epoch gate。
- `lib/composition/realtime.ts` 为每个编辑器会话接线，`RealtimeControls` 在文档切换、返回文档库和卸载时关闭会话。SDK 的 `ClientSession` 在握手前即可持有和关闭，避免 `connect()` Promise 尚未完成时无法取消连接。
- `lib/usecases/realtime-executor.ts` 在 SDK 的 `run()` 内校验可信上下文，最多等待 IME 5 秒；等待后重新检查取消、文档绑定和版本，通过同步 `executeAgent` / `undoTurn` 提交。
- #29 已在主分支提供选择性轮次撤销；接入层提供 `undo_turn`，新连接的服务器 call/turn ID 映射到独立的本地 ID，恢复连接复用映射，防止新会话的 `turn-1` 与旧历史混合。
- 当前提供文字指令、可选麦克风、Stop/Esc 和断开入口。未实现 #33 的活动时间线和 #35 的渐进预览；工具参数增量不会直接写入正文。

### #35 准备：fake adapter 与协议 fixtures（2026-10-16）

按 #35“实施顺序”第 1 步，先补齐开发/测试基础设施，不涉及该 Issue 任何功能任务（上下文读取、独立预览、能力协商均未开始）：

- [`tests/support/fake-vrt-adapter.ts`](../tests/support/fake-vrt-adapter.ts)：`RealtimePort` 的可复用假实现，连接不经网络/鉴权，直接调用注册工具的 `run()`（当前 SDK 的完整参数调用路径）；暴露 `reconnect()` / `fail()` / `disconnectFromServer()` 驱动状态机。不模拟 austinchennn/vRT#22 提案中尚未落地的 `tool-stream`（参数增量/预览）协议——那部分名字和语义仍待 vRT 侧 #16 定稿，提前假造会与未来真实协议不一致。
- [`tests/support/realtime-scenarios.ts`](../tests/support/realtime-scenarios.ts)：#35 与 vRT#22 验收清单里版本冲突、按轮撤销等场景的请求/上下文构造器，供后续任务复用而不用重新拼装。
- [`tests/realtime-fake-adapter.test.ts`](../tests/realtime-fake-adapter.test.ts)：用上述假实现跑通 `openDocumentRealtime` + 文档工具 + 真实 `DocumentEngine` 的完整路径（连接状态、提交、过期撤销、重连、断开、关闭后拒绝晚到调用），无需真实 vRT 服务即可本地开发和回归。

### #35 任务1：上下文、按需读取和目标快照（2026-10-16，后由 #30 拆分 get_context）

新增 `get_context` 工具（独立于 `read_document`，见下方 #30 条目），返回：

- `outline`：标题列表 `{ id, level, text }[]`（[`documentOutline`](../lib/editor/document-snapshot.ts)），用于解析“在项目规划标题下面”一类指代。
- `selection`：按 `turnId` 冻结——同一语音轮次内多次读取返回首次读取时的选区，光标移动不重新解释目标；新 `turnId` 重新捕获当前选区。冻结的是引擎维护的 `SelectionAnchor`（`engine.anchorSelection()`），会随之后的文档修改（包括本轮 agent 自己的修改）映射，始终指向同一段内容——最初版本存的是原始位置，任何前面的插入都会让它指错，已修复（vdoc#44）。每个连接最多保留 64 个轮次，超出时只淘汰最早开始的轮次并释放其 anchor；连接结束时全部释放。
- `recentEdits`：最近成功提交的 agent 轮次（`{ id, turnId, actor, revision, affectedBlockIds }`，最多 20 条），`affectedBlockIds` 在每次读取时与当前文档重新比对，引用已删除的块会被过滤掉；只统计 `source: 'agent'` 的事件，用户或工具栏编辑不计入。

新增 `read_blocks({ ids })` 工具：按最多 200 个块/表格 ID 返回完整内容（文字、表格网格与单元格），不要求读取整份文档；未知 ID 直接省略，不报错。与其余工具共用 `check()`（取消、文档/会话绑定、可编辑性）。

尚未做、不要误认为已完成：可见块测算（留给编辑器/UI 适配层按设计）、上下文长度限额与截断标记、"冻结目标" 的显式目标对象（当前只冻结选区，不冻结 block 引用本身）。这些仍在 #35 任务1 范围内，留给后续迭代。

### #30：共用的文档工具目录（2026-10-16）

[`lib/usecases/document-tools.ts`](../lib/usecases/document-tools.ts) 新增 `documentToolCatalog`：`{ name, description, parameters, readOnly }[]`，`read_document`/`read_blocks`/`get_context`/`apply_document_operations`/`undo_turn` 五项，描述与 JSON Schema只在这一处定义。

- `realtimeDocumentTools(executor)` 对每一项套上对应的 `run`，供 `@vrealtime/client` 使用（不变）。
- [`browser-tools.ts`](../lib/usecases/browser-tools.ts)（WebMCP 桥）改为从同一个 catalog 取 `read_document`、`read_blocks`、`apply_document_operations` 三项的 description/parameters/readOnly，不再各写一套；新增注册 `read_blocks`。`get_context`、`undo_turn` 需要 agent turn 身份（`actor`/`turnId`），WebMCP 没有这个概念，不注册。
- `read_document` 本身拆成两个工具：`read_document` 保留原来的纯文档读取语义（snapshot + docId + agentEdits，WebMCP 和语音层行为一致，只是 WebMCP 版本没有 docId/agentEdits），任务1 新增的大纲/冻结选区/最近编辑移到独立的 `get_context`。
- `apply_document_operations` 在两条通道里仍然是两套不同的写入路径（WebMCP 走 `engine.executeExternal`，`api` 来源；语音层走 `realtime-executor.ts` 里 `engine.executeAgent` 的可信执行），只是 description 统一成一份、WebMCP 保留自己的 `externalDocumentSchema` 做校验（agent 和 external 的 schema 结构不同，`source`/`actor`/`turnId` 字段不一样，不能共用同一个 JSON Schema）。

### #35 任务2（部分）：整块插入与删除（2026-10-16）

新增两个 `Operation` 类型（[`lib/domain/entities/operation.ts`](../lib/domain/entities/operation.ts)、处理器在 [`lib/editor/document/commands.ts`](../lib/editor/document/commands.ts)），语义与既有 `block.move` 一致：按 `id`/`beforeId` 在顶层文档结构中定位，不经过 `target` 解析，因此和 `block.move` 一样要求全局 `expectedRevision`（已加入 `engine.ts` 的文档级前置检查列表）。

- `block.insert`：`beforeId`（`null` = 文档末尾）+ `block`（`heading` / `paragraph` / 带 `headerText`、`rowsText` 的 `table`，一次调用即可建好表头和初始数据）。覆盖了 Issue 示例"在项目规划下面加一个两列预算表，列名是项目和费用"的整个创建路径，不需要先插入空表再按临时 ID 回填单元格。
- `block.delete`：按 `id` 删除一个顶层块。

**仍未做，不要当作任务2已完成**：

- 跨操作临时 ID 引用（例如同一 batch 里先插入一个表格、再引用它刚生成的行/列 ID）完全没有实现；`block.insert` 只处理"一次性插好内容"的场景，不支持插入后在同一批次里对新节点做后续结构化操作。
- 没有为新建节点返回 `createdIdMap`；调用方要拿到新块 ID 需要重新 `read_document`。
- 没有修改 `table.edit`（行列增删）之外的既有语义；本次只填了"插入/删除整块"这一具体缺口。
- 没有改变 batch 的单一初始 `target` 限制——`block.insert`/`block.delete` 能工作是因为它们本来就不用 `target`，不代表 batch 现在支持任意多目标操作。

### #35 任务4（部分）：提交结果携带受影响块 ID（2026-10-16）

`apply_document_operations` / `undo_turn` 成功时现在在返回值里直接带 `affectedBlockIds`（取自 `engine.onApplied` 为这次调用发出的事件，按 `result.id` 匹配，不假设事件一定是最新的一条——未实际改变文档的成功调用没有事件，这时是空数组）。此前只能通过单独订阅 `onApplied` 才能拿到这个信息；现在模型/语音层不需要额外订阅就能知道刚才改了哪些块。

任务4其余项（STALE/TARGET/UNAVAILABLE/COMPOSING/INVALID/DUPLICATE 结构化错误、组字后复检、同步写入前无 await）已经在既有 `realtime-executor.ts` 中满足；`arguments-complete`/`document-committed`/`persisted` 三态区分仍未做，留给接入持久化回执的后续工作。

### 任务6（按语音轮次撤销）现状确认

复核后，#29 的既有 `SelectiveUndoHistory` 已经满足任务6列出的场景：未知/已撤销/已淘汰 turn 返回 `UNAVAILABLE`（见 [`tests/turn-undo.test.ts`](../tests/turn-undo.test.ts)）、同轮部分淘汰整轮拒绝而不是只撤一半、undo-of-undo 作为新 turn 处理且可重复交替撤销、结构冲突（如撤销会删除用户在新表格里写的内容）整轮拒绝并保留文档不变。`undo_turn` 已经复用这套实现。这次没有新增代码，只是确认任务6不需要在 #35 里重做一套。

### #33：Agent 活动可视化、状态条与 turn 时间线（2026-10-17）

实现范围限定在不依赖 vRT 尚未定稿的 tool-stream 协议的部分；完整协议面见 [`REALTIME_PROTOCOL.md`](REALTIME_PROTOCOL.md)。

- [`lib/editor/realtime/agent-activity.ts`](../lib/editor/realtime/agent-activity.ts)：纯视图 ProseMirror decoration，`attachAgentActivity(editor)` 在运行期注册插件并返回 `highlight`/`setPresence`/`clear`/`dispose` 句柄，和 `search-highlights.ts` 同一模式，不写入文档/历史/导出。（最初版本只导出了一个 Extension 却没有注册到应用编辑器里，生产环境不显示任何装饰，已修复并补了集成测试。）改动块渐隐高亮约 1.5 秒；presence 标记随最近一次提交移动，断开/卸载清空。
- [`components/editor/realtime/use-agent-activity.ts`](../components/editor/realtime/use-agent-activity.ts)：订阅 `engine.onApplied`（仅 agent 来源）驱动上述 decoration，并按 `turnId` 把 `engine.records` 分组供时间线渲染；返回的 `undoTurn(turnId)` 直接调用 `engine.undoTurn`，不经实时执行器（撤销是引擎通用能力，不需要可信 agent 身份）。
- [`components/editor/realtime/activity-timeline.tsx`](../components/editor/realtime/activity-timeline.tsx)：按 turn 分组的历史列表 + "Undo turn" 按钮，失败时 toast 提示，不静默吞错误。
- `RealtimeControls` 在 `status !== 'disconnected'` 时渲染时间线；Esc/Stop/连接状态文案是已有行为，未改动。
- `app/globals.css` 新增 `.vdoc-agent-highlight`/`.vdoc-agent-presence`/`.realtime-activity`，复用现有 `--accent`/`--ring`/`--muted-foreground` 主题变量，深色模式不用额外媒体查询。

**没做、不要当作已完成**：`tool.call.delta` 流式 ghost 预览（任务3的核心，依赖 vRT 还没实现的 tool-stream 能力）；presence 不是逐 token 跟随，只是"最近一次提交影响的块"；没有做 `tools/realtime-mock`（issue 测试小节提到的手工浏览器联调脚手架，本次未创建，手工验证留给真实部署环境）。

### 本地启用与服务端契约

默认关闭，不读取 URL 参数或文档内容中的连接配置。在应用来源的浏览器开发者工具中明确设置后刷新：

```js
localStorage.setItem('vdoc.realtime.v1', JSON.stringify({
  url: 'ws://localhost:8790',
  tokenUrl: '/api/realtime-token',
  audio: false,
}));
```

在编辑器点击 **Connect assistant**，输入文字指令；配置 `audio: true` 后按钮改为 **Connect voice assistant**，仅点击后申请麦克风。连接期间显示麦克风状态。配置只接受 `wss://` 或回环地址的 `ws://`，拒绝 URL 凭据、查询参数和 fragment。禁用时删除本地键并刷新。

`tokenUrl` 是部署方提供的**同源**鉴权端点；本提交不创建匿名签发 token 的接口。SDK 每次连接或重连调用 auth 函数，适配器 POST `{ docId, sessionId }`，端点基于现有用户身份和文档权限返回 `{ token: "短期令牌" }`。服务端必须验证该令牌并将连接限制在指定文档；不能信任客户端传来的 docId 本身就是授权。令牌不进入配置、URL 或日志，文档内容在模型调用读取工具后才返回。

未配置服务端/鉴权端点时，连接会失败但普通编辑仍可使用。实时语音服务和真实模型的端到端验证需要部署方的地址与凭据；本地自动测试使用 fake SDK 和真实 DocumentEngine。

## 0. 核心决策：tool 在浏览器执行

文档是 local-first（IndexedDB，引擎在浏览器），且语音控制意味着用户必然在页面前。因此：

> **服务端 agent 只负责“想”，浏览器里的 DocumentEngine 负责“做”。**
> tool_call 通过 WebSocket 下发到浏览器，引擎应用后把结果回传给 agent。

“每次 tool call 实时反馈到前端”因此不需要额外同步：执行处就是用户眼前的编辑器，改动在一帧（约 16ms）内上屏；agent 拿到的 tool_result 是真实结果（新 revision、改动摘要），而非推测。

后续需要多人协作、或关闭页面后 agent 仍能继续工作时，再把执行端换成服务端 Yjs 文档（见第 8 节 P3）。协议按执行端可替换来设计。

## 1. 整体架构

```
┌──────────────── Browser ────────────────┐        ┌──────── Cloudflare Durable Object（每会话一个）────────┐
│ 麦克风 → AEC → VAD(本地) ──┐             │        │                                                       │
│                            │ audio(binary)│──WS──▶│ Session Hub ─▶ 流式 ASR ─▶ 轮次检测 ─▶ Agent Orchestrator │
│ TTS 播放器 ◀─ audio ───────┼──────────────│◀──WS──│     ▲                                   │ (Claude，流式)   │
│                            │              │        │     │                                   ▼                  │
│ Interrupt Controller ◀─────┘ 本地立即生效  │        │  Turn 状态机 / epoch / AbortController   tool_use 流        │
│        │ epoch gate                       │        │                                         │                  │
│        ▼                                  │        │                       流式 TTS ◀─ 要说的话 │                  │
│ Tool Executor ─▶ DocumentEngine ─▶ TipTap │◀─tool.call────────────────────────────────────────┘                  │
│        │       (现有，需改造)              │──tool.result──────────────────────────────────▶ 回填给 Claude          │
│ 可视化层：AI 光标 / 改动高亮 / 操作时间线  │        │ 审计日志 · Trace · 限流 · 鉴权                            │
└───────────────────────────────────────────┘        └───────────────────────────────────────────────────────┘
```

- **服务端使用 Durable Object**：项目部署在 Cloudflare Workers（vinext + wrangler）。DO 即“一个会话一个单线程有状态实例”，turn 状态、对话历史、AbortController 均放在其中，无并发竞争。WebSocket 使用 Hibernation API。
- **语音链路采用级联方案（ASR → LLM → TTS），不用端到端语音大模型**。文档编辑最看重 tool call 的准确性与可控性，级联方案每段可观测、可替换，并可使用 Claude 推理。中文 ASR 选择支持流式 partial 结果的服务商，并配置热词（文档内专有名词）。

## 2. 语音打断（最关键部分）

### 2.1 状态机

```
IDLE ─说话→ LISTENING ─轮次结束→ THINKING ─tool_use→ ACTING ⇄ SPEAKING ─完成→ IDLE
                  ▲                    │              │          │
                  │                    └──────────────┴──────────┘
                  │                         检测到用户开口（VAD）
                  │                                ▼
                  └───── 判定为打断 ───────── SOFT_PAUSE（约 300ms）
                                                   │ 判定为附和音（“嗯”“对”）
                                                   └──────→ 回到原状态继续
```

### 2.2 打断五条规则

1. **打断先在本地生效，不等服务端。** VAD 检测到开口，浏览器立即：TTS 降音量或暂停、关闭执行闸门（gate）、清除流式预览。服务端 abort 是异步的，途中可能仍有 tool.call 在传输，**只能由客户端闸门兜底**。
2. **以 epoch 做闸门。** 每个 turn 有递增的 `turnEpoch`。打断后客户端记录 `interruptedEpoch`，此后收到 `epoch ≤ interruptedEpoch` 的 tool.call 直接回 `INTERRUPTED`，**不执行**。
3. **先软暂停，再决定是否打断。** 开口后约 300ms 内只暂停不中止，等待 ASR partial：若为“嗯 / 对 / 好”等附和音或咳嗽，则恢复；若为“停 / 等等 / 不对 / 不是这段……”，则中止。以此压低误打断率。Esc 键与“停止”按钮直接中止，不经软暂停。
4. **每个 tool call 原子执行，不会只改一半。** 现有引擎已保证一批操作为一个事务。打断后，已提交的改动保留；执行中的那一个要么完整完成，要么完全不做。流式预览（见 3.2）仅为装饰层，不写入文档。
5. **服务端收尾须补全对话历史：**
   - 中止 LLM 流。
   - **每个已发出的 `tool_use` 都必须补一条 `tool_result`**（如 `"cancelled: user interrupted"`），否则下一次请求 Claude API 会因历史不完整而报错。
   - assistant 文本**截断到实际播放位置**（客户端回报 TTS 播放进度），避免模型以为说过未播出的话。
   - 新用户发言前附本轮小结：“被打断前已完成 A、B，C 已取消”。用户说“继续”即可接着做；说“撤销刚才的”即可整轮回滚（见 4.3）。

### 2.3 回声消除

`getUserMedia({ echoCancellation: true, noiseSuppression: true })`，否则 agent 自身的 TTS 声音会被麦克风收入并触发打断。后期若音频改走 WebRTC，AEC 与抗抖动效果更好；初期 WebSocket 传音频可用。

## 3. 实时反馈：每次 tool call 用户都看得到

### 3.1 可视化层（新增，ProseMirror Decoration 实现，不改文档内容）

| 元素 | 作用 |
|---|---|
| AI 光标 / presence | 如协作者般显示“AI 正在编辑这里”，自动滚动视口（用户手动滚动后停止自动滚动） |
| 改动高亮 | 每次提交后对受影响 block 做 1–2 秒渐隐高亮 |
| 状态条 | `正在听… / 正在想… / 正在修改第 3 段 / 等待确认`，与状态机一致 |
| 操作时间线 | 复用 `engine.records`，按 turn 分组，每组可“撤销整轮” |

### 3.2 长文本流式写入

改写一段话时，若等整个 tool 参数生成完才上屏，延迟过高。做法：

- 开启 Claude tool 输入流式（`input_json_delta`），参数生成过程中在目标位置用 **ghost decoration** 实时显示“正在写的文字”（打字机效果）。
- 参数生成完成后，一次性 commit 为真正的事务。
- 中途被打断则清除 ghost，文档不变。

体验上实时，数据上保持原子性。

## 4. 现有引擎需要的改造（P0 重点）

现引擎按“偶尔调用一次 API”设计。一个与用户同时编辑、持续写入的 agent 会遇到以下问题：

| # | 问题 | 位置 | 改造 |
|---|---|---|---|
| 4.1 | agent 每次操作都执行 `tr.setSelection(target)`，**用户光标会被拉走** | [engine.ts:90](../lib/usecases/engine.ts#L90) | `source: 'agent'` 时在目标选区执行，执行后把用户原选区经 mapping 映射后还原 |
| 4.2 | 以全局 `expectedRevision` 判断过期，用户每敲一个字 revision 都会加一，**agent 请求几乎全部 STALE** | [engine.ts:69](../lib/usecases/engine.ts#L69) | 改为目标 block 级版本或哈希检查：目标 block 自上次读取后未变即放行，其他位置的改动不影响 |
| 4.3 | agent 与用户的改动在同一 undo 栈交错，用户 Ctrl+Z 可能撤掉 AI 的改动 | `closeHistory` 逻辑 | 每个事务标记 `origin + turnId`，实现按 origin 撤销（“撤销 AI 这一轮”）；P3 可直接用 Yjs UndoManager 的 `trackedOrigins` |
| 4.4 | 中文用户常处于 IME 组字中，此时**直接返回 `COMPOSING` 失败** | [engine.ts:68](../lib/usecases/engine.ts#L68) | executor 将操作排队，在 `compositionend` 后执行，不把失败直接返回给 agent |
| 4.5 | 事件只有 `subscribe(() => void)`，粒度不足 | `listeners` | 增加 `onApplied({id, turnId, origin, changedBlockIds, revision})` 事件流，供高亮、时间线、审计使用 |
| 4.6 | `source` 只有 `toolbar / keyboard / api` | [operation.ts](../lib/domain/entities/operation.ts) | 增加 `agent`，并附带 `actor`（userId 或 agentId）用于审计 |

## 5. WebSocket 协议

单条 WS 连接：**音频走 binary frame，控制消息走 JSON**。统一 envelope：

```ts
{ v: 1, type, sessionId, turnEpoch, seq, ts, payload }
```

| 方向 | type | 说明 |
|---|---|---|
| C→S | `session.start` | 鉴权（短期 token 放首条消息，**不放 URL**）、docId、能力声明 |
| C→S | `vad.start` / `vad.end` / `interrupt` | 打断信号（客户端已在本地先行生效） |
| C→S | `context.update` | 当前选区所在 block、视口可见 block、大纲（用于解析“这段 / 上面那个标题”等指代） |
| C→S | `tool.result` | `{callId, ok, code, revision, changedBlockIds, summary}` |
| C→S | `tts.progress` | 已播放到的字符位置（用于截断历史） |
| S→C | `asr.partial` / `asr.final` | 实时字幕 |
| S→C | `turn.state` | 状态机当前状态，驱动 UI |
| S→C | `tool.call.start` / `tool.call.delta` / `tool.call.commit` | 流式预览与最终执行 |
| S→C | `agent.text.delta` + binary TTS | 语音回复 |
| 双向 | `ping` / `pong`、`resume {lastSeq}` | 心跳；断线重连后从断点续传 |

幂等：tool.call 的 `callId` 直接作为引擎 operation 的 `id`。引擎已按 id 去重，重连重发不会重复执行。

## 6. Agent 层设计

- **模型分工**：主 agent 用 Claude Sonnet 5.5，兼顾速度与 tool 准确性；打断意图判定（附和音 / 停止 / 纠正）、语义轮次检测等小判断用 Haiku 5.5。
- **工具集保持粗粒度**（语音场景对延迟敏感）：
  - `get_outline`、`read_blocks(ids)`、`search(query)`：读工具，**不每次读全文**
  - `apply_operations`：复用 `externalRequestSchema`
  - `navigate(blockId)`：滚动或选中，对应“跳到第三章”
  - `undo_turn(turnId)`
  - `request_confirmation(summary)`：危险操作前语音确认
- 将 50+ operation 的大 schema、system prompt、工具定义设为**固定前缀并开启 prompt caching**，降低首 token 延迟。
- **指代解析**：每次用户发言附带 `context.update` 中的选区与视口信息。“把这段加粗”指光标所在 block；“上面那个”按视口与大纲解析。
- **说话策略**：先做后说，少说。视觉反馈为主通道，语音只做简短确认（“好，改了三处”），避免长篇解释。

### 延迟预算（目标：说完话到开始改动 < 1 秒）

| 阶段 | 目标 |
|---|---|
| 语义轮次判定 | 300–500ms |
| ASR final | 100–200ms |
| LLM 首个 tool_use 开始流式输出 | 400–600ms |
| 浏览器执行并上屏 | < 16ms |
| **打断：本地停播** | **< 100ms** |
| **打断：停止改文档** | **< 200ms**（由客户端闸门保证） |

## 7. 企业级要求

- **安全与权限**：每种 operation 设风险等级。整篇查找替换、删除表格、大范围删除需语音确认或先预览 diff。文档内容一律视为不可信数据（保留现有 `untrustedContentHint`），system prompt 中防提示词注入。按 docId 做 ACL，WS token 定期轮换。
- **审计**：每个 agent 操作记录 `谁 / 哪个 turn / 对应语音转写 / 改了哪些 block / 前后差异`，可回放。
- **隐私合规**：麦克风开启时有明确指示；音频默认不落盘，转写保留期可配置；ASR/TTS 服务商数据驻留区域可选（国内外客户分开配置）。
- **可观测性**：以 `turnId` 为 trace 主键，串联 ASR → LLM → tool → 上屏各段耗时。核心指标：打断响应时间、误打断率、tool 成功率、STALE 与 COMPOSING 比例、p95 端到端延迟。
- **可靠性**：ASR/TTS 服务商可切换备用；断线后断点续传；离线时禁用 agent，编辑不受影响（沿用现有原则：AI 不可用绝不影响编辑）。
- **测试**：
  - 录制音频 fixture 回放为 transcript 与 tool call 序列，做确定性回归。
  - 用 fake LLM 对打断时序做 fuzz 测试：在每个状态、每个时间点注入打断，断言文档要么是完整前态，要么是完整后态。
  - Playwright 配合 Chrome `--use-file-for-fake-audio-capture` 跑端到端测试。

## 8. 落地路线

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **P0 底座** | 第 4 节引擎改造、WS 协议、DO 会话中心、**先用文字对话**驱动 agent 实时改文档、Esc/按钮打断、改动高亮与时间线 | 用户边打字 agent 边改，光标不被拉走、无 STALE 风暴，可一键撤销整轮 |
| **P1 语音** | VAD + AEC + 流式 ASR/TTS、打断状态机、epoch 闸门、软暂停、历史截断 | 打断后 200ms 内不再有任何改动上屏；附和音不触发打断 |
| **P2 体验与治理** | 流式 ghost 预览、危险操作确认、审计、trace、回放测试集 | p95 端到端 < 1.2s；误打断率 < 5% |
| **P3 协作** | Yjs + DO 作为权威文档源，agent 作为 Yjs peer，执行端可在服务端 headless 运行 | 多人与 AI 同时编辑；关闭页面后 agent 仍可完成任务 |

**P0 先不接语音**：打断与实时反馈的难点在于“agent 持续写入时，文档、选区、undo 都要正确”，与语音无关。先用文字对话把这一层做稳，P1 接入语音时只剩语音链路本身的问题。
