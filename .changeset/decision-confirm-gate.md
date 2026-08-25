---
"dsh-thread": minor
---

record_decision human-confirmation gate: decisions park in memory and pop a userQuestions dialog at the tool-turn (confirm / cancel with inline edit; user opinions on cancelled entries are appended to the event stream and queryable). No-UI environments and subagents auto-confirm. Structural changes (commands, isolation toggles, goal updates, confirmed decisions) refresh the status card immediately.
