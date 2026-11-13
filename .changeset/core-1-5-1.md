---
"dsh-thread": patch
---

跟随 core 1.5.1 修复：旧库缺 `handoffs` 表导致 `/thread-panel` 与 `handoff_next` 报 `no such table: handoffs`（`SCHEMA_VERSION` 未随建表升级，`ensureSchema` 快速短路跳过迁移）。

core dep: `@thread-memory/core` `^1.5.1`（带来：schema 10 迁移，旧库打开即补建 `handoffs`）。
