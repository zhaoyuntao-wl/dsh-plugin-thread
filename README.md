# dsh-plugin-thread

[![CI](https://github.com/zhaoyuntao-wl/dsh-plugin-thread/actions/workflows/ci.yml/badge.svg)](https://github.com/zhaoyuntao-wl/dsh-plugin-thread/actions/workflows/ci.yml)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
brings **Thread** — a base-agnostic session memory layer for coding agents — to
dsh as a one-package closed loop:

- **Lossless capture**: subscribes to `session/event` and persists the full event
  stream (user messages, assistant replies, tool calls/results) to dual SQLite
  databases.
- **Status-card injection**: injects a per-turn status card via `agent/pre-step`
  — goals, active decisions, and feedback stay resident with O(1) bounded context.
- **Situational relay**: the card is a situational router — new sessions auto-continue
  from prior work, compaction boundaries re-anchor goals, and recent decisions are
  relayed so the model never acts on stale state.
- **Decision confirmation dialog**: user decision statements are staged as
  candidates; a dialog (`确认 / 取消 / 推迟`) lets the user confirm, cancel, or
  postpone — nothing unconfirmed becomes a formal decision.
- **Embedded MCP server**: `query_session_memory` retrieval (semantic BM25 +
  structured queries) via the `dsh-thread` binary, mountable as a zero-code MCP
  overlay.

Guarantees: decisions never lost, goals never drift, no repeated questions —
across long tasks, compaction boundaries, and new sessions.

> **Repository relationship**: this is the dsh deep-adapter for
> [Thread](https://github.com/zhaoyuntao-wl/thread). The general kernel
> (`@thread-memory/core`) and the thin Qoder adapter live in the main Thread repository.

## Install

```sh
dsh plugin add dsh-thread
```

Zero configuration: `@thread-memory/core` + `better-sqlite3` resolve as dependencies;
capture and injection start as soon as the plugin is activated.

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

## Enable (profile)

All dsh plugins must be referenced in a profile's `bundles` to take effect. In
`~/.dsh/profiles/<your-profile>/package.json`:

```json
{
  "name": "dsh-profile-my",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-thread"]
    }
  }
}
```

To use `query_session_memory` in-session / in the Web UI, add the MCP overlay in
the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: mcp-thread
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: thread
        transport: stdio
        command: npx
        args: ['dsh-thread']
        failOnStartupError: true
```

## Session isolation

When two agents work in parallel on unrelated tasks in the same project, isolate
a session with natural language ("隔离/静默/别打扰") or `/isolate` — its dialogue
context (messages/decisions/feedback) becomes visible only to itself, and the
status card stops being disturbed by the other agent's updates; tool events stay
shared (project facts stay continuous). `/unisolate` lifts isolation (history
stays isolated), and `/thread-publish <goal|decision|feedback> <id>` (or natural
language "把这个决策共享出去") promotes a row back to shared visibility on demand.

## Version pinning

Peer dependencies use `^0.1.0-rc.6` (compatible with the rc.6/rc.7 train);
adapts to the dsh release train, compat matrix in CI.

## Development

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

`@thread-memory/core` is linked via `file:../thread/packages/core` during development
(CI runs the full chain only once core is published to npm and the dependency
switches to a version; see `.github/workflows/ci.yml`).

## License

[MIT](./LICENSE)
