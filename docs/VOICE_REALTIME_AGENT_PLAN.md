# VDoc 语音实时 Agent 方案

更新：2026-10-15。范围：语音控制 AI、实时操作文档。核心要求：agent 工作时用户可随时用语音打断；agent 每一次 tool call 对文档的修改都实时反馈到前端界面。

现状基础：[`DocumentEngine.executeExternal`](../lib/usecases/engine.ts) 已具备 zod 校验的 50+ operation、稳定 block/cell ID 定位、session/revision 防过期、批量原子执行（一次撤销）、op id 幂等；[`browser-tools.ts`](../lib/usecases/browser-tools.ts) 已暴露 `read_document` / `apply_document_operations`。本方案在其上叠加语音层与实时层，并改造引擎以适应持续写入、可被打断的 agent。

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
