---
"dsh-thread": minor
---

handoff 三动词接入（P0-1 补全，设计 v2 §1.4b.7）：

- MCP 工具新增 `propose_handoff`（模型/外部提议交接）、`handoff_next`（编排器按 `task_id`/`role` 取待投递交接，只读）、`handoff_ack`（确认消费）；
- 原生工具新增 `propose_handoff`：模型在会话中可主动提议交接（以当前状态为底，可覆盖目标/下一步/产物指针）；
- 编排器接入字段：`THREAD_TASK_ID` / `THREAD_ROLE` 环境变量——收尾生成的交接带 `task_id`/`from_role`，首轮投递按 `THREAD_ROLE` 匹配 `to_role`（未声明时按项目寻址，行为与 1.7.0 一致）；
- 红线不变：不调度、不启动、不重试。

core dep: `@thread-memory/core` `^1.2.0`（带来：`proposeHandoff` / `nextHandoff` / `ackHandoff`）。
