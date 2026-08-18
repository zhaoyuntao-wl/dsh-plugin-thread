---
"dsh-thread": patch
---

修复 `dsh plugin add` 后插件加载失败：bundle patch 的 insert 条目补 `config: {}`（插件有 Config zod schema，patch 无 config 字段时 Cordis 校验失败）。同时补 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`（pnpm v10 下 better-sqlite3 原生模块构建授权）。
