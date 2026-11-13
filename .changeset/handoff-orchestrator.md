---
"dsh-thread": minor
---

handoff 面向编排器的接入完善：

- `handoff_next` 改为**原子领取**（单条 `UPDATE … RETURNING`，领取即 `delivered`）——并发 worker 不会拿到同一条；工具描述同步更新；
- `handoff_ack` 幂等（重复确认仍成功）；
- README 中英新增「交接（给编排器）」一节：两步接入、契约保证、实测数据；
- 新增可跑示例 `examples/orchestrator-handoff.mjs`（分析 → 交接领取 → 开发开局 → ack 全流程）；
- `/thread-handoff` 命令补进命令表。

core dep: `@thread-memory/core` `^1.3.0`（带来：`claimHandoff` 原子领取、`ack` 幂等）。
