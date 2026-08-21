---
"dsh-thread": minor
---

候选折叠卡片（§1.5.3d 通道一；2026-08-21 词汇校准为 更新/取消/推迟）

- pre-step 检测到未提示过的决策候选 → `ctx.userQuestions.ask()` 对话内折叠卡片（fire-and-forget，不阻塞）
- 三选项：更新（转正 active，经 store.promoteCandidate）/ 取消（丢弃）/ 推迟（保持 pending 等唤醒）
- headless 无 UI 环境降级走状态卡计数通道（通道二）
- 选项处理抽为 `handlePendingAnswer` 导出（可单测）
- 新增 peer 依赖 @deepseek-ai/dsh-user-questions（^0.1.0-rc.6）
- 单测 +4（更新/取消/推迟/未知选项）
