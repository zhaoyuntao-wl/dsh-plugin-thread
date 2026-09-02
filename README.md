# dsh-thread

[![CI](https://github.com/zhaoyuntao-wl/dsh-plugin-thread/actions/workflows/ci.yml/badge.svg)](https://github.com/zhaoyuntao-wl/dsh-plugin-thread/actions/workflows/ci.yml)

Thread's **deep-integration** plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —
session memory with lineage for coding agents, using the base's native channels
end to end.

## What it does

- **Lossless capture** — subscribes to `session/event`; the full event stream
  lands in dual SQLite databases with stable origins (idempotent append).
- **Structural delivery, three triggers** — a first-turn anchor (project identity
  + behavior contract + status card), a re-anchor after every compaction, and a
  cross-agent state delta at every turn boundary. No per-turn card noise.
  The design follows the deterministic-log line of memory research
  (e.g. arXiv:2605.21997 “The Log is the Agent”); the compaction re-anchor
  targets the “Compaction Cliff” failure mode (arXiv:2608.22752).
- **Native query tool** — `query_session_memory` registered through
  `ctx.tools.register` into the model's tool schema, with filesystem-style
  navigation `ls` / `cd` / `cat` / `grep`. The embedded MCP server remains as a
  fallback channel. Retrieval is deterministic BM25 over the lossless stream
  (jieba word segmentation for Chinese) with citation pull-back — no embedding
  dependency by default; a hybrid layer can be added at the integration
  boundary (evaluated against the BM25 baseline on the eval suite, not bundled).
- **Behavior-contract skill** — a `thread` skill is registered into the base's
  skill catalog ("need details → call the tool") and injected at anchors, so the
  model does not rely on memory to know it has memory.
- **Output recognition** — write/edit tools on markdown documents register
  `knowledge_assets` with lineage edges on write; `/thread-reg ast` covers
  explicit registration.
- **Explicit decision & preference channels** — decisions are recorded through
  `/thread-reg dec` (user, `--supersedes <id>` for chain evolution) or the
  model's `record_decision` tool (the behavior contract instructs the model to
  call it when the user settles a decision or it commits to one). Preferences
  and lessons are recorded through `/thread-reg fdb` (auto-classified as
  correction when phrased as "don't"). Natural-language extraction of
  decisions/preferences is off — zero text-heuristic false positives; the
  lossless event stream remains the backstop for anything unrecorded. (Goal
  detection from short imperative messages and completion detection stay on,
  guarded against pasted/multi-line text.)
- **Closing sediment + inbox** — closing words sediment in-progress goals into
  todos; `/thread-cfm` is the single pending-work inbox: todos (`t#id`) and
  candidates (`c#id`) in one view — `do` completes/promotes (candidates accept a
  corrected text), `cnl` discards, `cnl all` clears both. The status card
  surfaces the top candidates so they cannot pile up silently.
- **Behavior notes (1.0, stated plainly)** — candidates are not produced
  automatically: natural-language extraction of decisions/preferences is off, so
  `c#` entries only ever hold pre-existing rows until the post-release
  extraction layer arrives; todos are produced actively (closing sediment +
  goal-completion self-healing). Decisions never expire on their own — close
  out time-bound ones with `--supersedes`. Goal completion detection is
  conservative (≥4 non-ASCII / ≥8 pure-ASCII overlap; short English goals are
  missed rather than mis-judged — abandon them with `/thread-rev gol`).
  See the [Thread README](https://github.com/zhaoyuntao-wl/Thread) "Honest
  boundaries" section for the full list.
- **Resource cleanup** — `/thread-rev <ast|dec|fdb|gol> <ids|all>` revokes
  registrations: decisions/preferences/assets are deleted (the event stream
  keeps the text), goals are abandoned through the state machine with their
  todos self-healed. Every structured row carries a visible `#id` on the status
  card, so memory stays human-editable end to end.
- **Session isolation** — `/thread-iso` / `/thread-uniso`, and
  `/thread-pub <ast|dec|fdb|gol> <ids|all>` shares rows produced while isolated.
- **Optional active compaction** — with `THREAD_AUTO_COMPACT=1` the plugin
  monitors token pressure at turn boundaries and triggers `compactNow` silently;
  state re-anchors after every compaction either way.
- **Dev probe, inert by default** — the package ships a `batch0-probe` module
  used for contract smoke-testing during development; it is inert unless
  `THREAD_B0_PROBE=1` is set, so normal sessions are unaffected.

## Supported dsh versions

- **Local-first, no daemon** — everything runs in-process: embedded SQLite
  stores, no background service, no cloud dependency. Headless and web profiles
  of the same machine share the same store, and offline sessions behave
  identically.

- **Verified**: dsh **0.1.1-rc.2** (current; the dsh CLI and its SDK packages
  ship version-locked). **0.1.0-rc.6** also works (the earlier dogfood
  baseline) but is not recommended.
- The plugin pins its SDK peers to `^0.1.1-rc.2`
  (`dsh-tools`/`dsh-agent`/`dsh-session`/`dsh-user-questions`); within the
  0.1.x train, upgrades are expected to be compatible and are verified by an
  isolated contract probe plus the CI compat matrix
  (`.github/workflows/ci.yml`) before this table is updated.
- No promise is made for future major releases (0.2+); each new dsh release is
  evaluated and the matrix extended before support is claimed.

## Install

```sh
dsh plugin add dsh-thread
dsh plugin add dsh-thread@latest   # 升级：同命令重装最新版（core 经 ^1.0.0 依赖自动跟随）
```

The plugin pulls its kernel (`@thread-memory/core`) through a `^1.0.0` range,
so new installs and re-adds pick up the latest core automatically. The runtime
logs the resolved core version at startup (`[dsh-thread] thread core vX.Y.Z`)
and the embedded MCP server reports it in its handshake.

All dsh plugins must be referenced in a profile's `bundles` to take effect. In
`~/.dsh/profiles/<your-profile>/package.json`:

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

Zero configuration beyond that: `@thread-memory/core` + `better-sqlite3` resolve
as dependencies; capture and injection start as soon as the plugin is activated.

> **Note (native module)**: if the plugin fails to start with
> "Could not locate the bindings file", pnpm 10 ignored the `better-sqlite3`
> build script during install. Fix with one command in the profile directory:
>
> ```sh
> cd ~/.dsh/profiles/<your-profile>
> pnpm rebuild better-sqlite3
> ```
>
> This is a pnpm 10 `onlyBuiltDependencies` policy, not a plugin bug.

## Configuration

| Config | Default | Meaning |
|---|---|---|
| `budgetLines` | 200 | Status card line budget |
| `feedbackRows` | 50 | Feedback rows consulted by the tool guard |
| `busyRetries` / `busyRetryDelayMs` | 20 / 100 | SQLITE_BUSY retry policy |
| `compactPressureTokens` | 0 | Active-compaction token threshold (0 = off; requires `THREAD_AUTO_COMPACT=1` to pull the compaction service) |

## Commands

Registered as real dsh commands — visible in the command palette, `/`-completable,
and executed directly (no model round-trip). The same lines also work as plain
messages where no command UI exists. One grammar, six commands:

| Command | Effect |
|---|---|
| `/thread-reg <ast\|dec\|fdb\|gol>` | List that resource's rows (ids for rev/supersede) |
| `/thread-reg <ast\|dec\|fdb\|gol> <text>` | Register: ast = path (directories expand recursively, cap 50) · dec = decision (active immediately; `--supersedes <id>` evolves the chain) · fdb = preference/lesson (auto-classified by "don't" phrasing) · gol = goal |
| `/thread-rev <ast\|dec\|fdb\|gol>` | List that resource's rows |
| `/thread-rev <ast\|dec\|fdb\|gol> <ids\|all>` | Revoke: dec/fdb/ast are deleted (event stream keeps the text) · gol is abandoned (state machine + todos self-heal) |
| `/thread-cfm` | Pending-work inbox: todos (`t#id`) + candidates (`c#id`) |
| `/thread-cfm do <id> [text]` | `t#` complete a todo · `c#` promote a candidate to an active decision (optional corrected text) |
| `/thread-cfm cnl <id>` / `cnl all` | Discard one item / clear the inbox |
| `/thread-iso` / `/thread-uniso` | Silence / restore a session |
| `/thread-pub` | List isolated rows (all resources, ids for sharing) |
| `/thread-pub <ast\|dec\|fdb\|gol> <ids\|all>` | Share isolated rows |

## MCP fallback

The package ships an embedded MCP server (`bin: dsh-thread`) exposing the same
`query_session_memory` contract over MCP for bases and setups where native tool
registration is unavailable. See the [Thread Memory
Protocol](https://github.com/zhaoyuntao-wl/Thread/blob/main/docs/design/memory-protocol.md).

## Repository relationship

This repository hosts the dsh deep-integration plugin. The base-agnostic kernel
(`@thread-memory/core`) and the Qoder adapter live in the main
[Thread](https://github.com/zhaoyuntao-wl/Thread) repository.

## License

MIT
