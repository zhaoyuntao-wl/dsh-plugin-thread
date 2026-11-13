# dsh-thread 使用手册

适用版本：`dsh-thread` 1.12.x / `@thread-memory/core` 1.6.x / dsh 0.2.2-rc.1

本手册面向**使用者**：怎么装、怎么看、怎么用、出问题怎么查。设计动机与取舍见
[README](./README.zh-CN.md) 与 Thread 仓库的 `docs/design/`。

---

## 1. 它解决什么问题

编码 agent 的长会话会丢失三样东西：**目标漂移**、**决策遗忘**、**重复提问**。
Thread 把会话中的事件、目标、决策、证据与交接状态存成可检索、可交接的状态层，
让下一个会话（或下一个 agent）开局就带着上文的结论。

dsh 插件负责三件事：

1. **采集**：订阅 `session/event`，全量落库（无损）；
2. **注入**：每轮把状态卡（目标 / 决策 / 未决 / 验收 / 待答问题）作为 instructions 注入；
3. **通道**：`/thread-*` 命令、`query_session_memory` 查询工具、`verify` 证据工具、`handoff_*` 交接动词。

---

## 2. 安装与升级

```sh
dsh plugin add dsh-thread          # 安装
dsh plugin add dsh-thread@latest   # 升级（core 经 ^1.0.0 自动跟随）
```

装完**重启 dsh**，会话启动日志应出现：

```
[dsh-thread] thread core v1.6.1
```

升级 dsh 本身前先看 [README 的兼容表](./README.zh-CN.md#支持的-dsh-版本)。

**本地开发**（不走 npm）时刷三样到每个 profile：插件 `dist/`、`@thread-memory/core/dist/`、
core 的 `package.json`。只刷插件会漏 core 新模块，启动即 `ERR_MODULE_NOT_FOUND`。

---

## 3. 五分钟上手

1. 开一个新会话。
2. 它会自动收到**首轮锚定**：项目身份 + 行为契约 + 状态卡（你看不到这段，它是 instructions）。
3. 输入 `/thread-panel`，你会看到模型此刻"以为"的状态：

```
[Thread 面板]
目标（1）：…
决策链（生效 5 · 已被取代 0）：…
未决（候选 0 · proposed 0）：…
本轮注入：2026-11-14T03:20Z [status-card] 状态卡 4213 字符
待答问题：（无）
验收证据：验收 2/2 已证 · ✓ core-tests exit=0 …
交接（未确认 0）：…
最近事件（5）：…
```

4. 让 agent 记一条决策（或自己用 `/thread-reg dec 决策文本`），再跑一次面板，决策链会变。

---

## 4. 面板怎么读

`/thread-panel` 与 MCP `thread_panel` 输出同一份内容，按**会话 + 所属项目**合并作用域：

| 区块 | 含义 | 为什么可能是空的 |
|---|---|---|
| 目标 | 本会话 + 项目级生效目标 | 项目里确实没有进行中目标 |
| 决策链 | 本会话生效决策 + 同项目 project 级决策，含 `superseded → #id` 取代关系 | 这个项目里还没记录过决策 |
| 未决 | 待确认候选 + `proposed` 决策 | 没有候选 |
| **本轮注入** | 最近一次注入回执（时间 / 类型 / 摘要） | 本次会话还没发生过注入（新会话首轮后就有） |
| 待答问题 | `ask_user_question` 未答的问题 + 已关闭回看 | 从未通过工具提问 |
| **验收证据** | 验收进度 + 每条目最新一行（✓/✗、退出码、命令） | 项目还没登记过验收条目 |
| 交接 | 未确认（pending）的交接条数 | 没有待领取交接 |
| 最近事件 | 事件流水末 5 条 | 新会话刚开始 |

**作用域**：面板按会话找项目桶（从磁盘解析），所以即使命令上下文里拿不到 agent 对象，
也能取到正确数据。目标与决策按项目合并（与状态卡同一份合并口径），只有事件列表和注入回执
按会话取。跨项目不会串。

---

## 5. 命令速查

| 命令 | 作用 |
|---|---|
| `/thread-panel` | 只读状态面板 |
| `/thread-reg <ast\|dec\|fdb\|gol> [text]` | 列出/注册 产出、决策、偏好、目标 |
| `/thread-rev <ast\|dec\|fdb\|gol> <ids\|all>` | 解除注册（事件流水保留原文） |
| `/thread-cfm` | 待处理收件箱（`t#` 待办 / `c#` 候选） |
| `/thread-cfm do <id> [text]` | 完成待办 / 转正候选 |
| `/thread-cfm cnl <id>` / `cnl all` | 丢弃 / 清空 |
| `/thread-iso` / `/thread-uniso` | 隔离 / 解除隔离 |
| `/thread-pub [ast\|dec\|fdb\|gol] [ids\|all]` | 隔离行转共享 |
| `/thread-handoff [target]` | 生成本会话交接 |

命令直接执行，不经过模型一轮；无命令 UI 的环境里按普通消息输入同样生效。

---

## 6. 交接（跨会话 / 编排器）

会话关闭时自动生成一条交接；也可用 `/thread-handoff` 手动生成。

```js
// 启动 worker 时声明任务与角色
env: { THREAD_TASK_ID: taskId, THREAD_ROLE: "dev" }

// 原子领取（两个 worker 并发不会拿到同一条）
const { content } = await mcp.callTool({ name: "handoff_next", arguments: { task_id: taskId, role: "dev" } });

// 消费完确认
await mcp.callTool({ name: "handoff_ack", arguments: { id } });
```

brief 结构：`goal / decisions[] / open[] / next[] / artifacts[] / conditions[] / acceptance?`。

`acceptance` 是本次新增：项目登记过验收条目时，交接里直接写
`验收 1/2 已证（缺：lint）`，且**关闭前会自动重跑已登记条目**——接手方看到的是刚测出的结论。

没有编排器也能用：不传 `task_id`/`role`，按项目寻址，人开下一个会话首轮自动注入。

---

## 7. 证据门（verify）

"做完了"必须是证据，不是声明。

```js
// 登记并执行验收条目
await mcp.callTool({ name: "verify", arguments: { criteria: [
  { key: "unit-tests", command: "pnpm test" },
  { key: "lint",       command: "pnpm lint" },
] } });
// → 验收 1/2 已证（缺：lint）
//   每条：{ key, status: passed|failed|missing-env, exit, output, evidenceId }

// 省略 criteria = 重跑本项目已登记的条目
await mcp.callTool({ name: "verify", arguments: {} });
```

规则：

- 每次执行落 `evidence`：命令、退出码、环境指纹、commit；
- **没有命令的条目 = `missing-env`**：阻止完成，但永远不算通过；
- 验收条目未证时**拒绝**把目标标完成，并回告 `[Thread 证据门] 目标未标完成：#3 缺 lint`；
- 面板按条目只显示**最新一条**证据（历史仍在库里）；
- 会话关闭前自动重跑 → 交接带新鲜结论。

**注意**：门禁是 opt-in 的——项目没登记过验收条目时不生效。想让某个目标受约束，
就至少跑一次 `verify` 并给它条目。

---

## 8. 阻塞性问题（ask_user_question）

- 模型通过 `ask_user_question` 提问时，问题带 `call_id` 落进 `open_questions`；
- 你正常回答 → 该条置 `settled`（面板「已关闭」里可回看）；
- 超时（仅 timed 变体）→ 记 `timed_out`，保留"它替你做决定了"的可见性；
- **当前不做**：从收件箱补答并让会话继续（需要底座的 pending-question 通道，属后续工作）；
  对话末尾的自然语言提问**不采集**（噪声大于价值，见设计文档范围边界）。

---

## 9. 隔离与共享

```sh
/thread-iso      # 本会话的内容对其它 agent 不可见（工具事件仍共享）
/thread-uniso    # 解除（历史仍隔离）
/thread-pub dec all   # 把隔离期决策转为共享
```

---

## 10. 配置

| 项 | 默认 | 说明 |
|---|---|---|
| `budgetLines` | 200 | 状态卡行预算 |
| `feedbackRows` | 50 | 工具守卫参考的反馈行数 |
| `busyRetries` / `busyRetryDelayMs` | 20 / 100 | SQLITE_BUSY 重试 |
| `compactPressureTokens` | 0 | 主动压缩阈值（0 关；需 `THREAD_AUTO_COMPACT=1`） |

环境变量：

| 变量 | 作用 |
|---|---|
| `THREAD_ROOT` | 存储根目录（默认 `~/.thread`） |
| `THREAD_CWD` | 显式指定项目键来源（默认取会话工作区） |
| `THREAD_TASK_ID` / `THREAD_ROLE` | 声明任务与角色，供交接寻址 |
| `THREAD_AUTO_COMPACT` | 启用主动压缩 |

---

## 11. 数据在哪、怎么备份

```
~/.thread/
├── structured.db              # 目标/决策/反馈/证据/问题/交接（全局一张）
└── projects/<hash>/events.db  # 按项目分桶的事件流水
```

- 备份 = 拷整个 `~/.thread`（先退出 dsh 更稳）；
- 事件流水是"真相源"，结构化行删除不影响原文可查；
- 库结构有版本号（当前 `SCHEMA_VERSION=12`），升级插件后首次打开会自动补表。

---

## 12. 故障排查

| 现象 | 先查 |
|---|---|
| 面板里目标/事件都是 0，但决策有 | 面板取错了桶：确认 `THREAD_CWD` 与会话工作区一致；当前版本已改为按会话在磁盘找桶 |
| 「本轮注入」一直是"无记录" | 该会话是否发生过注入；新会话首轮后应有一条 `anchor` |
| 状态卡看不到 | **正常**：它以 instructions 注入，不是对话气泡；用面板看回执 |
| `no such table: …` | 插件与 core 版本不匹配，或库 schema 落后：升级后重启，首次打开自动迁移 |
| 验收一直是 `missing-env` | `verify` 的条目没给 `command` |
| 目标标不了完成 | 项目登记了验收条目但有未证项；跑 `verify`，或先撤销条目 |
| 超时判定失效（超时被记成已回答） | dsh 升级改了文案：`grep pendingNotice <dsh>/node_modules/@deepseek-ai/dsh-tool-ask-user/lib/index.js` 复核 |
| dsh 升级后插件加载失败 | 看兼容表；插件钉 SDK peer 版本，跨大版本需升级插件 |

排障时**不要**直接改生产 `~/.thread` 里的数据；实验请用临时 `THREAD_ROOT`。

---

## 13. 边界（直说）

- 不做调度、不启动会话、不重试——交接是状态，不是编排器；
- 决策/偏好的自然语言抽取已关闭（零误判优先），未显式记录的靠事件流水回查；
- 证据门 opt-in：不登记条目就不拦截；
- 超时后的"模型假设"目前**不会**自动落成待确认候选（缺"假设文本"的来源）；
- 收件箱里不能补答阻塞性问题并让原会话继续（后续工作）。

---

## 14. 反馈

问题、误判、漏召回都欢迎：开 issue 时附 `/thread-panel` 输出（脱敏后）与复现步骤，
比一句"没生效"有用得多。
