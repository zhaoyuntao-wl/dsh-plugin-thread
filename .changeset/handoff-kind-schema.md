---
"dsh-thread": patch
---

修复 `query_session_memory kind=handoff` 在工具 schema 层被拒：MCP 与原生工具的 `kind` 枚举补上 `handoff`（core 1.1.0 起运行侧已支持，只是声明未跟进）。1.8.0 发布后 E2E 实测发现。
