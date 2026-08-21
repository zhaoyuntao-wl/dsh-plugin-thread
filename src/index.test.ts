import { describe, expect, it } from "vitest";
import {
  Config,
  buildToolCallMeta,
  expandAssetPaths,
  extractText,
  handleCfmCommand,
  handlePubCommand,
  handleRegCommand,
  handleRevCommand,
  isClosingWord,
  isOwnInjection,
  isThreadCommandLine,
  parseCfmCommand,
  parseIsoCommand,
  parsePubCommand,
  parseRegCommand,
  parseRevCommand,
  renderCfmList,
  renderIsolatedRows,
  renderResourceList,
} from "./index.js";
import { ThreadStore } from "@thread-memory/core";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeStore(): { store: ThreadStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "thread-cmd-"));
  const store = new ThreadStore({ eventsPath: join(dir, "e.db"), structuredPath: join(dir, "s.db"), projectKey: "demo" });
  return { store, dir };
}

describe("parseRegCommand（/thread-reg，2026-08-21 命令重构）", () => {
  it("资源名无 text → list", () => {
    for (const r of ["ast", "dec", "fdb", "gol"]) {
      expect(parseRegCommand(`/thread-reg ${r}`)).toEqual({ action: "list", resource: r });
    }
  });

  it("四资源 text 注册", () => {
    expect(parseRegCommand("/thread-reg ast docs/a.md")).toEqual({ action: "register", resource: "ast", text: "docs/a.md" });
    expect(parseRegCommand("/thread-reg dec 使用 JWT 认证")).toEqual({ action: "register", resource: "dec", text: "使用 JWT 认证" });
    expect(parseRegCommand("/thread-reg fdb 以后测试都用 vitest")).toEqual({ action: "register", resource: "fdb", text: "以后测试都用 vitest" });
    expect(parseRegCommand("/thread-reg gol 重构存储层")).toEqual({ action: "register", resource: "gol", text: "重构存储层" });
  });

  it("dec 支持 --supersedes <id>（取代链保真）", () => {
    expect(parseRegCommand("/thread-reg dec 改用 Session 认证 --supersedes 3"))
      .toEqual({ action: "register", resource: "dec", text: "改用 Session 认证", supersedesId: 3 });
    // 非 dec 资源不解析 --supersedes（原样保留文本）
    expect(parseRegCommand("/thread-reg ast docs/x.md --supersedes 3"))
      .toEqual({ action: "register", resource: "ast", text: "docs/x.md --supersedes 3" });
  });

  it("非法输入不触发", () => {
    expect(parseRegCommand("/thread-reg")).toBeUndefined();
    expect(parseRegCommand("/thread-reg dec")).not.toBeUndefined();
    expect(parseRegCommand("/thread-reg dec --supersedes 3")).toBeUndefined();
    expect(parseRegCommand("/thread-reg xxx text")).toBeUndefined();
    expect(parseRegCommand("thread-reg dec x")).toBeUndefined();
  });
});

describe("parseRevCommand（/thread-rev，2026-08-21 命令重构）", () => {
  it("资源名无 ids → list", () => {
    expect(parseRevCommand("/thread-rev dec")).toEqual({ action: "list", resource: "dec" });
  });

  it("单 id / 逗号分隔 ids / all", () => {
    expect(parseRevCommand("/thread-rev dec 3")).toEqual({ action: "revoke", resource: "dec", ids: [3] });
    expect(parseRevCommand("/thread-rev dec 1,3,5")).toEqual({ action: "revoke", resource: "dec", ids: [1, 3, 5] });
    expect(parseRevCommand("/thread-rev fdb all")).toEqual({ action: "revoke", resource: "fdb", ids: undefined });
  });

  it("非法输入不触发", () => {
    expect(parseRevCommand("/thread-rev")).toBeUndefined();
    expect(parseRevCommand("/thread-rev dec abc")).toBeUndefined();
    expect(parseRevCommand("/thread-rev xxx 3")).toBeUndefined();
    expect(parseRevCommand("thread-rev dec 3")).toBeUndefined();
  });
});

describe("parsePubCommand（/thread-pub，2026-08-21 命令重构）", () => {
  it("无参 = 列全部隔离行；资源名 = 列该资源隔离行", () => {
    expect(parsePubCommand("/thread-pub")).toEqual({ action: "list" });
    expect(parsePubCommand("/thread-pub gol")).toEqual({ action: "list", resource: "gol" });
  });

  it("ids / all 发布", () => {
    expect(parsePubCommand("/thread-pub dec 3,5")).toEqual({ action: "publish", resource: "dec", ids: [3, 5] });
    expect(parsePubCommand("/thread-pub ast all")).toEqual({ action: "publish", resource: "ast", ids: undefined });
  });

  it("非法输入不触发", () => {
    expect(parsePubCommand("/thread-pub dec abc")).toBeUndefined();
    expect(parsePubCommand("/thread-pub xxx 3")).toBeUndefined();
  });
});

describe("parseCfmCommand（/thread-cfm，2026-08-21 收件箱 t#/c# 命名空间）", () => {
  it("无参 → list；cnl all", () => {
    expect(parseCfmCommand("/thread-cfm")).toEqual({ action: "list" });
    expect(parseCfmCommand("/thread-cfm cnl all")).toEqual({ action: "cnl-all" });
  });

  it("do t#/c#；c# 可带修正文本", () => {
    expect(parseCfmCommand("/thread-cfm do t#3")).toEqual({ action: "do", target: "t", id: 3, text: undefined });
    expect(parseCfmCommand("/thread-cfm do c#9")).toEqual({ action: "do", target: "c", id: 9, text: undefined });
    expect(parseCfmCommand("/thread-cfm do c#9 修正后的决策文本")).toEqual({ action: "do", target: "c", id: 9, text: "修正后的决策文本" });
  });

  it("cnl t#/c#", () => {
    expect(parseCfmCommand("/thread-cfm cnl t#3")).toEqual({ action: "cnl", target: "t", id: 3 });
    expect(parseCfmCommand("/thread-cfm cnl c#9")).toEqual({ action: "cnl", target: "c", id: 9 });
  });

  it("非法输入不触发（无前缀数字/缺 id/未知目标）", () => {
    expect(parseCfmCommand("/thread-cfm do 3")).toBeUndefined();
    expect(parseCfmCommand("/thread-cfm do x#3")).toBeUndefined();
    expect(parseCfmCommand("/thread-cfm do t#")).toBeUndefined();
    expect(parseCfmCommand("/thread-cfm cnl t#3 extra")).toBeUndefined();
    expect(parseCfmCommand("thread-cfm cnl all")).toBeUndefined();
  });
});

describe("parseIsoCommand（/thread-iso /thread-uniso + 自然语言副通道）", () => {
  it("隔离白名单：命令与短短语触发 isolate", () => {
    for (const text of ["隔离", "/thread-iso", "开始隔离", "进入隔离", "临时隔离", "静默", "免打扰", "别打扰"]) {
      expect(parseIsoCommand(text)).toEqual({ action: "isolate" });
    }
  });

  it("解除白名单：命令与短短语触发 unisolate", () => {
    for (const text of ["/thread-uniso", "解除隔离", "退出隔离", "恢复共享"]) {
      expect(parseIsoCommand(text)).toEqual({ action: "unisolate" });
    }
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
      expect(parseIsoCommand(text)).toBeUndefined();
    }
  });

  it("前后空白不影响识别", () => {
    expect(parseIsoCommand("  隔离  ")).toEqual({ action: "isolate" });
    expect(parseIsoCommand("  /thread-uniso\r\n")).toEqual({ action: "unisolate" });
  });
});

describe("isThreadCommandLine（2026-08-21：命令消息跳过 applyAnalysis，防双创建/副作用）", () => {
  it("命令行 → true", () => {
    for (const line of [
      "/thread-reg dec 使用 JWT 认证",
      "/thread-reg fdb 不要用 pwsh 跑命令",
      "/thread-reg ast notes.md",
      "/thread-reg gol 重构存储层",
      "/thread-rev dec 3",
      "/thread-rev fdb all",
      "/thread-pub dec 3,5",
      "/thread-cfm",
      "/thread-cfm do c#9",
      "/thread-cfm cnl all",
      "/thread-iso",
      "/thread-uniso",
      "隔离",
    ]) {
      expect(isThreadCommandLine(line), line).toBe(true);
    }
  });

  it("旧命令已下线 → false（照常分析）", () => {
    expect(isThreadCommandLine("/thread-pending confirm 3")).toBe(false);
    expect(isThreadCommandLine("/thread-decision x")).toBe(false);
    expect(isThreadCommandLine("/thread-todo done 2")).toBe(false);
    expect(isThreadCommandLine("/thread-feedback x")).toBe(false);
    expect(isThreadCommandLine("/thread-asset notes.md")).toBe(false);
  });

  it("普通自然语言 → false（照常分析）", () => {
    expect(isThreadCommandLine("以后测试都用 vitest")).toBe(false);
    expect(isThreadCommandLine("帮我实现登录")).toBe(false);
    expect(isThreadCommandLine("先收了")).toBe(false);
  });
});

describe("handleRegCommand（注册四资源 + 回执）", () => {
  it("dec 创建 active；--supersedes 取代", () => {
    const { store, dir } = makeStore();
    try {
      const responses: string[] = [];
      handleRegCommand(store, "s1", { action: "register", resource: "dec", text: "使用 JWT 认证" }, { projectKey: "demo" }, (t) => responses.push(t));
      expect(responses.at(-1)).toContain("已记录决策 #1");
      expect(store.getActiveDecisions("s1").map((d) => d.text)).toContain("使用 JWT 认证");
      handleRegCommand(store, "s1", { action: "register", resource: "dec", text: "改用 Session 认证", supersedesId: 1 }, { projectKey: "demo" }, (t) => responses.push(t));
      expect(responses.at(-1)).toContain("取代 #1");
      expect(store.getActiveDecisions("s1").map((d) => d.text)).toContain("改用 Session 认证");
      expect(store.getDecisions("s1", "superseded").map((d) => d.text)).toContain("使用 JWT 认证");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fdb 自动分类教训/偏好；gol 落 active 目标", () => {
    const { store, dir } = makeStore();
    try {
      handleRegCommand(store, "s1", { action: "register", resource: "fdb", text: "不要用 pwsh 跑命令" }, { projectKey: "demo" }, () => {});
      handleRegCommand(store, "s1", { action: "register", resource: "fdb", text: "以后测试都用 vitest" }, { projectKey: "demo" }, () => {});
      handleRegCommand(store, "s1", { action: "register", resource: "gol", text: "重构存储层" }, { projectKey: "demo" }, () => {});
      const fb = store.getFeedback("s1", 10);
      expect(fb.find((f) => f.text.includes("pwsh"))?.kind).toBe("correction");
      expect(fb.find((f) => f.text.includes("vitest"))?.kind).toBe("preference");
      expect(store.getActiveGoals("s1").map((g) => g.text)).toContain("重构存储层");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("handleRevCommand（解除四资源）", () => {
  it("dec 删除（事件流水保留）；fdb 删除；gol 废弃 + 待办自愈", () => {
    const { store, dir } = makeStore();
    try {
      const d = store.addDecision("s1", "临时决策", { projectKey: "demo" });
      store.addFeedback("s1", "临时偏好", "preference", { projectKey: "demo" });
      const g = store.addGoal("s1", "废弃目标", { projectKey: "demo" });
      store.addTodo({ sessionId: "s1", text: "未完成", basis: `goal:${g.id}` });
      handleRevCommand(store, "s1", { action: "revoke", resource: "dec", ids: [d.id] }, () => {});
      expect(store.getDecisions("s1")).toHaveLength(0);
      handleRevCommand(store, "s1", { action: "revoke", resource: "fdb", ids: undefined }, () => {});
      expect(store.getFeedback("s1", 10)).toHaveLength(0);
      handleRevCommand(store, "s1", { action: "revoke", resource: "gol", ids: [g.id] }, () => {});
      expect(store.getGoals("s1").find((x) => x.id === g.id)?.status).toBe("abandoned");
      expect(store.listTodos({ sessionId: "s1" })[0].status).toBe("dropped");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ast 解除登记 + 血缘边清理", () => {
    const { store, dir } = makeStore();
    try {
      const a = store.registerAsset({ sessionId: "s1", path: "docs/x.md", title: "X", projectKey: "demo" });
      handleRevCommand(store, "s1", { action: "revoke", resource: "ast", ids: [a.id] }, () => {});
      expect(store.listAssets({ sessionId: "s1" })).toHaveLength(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rev ast all 不受 listAssets 默认 LIMIT 50 截断（2026-08-21 狗粮实证：残留 11 行）", () => {
    const { store, dir } = makeStore();
    try {
      for (let i = 0; i < 60; i++) {
        store.registerAsset({ sessionId: "s1", path: `docs/f${i}.md`, title: `F${i}`, projectKey: "demo" });
      }
      handleRevCommand(store, "s1", { action: "revoke", resource: "ast", ids: undefined }, () => {});
      expect(store.listAssets({ sessionId: "s1" })).toHaveLength(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("handlePubCommand（隔离行转共享）", () => {
  it("ids / all 共享；资源过滤", () => {
    const { store, dir } = makeStore();
    try {
      const g = store.addGoal("s1", "隔离目标", { projectKey: "demo", isolation: true });
      store.addDecision("s1", "隔离决策", { projectKey: "demo", isolation: true });
      handlePubCommand(store, "s1", { action: "publish", resource: "gol", ids: [g.id] }, () => {});
      expect(store.listIsolatedRows("s1").some((r) => r.kind === "goal")).toBe(false);
      expect(store.listIsolatedRows("s1").some((r) => r.kind === "decision")).toBe(true);
      handlePubCommand(store, "s1", { action: "publish", resource: "dec", ids: undefined }, () => {});
      expect(store.listIsolatedRows("s1")).toHaveLength(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("handleCfmCommand（收件箱 do/cnl）", () => {
  it("do t#=完成；do c#[text]=转正；cnl t#=丢弃；cnl c#=取消；cnl all 全清", () => {
    const { store, dir } = makeStore();
    try {
      const t1 = store.addTodo({ sessionId: "s1", text: "待办 A" });
      const c1 = store.addPendingCandidate({ sessionId: "s1", text: "候选 A", kind: "decision", projectKey: "demo" });
      handleCfmCommand(store, "s1", { action: "do", target: "t", id: t1.id }, { projectKey: "demo" }, () => {});
      expect(store.listTodos({ sessionId: "s1" })[0].status).toBe("done");
      handleCfmCommand(store, "s1", { action: "do", target: "c", id: c1.id, text: "修正候选 A" }, { projectKey: "demo" }, () => {});
      expect(store.getActiveDecisions("s1").map((d) => d.text)).toContain("修正候选 A");
      const t2 = store.addTodo({ sessionId: "s1", text: "待办 B" });
      const c2 = store.addPendingCandidate({ sessionId: "s1", text: "候选 B", kind: "decision", projectKey: "demo" });
      handleCfmCommand(store, "s1", { action: "cnl", target: "t", id: t2.id }, { projectKey: "demo" }, () => {});
      expect(store.listTodos({ sessionId: "s1" }).find((x) => x.id === t2.id)?.status).toBe("dropped");
      handleCfmCommand(store, "s1", { action: "cnl", target: "c", id: c2.id }, { projectKey: "demo" }, () => {});
      expect(store.listPendingCandidates({ projectKey: "demo" })).toHaveLength(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cnl all 分列两类计数", () => {
    const { store, dir } = makeStore();
    try {
      store.addTodo({ sessionId: "s1", text: "待办 C" });
      store.addPendingCandidate({ sessionId: "s1", text: "候选 C", kind: "decision", projectKey: "demo" });
      const responses: string[] = [];
      handleCfmCommand(store, "s1", { action: "cnl-all" }, { projectKey: "demo" }, (t) => responses.push(t));
      expect(responses.at(-1)).toContain("已丢弃 1 条待办、1 条候选");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renderResourceList / renderCfmList / renderIsolatedRows（id 可见来源）", () => {
  it("四资源列表含操作提示", () => {
    const { store, dir } = makeStore();
    try {
      store.registerAsset({ sessionId: "s1", path: "docs/a.md", title: "A 文档", projectKey: "demo" });
      store.addDecision("s1", "使用 JWT 认证", { projectKey: "demo" });
      store.addFeedback("s1", "测试用 vitest", "preference", { projectKey: "demo" });
      store.addGoal("s1", "重构存储层", { projectKey: "demo" });
      expect(renderResourceList(store, "s1", "ast")).toContain("/thread-rev ast <ids>");
      expect(renderResourceList(store, "s1", "dec")).toContain("--supersedes");
      expect(renderResourceList(store, "s1", "fdb")).toContain("/thread-rev fdb <ids>");
      expect(renderResourceList(store, "s1", "gol")).toContain("进行中");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rev gol 列表只列可废弃的 active 目标；ids 命中已完成时明示跳过（2026-08-21 狗粮修正）", () => {
    const { store, dir } = makeStore();
    try {
      const done = store.addGoal("s1", "已完成的目标", { projectKey: "demo" });
      store.updateGoalStatus("s1", done.id, "completed");
      const active = store.addGoal("s1", "进行中的目标", { projectKey: "demo" });
      const revList = renderResourceList(store, "s1", "gol", "rev");
      expect(revList).toContain("进行中的目标");
      expect(revList).not.toContain("已完成的目标");
      expect(renderResourceList(store, "s1", "gol", "reg")).toContain("已完成");
      // ids 命中已完成 → 跳过并回执明示
      const responses: string[] = [];
      handleRevCommand(store, "s1", { action: "revoke", resource: "gol", ids: [done.id, active.id] }, (t) => responses.push(t));
      expect(responses.at(-1)).toContain("已废弃 1 个目标");
      expect(responses.at(-1)).toContain("跳过 1 个");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("收件箱 t#/c# 命名空间 + 操作提示", () => {
    const { store, dir } = makeStore();
    try {
      store.addTodo({ sessionId: "s1", text: "待办 A" });
      store.addPendingCandidate({ sessionId: "s1", text: "候选 A", kind: "decision", projectKey: "demo" });
      const text = renderCfmList(store, "s1", "demo");
      expect(text).toContain("t#1 [待办] 待办 A");
      expect(text).toContain("c#1 [候选决策] 候选 A");
      expect(text).toContain("/thread-cfm do <id>");
      // 清空后空收件箱提示
      handleCfmCommand(store, "s1", { action: "cnl-all" }, { projectKey: "demo" }, () => {});
      expect(renderCfmList(store, "s1", "demo")).toContain("无待处理事项");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("隔离行列表：全部 + 单资源过滤 + 操作提示", () => {
    const { store, dir } = makeStore();
    try {
      store.addGoal("s1", "隔离目标", { projectKey: "demo", isolation: true });
      store.registerAsset({ sessionId: "s1", path: "docs/i.md", title: "隔离产出", projectKey: "demo", isolation: true });
      const all = renderIsolatedRows(store, "s1");
      expect(all).toContain("[gol]");
      expect(all).toContain("[ast]");
      const onlyAst = renderIsolatedRows(store, "s1", "ast");
      expect(onlyAst).toContain("[ast]");
      expect(onlyAst).not.toContain("[gol]");
      expect(renderIsolatedRows(store, "s-empty")).toContain("无隔离的结构化行");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
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

describe("expandAssetPaths（2026-08-21：文件/目录/上限/隐藏目录）", () => {
  it("文件 → [文件]；不存在 → [原路径]", () => {
    const dir = mkdtempSync(join(tmpdir(), "thread-asset-exp-"));
    try {
      const f = join(dir, "a.md");
      writeFileSync(f, "# A");
      expect(expandAssetPaths(f, dir)).toEqual([f]);
      expect(expandAssetPaths(join(dir, "missing.md"), dir)).toEqual([join(dir, "missing.md")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("目录 → 递归登记常规文件，跳过隐藏目录", () => {
    const dir = mkdtempSync(join(tmpdir(), "thread-asset-dir-"));
    try {
      mkdirSync(join(dir, "sub"), { recursive: true });
      mkdirSync(join(dir, ".git"), { recursive: true });
      writeFileSync(join(dir, "a.md"), "# A");
      writeFileSync(join(dir, "sub", "b.md"), "# B");
      writeFileSync(join(dir, ".git", "config"), "x");
      const files = expandAssetPaths(dir, dir);
      expect(files).toHaveLength(2);
      expect(files.every((f) => f.endsWith(".md"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("上限 50 防失控", () => {
    const dir = mkdtempSync(join(tmpdir(), "thread-asset-cap-"));
    try {
      for (let i = 0; i < 60; i++) {
        writeFileSync(join(dir, `f${i}.md`), "# x");
      }
      expect(expandAssetPaths(dir, dir)).toHaveLength(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe("extractText（2026-08-21 升级探针修复：tool-result 嵌套文本递归提取）", () => {
  it("顶层 text 块照常提取", () => {
    expect(extractText([{ type: "text", text: "行1" }, { type: "text", text: "行2" }] as never)).toBe("行1\n行2");
  });

  it("tool-result 嵌套 text 递归提取（0.1.1-rc.2 形状；生产库实证旧版全空）", () => {
    const shape = [
      {
        type: "tool-result",
        toolCallId: "call_1",
        content: [{ type: "text", text: '{\n  "status": "found"\n}' }],
        isError: false,
      },
    ];
    expect(extractText(shape as never)).toContain('"found"');
  });

  it("空块/无文本块返回空串", () => {
    expect(extractText([] as never)).toBe("");
    expect(extractText([{ type: "tool-result", content: [], isError: false }] as never)).toBe("");
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

describe("Config（官方 basic/config：插件配置经 Standard Schema 校验后注入 apply）", () => {
  it("缺省字段由 schema 填充默认值（budgetLines 200 / feedbackRows 50 / 重试 20×100ms）", () => {
    expect(Config.parse({})).toEqual({
      budgetLines: 200,
      feedbackRows: 50,
      busyRetries: 20,
      busyRetryDelayMs: 100,
      compactPressureTokens: 0,
      candidateTtlDays: 14,
    });
  });

  it("覆盖写生效（部署差异化配置）", () => {
    expect(Config.parse({ budgetLines: 120, feedbackRows: 80, busyRetries: 5, busyRetryDelayMs: 250, compactPressureTokens: 60000, candidateTtlDays: 7 })).toEqual({
      budgetLines: 120,
      feedbackRows: 80,
      busyRetries: 5,
      busyRetryDelayMs: 250,
      compactPressureTokens: 60000,
      candidateTtlDays: 7,
    });
  });

  it("非法值拒绝（非正数/非整数），不静默通过", () => {
    expect(() => Config.parse({ budgetLines: -1 })).toThrow();
    expect(() => Config.parse({ busyRetries: 2.5 })).toThrow();
    expect(() => Config.parse({ feedbackRows: "many" })).toThrow();
  });
});
