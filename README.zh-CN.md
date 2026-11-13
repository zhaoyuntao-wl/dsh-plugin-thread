# dsh-thread

[![CI](https://github.com/zhaoyuntao-wl/dsh-plugin-thread/actions/workflows/ci.yml/badge.svg)](https://github.com/zhaoyuntao-wl/dsh-plugin-thread/actions/workflows/ci.yml)

Thread 面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**深度集成**插件——
带血缘的编码 Agent 会话记忆，全程使用底座原生通道。

## 功能

- **无损采集**——订阅 `session/event`，完整事件流水落双 SQLite 库，稳定 origin 幂等去重。
- **三触发结构性送达**——首轮锚定（项目身份 + 行为契约 + 状态卡）、每次压缩后重锚定、每回合边界的跨代理状态增量。无每轮状态卡噪音。设计沿确定性日志的记忆研究方向（如 arXiv:2605.21997《The Log is the Agent》）；压缩重锚定针对「Compaction Cliff」失效模式（arXiv:2608.22752）。
- **原生查询工具**——`query_session_memory` 经 `ctx.tools.register` 注册进模型工具面，支持文件系统式导航 `ls` / `cd` / `cat` / `grep`；内嵌 MCP server 保留为回退通道。检索为无损流水上的确定性 BM25（中文 jieba 分词）+ 引用回拉——默认零 embedding 依赖；可在集成边界加 hybrid 层（以回归集对照 BM25 基线评估，不打包）。
- **行为契约技能**——`thread` 技能注册进底座技能目录（"需要细节就调工具"）并在锚点注入，模型不必"记得自己有记忆"。
- **产出识别**——write/edit 类工具写出的 markdown 文档在写时登记为产出并建血缘边；`/thread-reg ast` 覆盖显式登记。
- **决策与偏好的显式通道**——决策经 `/thread-reg dec`（用户，`--supersedes <id>` 演化取代链）或模型的 `record_decision` 工具（行为契约指示模型：用户定案或自己落定决策时调用）记录；偏好/教训经 `/thread-reg fdb` 记录（"不要/别"句式自动分类为教训）。决策/偏好的自然语言判定已停用——文本启发式零误报；未显式记录的仍留在事件流水可回拉（目标判定与完成判定保留，带多行粘贴守卫）。
- **只读状态面板——模型"以为"的东西，按需可见**——`/thread-panel`（及 `thread_panel` MCP 工具）渲染目标、决策链（含取代关系）、未决、交接、本轮注入回执、验收证据与最近事件；作用域是**本会话 + 所属项目**（与状态卡同一份合并口径，新会话也能看到项目里已定的决策，只有事件列表与注入回执按会话取）；回执行回答"这一轮到底喂了什么"，面板从磁盘解析会话所在桶，因此在拿不到 agent 对象的命令上下文里也成立。
- **证据门——"做完了"必须有证据**——验收不是声明而是执行证据：`verify` 逐条跑命令，把命令 + 退出码 + 环境指纹 + commit 落进 `evidence` 表，返回 `passed` / `failed` / `missing-env`（没有命令 = 缺环境，永不算通过）。验收条目未证时**拒绝**把目标标完成，并回告缺哪几条；会话关闭时会**自动重跑**已登记条目，交接里带的是刚测出的结论而不是上一轮的旧判断。
- **阻塞性问题入库**——`ask_user_question` 调用带 `call_id` 落 `open_questions`；真实回答置 `settled`，超时（按底座文档化的 `pendingNotice` 文案判定，不猜关键字）记 `timed_out`——"它替你决定了"这件事保持可见，不会被抹成"已回答"。
- **收尾沉淀 + 收件箱**——收尾词把进行中目标沉淀为待办；`/thread-cfm` 是唯一待处理收件箱：待办（`t#id`）与候选（`c#id`）一个视图——`do` 完成/转正（候选可带修正文本）、`cnl` 丢弃、`cnl all` 双清。状态卡展示前几条候选，杜绝无声堆积。
- **行为边界（1.0，直说）**——候选不会自动产出：决策/偏好的自然语言判定已停用，`c#` 条目只会显示存量遗留，直到发布后的抽取层上线；待办相反有活跃产出（收尾沉淀 + 目标完成自愈）。决策不会自行过期——时间性决策用 `--supersedes` 显式收口。目标完成判定偏保守（非 ASCII ≥4 连字符 / 纯 ASCII ≥8 连字符重叠；短英文目标宁漏勿误，用 `/thread-rev gol` 废弃）。完整清单见 [Thread README](https://github.com/zhaoyuntao-wl/Thread) 的「诚实边界」一节。
- **资源解除**——`/thread-rev <ast|dec|fdb|gol> <ids|all>` 解除注册：决策/偏好/产出删除（事件流水保留原文）、目标走状态机废弃并同步自愈关联待办。每条结构化行在状态卡上带可见 `#id`，记忆全程可人工编辑。
- **会话隔离**——`/thread-iso` / `/thread-uniso`；`/thread-pub <ast|dec|fdb|gol> <ids|all>` 把隔离期产生的行转共享。
- **可选主动压缩**——`THREAD_AUTO_COMPACT=1` 时插件在回合边界监控 token 压力并静默触发 `compactNow`；无论哪种方式压缩，状态都会在压缩后重锚定。

> 完整使用说明：[中文手册](./docs/manual.zh-CN.md) · [English](./docs/manual.md)。

## 支持的 dsh 版本

- **本地优先、零常驻**——一切进程内运行：内嵌 SQLite 存储、无后台服务、无云端依赖。同机 web/headless profile 共享同一存储，离线会话行为一致。
- **已验证**：dsh **0.2.2-rc.1**（当前；CLI 与其 SDK 子包同版锁步发布）。**0.1.x 不再声明支持**——dsh 0.2.0 取消了共享的 `plugin` 消息来源，改为"每个生产者声明自己的 `MessageSourceMap` kind"，本插件已按新契约声明；0.1.x 用户请留在 `dsh-thread@1.2.x`。
- 插件钉 SDK peer `^0.2.2-rc.1`（dsh-tools / dsh-agent / dsh-session / dsh-user-questions），`@deepseek-ai/cordis` 钉 `^4.1.0`（dsh 0.2.2-rc.1 把 cordis 钉在 `~4.1.0`）；每次升级经隔离契约探针（对已发布 SDK 做类型编译 + 隔离 headless profile live 跑一遍）+ CI compat matrix（`.github/workflows/ci.yml`）验证后才更新此表。
- 除已验证版本外不做承诺；每个新 dsh 版本经评估并扩展 matrix 后才声明支持。

## 安装

```sh
dsh plugin add dsh-thread
dsh plugin add dsh-thread@latest   # 升级：同命令重装最新版（core 经 ^1.0.0 依赖自动跟随）
```

插件经 `^1.0.0` 区间拉取内核（`@thread-memory/core`），新装与重装自动拿到最新 core；运行时启动日志报告解析到的 core 版本（`[dsh-thread] thread core vX.Y.Z`），内嵌 MCP server 亦在其握手中报告。

dsh 插件需在 profile 的 `bundles` 中引用才生效。在
`~/.dsh/profiles/<your-profile>/package.json`：

```json
{
  "name": "dsh-profile-my",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "dsh-thread"
      ]
    }
  }
}
```

除此之外零配置：`@thread-memory/core` 与 `better-sqlite3` 随依赖解析，插件激活即开始采集与注入。

> **注意（原生模块）**：若插件启动报 "Could not locate the bindings file"，
> 是 pnpm 10 在安装时跳过了 `better-sqlite3` 的构建脚本。在 profile 目录执行一条命令修复：
>
> ```sh
> cd ~/.dsh/profiles/<your-profile>
> pnpm rebuild better-sqlite3
> ```
>
> 这是 pnpm 10 的 `onlyBuiltDependencies` 策略，不是插件缺陷。

## 配置

| 配置 | 默认 | 含义 |
|---|---|---|
| `budgetLines` | 200 | 状态卡行数预算 |
| `feedbackRows` | 50 | 工具守卫查询的反馈行数 |
| `busyRetries` / `busyRetryDelayMs` | 20 / 100 | SQLITE_BUSY 重试策略 |
| `compactPressureTokens` | 0 | 主动压缩的 token 阈值（0 = 关；需 `THREAD_AUTO_COMPACT=1` 拉活压缩服务） |

## 命令

已注册为 dsh 真命令——命令面板可见、斜杠可补全、直接执行（不经模型一轮）。同样的文本在无命令 UI 的环境里按普通消息输入同样生效。

| 命令 | 作用 |
|---|---|
| `/thread-reg <ast\|dec\|fdb\|gol>` | 列出该资源行（rev/supersede 所需的 id 来源） |
| `/thread-reg <ast\|dec\|fdb\|gol> <text>` | 注册：ast = 路径（目录递归展开，上限 50）· dec = 决策（直接生效；`--supersedes <id>` 演化取代链）· fdb = 偏好/教训（"不要/别"句式自动分类）· gol = 目标 |
| `/thread-rev <ast\|dec\|fdb\|gol>` | 列出该资源行 |
| `/thread-rev <ast\|dec\|fdb\|gol> <ids\|all>` | 解除：dec/fdb/ast 删除（事件流水保留原文）· gol 废弃（状态机 + 关联待办自愈） |
| `/thread-cfm` | 待处理收件箱：待办（`t#id`）+ 候选（`c#id`） |
| `/thread-cfm do <id> [text]` | `t#` 完成待办 · `c#` 候选转正为生效决策（可带修正文本） |
| `/thread-cfm cnl <id>` / `cnl all` | 丢弃一条 / 清空收件箱 |
| `/thread-iso` / `/thread-uniso` | 隔离 / 解除会话 |
| `/thread-pub` | 列出隔离行（全部资源，id 来源） |
| `/thread-pub <ast\|dec\|fdb\|gol> <ids\|all>` | 隔离行转共享 |
| `/thread-handoff [target]` | 按本会话状态生成一条交接（可指定目标角色；不带参数按项目寻址） |
| `/thread-panel` | 只读面板：目标 · 决策链（含取代） · 未决 · 本轮注入回执 · 验收证据 · 交接 · 最近事件 |

## 证据门

验收是证据，不是声明：

```js
// 登记并执行验收条目（省略 criteria 则重跑已登记的条目）
await mcp.callTool({ name: "verify", arguments: { criteria: [
  { key: "unit-tests", command: "pnpm test" },
  { key: "lint",       command: "pnpm lint" },
] } });
// → 验收 1/2 已证（缺：lint）  + 每条 { status, exit, output, evidenceId }
```

- 每次执行都把命令、退出码、环境指纹与 commit 落进 `evidence`；面板按条目只显示最新一条。
- `checkCompletionGate` 在任一条目没有 passing 证据时**拒绝**把目标标完成，且拒绝会回告模型（`[Thread 证据门] 目标未标完成：#3 缺 lint`），不吞掉。
- 没有命令的条目是 `missing-env`：它会阻止完成，但永远不算证据。
- 交接 brief 因此多一行：`验收：验收 1/2 已证（缺：lint）`。

## 可见性与回执

状态卡是以底座 *instructions* 形式注入的，不显示为对话气泡。为了让"到底注入了什么"可审计，每次注入都写一条回执（`anchor | status-card | handoff` + 时间 + 摘要），面板渲染为「本轮注入」。卡片在注入那一刻从库里重建（从不缓存），并在决策确认、结构类命令、收尾沉淀、压缩后刷新，另外每轮 `agent/pre-step` 注入一次。

## 交接（给编排器）

Thread 负责把**状态**跨会话带过去：收尾的会话留下一条紧凑 brief（目标、至多三条生效决策、未决项、下一步、产物指针），接手的会话开局就带着它，不用从头摸索。

Thread **不做调度、不启动会话、不重试**——它是编排器脚下的状态底座，不是又一个编排器。

```js
// 启动 worker 时多给两个字段
env: { THREAD_TASK_ID: taskId, THREAD_ROLE: "dev" }

// 领取寻址到该 task/role 的交接（原子；领取即 delivered）
const { content } = await mcp.callTool({ name: "handoff_next", arguments: { task_id: taskId, role: "dev" } });
// → { id, status, brief: { goal, decisions[], open[], next[], artifacts[], conditions[] } }

// 消费完确认
await mcp.callTool({ name: "handoff_ack", arguments: { id } });
```

契约保证：领取是单条 `UPDATE … RETURNING`（两个 worker 不会拿到同一条）；同一目标重复生成幂等；`ack` 幂等；查询按项目键隔离；交接相关失败一律 fail-open，不阻塞 agent 主路径；brief 只放指针，正文留在文档层。

实测（2026-11-13，三臂 × 5 次，空工作区，同一份记忆）：

| | 推送交接 | 仅记忆 | 无 Thread |
|---|---|---|---|
| 召回前序已定方案 | **5/5** | 5/5 | 1/5 |
| 采用生产者策展的下一步 | **5/5** | **0/5** | 0/5 |
| 接手方查询次数 | **1.0** | 6.8 | 4.2 |
| 平均耗时 | **7s** | 15s | 12s |

细节见 [Thread 交接文档](https://github.com/zhaoyuntao-wl/Thread/blob/main/docs/design/handoff.md)。

## MCP 回退

包内附带 MCP server（`bin: dsh-thread`），在原生工具注册不可用的底座/场景下提供同一
`query_session_memory` 契约。见 [Thread 记忆协议](https://github.com/zhaoyuntao-wl/Thread/blob/main/docs/design/memory-protocol.md)。

## 仓库关系

本仓库承载 dsh 深度集成插件。底座无关内核（`@thread-memory/core`）与 Qoder 适配器在主仓库
[Thread](https://github.com/zhaoyuntao-wl/Thread)。

## License

MIT
