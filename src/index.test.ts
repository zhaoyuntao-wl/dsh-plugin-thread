import { describe, expect, it } from "vitest";
import { isOwnInjection } from "./index.js";

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
