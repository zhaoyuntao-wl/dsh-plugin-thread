---
"dsh-thread": patch
---

修复 `/thread-panel` 在命令上下文里拿不到 `agent.session` 时退化成空会话视图（`目标 0 / 最近事件 0`，只剩项目共享决策）：

- 命令侧 sid 为空时退回该库最近活跃会话（`getRecentSessionId`），与 `agent/pre-step` 注入时使用的会话一致；
- 面板的「本轮注入」回执依赖同一 sid，此修复后应能显示本会话的注入记录。
