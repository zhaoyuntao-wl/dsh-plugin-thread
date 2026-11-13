---
"dsh-thread": minor
---

证据门接入（P0-2）：

- 新增 MCP 工具 `verify`：逐条跑验收命令、落证据（命令 + 退出码 + 环境指纹 + commit），返回 `passed / failed / missing-env` 与当前进度行；
- 状态卡在登记过验收条目的项目上多一行「验收 X/Y 已证（缺：…）」；
- `/thread-panel` 增加「验收证据」区块：进度 + 最近条目（✓/✗、exit、命令）。

core dep: `@thread-memory/core` ≥（带来：`verifyCriteria` / `progressFor` / `renderEvidenceLine` 与 `evidence` 表）。
