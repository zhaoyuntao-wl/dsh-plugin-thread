---
"dsh-thread": minor
---

支持 dsh **0.2.1-rc.2**：SDK peer 由 `^0.2.0-rc.2` 上移到 `^0.2.1-rc.2`，`@deepseek-ai/cordis` 提到 `^4.0.5`（0.2.1 的 SDK 包把 cordis 钉在 `~4.0.5`，留在 4.0.4 会形成 unmet peer）。跨过的这一版含多项开发者面变更（移除运行时 invariant 插件与各包 `./invariant` 导出、子路径插件不再读独立 `package.json`、输入区统计扩展拆成 `activity`/`usage`、Agent Team 消息直投 Inbox、移除工具展示 `both` 模式、agent-instructions 不再读逐行 dshHome 配置）；经类型探针（`tsc --noEmit` 对 0.2.1-rc.2 全绿）与隔离 live 探针逐接缝核实，**插件源码无需改动**。旧基线 0.2.0-rc.2 不再声明支持。

core dep: `@thread-memory/core` `^1.0.13`（本次未变，无核心能力变更）。
