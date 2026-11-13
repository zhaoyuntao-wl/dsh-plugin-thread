#!/usr/bin/env node
// 编排器示例：分析段已跑完 → 编排器领取交接 → 开发 agent 带着 brief 开局 → ack。
// 用法：node examples/orchestrator-handoff.mjs
//
// 说明：真实编排器里第 ① 段是分析 agent 的会话；这里用 core API 复现同一份状态，
// 让示例不依赖模型调用、可离线重复。第 ③ 段展示接收方实际拿到的文本。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ThreadStore, deriveProjectKey, proposeHandoff, renderBrief, parseBrief } from "@thread-memory/core";

const TASK_ID = "demo-task-1";
const role = "dev";
const root = mkdtempSync(join(tmpdir(), "thread-orchestrator-demo-"));
const workspace = join(root, "ws");

function analysisPhase(projectKey) {
  const store = new ThreadStore({
    eventsPath: join(root, "events.db"),
    structuredPath: join(root, "structured.db"),
    projectKey,
  });
  store.addGoal("analysis-1", "为离线检索选型并交付开发");
  store.addDecision("analysis-1", "条件：必须离线可跑；检索层用 BM25 + FTS5，不引入向量库");
  store.addTodo({ sessionId: "analysis-1", text: "重构检索层（旧计划，尚未确认）", projectKey });
  store.registerAsset({ sessionId: "analysis-1", path: "docs/design/retrieval.md", title: "检索设计" });
  // 分析 agent 收尾时：策展「下一步」，交给 dev 角色
  const handoff = proposeHandoff(
    store,
    "analysis-1",
    { toRole: role, next: ["先跑回归再动检索层"] },
    { projectKey, taskId: TASK_ID },
  );
  store.close();
  return handoff;
}

async function main() {
  const projectKey = deriveProjectKey(workspace);
  const created = analysisPhase(projectKey);
  console.log(`① 分析段收尾：已生成交接 #${created.id}（to_role=${created.to_role ?? "project"}）`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/server.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
    env: { ...process.env, THREAD_ROOT: root, THREAD_CWD: workspace },
  });
  const client = new Client({ name: "orchestrator-demo", version: "0.0.0" });
  await client.connect(transport);

  console.log(`\n② 编排器领取（task_id=${TASK_ID} role=${role}）`);
  const claimed = await client.callTool({ name: "handoff_next", arguments: { task_id: TASK_ID, role } });
  const payload = JSON.parse(String(claimed.content?.[0]?.text ?? "{}"));
  if (payload.status === "not-found") {
    console.error("没有可领取的交接——检查 THREAD_ROOT / task_id / role。");
    await client.close();
    process.exit(1);
  }
  console.log(JSON.stringify(payload, null, 2));

  console.log("\n③ 开发 agent 实际收到的文本（首轮注入的 brief）");
  console.log(renderBrief(payload.brief, payload.id));

  console.log("\n④ 消费确认");
  const acked = await client.callTool({ name: "handoff_ack", arguments: { id: payload.id } });
  console.log(String(acked.content?.[0]?.text ?? "").replace(/\s+/g, " "));

  const again = await client.callTool({ name: "handoff_next", arguments: { task_id: TASK_ID, role } });
  console.log(`⑤ 再次领取：${String(again.content?.[0]?.text ?? "").replace(/\s+/g, " ")}`);
  console.log(`\n（brief 解析校验：goal=${parseBrief(JSON.stringify(payload.brief)).goal}）`);

  await client.close();
  rmSync(root, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
