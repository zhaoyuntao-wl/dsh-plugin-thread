---
"dsh-thread": major
---

命令全量重构：一套语法六个命令 + 模型决策工具（2026-08-21 用户定案）

- **命令语法统一为「动词 + 资源 + 动作」**，六命令：`/thread-reg <ast|dec|fdb|gol>`（注册产出/决策/偏好·教训/目标，无 text 列资源行；dec 支持 `--supersedes <id>` 演化取代链）、`/thread-rev <ast|dec|fdb|gol> <ids|all>`（解除：dec/fdb/ast 删除、gol 走状态机废弃并自愈关联待办）、`/thread-cfm`（待处理收件箱：待办 `t#id` + 候选 `c#id` 命名空间，`do` 完成/转正可带修正文本、`cnl` 丢弃、`cnl all` 双清）、`/thread-pub <ast|dec|fdb|gol> <ids|all>`（隔离行转共享，无参列隔离行）、`/thread-iso` / `/thread-uniso`
- **旧命令全量下线**（1.0 未发布不留别名）：thread-asset / thread-decision(-del) / thread-pending / thread-todo / thread-feedback(-del) / thread-publish / thread-isolate / thread-unisolate；自然语言副通道（隔离/静默/共享）保留
- **`record_decision` 原生模型工具**：行为契约指示模型在用户定案或自己落定决策时调用；supersedes_id 可选；对用户不可见
- **收件箱语义**：待办 = 本会话，候选 = 项目级（与状态卡候选唤醒视图一致）；候选转正与折叠卡片共用 store.promoteCandidate 单一路径
- Qoder 适配器同步（capture.mjs 同语法命令族；assistant 文本不再分析）
- **tool_result 采集修复（2026-08-21 dsh 升级探针发现）**：extractText 只认顶层 text 块，dsh 的 tool-result 块把文本嵌在 `content[].content[].text` → 生产库 tool_result body 全空（既有缺口，rc.6 与 0.1.1-rc.2 通吃）。改为递归下钻任意含 content 数组的块；升级探针实证 0.1.1-rc.2 下 tool_result 恢复捕获（1585 字符 JSON 全量入库）
- **SDK 钉版本升 `^0.1.1-rc.2`**（dsh-agent/llm/session/tools/user-questions；0.1.1-rc.2 兼容性经全隔离契约探针 + typecheck 验证）
- 单测 61 全绿（四解析器 + 四执行器 + 收件箱/资源/隔离渲染 + extractText 嵌套形状）
