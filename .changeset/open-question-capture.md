---
"dsh-thread": minor
---

阻塞性问题采集（P0-3 接线）：

- 采集 `ask_user_question` 的 `tool/call` 事件 → `open_questions` 收件箱（`call_id` + 原始 questions JSON，不解析自然语言）；
- 对应 `tool/result` 到达 → 该问题标记 `settled` 并留存答案摘要（出队，不再计入待答）；
- 超时不静默：`open_questions` 停留 `open`，由 core 的 `markTimedOut` 把模型假设落成待确认候选；
- 状态卡与 `/thread-panel` 分别显示「待答问题 N 条」与「待答问题」区块。

core dep: `@thread-memory/core` ≥（带来：`open_questions` 表、`recordOpenQuestion` / `settleOpenQuestion` / `markTimedOut`）。
