---
"dsh-thread": patch
---

`/thread-panel` 改为**从磁盘解析最近活跃会话**，不再依赖进程内状态：

- 背景：重启后未开新会话时，命令 handler 所在进程里 `pre-step` 记录可能不存在（跨进程/顺序差异），面板因此落到 fallback 空桶；
- 做法：扫描 `<THREAD_ROOT>/projects/*/events.db`，按事件 `ts` 取最新一条的 `session_id` 与 `project_key`，用该键取库；
- 解析顺序：命令上下文 sid → 本进程 pre-step 记录 → 磁盘最近活跃会话；三者都以项目键为准取事件桶。
