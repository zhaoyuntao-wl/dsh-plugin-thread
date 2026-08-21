# dsh-thread

[![CI](https://github.com/zhaoyuntao-wl/dsh-plugin-thread/actions/workflows/ci.yml/badge.svg)](https://github.com/zhaoyuntao-wl/dsh-plugin-thread/actions/workflows/ci.yml)

Thread 面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**深度集成**插件——
带血缘的编码 Agent 会话记忆，全程使用底座原生通道。

## 功能

- **无损采集**——订阅 `session/event`，完整事件流水落双 SQLite 库，稳定 origin 幂等去重。
- **三触发结构性送达**——首轮锚定（项目身份 + 行为契约 + 状态卡）、每次压缩后重锚定、每回合边界的跨代理状态增量。无每轮状态卡噪音。
- **原生查询工具**——`query_session_memory` 经 `ctx.tools.register` 注册进模型工具面，支持文件系统式导航 `ls` / `cd` / `cat` / `grep`；内嵌 MCP server 保留为回退通道。
- **行为契约技能**——`thread` 技能注册进底座技能目录（"需要细节就调工具"）并在锚点注入，模型不必"记得自己有记忆"。
- **产出识别**——write/edit 类工具写出的 markdown 文档在写时登记为产出并建血缘边；`/thread-reg ast` 覆盖显式登记。
- **决策与偏好的显式通道**——决策经 `/thread-reg dec`（用户，`--supersedes <id>` 演化取代链）或模型的 `record_decision` 工具（行为契约指示模型：用户定案或自己落定决策时调用）记录；偏好/教训经 `/thread-reg fdb` 记录（"不要/别"句式自动分类为教训）。决策/偏好的自然语言判定已停用——文本启发式零误报；未显式记录的仍留在事件流水可回拉（目标判定与完成判定保留，带多行粘贴守卫）。
- **收尾沉淀 + 收件箱**——收尾词把进行中目标沉淀为待办；`/thread-cfm` 是唯一待处理收件箱：待办（`t#id`）与候选（`c#id`）一个视图——`do` 完成/转正（候选可带修正文本）、`cnl` 丢弃、`cnl all` 双清。状态卡展示前几条候选，杜绝无声堆积。
- **行为边界（1.0，直说）**——候选不会自动产出：决策/偏好的自然语言判定已停用，`c#` 条目只会显示存量遗留，直到发布后的抽取层上线；待办相反有活跃产出（收尾沉淀 + 目标完成自愈）。决策不会自行过期——时间性决策用 `--supersedes` 显式收口。目标完成判定偏保守（非 ASCII ≥4 连字符 / 纯 ASCII ≥8 连字符重叠；短英文目标宁漏勿误，用 `/thread-rev gol` 废弃）。完整清单见 [Thread README](https://github.com/zhaoyuntao-wl/Thread) 的「诚实边界」一节。
- **资源解除**——`/thread-rev <ast|dec|fdb|gol> <ids|all>` 解除注册：决策/偏好/产出删除（事件流水保留原文）、目标走状态机废弃并同步自愈关联待办。
- **会话隔离**——`/thread-iso` / `/thread-uniso`；`/thread-pub <ast|dec|fdb|gol> <ids|all>` 把隔离期产生的行转共享。
- **可选主动压缩**——`THREAD_AUTO_COMPACT=1` 时插件在回合边界监控 token 压力并静默触发 `compactNow`；无论哪种方式压缩，状态都会在压缩后重锚定。

## 支持的 dsh 版本

- **已验证**：dsh **0.1.1-rc.2**（当前；dsh CLI 与其 SDK 包同版锁步发布）。**0.1.0-rc.6** 亦可用（早期狗粮基线）但不推荐。
- 插件钉 SDK peer `^0.1.1-rc.2`（dsh-tools / dsh-agent / dsh-session / dsh-user-questions）；0.1.x 内升级预期兼容，每次升级经隔离契约探针 + CI compat matrix（`.github/workflows/ci.yml`）验证后才更新此表。
- 未来大版本（0.2+）不做承诺；每个新 dsh 版本经评估并扩展 matrix 后才声明支持。

## 安装

```sh
dsh plugin add dsh-thread
```

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

## MCP 回退

包内附带 MCP server（`bin: dsh-thread`），在原生工具注册不可用的底座/场景下提供同一
`query_session_memory` 契约。见 [Thread 记忆协议](https://github.com/zhaoyuntao-wl/Thread/blob/main/docs/design/memory-protocol.md)。

## 仓库关系

本仓库承载 dsh 深度集成插件。底座无关内核（`@thread-memory/core`）与 Qoder 适配器在主仓库
[Thread](https://github.com/zhaoyuntao-wl/Thread)。

## License

MIT
