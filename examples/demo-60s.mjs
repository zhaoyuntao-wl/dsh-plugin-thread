#!/usr/bin/env node
// 60 秒演示：目标 → 决策 → 面板 → 交接 → 接手方文本。全程离线、确定性。
// 用法：node examples/demo-60s.mjs
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ThreadStore, deriveProjectKey, proposeHandoff, renderBrief } from "@thread-memory/core";

const root = mkdtempSync(join(tmpdir(), "thread-demo-"));
const workspace = join(root, "ws");
const taskId = "demo-task-1";
const sessionId = "analysis-1";
const projectKey = deriveProjectKey(workspace);

function stop(step, text) {
  console.log(`\n=== ${step} ===\n${text}`);
}

async function main() {
  const store = new ThreadStore({
    eventsPath: join(root, "events.db"),
    structuredPath: join(root, "structured.db"),
    projectKey,
  });

  store.addGoal(sessionId, "为离线检索选型并交付开发");
  stop("① 目标", "已登记：为离线检索选型并交付开发");

  const first = store.addDecision(sessionId, "条件：先做原型再定方案");
  const second = store.addDecision(sessionId, "条件：必须离线可跑；检索层用 BM25 + FTS5，不引入向量库");
  store.supersedeDecisionById(sessionId, first.id, "最终：BM25 + FTS5，先跑回归再动检索层");
  stop("② 决策与取代", `#${first.id} → 被 #${second.id} 取代`);

  const handoff = proposeHandoff(
    store,
    sessionId,
    { toRole: "dev", next: ["先跑回归再动检索层"], artifacts: ["docs/design/retrieval.md"] },
    { projectKey, taskId },
  );
  store.close();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/server.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
    env: { ...process.env, THREAD_ROOT: root, THREAD_CWD: workspace },
  });
  const client = new Client({ name: "demo-60s", version: "0.0.0" });
  await client.connect(transport);

  const panel = await client.callTool({ name: "thread_panel", arguments: { session_id: sessionId } });
  stop("③ 面板（与 /thread-panel 同一份渲染）", String(panel.content?.[0]?.text ?? ""));

  const claimed = await client.callTool({ name: "handoff_next", arguments: { task_id: taskId, role: "dev" } });
  const payload = JSON.parse(String(claimed.content?.[0]?.text ?? "{}"));
  stop("④ 交接领取", JSON.stringify({ id: payload.id, status: payload.status, goal: payload.brief?.goal }, null, 2));
  stop("⑤ 接手方收到的文本", renderBrief(payload.brief, payload.id));
  console.log(`\n（本轮生成的交接 #${handoff.id}）`);

  await client.callTool({ name: "handoff_ack", arguments: { id: payload.id } });
  const after = await client.callTool({ name: "thread_panel", arguments: { session_id: sessionId } });
  const line = String(after.content?.[0]?.text ?? "").split("\n").find((l) => l.includes("交接（")) ?? "";
  stop("⑥ ack 后", line);

  await client.close();
  rmSync(root, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
