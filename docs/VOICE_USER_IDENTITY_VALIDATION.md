# 可信用户身份与配额：应用侧验证

## 版本与边界

本改动基于 vdoc SDK 集成提交 `25e1c68`（PR #100），客户端和协议依赖为 `@vrealtime/* 0.2.0`。没有修改 SDK 适配器、依赖或锁文件。服务端联调使用 vdoc-server 的可信用户实现工作区，基线为 `104be6cab93af71fdd2ba5c4d47578c90d4ccacd`；最终提交由两端 PR 记录，未将未合并或未部署代码标记成线上能力。

目标部署为前端 `https://vdoc.ink`、后端 Cloudflare Worker `vdoc-server`、Boson 模型。测试没有使用生产密钥、真实 Google/Neon 登录、公开 Worker 地址或付费模型。下面分别记录自动化证据与待验收事项。

## 已验证

| 检查 | 结果与边界 |
|---|---|
| 代理身份 | create、grant、end 均使用 `getRequestUser()` 的稳定 userId。浏览器伪造身份、Authorization、Cookie、requestId 无法覆盖；请求体多余身份字段被拒绝。 |
| 身份约束 | 用户 ID 仅接受 1–128 个 ASCII 字符，首字符为字母/数字，其余可含 `._:-`；空值、超长、Unicode、空白、路径、CR/LF（包括末尾换行）均拒绝。 |
| 追踪 | 每次上游请求生成独立 UUID；重连续发和结束保留相同用户身份，但使用新的 requestId。 |
| 真实云 ACL | PGlite 执行项目迁移与实际 `authorizeVoiceDocument`，两个账户的同名导入 ID 获得不同 transport room；三种生命周期调用都保持各自用户与房间。此项验证 SQL/ACL 行为，不代表真实 Neon 网络验证。 |
| SDK 生命周期 | 实际 `@vrealtime/client 0.2.0` 与 BFF handler 联动，首连、重连续发和结束产生三次可信用户请求；socket 与上游 HTTP 服务为 fixture。 |
| 配额映射 | 仅白名单转换 429 `QUOTA_EXCEEDED` 的 concurrency/rate 类别、503 `QUOTA_UNAVAILABLE` 和正安全整数秒数；JSON 与 `Retry-After` 一致。未知字段、私密详情、错误认证头不外传；超大错误体按 4 KiB 上限丢弃。 |
| 用户提示 | 区分并发上限、滚动小时频率和配额存储暂时不可用；只使用应用自己的消息，合法秒数可提供重试提示。 |
| Worker 构建 | 本地生产构建与 Worker smoke 验证首页、打印、账户、云文档、未配置认证时拒绝访问，以及全部 11 个引用的客户端静态资源。 |

本地 `npm ci`、typecheck、lint、生产 build、Worker smoke 均通过；完整 `npm test` 为 **186 个文件、2,502 个测试全通过**。

相关命令（在应用 checkout 执行）：

```sh
npm ci --no-audit --no-fund
npm run typecheck
npm run lint
npx vitest run tests/voice-session-proxy.test.ts tests/voice-errors.test.ts tests/voice-session-routes.test.ts tests/voice-session-sdk.test.ts tests/cloud-library.test.ts
npm test
npm run build
npm run test:worker
```

跨服务验证由服务端脚本复现（在 vdoc-server checkout，`VDOC_APP_CHECKOUT` 指向应用 checkout）：

```sh
VDOC_APP_CHECKOUT=/absolute/path/to/vdoc node --import tsx scripts/check-trusted-identity.mjs
```

该脚本实际调用 BFF handler → 独立端口的 Node HTTP 服务，13 次上游请求通过：可信身份覆盖、owner-scoped 路径、主体持久化与审计、并发与滚动小时 429、两用户隔离、续发/结束归属、结束释放占用、配额存储故障 503、唯一 requestId。服务端使用 fake model，认证和 ACL 回调为测试 fixture；没有把它描述成真实用户登录或模型验收。

## Cloudflare 配置清单（无密钥示例）

应用 Worker 保留现有组合根，无新增客户端 secret 或身份配置：

| 名称 | 类型 | 配置要求 |
|---|---|---|
| `AUTH_BASE_URL` | Variable | `https://vdoc.ink`，必须与真实浏览器 origin 一致。 |
| `GOOGLE_CLIENT_ID` | Variable/Secret | 对应 Google OAuth 应用，回调配置见 [登录部署](GOOGLE_SIGN_IN.md)。 |
| `GOOGLE_CLIENT_SECRET` | Secret | 登录服务端凭据，仅 Worker 使用。 |
| `BETTER_AUTH_SECRET` | Secret | 按登录部署说明设置，不用于语音应用鉴权。 |
| `DATABASE_URL` | Secret | 已迁移的 Neon 数据库连接串；预览和测试使用独立分支。 |
| `VDOC_SERVER_URL` | Variable | 后端实际 HTTPS origin；Worker 名称不能替代域名。当前尚未提供/验证该地址。 |
| `VDOC_SERVER_CLIENT_KEY` | Secret | 对应后端 `VDOC_SERVER_CLIENTS` 中注册的同一应用 key，至少 24 字符；此处只填 key，不含 `web:` 前缀。 |

后端 Worker `vdoc-server`：`VDOC_SERVER_CLIENTS=web:<同一应用key>`（Secret）；production 的 `VDOC_SERVER_ALLOW_CLIENT_ONLY` 默认 `false`，要求可信用户头，不能静默回退到共享应用身份。生产不应为了绕过缺失身份而启用该兼容开关。模型 key、grant 签名 secret 与配额 DO 绑定按后端 [可信身份说明](https://github.com/Q-cell2/vdoc-server/blob/main/docs/TRUSTED_USER_IDENTITY.md) 配置；不要用应用 client key 替代 grant 签名密钥。

本地 `.dev.vars` 已被 gitignore 排除，生产 secret 应通过 Cloudflare secret 管理写入，不能放在 `NEXT_PUBLIC_*`、localStorage、URL、源码或静态资源中。当前环境未登录 Cloudflare，没有执行生产配置、部署或密钥变更。完整云文档配置见 [Neon 部署](NEON_DEPLOYMENT.md)、[云工作区](CLOUD_WORKSPACE.md) 与 [登录部署](GOOGLE_SIGN_IN.md)。

## 上线、旧数据与回滚

先部署后端可信用户能力并确认应用 key 匹配，再部署本 BFF。切换前结束旧应用级会话，要求重新连接；旧会话没有可靠个人归属，不能猜测迁移或把旧应用用量算给当前登录用户。本 BFF 始终带用户头，不能以共享身份续发旧会话。旧 grant 是否仍在有效期内，需由后端部署/会话停用流程处理，不能仅靠前端上线假定立即失效。

回滚时保留登录和文档授权检查。若旧 BFF 不支持可信用户，应先停用语音配置，后端保持拒绝无用户请求；不得回退成无限制共享应用额度。监测应关注 429 的 quotaKind、503 `QUOTA_UNAVAILABLE`、创建/续发失败、持续占用与到期回收，以及相同 requestId 的后端审计，禁止记录 app key、Cookie、grant 或文档正文。

## 尚未验证

- 真实 Google 登录、Neon 会话撤销/切换账户、Cloudflare WebSocket 和后端实际域名。
- 真实 Boson 中文识别、改写工具、语音打断、重连、按轮撤销及持久保存后的完整浏览器流程。
- 已部署版本中两真实账户的配额、用量和审计归属，以及线上配额 DO 故障恢复。

这些需要测试账户、可访问的后端地址、模型配置和部署环境。自动化 fixture 结果不替代上述验收，也不证明模型 token 成本或计费余额；当前配额单位仅为 session 与 session/hour。
