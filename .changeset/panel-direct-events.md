---
"dsh-thread": patch
---

`/thread-panel` 磁盘解析改为**直接打开扫到的 events.db**：

- 旧事件行的 `project_key` 可能为空，按项目键反解会退回 fallback 空桶（面板显示 0 事件 / 0 目标）；
- 现在命中磁盘时用该桶的 `eventsPath` 直接建 store，不再依赖键解析；
- 已验证：同一逻辑预演可取出本会话最近事件（`tool_call`/`tool_result`），面板不再空。
