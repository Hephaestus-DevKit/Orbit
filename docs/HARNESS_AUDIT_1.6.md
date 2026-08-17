# Orbit 1.6.0 Harness Audit

日期：2026-08-17

## 发布定义

1.6.0 把 Orbit 从“可恢复的 Agent Harness 基础”推进到“可审查的本地
Agent Control Plane”：任务状态、权限、沙箱降级、MCP 交互、ACP 外部
Agent、Profile、Review finding 和扩展信任都必须有明确的状态与证据。

## 本版已落地

### 安全执行边界

- Bash 和测试命令统一经过 Process Sandbox 包装。
- macOS 使用 `sandbox-exec`，Linux 优先使用 bubblewrap、再回退 firejail；
  `required` 模式在没有可用原生后端时失败关闭，`auto` 明确报告 degraded。
- Windows 不把 Node/PowerShell 包装伪称为 OS 沙箱：Orbit 已集成签名 native
  helper contract，但只有显式安装且通过文件本体、SHA-256、Ed25519 信任根
  校验的 helper 才会选择 `windows-appcontainer-helper`；否则 required 模式
  拒绝执行，auto 模式明确降级并由 doctor 报告缺口。
- 网络策略与可写工作区根目录进入命令元数据、审计和 doctor 快照。

### Agent Profile 与运行时控制

- Profile 支持项目/用户目录优先级、继承、model/provider/effort、工具
  allow/deny、权限、maxTurns、memory、forced Skills 和 worktree isolation。
- Profile 还可声明受限的 MCP server allow-list 与 profile-owned lifecycle
  hooks；hooks 在全局 hooks 前执行并复用同一超时、matcher、失败策略、审批
  与脱敏合同。切换 Profile 时仅在空闲边界重置旧 MCP 注册，避免工具泄漏。
- TUI、WebUI 和 CLI 均可选择 Profile；WebUI 设置变更会校验 managed policy，
  `/agent` 与设置面板只在 loop 空闲时切换运行时。主工作区交互会拒绝
  worktree-only Profile，而不是忽略隔离声明。
- durable runs 提供 `orbit runs list|inspect|recover`，恢复只处理过期
  lease，不删除记录、不伪造恢复执行。

### TUI 可访问性与终端兼容

- `config.tui.color` 提供 `auto`、`always`、`never` 三种显式策略；默认
  `auto` 遵守 `NO_COLOR`、`FORCE_COLOR` 与 `TERM=dumb`，无色模式会贯穿
  主会话、嵌入式 Prompt 和状态消息渲染，不只关闭一层装饰。
- `config.tui.keymap` 默认保持标准键位；显式 `vim` 只作用于主任务输入，
  提供可见 INSERT/NORMAL 状态和有界导航/编辑，同时保留全局 Ctrl/Meta
  快捷键。审批、确认和选择 Prompt 不继承 Vim 状态，避免改变安全语义。
- `config.tui.accessibility: screen-reader` 复用 line-oriented REPL，关闭
  alternate screen、鼠标捕获、动态 spinner、光标重绘和 ANSI 富文本；普通
  命令、审批、取消、流式输出与 diff pager 仍保留，不另造弱化版 Agent 循环。
- `config.tui.theme` 提供持久化的 `morandi`、`high-contrast`、`plain` 三个
  命名主题，且 `color` 仍是最终 ANSI 开关。Vim 主输入补齐有界的
  `dw`/`cw`/`D`/`C`、`I`/`A` 和单步 `u`，操作只作用于单行 composer，不改变
  审批/选择 Prompt 的键语义。

### MCP 现代交互

- stdio 与 Streamable HTTP 都支持 Tasks、任务取消/轮询、资源订阅、目录
  刷新、Roots、Elicitation 和基础 Sampling。
- URL Elicitation 的 `notifications/elicitation/complete` 与
  `URLElicitationRequiredError (-32042)` 已结构化传递到运行时；Roots
  支持 `listChanged` 能力声明、主动通知和监听。
- Durable Tasks 的 `input_required` 不再被降级为空工具结果；`waitForTask`
  会按规范预取并返回结构化输入请求，断线后仍可交给上层交互恢复。
- Task augmentation now honors each tool's `execution.taskSupport` declaration;
  Orbit refuses to send task metadata when a tool is absent, forbidden, or
  silent about task support.
- Roots 只暴露当前工作区 file URI；表单 Elicitation 逐字段收集并在提交
  前再次审批，敏感字段默认拒绝；URL Elicitation 只展示完整 URL 并要求
  明确同意，不自动打开或预取。
- Sampling 只使用当前已配置模型，必须经过用户审批；工具型 Sampling
  当前显式拒绝。MCP `2026-07-28` 已弃用 Sampling，并要求新实现不要继续
  扩展；Orbit 仅保留受控的旧版基础兼容，不再新增该废弃协议的工具循环。
- 所有服务端请求均经过 schema、超时、取消、脱敏和 serverName 归属。
- 每个 MCP server 可独立关闭 elicitation、sampling 或 roots；策略在
  capability advertisement 前生效，避免把未批准的交互暴露给远端服务。
- stdio 传输提供显式、并发合并的 `reconnect()`：重连会重新握手、刷新
  能力与工具目录并累加 recovery 计数；不会对不受信任的第三方进程开启
  无界自动重启循环。
- stdio 动态工具在发现断线时使用每个 server 独立的
  `recovery.enabled/maxAttempts/windowMs/initialBackoffMs/maxBackoffMs`，以
  有界指数退避恢复、刷新目录并在 crash-loop 超限后暂停；等待可取消，
  已发出的工具调用永不自动重放，避免不确定副作用。

### ACP 外部 Agent

- 新增 `@orbit-build/acp` 官方 ACP v1 客户端桥接：initialize、session/new、
  流式 update、权限请求、取消、超时、进程树回收和 bounded redacted logs。
- `orbit acp list|probe|run|close` 将外部 Agent 的 auth/model/runtime 与 Orbit
  Provider 分离；probe 只协商能力，不执行 prompt。
- `orbit acp sessions <agent>` 可通过 ACP `session/list` 查看外部 Agent 的
  有界持久会话目录，元数据只在本次控制操作中存在，不自动导入 Orbit。
- `orbit acp run --session <id>` 会按能力优先 `session/resume`、回退
  `session/load`，并把历史回放计数与当前轮输出分离；`orbit acp close`
  显式释放活跃会话。list/close 共享同一套协商、超时、stderr 和进程树回收。
- `orbit acp import <agent> <session>` 提供显式历史迁移：只调用有界
  `session/load`，将文本与计划/工具回放转换为带 provenance 的不可执行 Orbit
  消息，二进制内容省略，超过上限默认拒绝，按内容摘要去重，并在持久化失败
  时删除新建会话。
- `orbit acp registry list|validate` 提供用户级与项目级本地 ACP manifest
  discovery；项目同 ID 覆盖用户项，文件有大小/schema/符号链接边界并输出
  SHA-256 digest。新增 `orbit acp registry fetch --url` hosted transport：
  HTTPS-only、大小/超时/取消/redirect 边界、签名 owner/id/revision/expiry
  校验、ETag 304 与本地原子 pinning；发现和抓取都不会启动进程，只有显式
  trusted entry 才能转换为可执行配置。
- ACP registry 支持 Ed25519 签名分发：签名覆盖 canonical unsigned manifest
  与稳定 SHA-256 digest，复用配置中的 trust roots；篡改、无可信 key 或
  `--require-signature` 下的 unsigned registry 均拒绝进入可执行候选，并输出
  明确 signature status。
- Managed policy 支持可选的 Ed25519 signed bundle：canonical policy digest、
  policy id/owner/revision、issued/expiry 时间、独立 trust roots 和
  `ORBIT_MANAGED_POLICY_REQUIRE_SIGNATURE` fail-closed 模式均经过 schema 与
  签名校验；签名策略不会冒充组织 identity 或中央发布服务。
- Managed policy 新增可签名的 `allowedExtensions` allow-list；扩展只有在
  registry 信任、tree digest、manifest 身份和组织 allow-list 全部通过后，
  才能物化 MCP、Skill、Profile 或 Hook 贡献，未列出的 trusted entry 也会
  在贡献边界前 fail-closed。
- daemon 控制面支持本地 scoped principals：read/submit/control/admin 在每个
  endpoint 做最小权限校验；默认 token-file principal 保持兼容但明确是 full
  local-admin，不伪称 SSO/RBAC 组织身份。可选 `JwtDaemonAuthenticator`
  通过管理员提供的 offline JWKS 校验 RS256 bearer token 的 issuer、audience、
  expiry、scope/role mapping 和 clock skew；CLI 可用 `--jwks --issuer
--audience` 启用。`DaemonAuditLog` 提供 fsynced、redacted、SHA-256 hash-chain
  本地审计，并可用 `requireAudit` fail-closed。
- `FleetProtocol`/`FleetCoordinator` 提供 provider-neutral offload 基础：签名
  job envelope、幂等 job ID、worker lease/heartbeat、stale recovery、bounded
  retry、明确 patch owner/base revision/file scope/result digest、取消和可注入
  持久化。`FleetHttpServer`/`FleetHttpClient` 提供有界、鉴权、HTTPS-or-loopback
  的传输层和 submit/list/claim/heartbeat/complete/cancel 操作；worker principal
  可绑定显式 `workerIds`，托管部署可启用 `requireWorkerBinding` 做 fail-closed
  身份约束；它不自动上传
  workspace，部署方仍需提供租户存储、patch transfer、密钥轮换和回滚服务。

### Review 与扩展治理

- Multi-Agent Reviewer 输出 schema-validated finding：severity、文件/行、
  证据、影响、修复建议和 disposition。
- P0/P1 未 fixed finding 会强制 rejected；审查证据持久化到
  `.orbit/reviews/*.json`。
- `orbit review list|show|set|verify` 支持安全查看、变更 finding disposition
  和 CI 阻断检查；disposition 变更保留有界审计历史，不修改源文件。
- 扩展支持 Ed25519 签名，签名覆盖规范化 manifest 与不可变 tree digest；
  managed policy 或全局 security trust roots 配置后，未通过信任根的扩展
  不会注入 MCP 配置。
- 扩展的 `contributes.agents` 会在安装事务中与命令/Skill 一起 materialize
  到 `~/.orbit/agents/extensions/<extension-id>`；安装前校验 YAML/JSON、Profile
  schema 与贡献名一致性，发现时只读取直接文件并保留 direct-profile precedence。
- `contributes.hooks` 只有在 manifest 声明 process 权限、扩展树完整性通过且
  安装项显式 trusted 时才会 materialize；Hook 带 extension provenance，执行时
  强制 required native sandbox、只读扩展根、拒绝网络、最小环境、超时/取消/脱敏
  和共享审批审计。Windows 只有签名 helper contract 通过时才可执行；缺失或
  篡改时 fail-closed；管理员策略可用 `disableExtensionHooks` 全局阻断。
- `contributes.tools` 已从元数据升级为版本化的 Node stdin/stdout 子进程协议：
  定义文件和入口点均有 schema/大小/树完整性边界，输入是 closed-object
  schema，工具使用固定 Node argv、minimal 脱敏环境、required native sandbox、
  extension 只读根和 manifest 声明的 workspace 根，网络 fail-closed；超时、
  取消、输出上限、进程树回收、脱敏和正常 tool permission/audit 全部复用。
  `risk: network` 工具在安装时拒绝，管理员可用 `disableExtensionTools` 阻断；
  任意 JavaScript 不会 import 到 Orbit 进程。

### Windows native helper contract

Orbit 不内置或自动下载 Windows 沙箱二进制。管理员必须通过环境变量提供
helper 路径、实际文件 SHA-256、签名 key id 和 Ed25519 签名，并在独立的
`security.windowsSandboxTrustRoots` 中配置公钥。签名覆盖稳定 JSON：

```json
{
  "schemaVersion": 1,
  "protocol": "orbit-process-sandbox-v1",
  "digest": "<sha256>"
}
```

通过后 Orbit 只传递结构化 argv：协议版本、cwd、network、read-only roots、
writable roots 和 `--` 后的原始进程 argv；不拼接 shell 字符串，也不把 helper
信任根扩展为扩展、MCP 或 provider 信任。helper 本身仍必须由发布方证明使用
Windows AppContainer 或等价的受信 native isolation，并负责进程树回收、网络
拒绝和精确退出码转发；Orbit 不把“contract 已验证”写成 Microsoft OS 级实现
已经由 Orbit 提供。

仓库 CI 与 npm release workflow 会在 `windows-latest` 上使用
Visual Studio/CMake 实际编译该 helper，并检查 Release 可执行文件产出和
SHA-256；这证明源码在受支持 Windows 工具链上可构建，但不会替管理员签名、
安装或自动信任该二进制。

### Remote task control plane

- `@orbit-build/daemon` 与
  `orbit daemon start|status|submit|tasks|inspect|events|cancel|resume|remove|stop`
  提供独立于 WebUI/TUI 的跨进程任务控制：loopback 默认、非 loopback 强制
  TLS、原子私有 bearer token、allowed-root、持久 task record、lease/heartbeat、
  orphan recovery、cancellation、resume、显式 terminal retention cleanup 和
  bounded SSE replay/follow。
- daemon 不把进程退出伪装成成功；旧 owner 的 running task 会变成
  `orphaned`，客户端必须显式 resume。CLI runner 使用 JSONL 事件作为唯一
  子进程边界，并保留 bounded redacted diagnostics。元数据经过 schema 和
  token-path 绑定，journal 拒绝符号链接；事件 follower 有数量、keepalive 和
  backpressure 边界，达到持久化上限时也会关闭 terminal stream。
- `DaemonClient` 作为独立 typed client 导出给 WebUI、桌面端、编辑器和远程
  host，统一 response schema、bounded body/SSE frame、replay/follow、错误和
  取消语义；消费端不必复制 CLI 的 token/HTTP 实现。
- CLI 的 status/submit/tasks/inspect/events/cancel/resume/remove/stop 也可通过
  `--url` + `--token-env` 走同一 `DaemonClient` 远程控制面；远程 plain HTTP
  仅允许 loopback，start 仍只负责本机生命周期，避免把“远程连接”误当作
  daemon 部署或身份系统；remote submit 还强制显式提供 daemon host 可见的
  `--cwd`，不猜测跨机器路径映射。

在同一台 Windows 11 unrestricted runner 上完成了真实 CLI 控制面 smoke：
`start --background`、`submit`、活动任务 `events --json`（`follow=false`）、
`cancel`、`remove`、删除后的 `inspect` 404，以及认证 `stop` 均按预期返回；
任务子进程的 provider 失败也只落为 `failed` 记录，不会让 daemon 伪报成功或
崩溃。

## 仍未声称完成的能力

以下项目仍需独立版本和真实环境证据，1.6.0 不将接口占位当成完成；仓库内
可实现的扩展工具、自动 MCP recovery、命名主题和基础 Vim operators 不再
列为未完成：

- Windows 原生 helper 的 AppContainer 源码已纳入仓库 CI 与 release workflow 的
  Windows runner 编译、拒绝路径测试和产物检查门禁；本地 runner 仍缺少 MSVC/CMake，
  因此当前没有把远程 workflow 的未来结果写成本地已通过证据。仍需发布方完成
  独立代码审查、签名、安装和 contract 配置，Orbit 不自动下载或伪称已安装。云端 offload 的网络/存储/
  部署适配仍需外部服务；当前 coordinator 与 HTTP transport 已真实实现
  ownership/lease/rollback 传输契约，但跨机器任务的组织级部署、identity、
  patch transfer 与 fleet/orchestration 运维仍需部署方完成。
- ACP registry 的签名 artifact 验证、hosted fetch/pinning 和显式 `acp import`
  历史迁移已完成；中央托管索引的组织级发布服务、多 Agent 跨进程任务迁移
  仍需要独立的 ownership、provenance 与 rollback 服务协议。导入只创建带
  来源标记的不可执行 Orbit 快照，不偷偷接管外部 Agent 的持续历史所有权。
- MCP Sampling 工具循环属于明确非目标：该能力已在 MCP `2026-07-28`
  弃用；Orbit 保留旧服务的基础 Sampling 兼容，但不会为废弃协议扩展新的
  Agent 循环。
- GitHub 自动 CI 编排仍不替用户配置 workflow/权限；Checks API、可选 PR
  head 校验、显式 inline comment adapter 和有界 `github-dispatch` 已提供，
  但 workflow 文件、分支保护和组织权限仍需项目自行配置。
- WebUI 已完成有界、鉴权、签名校验的图片上传/预览/消费/删除链路；TUI 仍支持
  `/attach`、`/attachments`、`/detach` 的本地图片引用，不把二进制写进事件流。
  Provider profile 可为具体模型声明 `maxImages`/`maxImageBytes`，发送前会按
  模型能力拒绝超限附件。
  `transcribe_audio` 已提供本机 Whisper CLI adapter，`inspect_document` 已支持
  有界 Tesseract 图片/扫描 PDF OCR，`capture_audio`、`capture_screenshot` 和
  `inspect_accessibility` 已提供 argv-only 的本机 adapter；每个平台的真实权限、
  设备和外部依赖仍需在对应 runner 验收。
- 完整 hosted SSO/federated login、组织目录同步、集中 RBAC/审计后端、跨
  设备 retention 和公开 SLA；本地 JWT verifier、scoped RBAC、hash-chain
  audit 和 session retention 不等同于这些组织服务。

## 1.6.0 验收门禁

- 所有新增协议边界必须有 schema、超时、取消、脱敏和拒绝路径测试。
- `orbit doctor --json` 必须真实反映平台后端，不得把 Worktree 或 Full
  Access 当作 OS 沙箱。
- Review finding 必须可追踪、可 disposition、可复现；源文件修改与 finding
  状态分离。
- Review finding 可导出标准 SARIF 2.1.0，包含 workspace-relative location、
  严重级别、disposition、证据和稳定 fingerprint，供 CI/code-scanning 消费；
  导出本身不上传代码，也不伪称已经接入 GitHub API。
- `orbit review github-check` 已提供真实 GitHub Checks API adapter：默认
  dry-run，`--apply` 才发起 HTTPS POST；repo/SHA、token-env、response limit、
  30 秒超时、50 条 annotation 上限和错误脱敏均有边界；`--pr` 会在发 POST
  前校验 PR head SHA 与目标 commit 一致。inline review comment 与
  `github-dispatch` 均需显式 apply，workflow/权限配置不由 Orbit 隐式修改；
  Enterprise/custom API host 还必须显式 `--allow-custom-api`。
- `orbit review github-comment` 提供显式 inline comment adapter：默认 dry-run，
  `--apply` 前分页扫描最多 1000 条评论并按 Orbit marker 去重，只为 open
  finding、无路径穿越的仓库相对路径和有效行号发 bounded POST；401/403/429
  会停止后续写入并保留 partial-failure 结果，分页异常会 fail-closed。
- `orbit review github-dispatch` 提供显式 GitHub Actions workflow dispatch：默认
  dry-run，`--apply` 才发送 POST；workflow、ref、输入键和值、仓库和 API 主机
  均有 schema/大小边界，支持重复 `--input name=value`，请求超时、响应上限和
  opaque token 脱敏均已覆盖。
- Session retention 提供 `orbit sessions retention` 的 age/count/byte 计划、
  JSON dry-run、active 默认保护、明确 `--yes` 确认，以及执行前的
  updatedAt/size 竞态重检；它只管理 `.orbit/sessions`，不替代组织级后端留存。
- 发布前通过类型检查、格式检查、全量 Vitest、WebUI E2E、构建、依赖审计、
  npm 包内容、安装 smoke、provenance 和回滚演练。

## 1.6.0 本地验收证据

以下结果来自本工作树最后一次完整发布门禁（Windows 11、Node 24、2026-08-17，
unrestricted runner）。仓库声明的 packageManager 是 `pnpm@10.34.5`，本机实际
执行器为 pnpm `11.19.0`；两者差异已保留在证据中，没有伪称使用了声明版本。

扩展 Agent Profile 增量已纳入完整门禁；此前受限环境中的 Hooks、后台任务、
弱模型和 non-interactive 失败均被 unrestricted runner 复核为环境假失败，
没有留下产品回归。

| 门禁                                             | 结果                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 依赖声明、ESLint、Prettier、全部 workspace build | 通过                                                                                          |
| 全量 Vitest                                      | 217 个文件通过；1395 通过；6 跳过                                                             |
| 关键覆盖率                                       | statements 82.80%；branches 76.53%；functions 89.12%；lines 82.80%                            |
| WebUI Playwright E2E                             | 19/19 通过；修复初始化流程抢占队列编辑器焦点的竞态后无 flaky                                  |
| 文档链接检查                                     | 61 个 Markdown 文件通过                                                                       |
| CLI smoke                                        | 版本、help、doctor、REPL、exec、LSP 生命周期通过                                              |
| npm 安装/卸载 smoke                              | `@orbit-build/cli@1.6.0` 通过                                                                 |
| 生产依赖审计                                     | 54 个包检查；高危及以上 0                                                                     |
| 第三方许可声明                                   | 仓库与 CLI 包一致                                                                             |
| CLI 包内容                                       | 35 个文件；2,556,659 packed bytes；14,241,024 unpacked bytes；无 workspace 协议残留；验证通过 |

### 真实 DeepSeek provider smoke（脱敏）

同一 Windows 11 runner 使用当前已加载的 DeepSeek 凭证完成了最小真实
provider 验证；命令只输出哈希、计时和 token 统计，不保存 prompt、响应或
凭证。`deepseek-v4-flash` 完成 1 次普通样本和 3 次稳定前缀缓存样本，均无
provider 错误，后两次缓存命中率均为 99.04%。`deepseek-v4-pro` 使用
`thinking=high`、`max-tokens=512` 完成 3/3 样本，错误率为 0；首个 thinking
delta 为 1.46–1.73 秒，首个文本为 2.10–2.15 秒，总耗时为 2.10–2.15 秒，
解码吞吐为 31.77–49.53 tokens/s。另一次使用过低的 16 token 上限时触发了
预期的截断错误，提升上限后恢复正常，证明了边界错误不会被伪装成成功。

这些是当前账号、当前区域和当前时间窗的观测，不是 SLA 或公开性能承诺；
正式发行仍需在专用低权限账号、固定区域和批准阈值下重复并归档完整 gate。

这张表是“本地可复现证据”，不是对远程执行、Windows 原生沙箱或企业
合规能力的替代证明；这些能力仍必须在对应真实环境中单独验收。
