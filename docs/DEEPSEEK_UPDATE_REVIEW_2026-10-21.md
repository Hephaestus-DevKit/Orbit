# DeepSeek 更新评估 · 2026-10-21

> 这是 2026-10-21 的评估快照。后续实现及验证结果见
> [2026-11-16 优化记录](DEEPSEEK_OPTIMIZATION_2026-11-16.md)。

## 结论与范围

Orbit 使用的 `deepseek-flash` 请求 ID 仍然正确，官方当前将其路由到
DeepSeek-V4.1-Flash-1017。应优先推进协议兼容、搜索能力和多模态成本控制，
再通过编码任务实测调整推理档位。本次仅增加评估文档，没有更改运行代码、凭据或本地安装。

本次查看了官方发布说明、API 文档，以及 Harness 相关适配文件。源码基线为
`d743267388641bc76f17c45ce8b4c231aed1d32c`，对照提交为
`687f282e8625c6b8d11ff58211a90524be2e4317`。这是针对模型调用和联网能力的定向审查，
并非对两次提交之间全部变更的完整审计。

官方 [v0.2.1-rc.2 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)
于 10 月 17 日发布，列出新版 Flash 以及可在设置中启用的 Search/Fetch API。
模型版本对应关系以[官方模型表](https://api-docs.deepseek.com/quick_start/pricing/)为准。

## 优先推进

### P1：补齐 Flash 的 Messages 图片能力

- **代码事实**：`packages/model-providers/src/anthropic-compatible/AnthropicCompatibleProvider.ts`
  对 DeepSeek 返回固定 `vision: false`，并拒绝任何含图片的 DeepSeek 请求；同文件已经有
  Anthropic base64 图片序列化能力。公共模型配置则已经声明 Flash 支持视觉。
- **官方依据**：[Anthropic 兼容说明](https://api-docs.deepseek.com/guides/anthropic_api/)
  明确支持 image 的 base64、URL 和 file 来源；模型表显示 Flash 支持视觉，Pro 不支持。
- **建议**：按模型能力开放 Flash 的 base64 图片请求，并统一能力展示与请求校验。
  Files 上传与缓存作为后续独立改动；不能把所有 DeepSeek 模型一起开放。
- **验收**：Flash 图片请求结构测试、Pro 拒绝测试、非 DeepSeek 回归，以及 Flash
  Messages 单图和多轮截图工具续接实测。此前的三协议文本工具测试不能替代视觉验收。

### P1：清理 Messages 请求中的空消息

- **代码事实**：同一 provider 直接转换所有非 system 消息及 text 块，没有空块过滤。
- **上游变化**：固定提交的
  [serialize.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm-deepseek/src/serialize.ts)
  相对上述基线新增跳过空 assistant 文本和空 assistant 消息，并继续保留空工具结果的调用 ID。
- **建议**：在 DeepSeek Messages 请求边界做协议专用归一化；保持持久化历史、推理片段、
  工具调用及结果对应关系完整。不能对 Chat/Responses 无差别删除空 content，
  因为只有推理或工具调用的 assistant 轮次可能有效。
- **验收**：覆盖空 text、空 user/assistant、非空推理、空工具结果、取消恢复和压缩后续接。
  这是源码暴露的兼容风险，本次未复现服务端报错。

### P1：区分 Flash 与 Pro 的采样策略

- **代码事实**：`packages/model-providers/src/deepseek/DeepSeekRequestPolicy.ts`
  的 `applyDeepSeekSamplingPolicy` 只有 thinking 开关，没有模型参数；三个传输通道共用
  Flash 策略，关闭思考时会删除调用者提供的 `top_p`。
- **官方依据**：[思考模式说明](https://api-docs.deepseek.com/guides/thinking_mode/)
  和 Anthropic 兼容说明均区分 Flash/Pro：Pro 在非思考模式下支持 `top_p`。
  但 [Chat 参数页](https://api-docs.deepseek.com/api/create-chat-completion/)
  仍给出未区分模型的描述，文档存在不一致。
- **建议**：将策略按模型及协议划分，先核实 Pro 非思考请求，再更新过滤逻辑和适配文档。
  不能仅凭一次请求成功就断言参数实际影响采样分布。
- **验收**：Flash/Pro × 思考开关 × 三协议的请求矩阵、无效值校验、受控真实请求；
  保留 Chat 思考模式下对强制工具选择的现有提前校验。

### P1：增加可选的 DeepSeek Search/Fetch 后端

- **现状**：`packages/config/src/schema.ts` 的搜索后端没有 DeepSeek；
  `packages/tools/src/web/search.ts` 仍使用现有搜索提供商。
- **新能力**：[官方 Search/Fetch 指南](https://api-docs.deepseek.com/guides/search/)
  提供独立的 `/v1/tools/search` 与 `/v1/tools/fetch` 接口，分别返回搜索结果和网页内容。
  Harness 对应模块是 `packages/web/web-deepseek-api`，发布说明将其作为可选设置。
- **建议**：复用 Orbit 的搜索/抓取工具接口和 CredentialsManager，增加明确的提供商配置、
  响应 schema、取消与超时处理、结果长度限制、公共 URL 校验和按请求计费记录。
  先保持可选，验证后再决定是否进入自动选择。
- **验收**：成功、无结果、限流、余额不足、取消、非法响应及超长页面；失败回退不得导致
  无界重试或重复费用。实测搜索相关性和正文提取质量。
- **费用**：官方标价 Search、Fetch 各为每千次成功请求 $0.75。价格页还说明
  Harness/Claude Code/Codex 的服务端工具调用将在北京时间 2026-11-01 零点开始按次计费；
  不能据此假定 Orbit 直接调用独立 API 也享有相同免费期。

## 后续性能与成本工作

| 优先级 | 现状与建议                                                                                                                                         | 验收依据                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P2     | `ContextWindowManager.ts` 使用序列化历史估算 token，图片 base64 可能被当作长文本，导致提前压缩。改为按内容类型估算上下文占用，独立限制请求字节数。 | 相同文本搭配不同尺寸图片；估算与 API usage 对比；压缩触发点回归。                      |
| P2     | 参考 Harness 的图片请求处理和官方 Files API，增加图片内容哈希缓存、文件 ID 复用及过期回退。                                                        | 多轮重复截图的上传字节、延迟、失效恢复和取消清理；验证凭据隔离。                       |
| P2     | 评估原生 Messages 的增量 system/tool 更新，减少工具列表变化对缓存的影响。这是此前已有的优化空间，不能算作本次模型更新新增能力。                    | 与完整声明方式比较缓存命中、输入 token、工具可见性及调用正确率；其他协议保持独立契约。 |
| P2     | `ModelPricing.ts` 只有星期和 UTC 时段判断，缺少官方价格表中的中国公共假期例外。增加可维护的例外日历，并将搜索费用与模型 token 费用分开。           | 假期、周末、时段边界和价格生效日期测试；费用估算保留来源日期。                         |
| P2     | `DeepSeekV4.ts` 仍显示通用版本名 `DeepSeek-V4.1-Flash`。增加已知服务端版本及核验日期，保留 `deepseek-flash` 请求 ID。                              | 诊断输出区分配置模型、文档标注版本和响应实际报告值，不能把静态标签当实时探测。         |

Files 的用途及限制见[官方视觉指南](https://api-docs.deepseek.com/guides/vision/)。
当前 Flash/Pro 峰谷费率已有配置；需要补齐的是例外日期和新增工具费用，而非整体重写计价。

## 用实测决定默认策略

优先级顺序：Messages 图片与空消息兼容 → 模型参数核实与修正 → 可选搜索接口 →
图片和缓存优化。每批改动单独回归，再用固定编码任务比较效果。

建议固定任务包含 bug 修复、多文件小改动、工具续接、截图分析、取消后恢复，记录：

- 任务通过率、工具错误率，以及无法完成任务的原因。
- 总费用、缓存命中、输入/输出用量。
- 首 token 和整轮完成时间的 p50/p95。
- Flash low/high/max 与现有 Pro 升级策略的收益差异。

现有按任务复杂度选择推理档位的策略应先保留；没有新版任务数据时，不宜把所有请求
统一升级到 max 或 Pro。上次记录的真实三协议联调日期是 2026-10-10，不能作为
1017 版本的性能或质量结论。

## 本次验证

- 通过现有 Vitest 入口直接执行 `package.json` 中 `test:deepseek` 的同一组参数，
  **20 个文件、267 项测试全部通过**。
- 这证明当前回归用例通过，不证明上述尚未覆盖的缺口已修复。
- 本次没有运行付费模型请求，没有修改密钥、运行配置或全局安装。
- 原有工作区修改保留；本次新增文件仅为这份评估。
