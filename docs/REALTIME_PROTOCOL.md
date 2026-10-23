# 实时连接协议（当前实现）

这份文档记录 vdoc 应用侧**实际已实现**的实时协议面：`RealtimePort` 契约、文档工具目录、agent 活动可视化。不是设计提案；设计讨论见 [`VOICE_REALTIME_AGENT_PLAN.md`](VOICE_REALTIME_AGENT_PLAN.md)，操作本身的 schema 见 [`OPERATIONS.md`](OPERATIONS.md)。

## 连接契约（`lib/usecases/ports.ts`）

```ts
interface RealtimeToolContext { signal: AbortSignal; callId: string; turnId: string; epoch: number; }
interface RealtimeTool { description: string; parameters: object; run(input: unknown, context: RealtimeToolContext): unknown; }
interface RealtimeConnection { interrupt(reason?: 'user' | 'keyboard'): void; sendText(text: string): void; close(): void; }
interface RealtimePort { open(options: { config, context: { documentId, title, language, vocabulary }, tools, signal, onStatus, onActivity? }): RealtimeConnection; }
```

`lib/infrastructure/realtime/vrt-adapter.ts` 是唯一导入 `@vrealtime/client` 的文件，把上面的契约接到真实 SDK；`tests/support/fake-vrt-adapter.ts` 是本地开发/测试用的假实现，不经网络。两者都实现同一个 `RealtimePort`，`lib/composition/realtime.ts` 的 `openDocumentRealtime(options, port)` 通过依赖注入切换。

## 语音会话与 Worker 鉴权

编辑器的正式按钮不依赖 localStorage。云工作区挂载时通过只读 `GET /api/voice-sessions?documentId=…` 获取 `{ url, sessionsUrl, audio: true }`。该接口验证登录、文档归属及语音部署配置，只返回由 `VDOC_SERVER_URL` 派生的安全 WebSocket origin 和同源 `/api/voice-sessions`，不创建会话、不消耗连接配额、不打开麦克风。旧 `vdoc.realtime.v1` / `vdoc.realtime.v2` 设置和 URL 参数均被忽略。

入口始终可见，本地文档显示迁移指引并禁用连接。云文档必须属于当前登录账户且不在回收站。点击连接才请求麦克风；权限拒绝、无设备、设备被占用、非安全来源分别提供提示。状态覆盖连接中、已连接、重连、断开、错误，以及真实麦克风状态；取消/断开/卸载会释放资源，晚到的授权不会恢复录音。音频资源由适配器管理，通过 SDK 自定义音频输入接口传入，避免 SDK 内置麦克风在授权未完成时无法取消的问题。

现有后端没有剩余配额查询契约，界面明确显示余额不可查询，不展示虚构的分钟数或重置时间。创建/续发的 HTTP 402、429 和 SDK 配额错误会显示额度或限流说明；401、403、409、503 等分别提供登录、云文档条件或重试指引。只映射允许的错误类型，不展示上游错误正文。终止错误关闭连接且保留提示，不被后续 closed/ready 覆盖。

三个同源 Worker 接口都接收 JSON `{ documentId }`，都先验证同源请求、登录用户和文档授权，再携带 Worker secret 中的 client key 请求 vdoc-server：

| VDoc 接口 | 上游路径 |
|---|---|
| `POST /api/voice-sessions` | `POST /v1/documents/{documentId}/voice-sessions` |
| `POST /api/voice-sessions/{id}/grants` | `POST /v1/documents/{documentId}/voice-sessions/{id}/grants` |
| `DELETE /api/voice-sessions/{id}` | `DELETE /v1/documents/{documentId}/voice-sessions/{id}` |

这里的 `{id}` 是 **语音会话 ID**。编辑器 `engine.sessionId` 只用于本地操作校验，留在 executor 内，不发往上述接口或 `hello.context`；SDK 自己用于重连的会话 ID 也不用于这些 HTTP 路径。

客户端先创建语音会话，校验响应的 `documentId`、`sessionId` 和完整 `realtimePath`，再构造 SDK。路径必须精确对应本次文档和语音会话，不接受跨源地址、查询参数或其他会话路径。首次 `auth()` 使用创建响应中的 `grant.token`；若它已经过期或距过期不足一秒，则先续发。之后每次 `auth()` 都重新调用 `/grants`，响应是 `{ token, expiresAt }`，不能复用之前的短期凭证。

`hello.context` 只包含 `{ documentId, title, language, vocabulary }`。标题取点击连接时的当前标题；语言优先用配置中的显式偏好，否则用文档语言，未指定（`und`）时为 `en-US`；词汇表默认 `[]`，最多 50 个、每个最多 40 字符。文档正文仍由工具读取，不在创建会话时上传。

关闭或文档卸载立即停止 SDK、取消续发请求，并以独立的清理信号发送一次 `DELETE`。创建请求有 15 秒上限，关闭时允许它返回，以便删除迟到的已创建会话，且绝不启动迟到的 SDK。清理请求使用 `keepalive`；网络中断或页面进程被终止时不能保证 DELETE 到达，最终仍由服务端会话时限回收。永久关闭的 SDK 会话也会触发清理；自动续连期间不结束语音会话。

### 服务端配置与权限来源

生产身份来自 Better Auth 的 Google 登录会话，使用 Neon 云文档表校验所有权。`authorizeVoiceDocument` 只允许当前用户拥有的有效云文档，拒绝文件夹和回收站文档，并生成包含用户与文档 ID 的哈希传输 ID，隔离不同账户导入同名/同 ID 文档的语音房间。静态授权清单只保留为代理测试依赖，生产组合根不使用该清单或旧 ChatGPT 网关注入身份。

Worker 需要配置：

- Google 登录与 Neon 云存储的部署配置（参见账户和云文档部署说明）。
- `VDOC_SERVER_URL`：上游 HTTP origin，如 `https://voice.example.com`；浏览器 WebSocket origin 自动由此派生，本地回环地址可使用 HTTP。
- `VDOC_SERVER_CLIENT_KEY`：Worker **secret**，值为 vdoc-server 的 `VDOC_SERVER_CLIENTS` 中一个已注册 client 的 key，至少 24 字符；不是整个 `clientId:key,…` 字符串。

通过部署平台的 Worker secret 管理配置凭据；本地可放入已被 gitignore 排除的 `.dev.vars`。不要使用 `NEXT_PUBLIC_*`、localStorage、URL 或客户端构建变量保存 client key。响应禁用缓存，代理不转发上游错误正文、Cookie 或认证头。部署前还需在 vdoc-server 配置允许的 VDoc 浏览器来源。普通本地编辑不依赖这些服务；现有本地文档需导出备份后导入云工作区，不会自动上传。

本次协议核对依据：`austinchennn/vdoc-server` 的 `voice-session-controller.ts`、`document-context.ts` 和 `principal.ts`。本仓库测试覆盖代理权限、创建/续发/清理和 SDK 重连；部署真实地址与 secret 后仍需真实模型端到端验收。

`createRealtimeExecutor` 只依赖 `RealtimeEngine` 这个窄接口（`lib/usecases/realtime-executor.ts`，vdoc#43）：会话 ID、版本、记录、`canEdit()`、`isComposing()`、提交/撤销、快照/大纲/按 ID 读取、`hasBlock`、`anchorSelection`、`onApplied`。接口里**没有** Tiptap `editor`，`DocumentEngine` 按结构满足它，测试可以直接传普通对象（`tests/realtime-engine-port.test.ts`）。

工具的 `run()` 由 SDK 在模型发出完整参数的 `tool_call` 后调用；SDK 负责顺序、epoch 和取消信号本身，`run()` 内部只做：取消检查、文档/会话绑定检查、IME 等待、幂等去重、实际提交（见 `lib/usecases/realtime-executor.ts`）。`RealtimeTool` 只有完整参数的 `run()`，没有部分参数钩子（见下方"SDK 已核实的行为"）。

## SDK 已核实的行为（`@vrealtime/client` 0.2.0）

以下结论来自直接阅读已安装的 SDK 源码（`node_modules/@vrealtime/client/dist/session.js`、`tool-host.js`、`epoch-gate.js`），并由真实 SDK 加文档引擎的回归测试验证。客户端和传输协议锁定为 0.2.0；配套服务端的 `server`、`core`、`boson`、`openai`、`openai-compatible`、`testing` 依赖也统一为 0.2.0。HTTP 创建、续发、结束以及 grant 格式保持原有契约。

SDK 自动在 `hello` 中声明 `tool-stream-v1` 和 `global-tool-ids-v1`，以 `ready.capabilities` 确认协商结果；未声明能力的旧服务端仍使用完整 `tool.call` 路径。0.2.0 的 `tool.stream` 已定义 start、arguments-delta、arguments-complete、progress 和终态，但应用尚未提供渐进预览 UI。即使收到 arguments-complete，也只视为进度信息，不据此执行编辑；文档写入仍只发生于完整 `tool.call` 对应的 `run()`。SDK 和 executor 分别处理传输序号重放与调用 ID 幂等。

可恢复的 `AGENT_ERROR` 仅显示可重试提示，保留当前连接；不可恢复错误、认证／续发失败、音频失败和配额错误仍会关闭并清理会话。不会把上游错误原文展示给用户。

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
| `tool.preview` | 旧 `tool.call.delta` 或新 `tool.stream` 的兼容进度事件，发出前已按 epoch 过滤 | 仅供展示；应用尚未订阅，不作为执行入口 |
| `tool.stream` | 协商 `tool-stream-v1` 后的工具生命周期事件 | SDK 已支持；应用暂不展示增量预览，也不从此事件提交文档修改 |
| `tool.result` | 每个调用恰好一次 | 包含 `INTERRUPTED` |
| `state` | 服务端 `turn.state` | 轮次状态（listening / thinking / …），附 `turnId`、`epoch` |
| `interrupted` | 本地或服务端中断 | 附 `epoch` 和 `source` |

`RealtimePort.open` 的可选 `onActivity` 回调现在转发其中四种（`vrt-adapter.ts` 订阅后归一化为 `RealtimeActivity`）：`turn`（轮次状态）、`call`（完整参数到达、执行前）、`result`（成功与否）、`interrupted`。这些只用于显示，不是写入通道——写入只发生在 `RealtimeTool.run()` 里；`call.arguments` 是模型输出，不可信。用途：
- 状态条在"Assistant connected"后显示 Listening / Thinking / Speaking / Editing；
- presence 标记在调用**到达时**就移到它的目标块（`target` 里的 block/text/cell ID，且该块确实存在），不必等提交——调用可能在等 IME 组字；提交后移到实际改动的块；调用失败或被中断时清除。

`tool.preview` 和 `tool.stream` 的增量展示仍未接入，属于后续 UI 工作；协议能力已由 SDK 0.2.0 提供。

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

**没做、不要当作已完成**：流式 ghost 预览（vdoc#35 任务3）和应用层能力展示。SDK 0.2.0 已负责传输能力协商，但不代表 UI 已实现；presence 不是逐 token 流式位置。

升级回归见 `tests/voice-session-sdk.test.ts`：真实 SDK 连接与 grant 续发、能力有／无时的完整工具执行、预览不落盘、调用重放去重、重连后撤销、本地／服务端打断、过期及无效编辑失败、可恢复模型错误。真实模型的中文音频识别和延迟仍需部署环境验收，不能由这些协议测试推断。
