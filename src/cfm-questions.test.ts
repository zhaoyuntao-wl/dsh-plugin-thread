import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCfmCommand, parseCfmCommand } from "./index.js";
import { listOpenQuestions, openQuestionCount, recordOpenQuestion } from "@thread-memory/core";
import { ThreadStore } from "@thread-memory/core";

let dir: string;
let store: ThreadStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "thread-cfm-q-"));
  store = new ThreadStore({ eventsPath: join(dir, "events.db"), structuredPath: join(dir, "structured.db"), projectKey: "q-proj" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const seed = () =>
  recordOpenQuestion(store, {
    projectKey: "q-proj",
    sessionId: "s1",
    callId: "call-7",
    questions: [{ question: "选 A 还是 B？" }],
  });

describe("q# 收件箱", () => {
  it("解析 do q# / cnl q#", () => {
    expect(parseCfmCommand("/thread-cfm do q#3 选 A")).toEqual({ action: "do", target: "q", id: 3, text: "选 A" });
    expect(parseCfmCommand("/thread-cfm cnl q#3")).toEqual({ action: "cnl", target: "q", id: 3 });
  });

  it("do q# 记录答案并关闭，且提示不会续跑会话", () => {
    const id = seed();
    let reply = "";
    handleCfmCommand(store, "s1", { action: "do", target: "q", id, text: "选 A" }, { projectKey: "q-proj" }, (t) => {
      reply = t;
    });
    expect(reply).toContain("已答并关闭");
    expect(reply).toContain("不会自动续跑");
    expect(openQuestionCount(store, { projectKey: "q-proj" })).toBe(0);
    expect(listOpenQuestions(store, { projectKey: "q-proj" })[0].answers_json).toContain("选 A");
  });

  it("cnl q# 丢弃问题", () => {
    const id = seed();
    let reply = "";
    handleCfmCommand(store, "s1", { action: "cnl", target: "q", id }, { projectKey: "q-proj" }, (t) => {
      reply = t;
    });
    expect(reply).toContain("已丢弃");
    expect(openQuestionCount(store, { projectKey: "q-proj" })).toBe(0);
  });

  it("对不存在的 id 给出不存在提示", () => {
    let reply = "";
    handleCfmCommand(store, "s1", { action: "do", target: "q", id: 999 }, { projectKey: "q-proj" }, (t) => {
      reply = t;
    });
    expect(reply).toContain("不存在或已关闭");
  });
});
