---
"dsh-thread": minor
---

可见性（P0-0 第一步）：

- 新命令 `/thread-panel`：只读状态面板——目标 / 决策链（含 `superseded → #id` 取代关系）/ 未决 / 交接（未确认，含 from/to）/ 最近事件；
- MCP 工具新增 `thread_panel`（`session_id`、`limit`）：编排器与演示脚本可直接取同一份文本视图；
- 渲染逻辑在 core（`renderPanel`），命令与 MCP 共用同一实现。

core dep: `@thread-memory/core` `^1.4.0`（带来：`renderPanel` 只读面板渲染器）。
