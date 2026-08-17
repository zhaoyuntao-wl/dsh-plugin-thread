import { describe, expect, it } from "vitest";
import { isOwnInjection, parseIsolationCommand } from "./index.js";

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
