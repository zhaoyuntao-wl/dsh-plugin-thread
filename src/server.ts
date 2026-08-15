#!/usr/bin/env node
import { ThreadStore, queryMemory, queryEvents, THREAD_VERSION, defaultPaths } from "@thread/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const paths = defaultPaths();
const store = new ThreadStore({ eventsPath: paths.eventsDbPath, structuredPath: paths.structuredDbPath });

const server = new McpServer({
  name: "thread-sms",
  version: THREAD_VERSION,
});

const TOOL_DESCRIPTION = [
  "查询会话记忆：事件流水与结构化表（目标/决策/反馈）的按需检索。",
  "需要历史细节、上下文或不确定时调用本工具，不要编造；返回的命中事件可按引用回拉原文。",
  "未找到时返回 not-found 标记与追问建议。",
].join("\n");

server.tool(
  "query_session_memory",
  TOOL_DESCRIPTION,
  {
    query: z.string().describe("检索查询，支持关键词/短语，如 '登录模块 决策'"),
    token_budget: z.number().int().positive().optional().describe("返回结果 token 预算，默认 4000"),
    session_id: z.string().optional().describe("会话 ID；缺省使用最近活跃会话"),
    limit: z.number().int().positive().max(50).optional().describe("最大返回片段数，默认 20"),
    kind: z.enum(["user_message", "assistant_message", "tool_call", "tool_result", "compact_checkpoint"]).optional().describe("按事件类型过滤（精确查询路径，如审计/抽查）"),
    since: z.string().optional().describe("时间下界 ISO（精确查询路径，如 '2026-08-14T01:00:00Z'）"),
    until: z.string().optional().describe("时间上界 ISO（精确查询路径）"),
    order: z.enum(["asc", "desc"]).optional().describe("排序方向，默认 desc（最近优先）"),
    count_only: z.boolean().optional().describe("只返回计数（如'调了几次某工具'）"),
  },
  async (args) => {
    const sessionId = args.session_id ?? store.getRecentSessionId();
    if (!sessionId) {
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ status: "not-found", results: [], note: "会话记忆为空：尚无事件写入。", session_isolation: null }, null, 2) },
        ],
      };
    }
    const structured =
      args.kind !== undefined ||
      args.since !== undefined ||
      args.until !== undefined ||
      args.order !== undefined ||
      args.count_only === true;
    const result = structured
      ? queryEvents(store, {
          sessionId,
          kind: args.kind,
          timeRange: { since: args.since, until: args.until },
          order: args.order,
          limit: args.limit,
          count: args.count_only,
        })
      : queryMemory(store, args.query, {
          tokenBudget: args.token_budget,
          sessionId,
          limit: args.limit,
        });
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ...result, session_isolation: store.getSessionIsolation(sessionId) }, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
