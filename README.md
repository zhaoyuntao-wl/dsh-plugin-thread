# dsh-thread

Thread 会话记忆的 dsh 旗舰插件——**确定性无损采集**（订阅 `session/event` 写双库）+ **状态卡注入**（`agent/pre-step` 每轮提醒）+ **MCP 查询**（`query_session_memory`）。

- 决策不丢、目标不漂移、不重复提问
- 跨压缩边界保真：状态卡 O(1) 常驻，细节按需检索回拉
- 跨会话继承：新会话开场自动继承项目 active 决策与全局偏好
- 与底座同仓库零污染：事件写 `~/.thread/projects/<项目键>/events.db`，项目目录无 DB

## 安装（一条命令）

```sh
dsh plugin add dsh-thread
```

零配置：`better-sqlite3` 依赖随包解决，插件激活后自动采集 + 注入。

## 版本约束

钉 dsh `0.1.0-rc.6`（peer 依赖）；跟随 dsh release train 适配，compat 矩阵见 CI。

## 查询

会话内模型可经 MCP overlay 调 `query_session_memory`（安装 `thread-mcp` 或复用 profile 内 MCP 条目），或任意 MCP 客户端直连。
