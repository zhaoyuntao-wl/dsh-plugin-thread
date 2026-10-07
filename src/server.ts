#!/usr/bin/env node
import { ThreadStore, runQueryTool, THREAD_VERSION, defaultPaths } from "@thread-memory/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const paths = defaultPaths();
// 路径按本进程 cwd 解析：新工作区/新启动目录下桶目录尚不存在时，better-sqlite3 直接抛
// "Cannot open database because the directory does not exist"，整个查询通道（MCP entry）激活失败
//（2026-10-07 dsh 0.2.0-rc.2 隔离 live 探针实证）。这里与插件侧一致先建父目录。
mkdirSync(dirname(paths.eventsDbPath), { recursive: true });
mkdirSync(dirname(paths.structuredDbPath), { recursive: true });
const store = new ThreadStore({ eventsPath: paths.eventsDbPath, structuredPath: paths.structuredDbPath });

const server = new McpServer({
  name: "thread-sms",
  version: THREAD_VERSION,
});

const TOOL_DESCRIPTION = [
  "查询会话记忆：事件流水与结构化表（目标/决策/反馈）的按需检索，支持导航原语（ls/cd/cat/grep）。",
  "涉及本会话历史/本项目状态的话题先查再答，不要编造；返回的命中事件可按引用回拉原文。",
  "未找到时返回 not-found 标记与追问建议。",
  "示例：拿不准某决策的来龙去脉时，query='登录方案 决策' 即可带回原文；nav=ls 无 target 列出目录视图（活跃会话完整 id + 本会话库存）；nav=ls target=<会话> 列出产出与待办。",
].join("\n");

server.tool(
  "query_session_memory",
  TOOL_DESCRIPTION,
  {
    query: z.string().optional().describe("检索查询，支持关键词/短语，如 '登录模块 决策'（nav 时可为 grep 关键词）"),
    token_budget: z.number().int().positive().optional().describe("返回结果 token 预算，默认 4000"),
    session_id: z.string().optional().describe("会话 ID；缺省使用最近活跃会话"),
    limit: z.number().int().positive().max(50).optional().describe("最大返回片段数，默认 20"),
    kind: z.enum(["user_message", "assistant_message", "tool_call", "tool_result", "compact_checkpoint", "goal", "decision", "feedback"]).optional().describe("按类型过滤：事件类（精确查询路径）或结构化表类 goal/decision/feedback（目标/决策/偏好行）"),
    since: z.string().optional().describe("时间下界 ISO（精确查询路径，如 '2026-08-14T01:00:00Z'；结构化表类忽略）"),
    until: z.string().optional().describe("时间上界 ISO（精确查询路径；结构化表类忽略）"),
    order: z.enum(["asc", "desc"]).optional().describe("排序方向，默认 desc（最近优先）"),
    count_only: z.boolean().optional().describe("只返回计数（如'调了几次某工具'）"),
    nav: z.enum(["ls", "cd", "cat", "grep"]).optional().describe("导航指令：ls 列子项（无 target=目录视图：活跃会话完整 id + 本会话库存计数；target=会话/产出）| cd 节点详情 | cat 全文 | grep 检索带关联上下文"),
    target: z.string().optional().describe("导航目标（会话 id / asset id / 文档路径）"),
  },
  async (args) => {
    const result = runQueryTool(store, {
      query: args.query,
      token_budget: args.token_budget,
      session_id: args.session_id,
      limit: args.limit,
      kind: args.kind,
      since: args.since,
      until: args.until,
      order: args.order,
      count_only: args.count_only,
      nav: args.nav,
      target: args.target,
    });
    return {
      content: [{ type: "text" as const, text: result.text }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
