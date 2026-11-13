---
"dsh-thread": minor
---

「本轮注入了什么」回执（P0-0 收口）：

- 首轮锚定 / 状态卡注入后记录回执（`kind=anchor|status-card`，含注入文本长度）；
- 首次投递交接时记录回执（`kind=handoff`，含交接 id、目标角色与 brief 目标）；
- 回执只存摘要，`/thread-panel` 与 `thread_panel` 的「本轮注入」区块直接展示；
- 回执写入失败一律 fail-open，不影响注入本身。

core dep: `@thread-memory/core` `^1.5.0`（带来：`recordInjection` / `lastInjection`，及面板「本轮注入」区块）。
