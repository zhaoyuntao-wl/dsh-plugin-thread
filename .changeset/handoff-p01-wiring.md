---
"dsh-thread": minor
---

接入 handoff 交接原语（P0-1，设计 v2 §1.4b.3 / §1.4b.7）：

- 收尾即生成：`session/disposed` 时调用 `createCloseOutHandoff` 生成 close-out 交接（事件是主路径，命令只是手动覆盖）；
- 首轮投递：新会话首个 turn 注入一条待投递 brief（一次、幂等），并标记 `delivered`；
- 新命令 `/thread-handoff [target]`（无参按 project 寻址，`target` 作为 `to_role`）；
- 状态卡由 core 披露「交接（N 条待投递）」。

core dep: `@thread-memory/core` `^1.1.0`（带来：handoffs 表、brief 生成器、`kind=handoff` 查询）。
