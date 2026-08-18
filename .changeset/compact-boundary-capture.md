---
"dsh-thread": patch
---

修复：dsh 压缩事件未采集 → post-compact 情境在 dsh 上从未触发（L1 压缩边界回归缺口）

- `compaction/summary` → 写 `compact_checkpoint`（body=摘要全文，meta=trigger manual/auto + model + compactionId，origin 幂等防重放）
- 跳过 dsh 压缩 checkpoint 摘要 `user/message`（`isCompactCheckpointSource`，source.plugin='compact'）：避免摘要被重复采成普通用户消息、避免摘要被 applyAnalysis 当用户话语分析出假决策候选
- 此前 `compaction/*` 四类事件全落 session/event 的 `default` 分支被丢弃，`detectSituation` 判定 post-compact 依赖 `compact_checkpoint` 事件 → 压缩边界回归块从未出现过（2026-08-18 实机发现：dsh 自动压缩后仅摘要以 user_message 落库，无 checkpoint 标记）
- 单测 +7（handleCompactionSummary 4 + isCompactCheckpointSource 3）
