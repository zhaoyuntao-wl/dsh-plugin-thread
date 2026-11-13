# dsh-thread — User Manual

Applies to: `dsh-thread` 1.12.x / `@thread-memory/core` 1.6.x / dsh 0.2.2-rc.1

This manual is for **users**: how to install, read the panel, use the commands, and debug.
Motivation and trade-offs live in the [README](./README.md) and Thread's `docs/design/`.

---

## 1. What it solves

Long coding sessions lose three things: **goal drift**, **forgotten decisions**, and
**questions asked twice**. Thread stores the session's events, goals, decisions, evidence
and handoff state as a state layer that the next session — or the next agent — starts from.

The dsh plugin does three jobs:

1. **Capture** — subscribes to `session/event`, stores the full stream (lossless);
2. **Inject** — each turn injects a status card (goals / decisions / open items / acceptance / open questions) as instructions;
3. **Channels** — `/thread-*` commands, the `query_session_memory` query tool, the `verify` evidence tool, and the `handoff_*` verbs.

---

## 2. Install and upgrade

```sh
dsh plugin add dsh-thread          # install
dsh plugin add dsh-thread@latest   # upgrade (core follows via ^1.0.0)
```

Restart dsh afterwards; the session log should show:

```
[dsh-thread] thread core v1.6.0
```

Check the [compatibility table](./README.md#supported-dsh-versions) before upgrading dsh itself.

**Local development** (not via npm): copy three things into every profile — the plugin `dist/`,
`@thread-memory/core/dist/`, and core's `package.json`. Copying only the plugin misses new core
modules and fails at startup with `ERR_MODULE_NOT_FOUND`.

---

## 3. Five-minute start

1. Open a new session.
2. It receives the **first-turn anchor**: project identity + behavior contract + status card.
   You do not see this text — it is injected as instructions.
3. Type `/thread-panel`. You see what the model currently believes:

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

4. Record a decision (ask the agent, or run `/thread-reg dec <text>`), then run the panel again.

---

## 4. Reading the panel

`/thread-panel` and the MCP tool `thread_panel` render the same content, scoped to a **session**:

| Section | Meaning | Why it can be empty |
|---|---|---|
| Goals | active goals for this session + project-level | the project really has no active goal |
| Decision chain | active decisions, incl. `superseded → #id` | nothing recorded yet |
| Open items | pending candidates + `proposed` decisions | no candidates |
| **Last injection** | receipt of the most recent injection (time / kind / summary) | no injection has happened in this session yet (a new session gets one on turn 1) |
| Open questions | unanswered `ask_user_question` rows + closed history | the tool was never used |
| **Acceptance evidence** | progress + latest row per criterion (✓/✗, exit, command) | the project has no registered criteria |
| Handoffs | pending (unclaimed) handoff count | nothing to claim |
| Recent events | last 5 events | a brand-new session |

**Scoping**: the panel finds the session's project bucket on disk, so it works from a command
context that never saw the agent object. Cross-project leakage does not happen.

---

## 5. Commands

| Command | Effect |
|---|---|
| `/thread-panel` | Read-only status panel |
| `/thread-reg <ast\|dec\|fdb\|gol> [text]` | List / register artifacts, decisions, preferences, goals |
| `/thread-rev <ast\|dec\|fdb\|gol> <ids\|all>` | Revoke (the event stream keeps the text) |
| `/thread-cfm` | Pending-work inbox (`t#` todos / `c#` candidates) |
| `/thread-cfm do <id> [text]` | Complete a todo / promote a candidate |
| `/thread-cfm cnl <id>` / `cnl all` | Discard one / clear the inbox |
| `/thread-iso` / `/thread-uniso` | Isolate / restore a session |
| `/thread-pub [ast\|dec\|fdb\|gol] [ids\|all]` | Share isolated rows |
| `/thread-handoff [target]` | Produce a handoff from this session |

Commands execute directly (no model round-trip); the same text works as a plain message where
no command UI exists.

---

## 6. Handoffs (across sessions / orchestrators)

A handoff is produced automatically when a session closes; `/thread-handoff` produces one manually.

```js
// declare task and role when starting a worker
env: { THREAD_TASK_ID: taskId, THREAD_ROLE: "dev" }

// claim atomically (two workers never get the same row)
const { content } = await mcp.callTool({ name: "handoff_next", arguments: { task_id: taskId, role: "dev" } });

// acknowledge once consumed
await mcp.callTool({ name: "handoff_ack", arguments: { id } });
```

Brief shape: `goal / decisions[] / open[] / next[] / artifacts[] / conditions[] / acceptance?`.

`acceptance` is new: when the project has registered criteria, the brief carries
`验收 1/2 已证（缺：lint）`, and **criteria are re-run before the handoff is written** — the
receiver gets a fresh verdict, not last round's judgement.

No orchestrator required: omit `task_id`/`role` and the handoff is project-addressed; the next
human session receives it on turn 1.

---

## 7. Evidence gate (`verify`)

"Done" must be evidence, not a claim.

```js
// register and run criteria
await mcp.callTool({ name: "verify", arguments: { criteria: [
  { key: "unit-tests", command: "pnpm test" },
  { key: "lint",       command: "pnpm lint" },
] } });
// → 验收 1/2 已证（缺：lint）
//   each: { key, status: passed|failed|missing-env, exit, output, evidenceId }

// omit `criteria` to re-run what was registered before
await mcp.callTool({ name: "verify", arguments: {} });
```

Rules:

- every run stores command, exit code, environment fingerprint and commit in `evidence`;
- **a criterion with no command is `missing-env`** — it blocks completion but never counts as proof;
- completing a goal while a registered criterion lacks a passing row is **refused**, and the refusal
  is surfaced to the model (`[Thread 证据门] 目标未标完成：#3 缺 lint`), not swallowed;
- the panel shows only the **latest** row per criterion (history stays in the table);
- criteria are re-run automatically before a handoff → the brief carries fresh evidence.

**Note**: the gate is opt-in — a project without registered criteria is not blocked. Register at
least one criterion via `verify` if you want a goal constrained.

---

## 8. Blocking questions (`ask_user_question`)

- When the model asks through `ask_user_question`, the question lands in `open_questions` with its `call_id`;
- your real answer settles the row (`settled`, visible in the panel's closed list);
- a timeout (timed variant only) is recorded as `timed_out`, keeping "it decided for you" visible;
- **Not done**: answering from the inbox and resuming that session (needs the base's pending-question
  channel); natural-language questions at the end of a reply are **not captured** (noise outweighs
  value — see the design doc's scope boundary).

---

## 9. Isolation and sharing

```sh
/thread-iso      # this session's rows are invisible to other agents (tool events stay shared)
/thread-uniso    # restore (history stays isolated)
/thread-pub dec all   # share decisions produced while isolated
```

---

## 10. Configuration

| Option | Default | Meaning |
|---|---|---|
| `budgetLines` | 200 | Status-card line budget |
| `feedbackRows` | 50 | Feedback rows consulted by the tool guard |
| `busyRetries` / `busyRetryDelayMs` | 20 / 100 | SQLITE_BUSY retry policy |
| `compactPressureTokens` | 0 | Active-compaction threshold (0 = off; needs `THREAD_AUTO_COMPACT=1`) |

Environment variables:

| Variable | Effect |
|---|---|
| `THREAD_ROOT` | Storage root (default `~/.thread`) |
| `THREAD_CWD` | Explicit project-key source (default: session workspace) |
| `THREAD_TASK_ID` / `THREAD_ROLE` | Declare task/role for handoff addressing |
| `THREAD_AUTO_COMPACT` | Enable active compaction |

---

## 11. Where the data lives, how to back it up

```
~/.thread/
├── structured.db              # goals / decisions / feedback / evidence / questions / handoffs (one global db)
└── projects/<hash>/events.db  # event stream, one bucket per project
```

- Backup = copy `~/.thread` (ideally with dsh stopped);
- the event stream is the source of truth — deleting structured rows never removes the text;
- the schema is versioned (`SCHEMA_VERSION=12` currently); the first open after an upgrade creates
  missing tables automatically.

---

## 12. Troubleshooting

| Symptom | Check first |
|---|---|
| Panel shows 0 goals / 0 events but decisions exist | it is reading the wrong bucket: confirm `THREAD_CWD` matches the session workspace; current versions resolve the bucket on disk from the session |
| "Last injection" always says no record | has this session ever injected? a new session gets an `anchor` receipt on turn 1 |
| The status card is invisible | **expected**: it is injected as instructions, not a chat bubble; read the receipt in the panel |
| `no such table: …` | plugin/core version mismatch or an old schema: upgrade and restart; the first open migrates |
| Acceptance stuck at `missing-env` | the criterion was registered without a `command` |
| A goal cannot be completed | registered criteria have unproven entries: run `verify`, or revoke the criteria |
| Timeout detection stopped working | dsh changed the notice text: `grep pendingNotice <dsh>/node_modules/@deepseek-ai/dsh-tool-ask-user/lib/index.js` |
| Plugin fails to load after a dsh upgrade | check the compatibility table; the plugin pins SDK peer versions |

When debugging, do **not** edit production `~/.thread` by hand; use a temporary `THREAD_ROOT` for experiments.

---

## 13. Boundaries (stated plainly)

- No scheduling, no launching sessions, no retries — handoffs are state, not an orchestrator;
- natural-language extraction of decisions/preferences is off (zero false positives preferred);
  anything unrecorded is still retrievable from the event stream;
- the evidence gate is opt-in: no registered criteria, no blocking;
- after a timeout, the model's assumption is **not** converted into a pending candidate yet
  (the assumption text has no source);
- the inbox cannot answer a blocking question and resume the original session (future work).

---

## 14. Feedback

Issues, false positives and missed recalls are welcome: include the `/thread-panel` output
(redacted) and reproduction steps — far more useful than "it didn't work".
