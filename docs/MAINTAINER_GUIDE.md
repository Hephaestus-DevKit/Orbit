# Orbit 维护者指南

这份指南用于快速回答三个问题：代码应该改在哪里、最小验证应该跑什么、哪些约束不能破坏。源代码统一放在 `packages/*/src`；不要直接修改 `dist`、`node_modules`、`.orbit` 或其他运行时产物。

## Monorepo 包职责

| 包                         | 职责                                                                                              | 常用入口                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/cli`             | CLI 命令注册、运行时装配、REPL、WebUI、全屏 TUI、LSP 与诊断/基准命令                              | `src/index.ts`、`src/commands`、`src/runtime`、`src/tui`                           |
| `packages/config`          | 默认配置、Zod 配置模型、配置合并、凭据安全存取与配置脱敏                                          | `src/schema.ts`、`src/ConfigLoader.ts`、`src/Credentials.ts`                       |
| `packages/core`            | Agent 主循环、规划/执行、模型消息构建、交互端口、显式项目记忆、提示词缓存、事件总线、验证契约     | `src/agent`、`src/memory`、`src/events`、`src/verification`                        |
| `packages/context-engine`  | 项目索引、AST 分块、符号/引用检索、BM25/向量混合搜索、上下文压缩                                  | `src/ContextPackBuilder.ts`、`src/SymbolIndexer.ts`、`src/Compactor.ts`            |
| `packages/model-providers` | DeepSeek、OpenAI、Anthropic、Ollama 的请求适配、流式响应与统一模型类型                            | `src/registry.ts`、`src/types.ts`、`src/deepseek`                                  |
| `packages/mcp`             | MCP 现代/旧版双时代协商、请求元数据、分页发现、stdio/HTTP 生命周期、OAuth 与工具/资源/Prompt 适配 | `src/McpProtocol.ts`、`src/MCPClient.ts`、`src/StreamableHttpMCPClient.ts`         |
| `packages/permissions`     | 工具风险分级、权限策略与审批决策                                                                  | `src/RiskClassifier.ts`、`src/PermissionEngine.ts`                                 |
| `packages/sandbox`         | Git worktree、检查点、回滚与隔离执行                                                              | `src/WorktreeManager.ts`、`src/CheckpointManager.ts`、`src/RollbackManager.ts`     |
| `packages/session`         | 会话持久化、恢复、任务计划、本地指标与审计序列化                                                  | `src/SessionManager.ts`、`src/SessionStore.ts`、`src/types.ts`                     |
| `packages/shared`          | 无业务归属的基础类型与工具：路径、ID、错误、token、脱敏、截断                                     | `src/paths.ts`、`src/redaction.ts`、`src/tokens.ts`                                |
| `packages/tools`           | 工具协议、显式内置工具注册，以及文件、Shell、Git、项目、Web 工具实现                              | `src/registry.ts`、`src/defaultRegistry.ts`、`src/types.ts`、`src/fs`、`src/shell` |
| `packages/tui`             | 可复用的终端渲染、提示、Diff、状态栏组件                                                          | `src/Renderer.ts`、`src/Prompt.ts`、`src/DiffView.ts`                              |

依赖方向大致是：`shared/config` 提供基础能力，`model-providers/tools/session/...` 提供领域能力，`core` 负责编排，`cli` 负责装配和用户入口。不要为了方便让底层包反向依赖 `core` 或 `cli`。

## 文件放置规则

- CLI 参数解析放 `packages/cli/src/index.ts`；命令业务放 `packages/cli/src/commands`；交互期运行时协调放 `packages/cli/src/runtime`。
- 交互期斜杠命令按领域放 `packages/cli/src/runtime/commands`，`CommandRouter` 只负责展开、委派和少量跨进程协调。
- WebUI 的安全、数据、HTTP、实例生命周期、客户端片段与样式片段各自归属明确模块；新增或重构的高风险浏览器片段使用严格类型的可序列化工厂，并把独立类型检查接入 `verify:webui`。TUI 的 prompt、文本布局、历史存储与分页也保持独立。
- Agent 决策、执行和状态流转放 `packages/core/src/agent`，不要塞进 `CommandRouter` 或 UI 文件。`AgentInteraction.ts` 只定义交互协议；TUI/WebUI 适配由上层装配。`AgentInputQueueController.ts` 独立拥有持久队列变更和事件协议，`AgentLoop.ts` 只决定何时安全消费；主循环即使较长也不因行数机械拆分。
- 模型协议差异和按模型族的 thinking 策略放 `packages/model-providers`；模型选择和 CLI 诊断装配放 `packages/cli/src/runtime`。DeepSeek 规则按模型身份识别，因此官方 API、TokenDance 或未来兼容网关共享同一适配。
- 工具实现放 `packages/tools/src/<domain>`，权限判断放 `packages/permissions`，工作区隔离和回滚放 `packages/sandbox`。
- 只在确实被多个包复用且无领域归属时才放入 `packages/shared`，避免形成通用杂物箱。
- 测试与实现同目录，命名为 `*.test.ts`；新增公共导出时同步维护该包的 `src/index.ts`。
- 单个文件只有在同时承担彼此独立的解析、状态、I/O 和渲染职责时才拆分；仅仅因为文件较长不拆。入口文件只做校验与组合，状态机和有序生命周期仍留在拥有它们的协调器中。
- `packages/tools/src/defaultRegistry.ts` 是内置工具清单和注册顺序的唯一归属；需要隔离测试或嵌入式运行时使用 `createDefaultToolRegistry()`，兼容旧代码的进程级实例仍从同一模块导出。
- 每个 `AgentLoop` 持有独立工具注册表和长生命周期 MCP 运行时；动态工具不得注册到进程级兼容实例，MCP 只在 `AgentLoop.dispose()` 统一释放。
- MCP 协议时代、现代请求元数据和 HTTP 镜像头规则统一归 `McpProtocol.ts`；传输只负责探测、回退和生命周期。现代服务器不得退回 legacy session 语义，旧服务器继续通过 `initialize` 路径兼容。
- 代码语言解析入口统一归 `context-engine/LanguageParser.ts`；新增语言先实现解析器、依赖路径解析和回归夹具，再加入索引 glob。自动检索策略归 `CodebaseContextRetriever.ts`，工作区级索引快照与 stale-while-revalidate 生命周期归 `WorkspaceRetrievalService.ts`；不得把语言、关键词判断或每轮重建索引重新塞回 `ContextPackBuilder`。
- 所有 ESM 内部导入保留 `.js` 后缀；外部输入边界使用 Zod，避免使用 `any`。

## 常见改动定位

| 改动领域                | 先看这些文件                                                                                                                                                                                   | 通常一起检查                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| WebUI 页面与布局        | `packages/cli/src/runtime/webui/WebUiPage.ts`、`WebUiStyles.ts`、`styles/*`                                                                                                                    | 桌面/移动端布局、CSS 组合顺序、可访问名称、CSP 是否仍允许资源加载                                                     |
| WebUI 交互与流式输出    | `webui/WebUiClient*.ts`、`WebUiRuntime.ts`、`WebUiEventStream.ts`                                                                                                                              | SSE 重连/取消、停止实例隔离、客户端片段顺序、并发 turn 状态                                                           |
| WebUI 安全与序列化      | `webui/WebUiSecurity.ts`、`WebUiData.ts`、`WebUiHttp.ts`                                                                                                                                       | 事件 allowlist、敏感信息脱敏、请求上限、内部消息不得进入普通历史                                                      |
| `/webui` 生命周期       | `packages/cli/src/runtime/RunCoordinator.ts`、`CommandRouter.ts`、`webui/WebUiServer.ts`                                                                                                       | 启动/关闭是否幂等、旧实例延迟任务是否隔离、TUI 与 Web 是否争用同一个 runnable                                         |
| DeepSeek 协议与流式解析 | `packages/model-providers/src/deepseek/*`                                                                                                                                                      | `DeepSeekV4.test.ts`、OpenAI/Anthropic 兼容路径、usage/cache 字段                                                     |
| DeepSeek 模型路由与诊断 | `packages/model-providers/src/ModelAdaptation.ts`、`packages/model-providers/src/deepseek/DeepSeekV4.ts`、`packages/core/src/agent/ModelRouter.ts`、`packages/cli/src/runtime/ModelCatalog.ts` | `packages/cli/src/commands/doctor.ts`、`bench.ts`、Flash/Pro 与 thinking 模式是否匹配                                 |
| DeepSeek 缓存命中       | `packages/core/src/agent/PromptCacheSlab.ts`、`MessageBuilder.ts`                                                                                                                              | 稳定前缀是否保持稳定、动态仓库上下文是否位于后部、不要伪造命中率                                                      |
| 凭据登录与存储          | `packages/config/src/Credentials.ts`、`CredentialKeyStore.ts`、`ConfigLoader.ts`                                                                                                               | `packages/cli/src/commands/login.ts`、`doctor.ts`、Windows DPAPI、macOS Keychain、旧密钥迁移与日志脱敏                |
| 本地数据清理            | `packages/cli/src/runtime/CleanupManager.ts`                                                                                                                                                   | `packages/cli/src/commands/clean.ts`、用户目录/项目目录去重、符号链接与根目录保护、JSON 预览                          |
| 项目数据备份与恢复      | `packages/cli/src/runtime/ProjectBackup.ts`                                                                                                                                                    | `packages/cli/src/commands/backup.ts`、bundle schema、哈希、容量、路径穿越、符号链接与覆盖策略                        |
| CLI 版本更新            | `packages/cli/src/runtime/UpdateManager.ts`                                                                                                                                                    | `packages/cli/src/commands/update.ts`、stable/beta dist-tag、固定 npm 参数、安装后版本校验、失败回滚与 JSON 检查模式  |
| 配置字段                | `packages/config/src/schema.ts`、`defaults.ts`、`ConfigLoader.ts`                                                                                                                              | Zod 默认值、环境变量覆盖、`redactConfig.ts`、兼容旧配置                                                               |
| AgentLoop 行为          | `packages/core/src/agent/AgentLoop.ts`、`Orchestrator.ts`、`StepRunner.ts`                                                                                                                     | `McpRuntimeManager.ts`、`AgentToolProtocol.ts`、`AgentTextTransforms.ts`、`AgentAudit.ts`、中止与失败结果是否完整传播 |
| Agent 事件              | `packages/core/src/events/EventSchema.ts`、`EventBus.ts`                                                                                                                                       | TUI/WebUI 消费方、事件是否可序列化、是否含敏感字段                                                                    |
| 运行时斜杠命令          | `packages/cli/src/runtime/commands/*`、`CommandRouter.ts`                                                                                                                                      | handler 直接测试、路径边界、Git 参数数组、命令未处理/已处理返回值                                                     |
| 全屏 TUI                | `packages/cli/src/tui/FullscreenTui.ts`、`TuiPromptSession.ts`、`TuiPromptView.ts`、`TerminalText.ts`                                                                                          | 构造器无副作用、显式 initialize/dispose、TTY 与非交互降级、Unicode 光标                                               |
| 通用终端组件            | `packages/tui/src/Renderer.ts`、`Prompt.ts`、`DiffView.ts`、`StatusBar.ts`                                                                                                                     | 颜色/符号一致性、长输出分页、无 TTY 时的文本模式                                                                      |
| 会话持久化              | `packages/session/src/SessionManager.ts`、`SessionStore.ts`、`auditSerialization.ts`                                                                                                           | AgentLoop 的会话接线、`CommandRouter.ts` 的 `/chat` 流程、旧数据兼容                                                  |
| 项目记忆与任务计划      | `packages/core/src/memory/ProjectMemoryStore.ts`、`packages/session/src/types.ts`                                                                                                              | `Planner.ts`、`WorkspaceStateCommandHandler.ts`、WebUI 状态快照                                                       |
| 工具协议或注册          | `packages/tools/src/types.ts`、`registry.ts`、`defaultRegistry.ts`、`index.ts`                                                                                                                 | Zod 参数、事件输出、权限分类、工具结果截断/脱敏、隔离 registry 是否独立                                               |
| 文件/Shell/Git 工具     | `packages/tools/src/fs`、`src/shell`、`src/git`                                                                                                                                                | 工作区路径边界、命令注入、退出码、Windows 行为、回滚                                                                  |
| 权限与沙箱              | `packages/permissions`、`packages/sandbox`                                                                                                                                                     | 审批不能被 UI 绕过；worktree/checkpoint 在成功、中止和失败时都要清理                                                  |
| RAG 与索引              | `packages/context-engine`                                                                                                                                                                      | 缓存 key、原子写入、维度/模型变化后的重建、无向量服务时的 BM25 降级                                                   |

## 验证命令

首次进入仓库：

```powershell
pnpm install
```

### 最小反馈循环

只格式化和检查本次修改的文件：

```powershell
pnpm exec prettier --write packages/cli/src/runtime/webui/WebUiServer.ts
pnpm exec prettier --check packages/cli/src/runtime/webui/WebUiServer.ts
pnpm exec eslint packages/cli/src/runtime/webui/WebUiServer.ts
```

只运行相关测试：

```powershell
pnpm exec vitest run packages/cli/src/runtime/webui/WebUiServer.test.ts
pnpm exec vitest run packages/model-providers/src/deepseek
pnpm exec vitest run packages/core/src/agent
```

构建受影响包及其工作区依赖：

```powershell
pnpm --filter "@orbit-build/cli..." build
pnpm --filter "@orbit-build/core..." build
```

根 `format:check` 已覆盖仓库 README、`docs/**/*.md`、包级 README 和源码旁的 Markdown。单独修改文档时也可以显式检查：

```powershell
pnpm exec prettier --write docs/MAINTAINER_GUIDE.md
pnpm exec prettier --check docs/MAINTAINER_GUIDE.md
```

### 专项回归

```powershell
# CLI 全包测试，以及包含 lint/format/build 的完整专项验证
pnpm test:cli
pnpm verify:cli

# WebUI 快速测试，以及包含 lint/format/build 的完整专项验证
pnpm test:webui
pnpm typecheck:webui-client
pnpm verify:webui

# DeepSeek、模型诊断与缓存基准逻辑（单元测试，不调用真实 API）
pnpm test:deepseek

# 凭据与配置
pnpm exec vitest run packages/config/src/Credentials.test.ts packages/config/src/ConfigLoader.test.ts

# AgentLoop 与事件
pnpm exec vitest run packages/core/src/agent packages/core/src/events

# TUI
pnpm exec vitest run packages/tui/src packages/cli/src/tui

# 会话
pnpm exec vitest run packages/session/src

# 工具、权限与沙箱
pnpm exec vitest run packages/tools/src packages/permissions/src packages/sandbox/src
```

Vitest 通过根目录 `vitest.shared.ts` 把所有 `@orbit-build/*` 包直接解析到
`packages/*/src/index.ts`，因此 `pnpm test`、各类 `test:*` 和关键覆盖检查在
没有 `dist` 的全新工作区也必须可以独立运行。新增 workspace 包时同步更新该
别名表；`vitest.workspace.test.ts` 会检查包名和源码入口是否完整对应。

真实 DeepSeek 探测会产生网络请求和少量 API 用量，只在凭据已安全配置且确实需要端到端确认时运行：

```powershell
orbit doctor --deepseek
orbit doctor --probe --deepseek
orbit bench --model deepseek-v4-flash --thinking disabled --cache-profile --repeat 3 --min-cache-hit 75
```

### 全量交付检查

```powershell
pnpm verify
git diff --check
git status --short
```

`pnpm verify` 依次执行 lint、Prettier 检查、全包构建和全部 Vitest。失败时先修复最早出现的根因，再重跑专项检查，最后重新执行全量验证。

商业发布候选还必须执行 `pnpm verify:release`。该命令会增加生产依赖高危漏洞审计，并检查 CLI 构建版本、npm 包必需文件、开发/敏感文件排除规则和制品体积。`orbit doctor --json` 的输出 schema 独立版本化，同一 minor 版本内应保持向后兼容。

## Windows 全局命令

首次安装或全局命令损坏时，在仓库根目录运行：

```powershell
pnpm install-global
```

该命令会先构建 CLI 及其工作区依赖，再创建临时 npm tarball 并安装独立副本；它不会创建指向 `packages/cli` 的 `npm link`。因此后续清理源码工作区的 `dist` 不会破坏全局 `orbit`。源码更新后需要重新运行 `pnpm install-global` 才会刷新全局副本。

PowerShell 检查：

```powershell
Get-Command orbit
orbit --version
```

CMD 检查：

```bat
where orbit
orbit --version
```

还可以从 PowerShell 同时验证 CMD 解析：

```powershell
cmd /d /c "where orbit"
cmd /d /c "orbit --version"
```

若仍找不到命令，重新运行 `pnpm install-global`，打开新终端，并用 `npm config get prefix` 检查 npm 全局目录是否在 `PATH` 中。`npm list --global @orbit-build/cli --depth=0` 不应显示指向源码工作区的链接箭头。不要把生成的 `orbit.cmd` 手工复制进仓库。

## 安全与架构不变量

1. **凭据不出安全边界**：API key 只能通过 `CredentialsManager`/环境变量进入运行时；不得写入日志、事件、URL、会话、测试快照或错误详情。配置输出必须经过脱敏。
2. **工作区路径必须校验**：文件工具、索引、补丁、Git 和 Shell 相关路径必须解析并验证在授权工作区内，拒绝目录穿越和符号链接逃逸。
3. **外部边界必须验证**：配置、HTTP、SSE、工具参数、MCP、会话与检查点数据都使用明确类型和 Zod schema；错误响应保持可行动但不泄露内部栈或密钥。
4. **构造函数无副作用**：构造函数只保存依赖和初始化状态；文件、网络、进程、监听器等操作放在显式 `start`/`initialize` 方法，并提供幂等清理。
5. **长任务通过事件总线报告**：Agent、索引、验证和工具执行通过集中 `eventBus` 发状态；不要在领域层直接向控制台持续打印。
6. **审批不可绕过**：WebUI、TUI、非交互模式最终必须经过同一权限决策；新增工具时同时定义风险和失败/取消行为。
7. **中止必须真正传播**：取消信号从 UI/CLI 传到 Orchestrator、AgentLoop、模型流和工具执行；取消后不得继续写文件或把未完成任务标记成功。
8. **会话输出必须可恢复且可公开**：持久化写入应原子化；内部 volatile/system 上下文不应出现在普通历史或 Web API 中；序列化必须脱敏并保持旧数据兼容。
9. **DeepSeek 缓存只能测量，不能假设**：保持可复用前缀稳定，读取服务端 usage 中的 hit/miss；不要发送合成预热/保活请求，也不要承诺固定命中率或延迟。
10. **索引和工作树必须可降级、可清理**：无 Git、向量服务或交互终端时保留安全的功能降级；worktree、临时分支、锁和临时文件在成功、失败、中止时均清理。
11. **清理范围必须显式且可预览**：`orbit clean` 只能删除用户级或项目级 `.orbit` 运行时目录；不得删除源码、`ORBIT.md`、`orbit.config.yaml` 或未验证的根路径。非交互删除必须显式传入 `--yes`。
12. **更新不得静默改变安装**：TUI 每个进程只允许一次有超时、非阻塞、失败静默降级的后台版本检查；不得自动替换 CLI。版本必须来自 npm `dist-tags.latest` 并通过 SemVer 校验，安装只能在交互确认或显式 `--yes` 后执行。
13. **后台进程必须归运行时所有**：长命令只能通过 `BackgroundTaskRuntime` 启动；工具、TUI 和 WebUI 不得各自保存 `ChildProcess`。输出必须有界、模型与工具查询必须按 Session 隔离。切换 Session 不得误杀仍有价值的任务；删除所属 Session 或关闭 Orbit 时必须回收完整进程树。
14. **运行中输入必须只有一个事实来源**：引导和后续消息持久化到 Session 的 `input-queue.json`；TUI/WebUI 只能调用 AgentLoop 队列接口，不得各自维护 localStorage 或内存队列。编辑、排序、删除和模式提升必须通过 Session 原子写入并发送不含 prompt 的类型化事件。`steer` 只能在模型流或工具调用结束后的安全边界进入历史，不能靠取消请求伪造引导。
15. **并发审批必须有可见归属和确定顺序**：多个子 Agent 同时请求审批时，`WebUiApprovalBroker` 以有界 FIFO 串行展示，超时只从请求真正成为当前审批时开始。WebUI 必须显示请求角色，但不得暴露 prompt、工具参数或原始输出；关闭运行时必须拒绝当前及排队审批，不能让等待者悬挂。
16. **子 Agent 执行目录与会话目录必须解耦**：临时 worktree 只承载工具执行和待审查修改；子线程统一持久化到主项目 `.orbit/agent-sessions`，Session ID 写入 `.orbit/agent-runs`。worktree 合并或清理不得删除线程历史，也不得把内部子线程混入普通聊天目录。
17. **写入所有权必须先规范化再调度**：`AgentOwnership.ts` 是 scope 语义的唯一来源；`workspace`/`*` 表示全工作区，嵌套路径冲突、无交集路径可并行。绝对路径、UNC、盘符和 `..` 必须在启动任何任务前拒绝，不能只依赖调度后工具层的路径校验。
18. **子 Agent 恢复必须验证所有权与运行时**：`.orbit/agent-runs` 使用进程实例 ID、PID、进程启动时间和有界心跳租约记录所有权；只有租约失效后，新实例才能原子接管已中断且具有持久 Session 的子 Agent。旧实例续租或写回、存活租约的 run、已成功完成的 Agent、缺失 Session 或 provider 不一致均必须拒绝。恢复后沿用原 model、access mode 和 scopes，并把完成、失败、中止及累计成本原子写回 durable run。

## 建议工作流

1. 先执行 `git status --short`，确认哪些改动属于当前任务，不覆盖用户已有修改。
2. 从上面的定位表找到所有权包和相邻消费者，先读实现、公共导出和现有测试。
3. 为 bug 写一个能稳定复现的失败测试；新功能先定义输入边界、事件和失败/取消路径。
4. 做最小职责改动。跨包共享的是协议，不是 UI 状态或命令细节；避免顺手进行无关重命名。
5. 先跑相关 Prettier、ESLint、Vitest 和受影响包构建，修复后再扩大验证范围。
6. 涉及 WebUI 时检查桌面和移动端；涉及 TUI 时检查 TTY 与非交互降级；涉及凭据时检查输出中没有密钥；涉及文件工具时检查工作区逃逸用例。
7. 执行 `pnpm verify` 和 `git diff --check`，审阅最终 diff，确认没有生成物、调试日志或意外配置。
8. CLI 行为变更后运行 `pnpm build`，必要时 `pnpm install-global`，分别在 PowerShell 与 CMD 做一次烟雾测试。

## 排查顺序

- **源码已改但行为没变**：重新运行 `pnpm install-global` 刷新独立全局副本，再用 `Get-Command orbit` 确认命令来自 npm 全局目录。
- **模型名或 thinking 模式不对**：按 CLI options → `ModelCatalog` → `ProviderFactory` → DeepSeek provider 的顺序检查，避免只在 provider 末端打补丁。
- **WebUI 没有收到事件**：先确认 Agent 是否发出了 schema 内事件，再检查 `WebUiSecurity` allowlist、`WebUiEventStream` 实例状态，最后检查 Client 的 SSE 消费。
- **会话恢复异常**：先验证磁盘数据 schema 与审计序列化，再看 AgentLoop/CommandRouter 的活动会话切换，不要直接编辑用户会话文件。
- **Windows 凭据异常**：优先运行 `orbit doctor --deepseek`；检查 DPAPI 子进程环境和 PowerShell 版本，但不要打印或手动解密 key。
- **macOS 凭据异常**：确认 `security` 命令和登录 Keychain 可用；旧 `master.key` 只应在 Keychain 写入成功后删除，清理用户数据时必须同步删除原生密钥。
