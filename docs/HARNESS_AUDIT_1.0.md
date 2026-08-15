# Orbit 1.0.0 Harness Audit

日期：2026-08-15
范围：核心 Agent、三线 Provider transport、长任务恢复、Session/WebUI、权限与发布制品。

## 1. 1.0.0 的完成定义

Orbit 1.0.0 的“成熟 harness”不是单一聊天界面，而是一个可恢复、可审计、可验证的本地 Agent 运行时：

```text
用户任务
  -> 模型身份/能力解析（DeepSeek 族自动适配）
  -> 有界上下文与成本账本
  -> 统一审批、工具执行、验证合同
  -> 持久化 Session / Agent run / 事件
  -> TUI、WebUI、JSONL 同源观察
  -> 可恢复结果与发布制品
```

本版本打牢了上述闭环的关键边界；没有把尚未具备隔离证明的能力包装成“安全沙箱”或“云端托管”。

## 2. 本版本已落地的基础能力

| 领域           | 结论                                                                                                                                                                                                                | 关键证据                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Agent 生命周期 | Provider 初始化失败显式失败；取消、验证、回滚、结果 receipt 保持确定性                                                                                                                                              | `AgentLoop.ts`、`AgentLoopOutcome.test.ts`                                                          |
| 长任务恢复     | Agent run 采用带 instance、PID、启动时间和过期时间的 lease；heartbeat 丢失可回调；死进程可恢复并显式 resume                                                                                                         | `packages/session/src/AgentRunStore.ts`                                                             |
| 重试成本       | Agent-owned retry budget；编排请求传 `retryBudget: 0`，避免 transport × loop 嵌套重试                                                                                                                               | `ModelChatInput`、三种 transport、Provider 测试                                                     |
| 上下文         | 按模型上下文窗口计算；语义压缩可取消且 usage 纳入账本；DeepSeek 前缀缓存只测量真实 usage                                                                                                                            | `ContextWindowManager.ts`、`PromptCacheSlab.ts`                                                     |
| DeepSeek       | 模型身份与 provider hostname 解耦；官方 Chat/Responses、兼容 OpenAI、兼容 Anthropic 三条 wire path 共享模型族策略                                                                                                   | `ModelAdaptation.ts`、`deepseek/*`                                                                  |
| 权限           | Full Access 明确为完整宿主机权限；普通模式仍经过统一审批、路径边界和子进程环境收敛                                                                                                                                  | `packages/permissions`、`AgentLoop.ts`                                                              |
| WebUI          | SSE 每个 runtime 独立；事件 allowlist/脱敏；严格区分 `sessionId` 与子 Agent `taskId`；重连超过回放窗发送 `replay_gap` 并让客户端重新同步快照；窄屏安全区、独立滚动、侧栏/命令面板焦点循环和模态隔离已纳入客户端契约 | `WebUiEventStream.ts`、`WebUiClientSession.ts`、`WebUiClientFoundation.ts`、`WebUiClientPalette.ts` |
| 持久化         | Session/Run/Plan/Queue 使用 schema 校验、私有权限、原子写入和 `.bak` 保底；长事件日志按文件指纹缓存且返回深拷贝；vector cache 写入失败可观测                                                                        | `packages/session`、`VectorStore.ts`                                                                |
| CUMCM Skill    | `results/qN` 作为中文证据目录；叶级 CSV/TSV/XLSX 文件名、表头、工作表默认中文；`paper/` 保持交付紧凑；最终器是终态门禁                                                                                              | `packages/cli/skills/cumcm-draft/SKILL.md`                                                          |
| 发布           | 版本源统一、构建/测试/包内容/依赖审计/烟测/端到端 WebUI 纳入 release gate                                                                                                                                           | `scripts/*`、`.github/workflows`                                                                    |

## 3. 关键可靠性约束

### 3.1 Provider 与 Agent 的职责边界

- Provider 只负责协议适配、流解析、错误分类和可配置的独立调用重试。
- Agent 负责可见任务的 retry、fallback、上下文压缩、审批和成本上限。
- 编排请求明确传 `retryBudget: 0`；没有该字段的第三方调用不改变原有行为。
- 任何部分输出或工具调用已经出现时都不会盲目重放请求。

### 3.2 事件与恢复

- 事件 payload 只允许 WebUI 安全白名单字段，原始 prompt、工具参数、完整 diff 和凭据不得进入普通 UI 事件。
- SSE 回放窗口是有界的；窗口外事件通过 `replay_gap` 明示，客户端随后读取权威快照。
- Session history、run journal、agent-run lease 和 input queue 分开持久化，恢复时不会把未消费 steering 伪装成已执行历史。

### 3.3 权限与 Full Access

Full Access 是用户明确授予的完整宿主机权限，不等于 OS sandbox。1.0.0 保证审批、路径校验、环境收敛和审计链不因 Full Access 被绕过；需要真正隔离时应使用外部容器/虚拟机 posture，并在部署策略中单独声明。

## 4. 已知边界（不伪称完成）

- `AgentLoop.ts` 仍是较大的编排对象，已按 Context、RunTracker、MCP、Verification 等边界拆出协作模块，但完整状态机拆分属于 1.1 的兼容性工作。
- VectorStore 仍是 JS 线性检索；超过十万文档或高并发索引应接入专用向量数据库，当前实现保证边界、维度和持久化正确性。
- WebUI 客户端仍以可审计的片段模块拼装，浏览器端严格类型检查和行为测试已接入，但不是 React 等完整组件树迁移。
- MCP Tasks、elicitation、sampling、subscription 的完整服务器语义仍按协议能力逐项补齐；当前 runtime 对未知能力安全降级并保留现有工具目录。
- Extension signed manifest、组织信任根、OS 级 sandbox、远程 daemon/cloud offload 不在 1.0.0 的已交付范围内。
- 未配置模型价格时，Orbit 会明确报告 cost unknown；不会编造美元价格。生产环境应维护 `~/.orbit/pricing.json`，并用 `doctor --strict` 检查。

## 5. 发布前验证清单

必须在干净工作树、Corepack 锁定的 pnpm 版本下运行：

```text
corepack pnpm install --frozen-lockfile
corepack pnpm verify:release
node packages/cli/dist/index.js doctor --json --strict
node scripts/verify-cli-package.mjs
git diff --check
```

专项证据包括 DeepSeek、WebUI 单测与 E2E、依赖/许可审计、CLI 安装烟测、npm tarball 内容检查和 GitHub Actions 发布结果。任何失败都必须在发布报告中原样列出，不以“本地通过”替代远端核验。
