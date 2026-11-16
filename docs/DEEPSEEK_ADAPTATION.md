# DeepSeek 调用适配

初次适配对照了 DeepSeek 官方 `deepseek-harness` 的固定提交
[`d743267388641bc76f17c45ce8b4c231aed1d32c`](https://github.com/deepseek-ai/deepseek-harness/tree/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src)。
该提交主要使用 Messages 协议；Orbit 保留独立的 Chat Completions、Responses 和
Anthropic 三个传输实现，并按各协议的官方契约分别适配。没有引入整个 Harness
作为依赖，也没有改变用户指定的网关、模型 ID 或协议。

2026-11-16 已完成后续兼容与能力更新，参见
[优化与验收记录](DEEPSEEK_OPTIMIZATION_2026-11-16.md)。模型请求 ID 保持不变。

## 请求与推理历史

- Chat 的历史推理片段按原始顺序连接，不添加换行；请求带工具时回传所有 assistant
  轮次的 `reasoning_content`，包括没有调用工具的旧轮次。
- Responses 的 reasoning 输入使用 `content: [{type: "reasoning_text", text: "..."}]`。
  原先的字符串格式在真实工具续接请求中触发 422；现已修复，并通过两轮真实联调。
- 工具结果必须对应紧邻的待完成调用。孤立、重复、缺失的结果在发送请求前报错，
  不伪造结果，也不改写已保存的推理历史。
- Chat 在思考开启时提前拒绝 `required` 或指定工具的组合。需要强制
  工具时显式设置 `thinking.enabled: false`；`auto` 与 `none` 保持可用。
  Responses 与 Messages 保留各自支持的工具选择语义，不套用 Chat 的限制。
- Flash 在思考模式保留有效 `top_p`，钳制到 0.95–1.0；非思考模式去掉无效的 top_p。
  Pro 在非思考模式保留 top_p，在思考模式删除无效的 top_p。
  三协议均按模型应用策略；思考模式删除无效 temperature。
- Messages 按模型能力接受 Flash 图片，Pro 继续拒绝；请求边界过滤空文本与空消息，
  保留推理块、工具调用及空工具结果。

依据：[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、
[Chat 参数](https://api-docs.deepseek.com/api/create-chat-completion/)、
[Responses 参数](https://api-docs.deepseek.com/api/create-response/)。

## 流式结束与工具交付

`ProviderSseParser` 按完整 SSE 帧解析，支持多行 data、心跳注释、CR/LF/CRLF、
跨读取边界和 UTF-8 解码后的文本。单帧与总响应大小仍有上限。EOF 不会自动把
没有空行结束的尾部升级为成功事件。

三个 DeepSeek 协议都在收到完整结束契约后交付工具，并先校验整个批次的 ID、名称
和 JSON 参数。截断、异常结束、重复 ID 或批次中的无效参数不会泄露可执行的部分
工具调用。输出截断时仍保留已经收到的文本与 usage；错误标记已出现的部分输出，
避免把可见输出当作未开始的请求重试。

Chat 要求 finish reason 和 `[DONE]`，Responses 要求语义 terminal event，Messages
要求 stop reason 和 `message_stop`。Responses 与 Messages 不接受 Chat 的结束标记。
退出消费时取消上游流并移除监听器；请求层继续服从 Agent 提供的重试预算。

## 验证与边界

`pnpm test:deepseek` 包含三协议请求、流式/非流式、截断、批次原子校验、EOF、
单字节 UTF-8/CRLF、提前取消、推理回传和参数策略回归。新增模块也纳入关键覆盖率门禁。

在 2026-10-10 的真实官方 API 联调中，`deepseek-flash` 的三个协议均完成了开启思考的
两轮工具调用：模型取工具结果，完整历史回传，最后返回工具提供的随机 nonce。
仅执行内存中的验证工具，设置输出上限与零自动重试，凭据通过 CredentialsManager
读取；测试未改动用户配置，也未输出密钥。

这验证了当前调用契约，不能推导任意编码任务的质量、固定缓存命中率、固定延迟，
或第三方网关对所有协议的兼容性。新增 Files 图片复用和 Search/Fetch 均需显式配置；
增量 system/tool 声明尚未接入，当前仍使用稳定排序的完整工具目录。
