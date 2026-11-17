# DeepSeek 优化与验收 · 2026-11-16

本轮落实 [10 月评估](DEEPSEEK_UPDATE_REVIEW_2026-10-21.md) 中确认的兼容性缺口，
并在 11 月 16 日重新核对官方 API 文档。`deepseek-flash` 请求 ID 保持不变；
`DeepSeek-V4.1-Flash-1017` 是文档标注的已知版本，不是运行时版本探测结果。

## 已实现

| 范围          | 结果                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Messages 视觉 | Flash 支持图片；Pro 按能力拒绝。                                                                                   |
| Messages 历史 | 过滤空文本和空消息；保留推理、工具调用、空工具结果及持久化历史。                                                   |
| 模型参数      | Flash/Pro 分别处理 top_p；Pro 非思考模式保留调用者值。三协议已做真实请求验证。                                     |
| 联网          | 增加可选 Search/Fetch 后端、WebUI 搜索选项和钥匙库凭据复用。自动搜索默认策略保持不变。                             |
| 费用          | 独立记录成功请求数、估算费用及费率日期，并计入会话预算；无结果不计费，无法确认的已发送请求标为费用未知。           |
| 图片上下文    | 不再把 base64 传输长度当作文本 token。每图预留 4096 token 的通用估算额度，不作为计费依据。                         |
| Files         | 可选的一小时过期上传、按凭据和内容哈希隔离的 32 项内存缓存、三协议文件引用、上传失败回退及失效 ID 的一次内联回退。 |
| 请求限制      | 三协议均在发送前检查序列化请求的 48 MiB 上限。                                                                     |
| 价格          | 增加 2026 年中国假期例外；自定义价格可配置 offPeakDatesUtc。                                                       |

Files 只对官方 DeepSeek Flash 启用。文件 ID 存在于请求投影的 WeakMap，
不写入会话；缓存不保存明文密钥。不在已有输出或工具交付之后重发推理请求。
图片上传失败时回退到原始内联请求，依然受请求大小和取消限制约束。

Search/Fetch 使用固定官方地址，拒绝 HTTP 重定向，不自动重试付费请求。
Fetch 发送前验证公共 URL，即使处于 Full Access 也不把私网地址交给远端服务。
响应有 schema 和大小限制，返回内容截断，错误不回显远端正文或凭据。
DeepSeek 搜索限制为 128 个 Unicode 字符，并优先把 summary 提供给模型。

## 使用方式

现有模型调用自动获得兼容修复。联网和文件上传为显式可选项，可在现有配置中合并：

```yaml
providers:
  deepseek:
    deepSeekFiles: true
tools:
  webSearch:
    provider: deepseek
    fetchProvider: deepseek
```

`deepSeekFiles` 默认关闭；`fetchProvider` 缺省为本地直接抓取。
搜索也可通过 WebUI 设置中的 DeepSeek 选项开启；该选项显示每次搜索估算费用。
默认凭据名为 `DEEPSEEK_API_KEY`，无需把密钥写进配置文件。

当前 Search 和 Fetch 每次成功且产生内容的请求各按 $0.00075 估算。
以 [官方价格页](https://api-docs.deepseek.com/quick_start/pricing/) 和
[Search/Fetch 规则](https://api-docs.deepseek.com/guides/search/) 为准；此前免费期已结束。
费率是本次核验的快照，API 账单才是实际扣费依据。

假期日期依据 [2026 年国务院放假安排](https://www.gov.cn/zhengce/content/202511/content_7047090.htm)。
目前内置例外仅覆盖 2026 年；以后年份需随公告更新，或在定价文件的
`scheduled.offPeakDatesUtc` 中配置。调休周末仍遵守 DeepSeek 的周末低峰规则。

## 验证记录

- 全量 Vitest：295 个文件通过，2194 项通过、2 项平台跳过。
- 生产及测试 TypeScript 检查通过；模型、工具、核心和 CLI 构建通过。
- `scripts/deepseek-live-smoke.mjs --run`：11 个真实场景全部通过。
  包括三协议 Pro 非思考 top_p 请求、三协议 Flash 两轮工具续接、三协议 Files 图片识别、
  Messages 重复图片上传复用，以及 Search/Fetch。
- 实测仅使用合成图片、固定问题和内存 nonce 工具，不上传用户工作区内容。
  模型输出有上限，模型自动重试为零。生成的明细位于本机
  `output/local-deployment/deepseek-live-smoke.json`，不含密钥或模型推理正文。
- 浏览器设置的选择、保存、恢复、桌面与 390px 窄屏检查全部通过，页面无 JavaScript
  错误；`e2e/deepseek-settings.spec.ts` 的截图已人工检查。
- 依赖边界、架构、文档链接、ESLint、Prettier、Skills 校验及 CLI 冒烟、包内容检查均通过。
- 已更新本机 `/opt/homebrew/bin/orbit`，版本仍为本地构建 1.9.4；安装目录与工作区
  构建产物逐字节一致。旧安装包保存在本机
  `output/local-deployment/rollback-2026-11-16/`。
- 重启已有 Orbit 进程后加载新代码。兼容性修复默认生效；联网后端和 Files 开关
  保留用户原设置，按上面的配置显式开启。

重跑真实验证前先构建，然后执行：

```sh
node scripts/deepseek-live-smoke.mjs --run
```

此命令会产生少量 API 费用，并上传自动过期的合成测试图片。
不带 `--run` 只打印说明，不发送请求。

## 保留的边界

真实验收证明协议调用和指定任务通过，不证明 top_p 的统计效果或整体编码质量提升。
本轮没有依据少量样例改变 low/high/max 路由或默认升级到 Pro。

增量 system/tool 声明仍使用现有完整、稳定排序的工具目录。上游的增量语义涉及会话
回放和工具移除，尚缺 Orbit 三协议一致的验收依据，因此没有在生产路径启用。
后续若引入，应单独比较缓存收益，并验证恢复历史、工具撤销和跨协议切换。

接口依据：[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、
[Messages 兼容](https://api-docs.deepseek.com/guides/anthropic_api/)、
[Files API](https://api-docs.deepseek.com/guides/files_api/)。
