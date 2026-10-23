# 实时连接协议（当前实现）

这份文档记录 vdoc 应用侧**实际已实现**的实时协议面：`RealtimePort` 契约、文档工具目录、agent 活动可视化。不是设计提案；设计讨论见 [`VOICE_REALTIME_AGENT_PLAN.md`](VOICE_REALTIME_AGENT_PLAN.md)，操作本身的 schema 见 [`OPERATIONS.md`](OPERATIONS.md)。

## 连接契约（`lib/usecases/ports.ts`）

```ts
interface RealtimeToolContext { signal: AbortSignal; callId: string; turnId: string; epoch: number; }
interface RealtimeTool { description: string; parameters: object; run(input: unknown, context: RealtimeToolContext): unknown; }
interface RealtimeConnection { interrupt(reason?: 'user' | 'keyboard'): void; sendText(text: string): void; close(): void; }
interface RealtimePort { open(options: { config, docId, sessionId, tools, signal, onStatus }): RealtimeConnection; }
```

`lib/infrastructure/realtime/vrt-adapter.ts` 是唯一导入 `@vrealtime/client` 的文件，把上面的契约接到真实 SDK；`tests/support/fake-vrt-adapter.ts` 是本地开发/测试用的假实现，不经网络。两者都实现同一个 `RealtimePort`，`lib/composition/realtime.ts` 的 `openDocumentRealtime(options, port)` 通过依赖注入切换。

`createRealtimeExecutor` 只依赖 `RealtimeEngine` 这个窄接口（`lib/usecases/realtime-executor.ts`，vdoc#43）：会话 ID、版本、记录、`canEdit()`、`isComposing()`、提交/撤销、快照/大纲/按 ID 读取、`hasBlock`、`anchorSelection`、`onApplied`。接口里**没有** Tiptap `editor`，`DocumentEngine` 按结构满足它，测试可以直接传普通对象（`tests/realtime-engine-port.test.ts`）。

工具的 `run()` 由 SDK 在模型发出完整参数的 `tool_call` 后调用；SDK 负责顺序、epoch 和取消信号本身，`run()` 内部只做：取消检查、文档/会话绑定检查、IME 等待、幂等去重、实际提交（见 `lib/usecases/realtime-executor.ts`）。`RealtimeTool` 只有完整参数的 `run()`，没有部分参数钩子（见下方"SDK 已核实的行为"）。

## SDK 已核实的行为（`@vrealtime/client` 0.1.0，vdoc#47）

以下结论来自直接阅读已安装的 SDK 源码（`node_modules/@vrealtime/client/dist/session.js`、`tool-host.js`、`epoch-gate.js`），不是推测。升级 SDK 时需要重新核对。

**epoch 与取消——vdoc 不需要自己检查 `context.epoch`：**

- `ToolHost.submit()`：已关闭 epoch 的调用直接回 `INTERRUPTED`，`run()` 不会被调用。
- `ToolHost` 在 `queueMicrotask` 内部、真正调用 `run()` 之前再检查一次 epoch 和 signal——vRT#22 担心的"排入微任务后、执行前"的窗口在这个版本已经处理。
- epoch 关闭时，正在运行的调用的 `AbortSignal` 会被 abort；`realtime-executor.ts` 的 `check()` 第一步就是检查 `context.signal.aborted`，等待 IME 期间也监听这个 signal。
- 本地 `interrupt()` 同步关闭当前 epoch（不等服务端回包）；连接结束时关闭所有 epoch。
- "先到的结果生效"：abort 后 SDK 立即上报 `INTERRUPTED`，之后 `run()` 的返回值被丢弃。vdoc 的写入是同步的，abort 只能由之后的宏任务（用户事件或网络消息）触发，无法插入"已写入但上报 INTERRUPTED"的窗口。

**SDK 已有、vdoc 尚未接入的事件**（`session.on(...)`，此前文档说"没有流式钩子"是错的）：

| 事件 | 时机 | 说明 |
|---|---|---|
| `tool.call` | 完整参数到达、执行之前 | 可用于提前显示 agent 将要操作的块 |
| `tool.preview` | 参数生成过程中（服务端 `tool.call.delta`），发出前已按 epoch 过滤 | `preview` 是 `unknown`；按 vRT#22，服务端把参数增量和执行中进度都映射成它，语义尚未定稿 |
| `tool.result` | 每个调用恰好一次 | 包含 `INTERRUPTED` |
| `state` | 服务端 `turn.state` | 轮次状态（listening / thinking / …），附 `turnId`、`epoch` |
| `interrupted` | 本地或服务端中断 | 附 `epoch` 和 `source` |

`RealtimePort.open` 的可选 `onActivity` 回调现在转发其中四种（`vrt-adapter.ts` 订阅后归一化为 `RealtimeActivity`）：`turn`（轮次状态）、`call`（完整参数到达、执行前）、`result`（成功与否）、`interrupted`。这些只用于显示，不是写入通道——写入只发生在 `RealtimeTool.run()` 里；`call.arguments` 是模型输出，不可信。用途：
- 状态条在"Assistant connected"后显示 Listening / Thinking / Speaking / Editing；
- presence 标记在调用**到达时**就移到它的目标块（`target` 里的 block/text/cell ID，且该块确实存在），不必等提交——调用可能在等 IME 组字；提交后移到实际改动的块；调用失败或被中断时清除。

`tool.preview` 仍未接入：它的 payload 语义要等 vRT 定稿。

## 文档工具目录（`lib/usecases/document-tools.ts`）

`documentToolCatalog` 是 name/description/parameters/readOnly 的单一来源（vdoc#30）：

| 工具 | readOnly | 需要 agent turn | 用途 |
|---|---|---|---|
| `read_document` | 是 | 否 | 完整文档读取（snapshot；实时连接下附带 `docId`、`agentEdits`） |
| `read_blocks` | 是 | 否 | 按最多 200 个 ID 读取指定块/表格的完整内容 |
| `get_context` | 是 | 是 | 大纲、按语音轮次冻结的选区（随文档修改映射的 anchor，不受光标移动影响）、最近 agent 修改（`recentEdits`，#35 任务1） |
| `apply_document_operations` | 否 | 是（实时侧） | 原子提交操作；WebMCP 走 `executeExternal`（`api` 来源），实时走可信执行器的 `executeAgent` |
| `undo_turn` | 否 | 是 | 按 turn 撤销，保留无关的用户/其他轮次修改（复用 #29） |

读取成本（vdoc#40）：`read_blocks`、`get_context` 的大纲和 `recentEdits` 存活检查都查询引擎的 `BlockIndex`（每次文档变更后重建一次的 id→{节点, 位置, 版本} 表），代价与请求的块数成正比，不随文档大小增长；只有 `read_document` 仍是完整快照（它本来就要返回整份文档）。

`get_context` 和 `undo_turn` 需要 `actor`/`turnId` 身份，`lib/usecases/browser-tools.ts`（WebMCP 桥）不注册这两个；`@vrealtime/client` 通过 `realtimeDocumentTools(executor)` 拿到全部五个。

## Agent 活动可视化（`lib/editor/realtime/agent-activity.ts`，vdoc#33）

纯视图层 ProseMirror decoration，不写入文档、不进历史、不进导出——和 `lib/editor/search/search-highlights.ts` 同一个模式（`DecorationSet` + `addToHistory:false`）：

- `attachAgentActivity(editor, { locate?, highlightMs? })`：**运行期注册**两个 decoration 插件（不在基础扩展集里，因为实时功能是可选的），返回句柄：
  - `highlight(blockIds)`：约 1.5 秒渐隐高亮；新高亮会取消旧的清除计时器，不会被旧计时器误清。
  - `setPresence(blockId | null)`：标记 agent 正在处理的块。
  - `clear()`：一次 transaction 清空两者；本来就空时不派发 transaction。
  - `dispose()`：卸载插件（装饰随之消失），句柄此后为空操作。
  - 每次 attach 用独立的插件 key 名——Tiptap 的 `unregisterPlugin` 按前缀匹配，共用名字会误删别的实例。

驱动方：`components/editor/realtime/use-agent-activity.ts` 的 `useAgentActivity(engine, active)`——挂载时 attach、卸载时 dispose（注册只在编辑器会话开始时做一次，避免在用户打字/组字时重配编辑器 state）；`active` 为真时订阅 `engine.onApplied`（只处理 `source==='agent'` 且 `changedBlockIds` 非空的事件），`active` 变为假时 `clear()`；同时从 `engine.records` 按 `turnId` 分组，返回给 `components/editor/realtime/activity-timeline.tsx` 渲染"按轮次分组的历史 + Undo turn"。`RealtimeControls`（`components/editor/realtime-controls.tsx`）在 `status !== 'disconnected'` 时渲染这个时间线；`Undo turn` 按钮直接调用 `engine.undoTurn(turnId, origin)`，不经过实时执行器（它是普通引擎能力，任何调用方都能用，和语音/模型路径无关）。

**没做、不要当作已完成**：`tool.call.delta` 的流式 ghost 预览（vdoc#35 任务3、vRT#22 的 tool-stream 协议都还没定稿）；能力协商（vdoc#35 任务7）；presence 标记目前等同于"最近一次提交影响的最后一个块"，不是真正的逐 token 流式位置。
