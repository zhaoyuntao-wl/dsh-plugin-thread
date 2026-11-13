# dsh-thread

## 1.11.6

### Patch Changes

- 0a7d716: `/thread-panel` 磁盘解析改为**直接打开扫到的 events.db**：
  
  - 旧事件行的 `project_key` 可能为空，按项目键反解会退回 fallback 空桶（面板显示 0 事件 / 0 目标）；
  - 现在命中磁盘时用该桶的 `eventsPath` 直接建 store，不再依赖键解析；
  - 已验证：同一逻辑预演可取出本会话最近事件（`tool_call`/`tool_result`），面板不再空。

## 1.11.5

### Patch Changes

- 9c90c66: `/thread-panel` 改为**从磁盘解析最近活跃会话**，不再依赖进程内状态：
  
  - 背景：重启后未开新会话时，命令 handler 所在进程里 `pre-step` 记录可能不存在（跨进程/顺序差异），面板因此落到 fallback 空桶；
  - 做法：扫描 `<THREAD_ROOT>/projects/*/events.db`，按事件 `ts` 取最新一条的 `session_id` 与 `project_key`，用该键取库；
  - 解析顺序：命令上下文 sid → 本进程 pre-step 记录 → 磁盘最近活跃会话；三者都以项目键为准取事件桶。

## 1.11.4

### Patch Changes

- 5b3fe3a: 修复 `/thread-panel` 落在空桶（目标 0 / 最近事件 0 / 无回执）：
  
  - 证据：过滤条件 `(session_id = ? OR isolation = 0)` 都查不到事件 → 该库根本没有事件行；决策却能显示（决策在全局 `structured.db`），说明面板拿到的是**空事件桶**；
  - 根因：命令上下文只有 fallback 的 store，`deps.storeFor(sid)` 解析不到会话项目键；上一版的 `getRecentSessionId` 与活跃会话 id 都不改变桶；
  - 修法：`agent/pre-step` 同时记下**项目键**，`/thread-panel` 直接用该键取 store（与注入同桶），会话 id 仍用于目标/事件/回执过滤。

## 1.11.3

### Patch Changes

- 582d426: 修复 `/thread-panel` 数据为空（目标 0 / 最近事件 0 / 无注入回执）：
  
  - 根因：命令上下文里 `inv.agent.session` 不存在，sid 为空 → 面板落在默认桶、查不到本会话；
  - 修法：`agent/pre-step` 记下最近活跃会话 id，命令侧 sid 为空时用它（该 sid 在 scope 缓存里已有项目键，能落到正确的库）；
  - 上一版的 `getRecentSessionId` 兜底只在同一库内有意义，换成活跃会话 id 后可达。

## 1.11.2

### Patch Changes

- d4945f1: 修复 `/thread-panel` 在命令上下文里拿不到 `agent.session` 时退化成空会话视图（`目标 0 / 最近事件 0`，只剩项目共享决策）：
  
  - 命令侧 sid 为空时退回该库最近活跃会话（`getRecentSessionId`），与 `agent/pre-step` 注入时使用的会话一致；
  - 面板的「本轮注入」回执依赖同一 sid，此修复后应能显示本会话的注入记录。

## 1.11.1

### Patch Changes

- ba75321: 跟随 core 1.5.1 修复：旧库缺 `handoffs` 表导致 `/thread-panel` 与 `handoff_next` 报 `no such table: handoffs`（`SCHEMA_VERSION` 未随建表升级，`ensureSchema` 快速短路跳过迁移）。
  
  core dep: `@thread-memory/core` `^1.5.1`（带来：schema 10 迁移，旧库打开即补建 `handoffs`）。

## 1.11.0

### Minor Changes

- ca27f0e: 「本轮注入了什么」回执（P0-0 收口）：
  
  - 首轮锚定 / 状态卡注入后记录回执（`kind=anchor|status-card`，含注入文本长度）；
  - 首次投递交接时记录回执（`kind=handoff`，含交接 id、目标角色与 brief 目标）；
  - 回执只存摘要，`/thread-panel` 与 `thread_panel` 的「本轮注入」区块直接展示；
  - 回执写入失败一律 fail-open，不影响注入本身。
  
  core dep: `@thread-memory/core` `^1.5.0`（带来：`recordInjection` / `lastInjection`，及面板「本轮注入」区块）。

## 1.10.0

### Minor Changes

- 441e25b: 可见性（P0-0 第一步）：
  
  - 新命令 `/thread-panel`：只读状态面板——目标 / 决策链（含 `superseded → #id` 取代关系）/ 未决 / 交接（未确认，含 from/to）/ 最近事件；
  - MCP 工具新增 `thread_panel`（`session_id`、`limit`）：编排器与演示脚本可直接取同一份文本视图；
  - 渲染逻辑在 core（`renderPanel`），命令与 MCP 共用同一实现。
  
  core dep: `@thread-memory/core` `^1.4.0`（带来：`renderPanel` 只读面板渲染器）。

## 1.9.1

### Patch Changes

- 1d10d58: 示例修正与发布版一致性：
  
  - `examples/orchestrator-handoff.mjs` 改为确定性示例（用 core API 复现「分析段已完成」的状态），演示编排器领取 → 结构化 brief → 接收方实际收到的文本 → `ack` → 再次领取 `not-found` 的完整契约；不依赖模型调用，可离线重复；
  - 原因：示例原先直接驱动 `dsh` 传任务文本，在 Windows 下受命令行引号契约影响不稳定，而「怎么启动 agent」本就属于编排器职责，不属于交接契约。

## 1.9.0

### Minor Changes

- d69053b: handoff 面向编排器的接入完善：
  
  - `handoff_next` 改为**原子领取**（单条 `UPDATE … RETURNING`，领取即 `delivered`）——并发 worker 不会拿到同一条；工具描述同步更新；
  - `handoff_ack` 幂等（重复确认仍成功）；
  - README 中英新增「交接（给编排器）」一节：两步接入、契约保证、实测数据；
  - 新增可跑示例 `examples/orchestrator-handoff.mjs`（分析 → 交接领取 → 开发开局 → ack 全流程）；
  - `/thread-handoff` 命令补进命令表。
  
  core dep: `@thread-memory/core` `^1.3.0`（带来：`claimHandoff` 原子领取、`ack` 幂等）。

## 1.8.1

### Patch Changes

- bcc7b18: 修复 `query_session_memory kind=handoff` 在工具 schema 层被拒：MCP 与原生工具的 `kind` 枚举补上 `handoff`（core 1.1.0 起运行侧已支持，只是声明未跟进）。1.8.0 发布后 E2E 实测发现。

## 1.8.0

### Minor Changes

- 01b1659: handoff 三动词接入（P0-1 补全，设计 v2 §1.4b.7）：
  
  - MCP 工具新增 `propose_handoff`（模型/外部提议交接）、`handoff_next`（编排器按 `task_id`/`role` 取待投递交接，只读）、`handoff_ack`（确认消费）；
  - 原生工具新增 `propose_handoff`：模型在会话中可主动提议交接（以当前状态为底，可覆盖目标/下一步/产物指针）；
  - 编排器接入字段：`THREAD_TASK_ID` / `THREAD_ROLE` 环境变量——收尾生成的交接带 `task_id`/`from_role`，首轮投递按 `THREAD_ROLE` 匹配 `to_role`（未声明时按项目寻址，行为与 1.7.0 一致）；
  - 红线不变：不调度、不启动、不重试。
  
  core dep: `@thread-memory/core` `^1.2.0`（带来：`proposeHandoff` / `nextHandoff` / `ackHandoff`）。

## 1.7.0

### Minor Changes

- f101db4: 接入 handoff 交接原语（P0-1，设计 v2 §1.4b.3 / §1.4b.7）：
  
  - 收尾即生成：`session/disposed` 时调用 `createCloseOutHandoff` 生成 close-out 交接（事件是主路径，命令只是手动覆盖）；
  - 首轮投递：新会话首个 turn 注入一条待投递 brief（一次、幂等），并标记 `delivered`；
  - 新命令 `/thread-handoff [target]`（无参按 project 寻址，`target` 作为 `to_role`）；
  - 状态卡由 core 披露「交接（N 条待投递）」。
  
  core dep: `@thread-memory/core` `^1.1.0`（带来：handoffs 表、brief 生成器、`kind=handoff` 查询）。

## 1.6.2

### Patch Changes

- ddc51c8: 修复项目键解析读错字段：dsh 0.2.x 的 `Session` 暴露 `header.cwd`，不存在 `meta.cwd`；旧实现读 `meta.cwd` 永远落空并静默退回进程 cwd，导致同一 dsh 进程下不同工作区的会话共用同一个桶（跨工作区串桶、状态卡出现其他项目决策）。现按 `header.cwd`（兼容 `meta.cwd`）解析会话工作区。

## 1.6.1

### Patch Changes

- 35230d5: 文档：兼容性声明更新到 dsh **0.2.2-rc.1**（README 中英两份：verified 版本、SDK peer `^0.2.2-rc.1`、cordis `^4.1.0`），CI compat matrix 同步改为 `0.2.2-rc.1`。无代码变更。

## 1.6.0

### Minor Changes

- f0d48b9: 支持 dsh **0.2.2-rc.1**：SDK peer 由 `^0.2.1-rc.2` 上移到 `^0.2.2-rc.1`，`@deepseek-ai/cordis` 提到 `^4.1.0`（0.2.2-rc.1 把 cordis 钉在 `~4.1.0`，留在 4.0.x 会形成 unmet peer）。devDependencies 钉精确 `0.2.2-rc.1`，避免预发布范围被解析到更新的 rc。
  
  代码变更一处：`batch0-probe.ts` 的 `user/message` 分支改用 `event.type` 直接判别（0.2.2 的 `SessionEvent` 联合类型收紧后，原先的手写窄化断言不可比较）。
  
  验证：`tsc -p tsconfig.build.json` 与全量 `typecheck` 对 0.2.2-rc.1 通过，96 项单测通过；隔离 live 探针（独立安装的 0.2.2-rc.1 CLI + 复制 profile + 临时 `THREAD_ROOT`）确认插件加载、事件采集、MCP 查询通道均正常。
  core dep: `@thread-memory/core` `^1.0.13`（本次未变，无核心能力变更）。

## 1.5.0

### Minor Changes

- b2fb20b: 支持 dsh **0.2.1-rc.2**：SDK peer 由 `^0.2.0-rc.2` 上移到 `^0.2.1-rc.2`，`@deepseek-ai/cordis` 提到 `^4.0.5`（0.2.1 的 SDK 包把 cordis 钉在 `~4.0.5`，留在 4.0.4 会形成 unmet peer）。跨过的这一版含多项开发者面变更（移除运行时 invariant 插件与各包 `./invariant` 导出、子路径插件不再读独立 `package.json`、输入区统计扩展拆成 `activity`/`usage`、Agent Team 消息直投 Inbox、移除工具展示 `both` 模式、agent-instructions 不再读逐行 dshHome 配置）；经类型探针（`tsc --noEmit` 对 0.2.1-rc.2 全绿）与隔离 live 探针逐接缝核实，**插件源码无需改动**。旧基线 0.2.0-rc.2 不再声明支持。
  
  core dep: `@thread-memory/core` `^1.0.13`（本次未变，无核心能力变更）。

## 1.4.1

### Patch Changes

- core 依赖下限抬到 `^1.0.13`。
  
  core dep: `@thread-memory/core` `^1.0.13`（带来：事件检索的**项目作用域过滤**——同一个事件库里残留的历史误键行不再进入本项目查询结果；显式点名会话时该会话的行仍可查，存量无键行仍可见）。这是 1.4.0 会话作用域修复的下半场：写入按会话工作区分桶（D1）、查询按会话定位桶（D2）之后，检索结果这一层也按项目过滤，跨工作区泄漏在四条路径上闭合。

## 1.4.0

### Minor Changes

- **查询作用域修复（2026-10-07，与 core 1.0.12 配套）**——此前的项目键取自**进程启动目录**，一个 dsh 进程服务的所有会话共用一个桶：
  
  - **采集/注入作用域跟随会话工作区**：项目键改由 dsh `Session.meta.cwd` 解析（`THREAD_CWD` 仍是最优先显式覆盖），并按项目键缓存 store。修复两类后果：跨工作区串桶（A 工作区会话的产出出现在 B 工作区会话的卡片/目录里）与同会话历史跨桶劈裂（同一会话的事件被写进两个桶）。
  - **MCP 查询通道按调用方会话定位所属桶**：`server.ts` 现在用 `core.locateSession()` 反查会话所在事件库，并用该桶的 `project_key` 做全部过滤；不带 `session_id` 时退化为本进程默认项目，**并在结果首行标注作用域**（此前无 project_key，目录视图一次列出全部项目的会话、结构化合并视图的项目过滤整体空转）。
  - **查询通道启动健壮性**：桶目录不存在时先建父目录（此前直接抛 `Cannot open database because the directory does not exist`，整个 MCP entry 激活失败）。
  
  **决策行溯源锚补齐（论坛反馈同源缺口）**：`/thread-reg dec` 与决策确认门确认落库这两条路径此前不传 `source_event`，渲染出来**没有** `（源#eN）`——"截断 + 无锚"同时出现时模型只剩行首 `#id`。现在两条路径都带锚（工具调用事件 / 用户消息事件），`record_decision` 的落库路径同源使用。
  
  **决策写作约定**：`record_decision` 工具描述与 core 行为契约都补一句"先写适用条件/例外、再写动作"，与 core 1.0.12 的"头+尾保留截断"形成双保险（约定是提示，截断策略是确定性防线）。
  
  core dep: `@thread-memory/core` `^1.0.12`（带来：状态卡行截断改头+尾保留、末尾整句优先——论坛反馈的"句尾适用条件被切掉"由此修复；新增 `locateSession()` 供本插件的会话作用域查询使用）。

## 1.3.0

### Minor Changes

- 支持 dsh **0.2.0-rc.2**（跨过 0.1.6 / 0.1.7 / 0.2.0 三个系列）：SDK peer 由 `^0.1.5-rc.1` 升到 `^0.2.0-rc.2`（cordis peer `^4.0.4`）。
  
  契约变化与适配（隔离类型探针 + 隔离 headless live 探针逐条实证）：
  
  - **消息来源不再有共享的 `plugin` kind**：0.2.0 的 `MessageSourceMap` 改为"按生产者合并扩展"的和类型，本插件在 `src/source-kind.ts` 声明自己的 kind（`dsh-thread` / `dsh-thread-b0` / `dsh-thread-b0-drill`）；注入源、自身注入识别、batch-0 探针全部改走新 kind。
  - **压缩 checkpoint 来源改为 `kind: 'compact-checkpoint'`**（原 `{ kind: 'plugin', plugin: 'compact' }`）：压缩摘要跳过逻辑随之更新；新增单测用官方 `isCompactCheckpointSource()` 交叉验证本地常量——官方改名会让测试变红，而不是静默失配。
  - **`ToolResultBlock` 已移除**：`tool/result` 的调用 id 由结果块字段上移到 `ToolResultMessage.toolCallId`，采集 meta 的 `call_id` 改读新位置。
  - **MCP 查询通道健壮性修复**（0.1.x 同样存在）：`dist/server.js` 在本进程 cwd 的桶目录不存在时抛 `Cannot open database because the directory does not exist`，整个查询 entry 激活失败；现与插件侧一致先建父目录。
  
  live 探针实证（0.2.0-rc.2 隔离 profile，`THREAD_ROOT` 指临时根）：插件激活并报告 core 版本、首轮锚定卡注入且被模型遵循、事件采集完整（含新 call_id）、harness 注入（`runtime-context` / `skill-catalog`）按 form 过滤不落库、自动压缩触发两次 `compact_checkpoint` 且压缩后重锚定卡送达、MCP `query_session_memory` 目录视图可用。
  
  0.1.x 不再声明支持（0.1.x 用户请留在 `dsh-thread@1.2.x`）。
  
  core dep: `@thread-memory/core` `^1.0.0`（本次 core 未改动；本地 profile 已刷新至 1.0.11）。

## 1.2.0

### Minor Changes

- 2bc5705: 支持 dsh **0.1.5-rc.1**：SDK peer 钉由 `^0.1.1-rc.2` 升到 `^0.1.5-rc.1`（本地验证链运行在 SDK 0.1.5-rc.2 + cordis 4.0.2 上）。跨过的 0.1.2 / 0.1.3 / 0.1.5 三个预览系列含多项插件 API 破坏性变更（`ctx.agent` 移除、`Session.events` 改为按需读取 API、`Inbox` 改为类型接口且 `hasPending`/`claim` 不再公共、`UserQuestionProvider`/`registerProvider` 移除改为 Agent 作用域瀑布、默认文件工具由 `str_replace_editor` 改为 `read`/`write`/`edit`），经类型探针与隔离 live 探针逐接缝核实，**插件源码无需改动**；旧基线 0.1.1-rc.2 及更早不再声明支持。
  
  配套修正：`COMPACT_CHECKPOINT_SOURCE_PLUGIN` 的注释原称该标记"跨包钉死、改名即编译错"——探针证实标记在官方包内是模块私有的，公共契约是 `compactCheckpointSource()`/`isCompactCheckpointSource()`，此处实为逐字复制的字符串，改注释为事实陈述。CI compat matrix 改为**真正按矩阵版本安装 SDK 后再 typecheck**（原先只设置了 `DSH_VERSION` 环境变量、没有任何安装动作，该门禁此前不产生验证力）。
  
  core dep: `@thread-memory/core` `^1.0.0`（本次未变，无核心能力变更；本地两 profile 已刷新至 1.0.11）。

## 1.1.1

### Patch Changes

- 8c10a30: 版本可见性：启动时日志报告解析到的 thread core 版本（`[dsh-thread] thread core vX.Y.Z`，嵌入式 MCP server 握手同步真实版本）；README 补升级路径（`dsh plugin add dsh-thread@latest`）。
  
  core dep: @thread-memory/core ≥1.0.9（THREAD_VERSION 真实版本修复）

## 1.1.0

### Minor Changes

- 2ee7d11: record_decision human-confirmation gate: decisions park in memory and pop a userQuestions dialog at the tool-turn (confirm / cancel with inline edit; user opinions on cancelled entries are appended to the event stream and queryable). No-UI environments and subagents auto-confirm. Structural changes (commands, isolation toggles, goal updates, confirmed decisions) refresh the status card immediately.

### Patch Changes

- 2ee7d11: Handle the live dsh compaction/summary payload shape: `summary` is a `ContentBlock[]`, not a string. Checkpoints now land in the event stream, so post-compact re-anchoring fires on real compactions instead of being silently dropped at the DB bind.
- 2ee7d11: Skip harness-injected messages so they never pollute the event stream: job-completion notices, workspace instructions, runtime-context snapshots, and skill-catalog updates are detected by their source `form` signal (probe-verified live shapes), with content-prefix heuristics as fallback. Injections no longer cancel pending decision confirmations; unknown shapes are logged to `capture-debug.log` for the probe.
- 2ee7d11: Sync `query_session_memory` tool descriptions (native tool and embedded MCP server) with the post-compact recall governance: query-first-by-default wording, and `nav=ls` without a target now documents the directory view (active-session full ids + current-session inventory counts).

## 1.0.2

### Patch Changes

- docs：新增「支持的 dsh 版本」章节（验证 0.1.1-rc.2 / 兼容策略 / CI compat matrix 更新）

## 1.0.1

### Patch Changes

- 发布卫生（构建层修复）：build 改用 tsconfig.build.json 排除测试产物（1.0.1 起 dist 不含任何 *.test.*）；batch0-probe 保留在包内（env 门控 THREAD_B0_PROBE=1，默认零行为，README 已注明）

## 1.0.0

### Major Changes

- 504250b: 命令全量重构：一套语法六个命令 + 模型决策工具（2026-08-21 用户定案）
  
  - **命令语法统一为「动词 + 资源 + 动作」**，六命令：`/thread-reg <ast|dec|fdb|gol>`（注册产出/决策/偏好·教训/目标，无 text 列资源行；dec 支持 `--supersedes <id>` 演化取代链）、`/thread-rev <ast|dec|fdb|gol> <ids|all>`（解除：dec/fdb/ast 删除、gol 走状态机废弃并自愈关联待办）、`/thread-cfm`（待处理收件箱：待办 `t#id` + 候选 `c#id` 命名空间，`do` 完成/转正可带修正文本、`cnl` 丢弃、`cnl all` 双清）、`/thread-pub <ast|dec|fdb|gol> <ids|all>`（隔离行转共享，无参列隔离行）、`/thread-iso` / `/thread-uniso`
  - **旧命令全量下线**（1.0 未发布不留别名）：thread-asset / thread-decision(-del) / thread-pending / thread-todo / thread-feedback(-del) / thread-publish / thread-isolate / thread-unisolate；自然语言副通道（隔离/静默/共享）保留
  - **`record_decision` 原生模型工具**：行为契约指示模型在用户定案或自己落定决策时调用；supersedes_id 可选；对用户不可见
  - **收件箱语义**：待办 = 本会话，候选 = 项目级（与状态卡候选唤醒视图一致）；候选转正与折叠卡片共用 store.promoteCandidate 单一路径
  - Qoder 适配器同步（capture.mjs 同语法命令族；assistant 文本不再分析）
  - **tool_result 采集修复（2026-08-21 dsh 升级探针发现）**：extractText 只认顶层 text 块，dsh 的 tool-result 块把文本嵌在 `content[].content[].text` → 生产库 tool_result body 全空（既有缺口，rc.6 与 0.1.1-rc.2 通吃）。改为递归下钻任意含 content 数组的块；升级探针实证 0.1.1-rc.2 下 tool_result 恢复捕获（1585 字符 JSON 全量入库）
  - **SDK 钉版本升 `^0.1.1-rc.2`**（dsh-agent/llm/session/tools/user-questions；0.1.1-rc.2 兼容性经全隔离契约探针 + typecheck 验证）
  - 单测 61 全绿（四解析器 + 四执行器 + 收件箱/资源/隔离渲染 + extractText 嵌套形状）

### Minor Changes

- a672681: 候选折叠卡片（§1.5.3d 通道一；2026-08-21 词汇校准为 更新/取消/推迟）
  
  - pre-step 检测到未提示过的决策候选 → `ctx.userQuestions.ask()` 对话内折叠卡片（fire-and-forget，不阻塞）
  - 三选项：更新（转正 active，经 store.promoteCandidate）/ 取消（丢弃）/ 推迟（保持 pending 等唤醒）
  - headless 无 UI 环境降级走状态卡计数通道（通道二）
  - 选项处理抽为 `handlePendingAnswer` 导出（可单测）
  - 新增 peer 依赖 @deepseek-ai/dsh-user-questions（^0.1.0-rc.6）
  - 单测 +4（更新/取消/推迟/未知选项）

### Patch Changes

- 12396b1: 修复：dsh 压缩事件未采集 → post-compact 情境在 dsh 上从未触发（L1 压缩边界回归缺口）
  
  - `compaction/summary` → 写 `compact_checkpoint`（body=摘要全文，meta=trigger manual/auto + model + compactionId，origin 幂等防重放）
  - 跳过 dsh 压缩 checkpoint 摘要 `user/message`（`isCompactCheckpointSource`，source.plugin='compact'）：避免摘要被重复采成普通用户消息、避免摘要被 applyAnalysis 当用户话语分析出假决策候选
  - 此前 `compaction/*` 四类事件全落 session/event 的 `default` 分支被丢弃，`detectSituation` 判定 post-compact 依赖 `compact_checkpoint` 事件 → 压缩边界回归块从未出现过（2026-08-18 实机发现：dsh 自动压缩后仅摘要以 user_message 落库，无 checkpoint 标记）
  - 单测 +7（handleCompactionSummary 4 + isCompactCheckpointSource 3）
- 15c2f8d: 修复 `dsh plugin add` 后插件加载失败：bundle patch 的 insert 条目补 `config: {}`（插件有 Config zod schema，patch 无 config 字段时 Cordis 校验失败）。同时补 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`（pnpm v10 下 better-sqlite3 原生模块构建授权）。
