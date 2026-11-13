---
"dsh-thread": minor
---

支持 dsh **0.2.2-rc.1**：SDK peer 由 `^0.2.1-rc.2` 上移到 `^0.2.2-rc.1`，`@deepseek-ai/cordis` 提到 `^4.1.0`（0.2.2-rc.1 把 cordis 钉在 `~4.1.0`，留在 4.0.x 会形成 unmet peer）。devDependencies 钉精确 `0.2.2-rc.1`，避免预发布范围被解析到更新的 rc。

代码变更一处：`batch0-probe.ts` 的 `user/message` 分支改用 `event.type` 直接判别（0.2.2 的 `SessionEvent` 联合类型收紧后，原先的手写窄化断言不可比较）。

验证：`tsc -p tsconfig.build.json` 与全量 `typecheck` 对 0.2.2-rc.1 通过，96 项单测通过；隔离 live 探针（独立安装的 0.2.2-rc.1 CLI + 复制 profile + 临时 `THREAD_ROOT`）确认插件加载、事件采集、MCP 查询通道均正常。
core dep: `@thread-memory/core` `^1.0.13`（本次未变，无核心能力变更）。
