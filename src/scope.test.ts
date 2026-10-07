import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionScopes } from "./scope.js";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "thread-scope-"));
}

describe("createSessionScopes（会话工作区 → 项目键，2026-10-07 D1）", () => {
  it("两个不同工作区的会话落在两个桶，structured.db 共享", () => {
    const root = makeRoot();
    const wsA = makeRoot();
    const wsB = makeRoot();
    try {
      const scopes = createSessionScopes({ root, fallbackCwd: wsA });
      try {
        const a = scopes.storeFor(scopes.keyForSession({ id: "s-a", meta: { cwd: wsA } }));
        const b = scopes.storeFor(scopes.keyForSession({ id: "s-b", meta: { cwd: wsB } }));
        expect(a.projectKey).not.toBe(b.projectKey);
        // 事件库按项目键物理隔离；结构化库全局共享同一份
        expect(a.eventsDb.name).not.toBe(b.eventsDb.name);
        expect(a.eventsDb.name).toContain("projects");
        expect(a.structuredDb.name).toBe(b.structuredDb.name);
        expect(scopes.storeFor(scopes.keyForSession({ id: "s-a", meta: { cwd: wsA } }))).toBe(a);
      } finally {
        scopes.closeAll();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wsA, { recursive: true, force: true });
      rmSync(wsB, { recursive: true, force: true });
    }
  });

  it("keyOf：已见会话 → agents 注册表 → 进程 cwd 兜底", () => {
    const root = makeRoot();
    const ws = makeRoot();
    const other = makeRoot();
    try {
      const scopes = createSessionScopes({
        root,
        fallbackCwd: ws,
        lookupAgent: (id) => (id === "s-lookup" ? { session: { id, meta: { cwd: other } } } : undefined),
      });
      const seen = { id: "s-seen", meta: { cwd: ws } };
      scopes.remember(seen);
      const seenKey = scopes.keyForSession(seen);
      expect(scopes.keyOf("s-seen")).toBe(seenKey);
      // 注册表命中：走会话自己的工作区
      expect(scopes.keyOf("s-lookup")).toBe(scopes.keyForSession({ id: "s-lookup", meta: { cwd: other } }));
      // 谁都不认识 → 进程 cwd 兜底
      expect(scopes.keyOf("s-unknown")).toBe(scopes.fallbackKey());
      scopes.closeAll();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(ws, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("THREAD_CWD 覆盖会话工作区（显式逃生开关最优先）", () => {
    const root = makeRoot();
    const ws = makeRoot();
    const forced = makeRoot();
    const prev = process.env.THREAD_CWD;
    try {
      process.env.THREAD_CWD = forced;
      const scopes = createSessionScopes({ root, fallbackCwd: ws });
      const session = { id: "s-forced", meta: { cwd: ws } };
      expect(scopes.keyForSession(session)).toBe(scopes.keyForSession({ id: "x", meta: { cwd: forced } }));
      scopes.closeAll();
    } finally {
      if (prev === undefined) {
        delete process.env.THREAD_CWD;
      } else {
        process.env.THREAD_CWD = prev;
      }
      rmSync(root, { recursive: true, force: true });
      rmSync(ws, { recursive: true, force: true });
      rmSync(forced, { recursive: true, force: true });
    }
  });
});
