# VDoc

以语音为主要交互方式的 AI 文档工具：用户通过说话创作、修改、排版和反复完善文档。面向学生、研究人员、职场人士与创作者，优先支持个人文档工作流。

## 产品目标与当前阶段

目标体验是持续用语音操控文档：口述生成正文、精准定位并修改内容、调整字体和表格、随时打断或纠正、让 AI 再改一版或继续同类操作，以及保存和导出。键盘与鼠标作为补充入口；文档编辑底座服务于语音 AI 的执行与撤销。

当前实现的是本地单人网页编辑底座，使用 React + TypeScript + Tiptap / ProseMirror，界面为英文。**语音识别、持续语音会话、AI 修改与打断尚未接入**；上述能力是下一阶段目标，不属于下方“已实现”清单。先完成既定 [七项 AI 前验收](docs/acceptance/AI_ENTRY_SEVEN_GATES.json)，再进入语音 AI 开发，不追加多人协作或无关功能对标。

## 本地运行

Node.js >= 22.13。

```sh
npm ci
npm run dev
```

默认 http://localhost:5173/ ，以终端实际显示地址为准。本地服务运行时无需连接文档云服务。

使用正式构建在本机运行：

```sh
npm run build
npm start -- --port 8787
```

`npm start` 同时提供网页和本地 PDF 服务，只绑定回环地址。开发与本地生产模式均可使用已安装的 Chrome/Chromium 生成固定分页 PDF；可用 `VDOC_PDF_CHROME` 指定浏览器可执行文件的绝对路径。打印按钮在新标签打开 PDF，由阅读器打印或保存。渲染使用临时独立配置，文档不上传。浏览器不可用时保留普通浏览器打印入口。

切换启动方式时，继续使用原来的浏览器地址（域名、端口都相同）即可访问原有本地文档；`localhost` 与 `127.0.0.1` 是不同的存储来源。`npm run start:worker` 只运行原 Worker 服务，不提供本机 PDF 渲染；云端部署也不自动包含本机服务。Safari 缩放打印和多语言 PDF 的最终验收状态见七项清单。

```sh
npm test
npm run typecheck
npm run build
npm run test:worker
```

测试默认只启动一个 worker；全量测试、构建与表格渲染依次运行，避免在共享开发电脑上叠加内存负载。

`npm run test:worker` 在构建后启动临时本机 Worker，检查首页、打印预览的 HTTP 200、服务端页面内容及引用的静态资源，再自动停止。此检查也在 CI 中执行，可捕获浏览器客户端恢复显示所掩盖的服务端渲染错误；不需要 Cloudflare 账号，不会发布网站。

`ANALYZE=1 npm run build` 会额外写出 `dist/bundle-report/client.json`：列出浏览器端每个 chunk 的模块组成与大小，以及模块之间的引用关系，可用来追查某个模块为什么被打进某个 chunk。不设该变量时，构建产物与平时一致。

请把代码仓库放在 iCloud 云盘、Dropbox 等同步文件夹之外（或将其排除在同步之外）。同步冲突会生成 `engine 2.ts` 这类副本：`npm run typecheck` 会检查到这些过时的副本，`git add -A` 也会把它们提交。`tests/repository-hygiene.test.ts` 发现此类副本时会失败并列出文件名；请先与原文件比对，保留正确内容后删除副本。

## 已实现

- 统一操作 API：参数和目标校验、版本保护、原子批次、撤销／重做、稳定块 ID、会话内去重；支持选区、文字范围、块、矩形单元格目标。
- 加粗、斜体、下划线、删除线、上下标；5 种字体、8–96px 字号；自定义文字色和荧光笔；链接与清除格式。
- 标题 1–6、段落自动／LTR／RTL方向、对齐、行距、段前段后、缩进、编号／项目符号／清单、引用、代码块、分隔线、实时目录、脚注。
- 表格网格和自定义尺寸插入；行列增删、合并／取消合并、普通单元格细分、底色、边框、padding、垂直对齐、最小行高、拖动列宽、均分列、排序、菜单移动行列、右键菜单。
- 查找替换、Unicode规范等价、大小写／全词、字素簇字符统计、浏览器拼写检查、大纲、缩放和快捷键。
- 本地图片上传、替代文字、尺寸设置、拖动缩放与撤销；页面设置、显式分页、简单页眉页脚和 Word 页码。
- IndexedDB 自动保存、本地文档库、新建／打开；回收站内单文档确认后永久删除及关联版本原子清理；旧 localStorage 迁移且保留原始数据；命名版本／恢复（最多40份）。
- JSON 备份恢复；本地 DOCX／TXT 导入；DOCX／HTML／TXT／JSON 导出；浏览器打印／PDF。

## 使用入口

File：文档库、导入、导出、打印。Edit：查找替换和撤销。Insert：图片、目录、脚注、表格。Format：页面、段落、清单。选中表格后使用底部工具条或右键。Edit history → Saved versions 保存或恢复检查点。

## 当前边界

连续画布不是自动分页引擎。复杂 Word 文件可能改变样式或排版；普通 DOCX 格式已进行结构与直接格式验证。备份导入限制20MB，单张图片2MB。本地数据受浏览器存储配额管理；清理浏览器数据会删除文档，应另存备份。

操作级撤销栈仅在当前会话；命名版本持久保存。自动保存有450ms合并延时，突然关闭进程可能丢失尚未提交的输入。内置浏览器的系统下载落盘与 PDF 逐页打印尚未完成验收。尚无安装式 PWA。多语言功能需要支持 Intl.Segmenter 的现代浏览器；已验40语言样本不等于所有语言、字体、词典与系统输入法均已验收，详见 [多语言矩阵](docs/MULTILINGUAL_ACCEPTANCE.md)。

完整范围、证据和剩余功能见 [验收记录](docs/VALIDATION.md)、[单人功能差距](docs/GOOGLE_DOCS_LOCAL_GAP.md)、[计划](docs/IMPLEMENTATION_PLAN.md)、[操作接口](docs/OPERATIONS.md)。

## 代码结构

- `components/editor/`：工作台、工具栏、文档与属性对话框、查找／表格面板、版本历史。
- `lib/` 按分层组织，依赖只向内：`composition → (editor, infrastructure) → usecases → domain`，由 ESLint `no-restricted-imports` 强制：
  - `domain/`：`entities/`（文档、库条目、版本、导入结果、操作契约）、`rules/`（列表、段落边框、制表位、文本格式等纯规则与备份校验规则链）、`text/`（Unicode、语言、颜色、字号）。不依赖任何外层。
  - `usecases/`：`engine.ts` 操作事务、`autosave.ts`、`import-file.ts`、`export-file.ts`、`file-formats.ts`、`document-navigation.ts`、`browser-tools.ts`（可选 WebMCP；`window.vdoc` 为本地开发接口）。通过 `ports.ts` 中的 `DocumentRepository`、`LibraryRepository`、`VersionRepository`、`FileImporter`、`FileExporter` 访问存储与文件格式。
  - `editor/`：Tiptap/ProseMirror 适配层；`commands/` 为按操作族划分的命令注册表与目标解析，另有 `format/`、`list/`、`paragraph/`、`table/`、`search/`。
  - `infrastructure/`：`persistence/`（IndexedDB 连接、文档、版本、库）、`importers/`（Word、文本、备份导入策略）、`word/`、`export/`、`preview/`、`pdf/`、`browser/`。
  - `composition/`：组装根，把基础设施实现注入用例与 UI（`repositories.ts` 中的 `documents`、`library`、`versions`，以及 `startAutosave`、`readDocumentImport`）。更换存储后端只需改这里的绑定，新实现需通过 `tests/persistence-contract.test.ts`。
  - `shared/`：跨层通用工具。
- `tests/`、`docs/`：测试、验收与规划。

格式与结构命令共享操作层；原生输入、输入法、粘贴、选区移动与拖动由 ProseMirror 处理，共享同一文档状态与撤销历史。浏览器工具只控制受约束操作，不发送文档给模型服务。

文档语言可从 File → Language 设置：40 种预设及自定义语言标签；保存到备份、HTML 和 Word。词典支持取决于浏览器，内置输入工具与翻译尚未实现。逐行状态见 [验收清单](docs/ACCEPTANCE_CHECKLIST.md)。

### 扩展文件格式

`lib/composition/file-formats.ts` 是唯一的格式注册入口，记录 id、显示名称、导出扩展名、导入扩展名及导入/导出策略。File 与 Export 菜单、文档库与编辑器共用的文件输入框均读取这份注册表。

新增格式时，在基础设施层实现 `FileImporter` 和/或 `FileExporter`，然后添加一条注册记录即可，不需要修改菜单或增加按格式 id 分支。导入大小限制由条目声明；原生备份继续使用备份解析器自己的限制。导出策略接收快照并返回 Blob，可同步或异步，不操作编辑器或下载链接。

文档导出可选直接下载（`delivery: 'download'`）或异步准备后提供下载链接（`delivery: 'prepared'`，支持继续编辑、重新生成和释放 URL）。PDF 声明为 `kind: 'paginated'`，先进入既有预览流程，再导出完成分页的快照；本地服务不可用时仍使用原有浏览器打印回退。`tests/file-format-registry.test.ts` 验证菜单、筛选、往返和新增格式扩展，`tests/export-file.test.ts` 验证原序列化字节/Blob 透传与取消、失败行为。

## Editor feature 模块

编辑器功能在 `lib/editor/<feature>/` 内组织。每个目录的 `index.ts` 导出满足 `EditorFeature` 的对象：

- `extensions`：节点、标记与插件；通过参数接收快捷键、表格尺寸等运行时回调。
- `commands`：该功能的操作处理器。统一 dispatcher 保留事务刷新语义；重复处理器会报错，遗漏现有 `Operation` 的处理器会导致类型检查失败。
- `css`：可选样式，由工作区统一挂载。页面布局和通用 UI 样式仍在 `app/globals.css`。
- `validation`：可选的 JSON 节点校验规则；`validateDocument` 在 schema 检查之后执行表格网格等结构校验。
- `blockIdTypes`：需要稳定块 ID 的节点名，新节点无需修改公共 ID 插件。

新增功能后，只需将其 feature 对象加入 `lib/editor/feature-list.ts` 的 `editorFeatures`。扩展、命令、样式和备份校验都从这一列表生成，不再维护各自的功能清单。`document/` 提供基础文档与编辑能力；`keyboard/` 负责跨功能快捷键路由；列表、表格、段落、格式、查找和嵌入块各自拥有实现。

`order` 在扩展、CSS、节点校验三条链中分别按升序排序，同值保留声明顺序。现有序号保留重构前的 schema 排名、插件优先级、CSS 级联及首个报错顺序；新增项可使用间隔中的序号，不必重新编号其他模块。原 StarterKit 的子扩展按原顺序归入所属模块，避免格式标记和列表键位隐式注册在基础文档中。

领域层的 `validateDocumentTree` 只负责结构检查和树遍历，通过参数接收规则，**不导入 editor**。公共 `Operation` 数据协议及其参数 schema 仍属于 domain；实现这些操作的处理器位于对应 feature。新增公共操作时，应同时扩展领域协议和所属 feature 的处理器。表格的 ProseMirror 网格验证由 table feature 提供，持久化层只执行统一校验流程。

`tests/support/editor-schema-baseline.json` 固定重构前的展开扩展顺序、schema 和命令集合；`tests/editor-features.test.ts` 同时覆盖单列表启用/禁用、重复注册、稳定 ID、备份校验和首错顺序。改动功能后运行 `npm test`、`npm run typecheck`、`npm run build`。

历史人工 QA 截图、日志和源清单已打包至仓库的 Release 附件，恢复与路径映射见 [QA 证据索引](docs/QA_EVIDENCE.md)。自动化测试所需四组 fixture 仍随代码提供。
