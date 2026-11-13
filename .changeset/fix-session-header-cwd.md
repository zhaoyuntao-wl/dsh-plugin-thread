---
"dsh-thread": patch
---

修复项目键解析读错字段：dsh 0.2.x 的 `Session` 暴露 `header.cwd`，不存在 `meta.cwd`；旧实现读 `meta.cwd` 永远落空并静默退回进程 cwd，导致同一 dsh 进程下不同工作区的会话共用同一个桶（跨工作区串桶、状态卡出现其他项目决策）。现按 `header.cwd`（兼容 `meta.cwd`）解析会话工作区。
