#!/usr/bin/env node
// 编排器示例：分析 → 开发 两段流水线，交接由 Thread 承载。
// 用法：node examples/orchestrator-handoff.mjs
// 前置：dsh 已安装、dsh-thread 已装进 profile（或设置 DSH_PROFILE）。
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TASK_ID = "demo-task-1";
const root = mkdtempSync(join(tmpdir(), "thread-orchestrator-demo-"));
const workspace = join(root, "ws");
const profile = process.env.DSH_PROFILE ?? "headless";

function dsh(prompt, role) {
  const res = spawnSync("dsh", ["--profile", profile, JSON.stringify(prompt)], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 240000,
    env: { ...process.env, THREAD_ROOT: root, THREAD_TASK_ID: TASK_ID, THREAD_ROLE: role, DSH_PERMISSION_MODE: "danger-full-access" },
    shell: true,
  });
  return `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
}

async function main() {
  console.log("① 分析段：定方案并把结论留在 Thread 里");
  console.log(
    dsh("请用一句话记录一个决策：检索层用 BM25 + FTS5，不引入向量库（条件：必须离线可跑）。然后结束。", "analysis").slice(-300),
  );

  console.log("\n② 交接：编排器领取（领取即 delivered）");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/server.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
    env: { ...process.env, THREAD_ROOT: root },
  });
  const client = new Client({ name: "orchestrator-demo", version: "0.0.0" });
  await client.connect(transport);
  const next = await client.callTool({ name: "handoff_next", arguments: { task_id: TASK_ID, role: "dev" } });
  const text = String(next.content?.[0]?.text ?? "{}");
  console.log(text.slice(0, 600));

  const id = Number(/"id":\s*(\d+)/.exec(text)?.[1] ?? 0);
  if (id > 0) {
    console.log("\n③ 开发段：带着交接开局（首轮自动注入）");
    console.log(dsh("用一句话说明你接手后第一步做什么。", "dev").slice(-200));
    const ack = await client.callTool({ name: "handoff_ack", arguments: { id } });
    console.log("\n④ 确认消费：", String(ack.content?.[0]?.text ?? "").replace(/\s+/g, " "));
  }

  await client.close();
  rmSync(root, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
