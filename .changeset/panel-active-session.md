---
"dsh-thread": patch
---

修复 `/thread-panel` 数据为空（目标 0 / 最近事件 0 / 无注入回执）：

- 根因：命令上下文里 `inv.agent.session` 不存在，sid 为空 → 面板落在默认桶、查不到本会话；
- 修法：`agent/pre-step` 记下最近活跃会话 id，命令侧 sid 为空时用它（该 sid 在 scope 缓存里已有项目键，能落到正确的库）；
- 上一版的 `getRecentSessionId` 兜底只在同一库内有意义，换成活跃会话 id 后可达。
