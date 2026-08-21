# dsh-thread

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
