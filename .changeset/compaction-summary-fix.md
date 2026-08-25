---
"dsh-thread": patch
---

Handle the live dsh compaction/summary payload shape: `summary` is a `ContentBlock[]`, not a string. Checkpoints now land in the event stream, so post-compact re-anchoring fires on real compactions instead of being silently dropped at the DB bind.
