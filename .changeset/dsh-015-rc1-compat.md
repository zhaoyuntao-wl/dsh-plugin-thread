---
"dsh-thread": minor
---

支持 dsh **0.1.5-rc.1**：SDK peer 钉由 `^0.1.1-rc.2` 升到 `^0.1.5-rc.1`（本地验证链运行在 SDK 0.1.5-rc.2 + cordis 4.0.2 上）。跨过的 0.1.2 / 0.1.3 / 0.1.5 三个预览系列含多项插件 API 破坏性变更（`ctx.agent` 移除、`Session.events` 改为按需读取 API、`Inbox` 改为类型接口且 `hasPending`/`claim` 不再公共、`UserQuestionProvider`/`registerProvider` 移除改为 Agent 作用域瀑布、默认文件工具由 `str_replace_editor` 改为 `read`/`write`/`edit`），经类型探针与隔离 live 探针逐接缝核实，**插件源码无需改动**；旧基线 0.1.1-rc.2 及更早不再声明支持。

配套修正：`COMPACT_CHECKPOINT_SOURCE_PLUGIN` 的注释原称该标记"跨包钉死、改名即编译错"——探针证实标记在官方包内是模块私有的，公共契约是 `compactCheckpointSource()`/`isCompactCheckpointSource()`，此处实为逐字复制的字符串，改注释为事实陈述。CI compat matrix 改为**真正按矩阵版本安装 SDK 后再 typecheck**（原先只设置了 `DSH_VERSION` 环境变量、没有任何安装动作，该门禁此前不产生验证力）。

core dep: `@thread-memory/core` `^1.0.0`（本次未变，无核心能力变更；本地两 profile 已刷新至 1.0.11）。
