---
"dsh-thread": patch
---

面板统一按项目合并，修新会话显示「生效 0 / 目标 0」：

- MCP 工具 `thread_panel` 之前完全没传 `projectKey`，同一个会话的面板会显示「目标 0 · 生效 0 · 缺少项目键，无法计算验收进度」，与状态卡、`/thread-panel` 命令三处口径不一致（2026-11-14 实测）；
- 现在与 `verify` 工具同一套解析（`scope.projectKey ?? deriveProjectKey(THREAD_CWD ?? cwd)`），命令版磁盘兜底路径也补上 `projectKey`；
- 配套 core dep：`@thread-memory/core` ≥1.6.1（带来：`getDecisionsMerged`，面板决策链按项目合并）。
