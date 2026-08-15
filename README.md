# dsh-thread

Thread 会话记忆的 dsh 旗舰插件——一个包闭环：**确定性无损采集**（订阅 `session/event` 写双库）+ **状态卡注入**（`agent/pre-step` 每轮提醒）+ **内嵌 MCP server**（`query_session_memory` 查询通道，`dsh-thread` 命令启动）。

- 决策不丢、目标不漂移、不重复提问
- 跨压缩边界保真：状态卡 O(1) 常驻，细节按需检索回拉
- 跨会话继承：新会话开场自动继承项目 active 决策与全局偏好
- 与底座同仓库零污染：事件写 `~/.thread/projects/<项目键>/events.db`，项目目录无 DB

## 安装（一条命令）

```sh
dsh plugin add dsh-thread
```

零配置：`@thread/core` + `better-sqlite3` 依赖随包解决，插件激活后自动采集 + 注入。

## 启用（profile）

dsh 所有插件都要在 profile 的 bundles 里引用才生效（dsh 通用流程）。在 `~/.dsh/profiles/<你的 profile>/package.json`：

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

若要在会话内/Web UI 使用 `query_session_memory` 工具，在 profile 的 `cordis.patch.yml` 加 MCP overlay：

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

## 会话临时隔离（B⑧）

同项目双代理并行做不相关工作时，用自然语言（"隔离/静默/别打扰"）或 `/isolate` 隔离本会话——对话上下文（消息/决策/反馈）仅自己可见，状态卡只列本会话内容（不被其他代理更新干扰）；工具事件仍共享。`/unisolate` 解除（历史仍隔离），`/thread-publish <goal|decision|feedback> <id>` 或自然语言"把这个决策共享出去"按需沉淀转共享。

## 版本约束

钉 dsh `0.1.0-rc.6`（peer 依赖）；跟随 dsh release train 适配，compat 矩阵见 CI。
