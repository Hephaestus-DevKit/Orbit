# Orbit 1.5.0 Harness Audit

日期：2026-08-15

## 1. 1.5.0 的完成定义

Orbit 1.5.0 是“可恢复、可验证、可观察的 Agent Harness 基础版”。本版
优先把长任务和跨协议边界做成可审查的契约，不把尚未拥有 OS 级隔离、远程
daemon 或企业身份系统的能力包装成已完成。

## 2. 本版已落地

### Agent Profile 继承和模型 effort

- Profile 支持单父级继承；子配置只有在 manifest 中明确声明时才覆盖父级。
- 继承链最多八层，循环和缺失父级在 Agent 启动前失败。
- `effort: low|medium|high|xhigh|max` 经过 Zod 校验并传递到 Planner、Coder、
  Reviewer 和单 Agent。
- 通用模型保留五级 effort；DeepSeek V4 自动映射到官方 `low|high|max`，
  同时选择对应思考预算。
- `orbit agents list|validate` 展示继承关系和 effort，便于 CI 审查。

### MCP Durable Tasks

- stdio 与 Streamable HTTP 客户端都支持：
  - `tools/call` 的任务创建。
  - `tasks/get` 状态查询。
  - `tasks/list` 不透明游标分页。
  - `tasks/result` 结果获取。
  - `tasks/cancel` 取消。
  - `waitForTask` 有界轮询，尊重服务端 `pollInterval`。
- 支持 `working`、`input_required`、`completed`、`failed`、`cancelled` 状态。
- `input_required` 会返回结构化状态，不会猜测或伪造用户输入。
- 服务器没有声明任务能力时明确失败，旧 MCP 服务器继续走原有同步工具路径。
- stdio 的 `notifications/tasks/status` 经过 schema 验证后才通知订阅者。

### Mission Control 状态

- WebUI 任务卡明确区分：就绪、运行中、等待审批、正在取消。
- 审批原因经过现有脱敏边界后才显示。
- 任务状态与 SSE 重连、取消和现有 Agent/Background 状态共用同一快照。
- 保留键盘访问、窄屏布局、无水平溢出和状态 live-region 行为。

## 3. 验证证据

本版本至少要求以下聚焦检查通过：

```text
pnpm exec vitest run packages/config/src/AgentProfiles.test.ts \
  packages/model-providers/src/ModelAdaptation.test.ts \
  packages/mcp/src/MCPClient.test.ts \
  packages/mcp/src/StreamableHttpMCPClient.test.ts \
  packages/mcp/src/McpProtocol.test.ts
pnpm test:webui
pnpm typecheck:webui-client
```

发布前仍必须通过根目录的 `pnpm verify:release`、制品检查、安装 smoke、
依赖审计、跨平台 CI 和发布 provenance 门禁。

## 3.1 后续基础增量（当前工作树）

在 1.5.0 发布基线之上，当前未发布的基础增量已经补上两类容易造成
“假成功”的边界：

- `AgentRunStore` 使用共享的生命周期转换规则，禁止已完成子 Agent 被
  旧的失败/取消路径覆盖；重复写入相同的终态是幂等的。
- stdio 与 Streamable HTTP MCP 客户端识别资源订阅、目录变化、elicitation
  和 sampling 能力，并提供经过校验的资源订阅/取消订阅、资源更新监听，以及
  由显式 Host Handler 控制的服务端 `roots/list` 请求；
  现代 `input_required` 会保留结构化请求，只有显式注入的 Host Handler 才能
  回复 roots/elicitation/sampling，能力声明不会自动替代用户交互或权限审批。
- `orbit doctor --json` 明确输出 Workspace/Worktree、OS Sandbox、网络隔离、
  本地 Daemon、Remote Runtime、ACP、MCP 高级交互和 Extension 签名边界，
  避免将 Full Access 或 Worktree 误报为 OS 级沙箱。
- 新增 `orbit runs list|inspect|recover`，允许第二个终端读取脱敏后的持久化
  Agent Run、子 Agent、成本和 lease 状态；`recover` 只处理过期 lease，不删除
  记录，也不伪造“已恢复执行”。这使本地控制面可被脚本和故障处理流程复用。

这些增量仍属于下一版本候选变更，未改变当前已发布 npm 包，也不代表 OS
级 sandbox、远程 daemon、ACP 或企业治理已经完成。

## 4. 仍明确未完成的世界级门禁

以下能力没有在 1.5.0 中虚报完成：

- Windows/macOS/Linux 的 OS 级 sandbox 与网络隔离。
- 跨进程/远程任务控制平面和 cloud offload。
- ACP 外部 Agent registry 与 Thread 导入。
- MCP elicitation、sampling、roots/list changes、subscriptions 的完整交互。
- Extension 签名信任根和扩展沙箱。
- GitHub PR/CI 闭环、inline finding disposition。
- 原生截图、文档解析、浏览器/computer-use。
- 企业 SSO、RBAC、组织策略和审计后端。

这些能力仍按 1.6/2.0 的发布门禁拆分，并且必须以真实评测、威胁模型和
跨平台证据验收，而不是仅增加接口或 UI 占位符。

## 5. 回归规则

- Profile 继承不得削弱 managed policy、审批或路径边界。
- MCP 任务不得把未验证的参数、任务结果或通知送入 Agent。
- `input_required` 不得自动跳过用户交互。
- 任务轮询必须受超时、取消和状态数量上限约束。
- Full Access 仍表示完整宿主权限，不等于 sandbox。
- 任一协议失败都必须保留可操作的错误类别和脱敏诊断。
