import { describe, expect, it } from "vitest";
import { handlePendingAnswer } from "./index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadStore } from "@thread-memory/core";

function makeStore(): { store: ThreadStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "thread-pending-"));
  const store = new ThreadStore({ eventsPath: join(dir, "e.db"), structuredPath: join(dir, "s.db"), projectKey: "demo" });
  return { store, dir };
}

describe("handlePendingAnswer（§1.5.3d 折叠卡片选项处理；2026-08-21 更新/取消词汇）", () => {
  it("更新 → 候选转正为 active 决策", () => {
    const { store, dir } = makeStore();
    try {
      const c = store.addPendingCandidate({ sessionId: "s1", text: "以后就在创造模式开发", kind: "decision", projectKey: "demo" });
      handlePendingAnswer(store, "s1", c.id, "更新", { projectKey: "demo" });
      const active = store.getActiveDecisions("s1");
      expect(active).toHaveLength(1);
      expect(active[0].text).toBe("以后就在创造模式开发");
      expect(active[0].status).toBe("active");
      expect(store.listPendingCandidates({ sessionId: "s1" })).toHaveLength(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("取消 → 候选丢弃（ignored）", () => {
    const { store, dir } = makeStore();
    try {
      const c = store.addPendingCandidate({ sessionId: "s1", text: "用 X 方案", kind: "decision", projectKey: "demo" });
      handlePendingAnswer(store, "s1", c.id, "取消", { projectKey: "demo" });
      expect(store.getActiveDecisions("s1")).toHaveLength(0);
      expect(store.listPendingCandidates({ sessionId: "s1" })).toHaveLength(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("推迟 → 候选保持 pending（不转正不丢弃）", () => {
    const { store, dir } = makeStore();
    try {
      const c = store.addPendingCandidate({ sessionId: "s1", text: "缓存用 LRU", kind: "decision", projectKey: "demo" });
      handlePendingAnswer(store, "s1", c.id, "推迟", { projectKey: "demo" });
      expect(store.getActiveDecisions("s1")).toHaveLength(0);
      expect(store.listPendingCandidates({ sessionId: "s1" })).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("未知选项 → 保持 pending（安全降级）", () => {
    const { store, dir } = makeStore();
    try {
      const c = store.addPendingCandidate({ sessionId: "s1", text: "未知情况", kind: "decision", projectKey: "demo" });
      handlePendingAnswer(store, "s1", c.id, "别的", { projectKey: "demo" });
      expect(store.listPendingCandidates({ sessionId: "s1" })).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
