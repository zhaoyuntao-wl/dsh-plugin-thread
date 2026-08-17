# dsh-plugin-thread

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
brings **Thread** — a base-agnostic session memory layer for coding agents — to
dsh as a one-package closed loop:

- **Lossless capture**: subscribes to `session/event` and persists the full event
  stream (user messages, assistant replies, tool calls/results) to dual SQLite
  databases.
- **Status-card injection**: injects a per-turn status card via `agent/pre-step`
  — goals, active decisions, and feedback stay resident with O(1) bounded context.
- **Embedded MCP server**: `query_session_memory` retrieval (semantic BM25 +
  structured queries) via the `dsh-thread` binary, mountable as a zero-code MCP
  overlay.

Guarantees: decisions never lost, goals never drift, no repeated questions —
across long tasks, compaction boundaries, and new sessions.

> **Repository relationship**: this is the dsh deep-adapter for
> [Thread](https://github.com/zhaoyuntao-wl/thread). The general kernel
> (`@thread/core`) and the thin Qoder adapter live in the main Thread repository.

## Install

```sh
dsh plugin add dsh-thread
```

Zero configuration: `@thread/core` + `better-sqlite3` resolve as dependencies;
capture and injection start as soon as the plugin is activated.

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

Pinned to dsh `0.1.0-rc.6` (peer dependency); adapts to the dsh release train,
compat matrix in CI.

## Development

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

`@thread/core` is linked via `file:../thread/packages/core` during development;
switch to an npm version once the core API stabilizes.

## License

[MIT](./LICENSE)
