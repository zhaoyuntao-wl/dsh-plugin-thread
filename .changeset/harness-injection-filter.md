---
"dsh-thread": patch
---

Skip harness-injected messages so they never pollute the event stream: job-completion notices, workspace instructions, runtime-context snapshots, and skill-catalog updates are detected by their source `form` signal (probe-verified live shapes), with content-prefix heuristics as fallback. Injections no longer cancel pending decision confirmations; unknown shapes are logged to `capture-debug.log` for the probe.
