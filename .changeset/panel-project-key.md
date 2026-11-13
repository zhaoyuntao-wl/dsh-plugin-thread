---
"dsh-thread": patch
---

修复 `/thread-panel` 落在空桶（目标 0 / 最近事件 0 / 无回执）：

- 证据：过滤条件 `(session_id = ? OR isolation = 0)` 都查不到事件 → 该库根本没有事件行；决策却能显示（决策在全局 `structured.db`），说明面板拿到的是**空事件桶**；
- 根因：命令上下文只有 fallback 的 store，`deps.storeFor(sid)` 解析不到会话项目键；上一版的 `getRecentSessionId` 与活跃会话 id 都不改变桶；
- 修法：`agent/pre-step` 同时记下**项目键**，`/thread-panel` 直接用该键取 store（与注入同桶），会话 id 仍用于目标/事件/回执过滤。
