import { describe, expect, it } from "vitest";
import {
  Config,
  buildToolCallMeta,
  handlePendingCommand,
  isClosingWord,
  isOwnInjection,
  parseAssetCommand,
  parseIsolationCommand,
  parsePendingCommand,
} from "./index.js";
import { ThreadStore } from "@thread-memory/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeStore(): { store: ThreadStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "thread-b2-"));
  const store = new ThreadStore({ eventsPath: join(dir, "e.db"), structuredPath: join(dir, "s.db"), projectKey: "demo" });
  return { store, dir };
}

describe("parsePendingCommand（/thread-pending，1.3）", () => {
  it("list 无参", () => {
    expect(parsePendingCommand("/thread-pending")).toEqual({ action: "list" });
  });

  it("confirm/cancel/defer 带 id", () => {
    expect(parsePendingCommand("/thread-pending confirm 3")).toEqual({ action: "confirm", id: 3 });
    expect(parsePendingCommand("/thread-pending cancel 7")).toEqual({ action: "cancel", id: 7 });
    expect(parsePendingCommand("/thread-pending defer 9")).toEqual({ action: "defer", id: 9 });
  });

  it("cancel-all", () => {
    expect(parsePendingCommand("/thread-pending cancel-all")).toEqual({ action: "cancel-all" });
  });

  it("非命令不误触发", () => {
    expect(parsePendingCommand("thread-pending")).toBeUndefined();
    expect(parsePendingCommand("/thread-pending 查看")).toBeUndefined();
    expect(parsePendingCommand("待确认候选有 8 条")).toBeUndefined();
  });
});

describe("isClosingWord（收尾词白名单，1.2）", () => {
  it("白名单命中", () => {
    for (const w of ["先收了", "先收", "收工", "收工了", "今天到这", "明天继续", "歇了", "先记", "暂时这样"]) {
      expect(isClosingWord(w), w).toBe(true);
    }
  });

  it("讨论性语句不误触发", () => {
    expect(isClosingWord("今天到这附近开会")).toBe(false);
    expect(isClosingWord("我们收工了吗")).toBe(false);
  });
});

describe("handlePendingCommand（1.3 执行 + 回执）", () => {
  it("list 列出候选", () => {
    const { store, dir } = makeStore();
    try {
      store.addPendingCandidate({ sessionId: "s1", text: "候选决策 A", kind: "decision", projectKey: "demo" });
      const responses: string[] = [];
      handlePendingCommand(store, "s1", { action: "list" }, "demo", (t) => responses.push(t));
      expect(responses).toHaveLength(1);
      expect(responses[0]).toContain("[决策] 候选决策 A");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("confirm → 转 confirmed；cancel → ignored；defer 不动；cancel-all 全弃", () => {
    const { store, dir } = makeStore();
    try {
      const c1 = store.addPendingCandidate({ sessionId: "s1", text: "C1", kind: "decision", projectKey: "demo" });
      const c2 = store.addPendingCandidate({ sessionId: "s1", text: "C2", kind: "preference", projectKey: "demo" });
      const responses: string[] = [];
      handlePendingCommand(store, "s1", { action: "confirm", id: c1.id }, "demo", (t) => responses.push(t));
      expect(responses.at(-1)).toContain("已确认");
      expect(store.listPendingCandidates({ projectKey: "demo" })).toHaveLength(1);
      handlePendingCommand(store, "s1", { action: "defer", id: c2.id }, "demo", (t) => responses.push(t));
      expect(responses.at(-1)).toContain("推迟");
      expect(store.listPendingCandidates({ projectKey: "demo" })).toHaveLength(1);
      handlePendingCommand(store, "s1", { action: "cancel-all" }, "demo", (t) => responses.push(t));
      expect(responses.at(-1)).toContain("丢弃 1 条");
      expect(store.listPendingCandidates({ projectKey: "demo" })).toHaveLength(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseAssetCommand（/thread-asset 显式登记，0.2）", () => {
  it("纯路径登记", () => {
    expect(parseAssetCommand("/thread-asset docs/local/research/notes.md")).toEqual({ path: "docs/local/research/notes.md" });
  });

  it("带 --topic 登记", () => {
    expect(parseAssetCommand("/thread-asset notes.md --topic cordis")).toEqual({ path: "notes.md", topic: "cordis" });
  });

  it("非命令不误触发", () => {
    expect(parseAssetCommand("把 notes.md 登记为产出")).toBeUndefined();
    expect(parseAssetCommand("/thread-asset")).toBeUndefined();
    expect(parseAssetCommand("thread-asset a.md")).toBeUndefined();
  });
});

describe("buildToolCallMeta（dsh 侧 file_path 采集修复，自检修正⑦）", () => {
  it("JSON arguments 含 file_path → 进 meta", () => {
    const meta = buildToolCallMeta("write", "call-1", JSON.stringify({ file_path: "docs/a.md", content: "# 标题" }));
    expect(meta).toEqual({ tool_name: "write", call_id: "call-1", file_path: "docs/a.md" });
  });

  it("arguments 非 JSON / 缺 file_path → 仅基础字段（解析失败降级）", () => {
    expect(buildToolCallMeta("read", "call-2", "not json")).toEqual({ tool_name: "read", call_id: "call-2" });
    expect(buildToolCallMeta("pwsh", "call-3", JSON.stringify({ cmd: "ls" }))).toEqual({ tool_name: "pwsh", call_id: "call-3" });
  });
});

describe("isOwnInjection（卡片独立成轮守卫，B⑧ 迭代）", () => {
  it("空消息列表 → false（正常注入）", () => {
    expect(isOwnInjection([])).toBe(false);
  });

  it("真实用户消息 → false（正常注入）", () => {
    const user = { source: { kind: "user" } };
    expect(isOwnInjection([user])).toBe(false);
  });

  it("本插件注入的状态卡 → true（跳过注入，切断自循环）", () => {
    const card = { source: { kind: "plugin", plugin: "dsh-thread", form: "instructions" } };
    expect(isOwnInjection([card])).toBe(true);
  });

  it("用户消息 + 本插件注入混合 → false（正常注入）", () => {
    const user = { source: { kind: "user" } };
    const card = { source: { kind: "plugin", plugin: "dsh-thread", form: "instructions" } };
    expect(isOwnInjection([user, card])).toBe(false);
  });

  it("其他插件注入 → false（不误伤）", () => {
    const other = { source: { kind: "plugin", plugin: "other-plugin", form: "instructions" } };
    expect(isOwnInjection([other])).toBe(false);
  });

  it("source 缺失（防御）→ false", () => {
    expect(isOwnInjection([{}])).toBe(false);
  });
});

describe("parseIsolationCommand（⑦ 整条消息白名单，防讨论性语句误触发）", () => {
  it("隔离白名单：命令与短短语触发 isolate", () => {
    for (const text of ["隔离", "/isolate", "开始隔离", "进入隔离", "临时隔离", "静默", "免打扰", "别打扰"]) {
      expect(parseIsolationCommand(text)).toEqual({ action: "isolate" });
    }
  });

  it("解除白名单：命令与短短语触发 unisolate", () => {
    for (const text of ["/unisolate", "解除隔离", "退出隔离", "恢复共享"]) {
      expect(parseIsolationCommand(text)).toEqual({ action: "unisolate" });
    }
  });

  it("沉淀命令与自然语言触发 publish", () => {
    expect(parseIsolationCommand("/thread-publish decision 3")).toEqual({ action: "publish", kind: "decision", id: 3 });
    expect(parseIsolationCommand("把这个决策共享出去")).toEqual({ action: "publish" });
    expect(parseIsolationCommand("把刚才的偏好同步给项目")).toEqual({ action: "publish" });
  });

  it("反馈恢复命令触发 feedback-del（B⑥-② 恢复通道）", () => {
    expect(parseIsolationCommand("/feedback-del 7")).toEqual({ action: "feedback-del", id: 7 });
    expect(parseIsolationCommand("/feedback-del abc")).toBeUndefined();
  });

  it("讨论性语句不触发（2026-08-15 误触发回归，events id 5124）", () => {
    for (const text of [
      "隔离的判定规则是什么",
      "先隔离再看效果",
      "进入隔离模式后还能查公共内容吗",
      "解除",
      "解除隔离后怎么办",
      "讨论一下屏蔽机制",
    ]) {
      expect(parseIsolationCommand(text)).toBeUndefined();
    }
  });

  it("前后空白不影响识别", () => {
    expect(parseIsolationCommand("  隔离  ")).toEqual({ action: "isolate" });
    expect(parseIsolationCommand("  /unisolate\r\n")).toEqual({ action: "unisolate" });
  });
});

describe("Config（官方 basic/config：插件配置经 Standard Schema 校验后注入 apply）", () => {
  it("缺省字段由 schema 填充默认值（budgetLines 200 / feedbackRows 50 / 重试 20×100ms）", () => {
    expect(Config.parse({})).toEqual({
      budgetLines: 200,
      feedbackRows: 50,
      busyRetries: 20,
      busyRetryDelayMs: 100,
      compactPressureTokens: 0,
    });
  });

  it("覆盖写生效（部署差异化配置）", () => {
    expect(Config.parse({ budgetLines: 120, feedbackRows: 80, busyRetries: 5, busyRetryDelayMs: 250, compactPressureTokens: 60000 })).toEqual({
      budgetLines: 120,
      feedbackRows: 80,
      busyRetries: 5,
      busyRetryDelayMs: 250,
      compactPressureTokens: 60000,
    });
  });

  it("非法值拒绝（非正数/非整数），不静默通过", () => {
    expect(() => Config.parse({ budgetLines: -1 })).toThrow();
    expect(() => Config.parse({ busyRetries: 2.5 })).toThrow();
    expect(() => Config.parse({ feedbackRows: "many" })).toThrow();
  });
});
