import { describe, expect, it } from "vitest";
import { handleCompactionSummary, isCompactCheckpointSource } from "./index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadStore } from "@thread-memory/core";

function makeStore(): { store: ThreadStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "thread-compaction-"));
  const store = new ThreadStore({ eventsPath: join(dir, "e.db"), structuredPath: join(dir, "s.db"), projectKey: "demo" });
  return { store, dir };
}

// dsh compaction/summary payload（官方 dsh-compaction-basic commitCompactionBody 契约形状）
// 2026-08-25 修正：live 的 summary 是 ContentBlock[]（不是 string）——fixture 必须按 live 快照形状构造，
// 此前 string fixture 让单测全绿而现网四次压缩边界从未落库。
function makeSummaryEvent(overrides: { sourceCommandId?: string; compactionId?: string; summary?: Array<{ type: "text"; text: string }>; model?: string } = {}) {
  const id = overrides.compactionId ?? "comp-1";
  return {
    time: 1780000000000,
    data: {
      compactionId: id,
      ...(overrides.sourceCommandId ? { sourceCommandId: overrides.sourceCommandId } : {}),
      summary: overrides.summary ?? [{ type: "text", text: "## Primary Request and Intent\n- 会话主线" }],
      model: overrides.model ?? "DeepSeek-V4-Flash",
      provider: "deepseek",
      shadowedRange: { start: 10, end: 20 },
      shadowedSeqs: [10, 11, 12],
      shadowedTokenCount: 5000,
    },
  };
}

describe("handleCompactionSummary（压缩边界 → compact_checkpoint，2026-08-18 修复）", () => {
  it("自动压缩（无 sourceCommandId）→ 落 compact_checkpoint，meta.trigger=auto", () => {
    const { store, dir } = makeStore();
    try {
      handleCompactionSummary(store, "s1", makeSummaryEvent(), { projectKey: "demo" });
      const recent = store.getRecentEvents("s1", 3);
      expect(recent).toHaveLength(1);
      expect(recent[0].kind).toBe("compact_checkpoint");
      expect(recent[0].body).toContain("Primary Request and Intent");
      const meta = recent[0].meta as unknown as Record<string, unknown>;
      expect(meta.trigger).toBe("auto");
      expect(meta.model).toBe("DeepSeek-V4-Flash");
      expect(meta.compactionId).toBe("comp-1");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("手动压缩（有 sourceCommandId）→ meta.trigger=manual", () => {
    const { store, dir } = makeStore();
    try {
      handleCompactionSummary(store, "s1", makeSummaryEvent({ sourceCommandId: "cmd-9" }), { projectKey: "demo" });
      const recent = store.getRecentEvents("s1", 3);
      const meta = recent[0].meta as unknown as Record<string, unknown>;
      expect(meta.trigger).toBe("manual");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("同一 compactionId 重复事件 → origin 幂等只落一条", () => {
    const { store, dir } = makeStore();
    try {
      handleCompactionSummary(store, "s1", makeSummaryEvent({ compactionId: "comp-dup" }), { projectKey: "demo" });
      handleCompactionSummary(store, "s1", makeSummaryEvent({ compactionId: "comp-dup" }), { projectKey: "demo" });
      expect(store.getRecentEvents("s1", 5)).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("缺摘要/缺 compactionId → 不落库（契约防御）", () => {
    const { store, dir } = makeStore();
    try {
      handleCompactionSummary(store, "s1", makeSummaryEvent({ summary: [] }), { projectKey: "demo" });
      handleCompactionSummary(store, "s1", makeSummaryEvent({ compactionId: "" }), { projectKey: "demo" });
      expect(store.getRecentEvents("s1", 5)).toHaveLength(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("多块 ContentBlock summary → 文本拼接落库（live 形状）", () => {
    const { store, dir } = makeStore();
    try {
      handleCompactionSummary(store, "s1", makeSummaryEvent({
        summary: [
          { type: "text", text: "## Primary Request and Intent" },
          { type: "text", text: "- 会话主线：Thread 项目" },
        ],
      }), { projectKey: "demo" });
      const recent = store.getRecentEvents("s1", 3);
      expect(recent).toHaveLength(1);
      expect(recent[0].body).toContain("Primary Request and Intent");
      expect(recent[0].body).toContain("会话主线：Thread 项目");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isCompactCheckpointSource（识别 dsh 压缩摘要 user/message）", () => {
  it("plugin=compact → true（跳过重复采集）", () => {
    expect(isCompactCheckpointSource({ kind: "plugin", plugin: "compact" })).toBe(true);
  });
  it("plugin=dsh-thread（自身注入）→ false（走 PLUGIN_NAME 判定）", () => {
    expect(isCompactCheckpointSource({ kind: "plugin", plugin: "dsh-thread" })).toBe(false);
  });
  it("普通用户来源 → false", () => {
    expect(isCompactCheckpointSource({ kind: "user" })).toBe(false);
    expect(isCompactCheckpointSource(undefined)).toBe(false);
  });
});
