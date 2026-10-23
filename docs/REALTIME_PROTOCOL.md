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

工具的 `run()` 由 SDK 在模型发出完整参数的 `tool_call` 后调用；SDK 负责顺序、epoch 和取消信号本身，`run()` 内部只做：取消检查、文档/会话绑定检查、IME 等待、幂等去重、实际提交（见 `lib/usecases/realtime-executor.ts`）。**参数增量/流式预览不是这个契约的一部分**——vRT 的 `tool.call.delta` / `tool-stream` 能力还在提案阶段（austinchennn/vRT#22），没有对应的 `RealtimeTool` 钩子。

## 文档工具目录（`lib/usecases/document-tools.ts`）

`documentToolCatalog` 是 name/description/parameters/readOnly 的单一来源（vdoc#30）：

| 工具 | readOnly | 需要 agent turn | 用途 |
|---|---|---|---|
| `read_document` | 是 | 否 | 完整文档读取（snapshot；实时连接下附带 `docId`、`agentEdits`） |
| `read_blocks` | 是 | 否 | 按最多 200 个 ID 读取指定块/表格的完整内容 |
| `get_context` | 是 | 是 | 大纲、按语音轮次冻结的选区、最近 agent 修改（`recentEdits`，#35 任务1） |
| `apply_document_operations` | 否 | 是（实时侧） | 原子提交操作；WebMCP 走 `executeExternal`（`api` 来源），实时走可信执行器的 `executeAgent` |
| `undo_turn` | 否 | 是 | 按 turn 撤销，保留无关的用户/其他轮次修改（复用 #29） |

`get_context` 和 `undo_turn` 需要 `actor`/`turnId` 身份，`lib/usecases/browser-tools.ts`（WebMCP 桥）不注册这两个；`@vrealtime/client` 通过 `realtimeDocumentTools(executor)` 拿到全部五个。

## Agent 活动可视化（`lib/editor/realtime/agent-activity.ts`，vdoc#33）

纯视图层 ProseMirror decoration，不写入文档、不进历史、不进导出——和 `lib/editor/search/search-highlights.ts` 同一个模式（`DecorationSet` + `addToHistory:false`）：

- `highlightChangedBlocks(editor, changedBlockIds)`：每次成功提交后对受影响块做约 1.5 秒渐隐高亮；按 per-editor 序号防止旧调用的清除计时器打断新调用的高亮。
- `setAgentPresence(editor, blockId | null)`：标记 agent 最近修改的块，随下一次提交移动，断开时清空。
- `clearAgentActivity(editor)`：断开/卸载时清空两者。

驱动方：`components/editor/realtime/use-agent-activity.ts` 的 `useAgentActivity(engine, active)`——`active` 为真时订阅 `engine.onApplied`（只处理 `source==='agent'` 且 `changedBlockIds` 非空的事件），`active` 变为假或组件卸载时清空；同时从 `engine.records` 按 `turnId` 分组，返回给 `components/editor/realtime/activity-timeline.tsx` 渲染"按轮次分组的历史 + Undo turn"。`RealtimeControls`（`components/editor/realtime-controls.tsx`）在 `status !== 'disconnected'` 时渲染这个时间线；`Undo turn` 按钮直接调用 `engine.undoTurn(turnId, origin)`，不经过实时执行器（它是普通引擎能力，任何调用方都能用，和语音/模型路径无关）。

**没做、不要当作已完成**：`tool.call.delta` 的流式 ghost 预览（vdoc#35 任务3、vRT#22 的 tool-stream 协议都还没定稿）；能力协商（vdoc#35 任务7）；presence 标记目前等同于"最近一次提交影响的最后一个块"，不是真正的逐 token 流式位置。
