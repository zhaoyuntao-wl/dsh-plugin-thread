# dsh-plugin-thread

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件，把 **Thread**（底座无关的编码 Agent 会话记忆层）以单包闭环形式接入 dsh：

- **无损采集**：订阅 `session/event`，把完整事件流（用户消息 / Agent 回复 / 工具调用与结果）持久化到双 SQLite 库。
- **状态卡注入**：经 `agent/pre-step` 每轮注入状态卡——目标、生效决策与偏好常驻，每轮上下文保持 O(1) 有界。
- **内嵌 MCP server**：`dsh-thread` 命令提供 `query_session_memory` 检索（语义 BM25 + 结构化查询），可零代码挂载为 MCP overlay。

能力承诺：决策不丢、目标不漂移、不重复提问——跨长任务、跨压缩边界、跨新会话。

> **仓库关系**：本仓库是 [Thread](https://github.com/zhaoyuntao-wl/thread) 的 dsh 深度接入适配器；通用内核（`@thread/core`）与薄接入的 Qoder 适配器在 Thread 主仓库。

## 安装

```sh
dsh plugin add dsh-thread
```

零配置：`@thread/core` + `better-sqlite3` 依赖随包解决；插件激活即开始采集与注入。

## 启用（profile）

dsh 所有插件都要在 profile 的 `bundles` 里引用才生效。在 `~/.dsh/profiles/<你的 profile>/package.json`：

```json
{
  "name": "dsh-profile-my",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-thread"]
    }
  }
}
```

若要在会话内/Web UI 使用 `query_session_memory`，在 profile 的 `cordis.patch.yml` 加 MCP overlay：

```yaml
- insert:
    - id: mcp-thread
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: thread
        transport: stdio
        command: npx
        args: ['dsh-thread']
        failOnStartupError: true
```

## 会话临时隔离

同项目双代理并行做不相关任务时，用自然语言（"隔离/静默/别打扰"）或 `/isolate` 隔离本会话——对话上下文（消息/决策/反馈）仅自己可见，状态卡不再被对方更新干扰；工具事件仍共享（项目事实不断链）。`/unisolate` 解除（历史仍隔离），`/thread-publish <goal|decision|feedback> <id>` 或自然语言"把这个决策共享出去"按需沉淀转共享。

## 版本约束

钉 dsh `0.1.0-rc.6`（peer 依赖）；跟随 dsh release train 适配，compat 矩阵见 CI。

## 开发

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

开发期 `@thread/core` 经 `file:../thread/packages/core` 链接；core API 稳定后切换为 npm 版本。

## 许可证

[MIT](./LICENSE)
