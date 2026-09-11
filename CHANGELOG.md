# dsh-thread

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
