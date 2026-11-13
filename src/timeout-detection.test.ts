import { describe, expect, it } from "vitest";
import { TIMED_OUT_NOTICE, isTimedOutResult } from "./index.js";

describe("超时结果判定", () => {
  it("dsh timed 变体的超时文案被识别", () => {
    const body = `Questions are pending.\n${TIMED_OUT_NOTICE}. This is pending, not a skipped answer. Continue useful independent work.`;
    expect(isTimedOutResult(body)).toBe(true);
  });

  it("用户真回答不会被误判为超时", () => {
    expect(isTimedOutResult('{"answers":[{"id":"pick","selected":["A"]}]}')).toBe(false);
  });

  it("空结果不误判", () => {
    expect(isTimedOutResult("")).toBe(false);
  });
});
