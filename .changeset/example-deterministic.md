---
"dsh-thread": patch
---

示例修正与发布版一致性：

- `examples/orchestrator-handoff.mjs` 改为确定性示例（用 core API 复现「分析段已完成」的状态），演示编排器领取 → 结构化 brief → 接收方实际收到的文本 → `ack` → 再次领取 `not-found` 的完整契约；不依赖模型调用，可离线重复；
- 原因：示例原先直接驱动 `dsh` 传任务文本，在 Windows 下受命令行引号契约影响不稳定，而「怎么启动 agent」本就属于编排器职责，不属于交接契约。
