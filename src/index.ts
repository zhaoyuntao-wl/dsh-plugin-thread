// Thread dsh adapter — 采集（session/event → Thread 双库）+ 注入（pre-step → 状态卡）。
// 查询通道走 MCP（thread-sms overlay），本插件不注册工具（旗舰形态，spike ② 三接缝产品化）。
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// dsh-tools 声明合并 ctx.tools: ToolRuntime（官方类型，guard 签名与 Context 注入一致）
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage, type ContentBlock, type ToolResultBlock } from '@deepseek-ai/dsh-llm'
import {
  ThreadStore,
  applyAnalysis,
  buildStatusCard,
  classifyReportEvent,
  classifyWriteEvent,
  defaultPaths,
  deriveProjectKey,
  detectSituation,
  extractTitleFromContent,
  getStateDelta,
  matchToolFeedback,
  parseToolArgs,
  renderStateDelta,
  runQueryTool,
  sedimentClosingTodos,
  THREAD_BEHAVIOR_CONTRACT,
  THREAD_NORTH_STAR,
} from '@thread-memory/core'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { runBatch0Probes } from './batch0-probe.js'

export const name = 'dsh-thread'

// 批 0 探针模式 / 批 4 主动压缩增强层：inject 声明依赖 compaction（服务可用性驱动加载拉活惰性服务；
// tokenMeter 由其传递依赖拉起）。正常会话不依赖 compaction（压缩治理走订阅 + 重锚定）。
export const inject = process.env.THREAD_B0_PROBE === '1' || process.env.THREAD_AUTO_COMPACT === '1' ? ['tools', 'compaction'] : ['tools']

const PLUGIN_NAME = name

// 插件配置（官方 basic/config 规范：不同部署取值可变的参数必须定义为配置字段，
// zod v4 实现 Standard Schema，cordis 校验后注入 apply 第二参）
export const Config = z.object({
  budgetLines: z.number().int().positive().default(200),
  feedbackRows: z.number().int().positive().default(50),
  busyRetries: z.number().int().positive().default(20),
  busyRetryDelayMs: z.number().int().positive().default(100),
  // 批 4 增强层（可选，默认关）：回合边界主动压缩的 token 压力阈值（0=关；需 THREAD_AUTO_COMPACT=1 拉活服务）
  compactPressureTokens: z.number().int().nonnegative().default(Number(process.env.THREAD_AUTO_COMPACT_TOKENS ?? 0)),
})
export type Config = z.infer<typeof Config>

function extractText(content: readonly ContentBlock[]): string {
  return content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

// 卡片独立成轮守卫：inject 的消息会被 dsh agent-loop 当新 turn 输入再驱动一轮
//（inbox hasPending → wakeDriver），该轮 claimed 消息全部是本插件注入时视为纯卡片轮。
export function isOwnInjection(messages: readonly unknown[]): boolean {
  if (messages.length === 0) {
    return false
  }
  return messages.every((m) => {
    const source = (m as { source?: { kind?: string; plugin?: string } }).source
    return source?.kind === 'plugin' && source?.plugin === PLUGIN_NAME
  })
}

// dsh 压缩 checkpoint 摘要来源标记（官方 @deepseek-ai/dsh-compaction checkpoint 契约：
// COMPACT_CHECKPOINT_MARKER = { kind: 'plugin', plugin: 'compact' }，跨包钉死，renaming 即编译错）
const COMPACT_CHECKPOINT_SOURCE_PLUGIN = 'compact'

// 识别 dsh 压缩 checkpoint 摘要消息（source.plugin === 'compact'，官方 @deepseek-ai/dsh-compaction 契约）。
// 该消息是压缩事务内 append 的 user/message（摘要正文），Thread 侧已由 compaction/summary → compact_checkpoint
// 落库摘要全文，此处跳过可避免重复采集 + 避免摘要被 applyAnalysis 当用户话语分析（2026-08-18 修复）。
export function isCompactCheckpointSource(source: { kind?: string; plugin?: string } | undefined): boolean {
  return source?.kind === 'plugin' && source?.plugin === COMPACT_CHECKPOINT_SOURCE_PLUGIN
}

// 会话指令识别：整条消息 trim 后精确匹配白名单（隔离 ⑦定案 + 反馈治理恢复通道）
const ISOLATE_RE = /^(?:\/isolate|[/／]isolate|隔离|开始隔离|进入隔离|临时隔离|静默|免打扰|别打扰)$/
const UNISOLATE_RE = /^(?:\/unisolate|[/／]unisolate|解除隔离|退出隔离|恢复共享)$/
const PUBLISH_CMD_RE = /^\/thread-publish\s+(goal|decision|feedback)\s+(\d+)$/
const PUBLISH_NL_RE = /^把(?:刚才|刚才的)?(?:这个)?(?:决策|决定|目标|偏好)(?:共享|公开|同步)(?:出去|给项目)?$/
const FEEDBACK_DEL_RE = /^\/feedback-del\s+(\d+)$/
const ASSET_CMD_RE = /^\/thread-asset\s+(\S+)(?:\s+--topic\s+(\S+))?$/
// 收尾词白名单（1.2 收尾自动沉淀触发，整条消息精确匹配，防讨论性语句误触发）
const CLOSING_WORD_RE = /^(?:先收了|先收|收工了|收工|今天到这|明天继续|歇了|歇|先记|暂时这样)$/
// /thread-pending 命令（1.3 假承诺兑现）
const PENDING_LIST_RE = /^\/thread-pending$/
const PENDING_CMD_RE = /^\/thread-pending\s+(confirm|cancel|defer)\s+(\d+)$/
const PENDING_CANCEL_ALL_RE = /^\/thread-pending\s+cancel-all$/

interface IsolationCommand {
  action: 'isolate' | 'unisolate' | 'publish' | 'feedback-del'
  kind?: 'goal' | 'decision' | 'feedback'
  id?: number
}

// dsh compaction/summary 事件 payload（官方 dsh-compaction-basic commitCompactionBody 契约，
// SessionEventMap 未展开该类型，插件侧按运行时形状声明）
interface CompactionSummaryData {
  compactionId: string
  sourceCommandId?: string
  summary: string
  provider?: string
  model?: string
}

function tableForKind(kind: 'goal' | 'decision' | 'feedback'): 'goals' | 'decisions' | 'feedback' {
  return kind === 'goal' ? 'goals' : kind === 'decision' ? 'decisions' : 'feedback'
}

export function parseIsolationCommand(body: string): IsolationCommand | undefined {
  const text = body.trim()
  const delMatch = text.match(FEEDBACK_DEL_RE)
  if (delMatch) {
    return { action: 'feedback-del', id: Number(delMatch[1]) }
  }
  if (PUBLISH_CMD_RE.test(text)) {
    const m = text.match(PUBLISH_CMD_RE)
    return { action: 'publish', kind: m?.[1] as 'goal' | 'decision' | 'feedback', id: Number(m?.[2]) }
  }
  if (PUBLISH_NL_RE.test(text)) {
    // 自然语言沉淀：作用于本会话最近一条隔离结构化行
    return { action: 'publish' }
  }
  if (ISOLATE_RE.test(text)) {
    return { action: 'isolate' }
  }
  if (UNISOLATE_RE.test(text)) {
    return { action: 'unisolate' }
  }
  return undefined
}

// /thread-asset <path> [--topic <t>]：显式登记产出（0.2 显式登记入口，第一版只做命令）
export function parseAssetCommand(body: string): { path: string; topic?: string } | undefined {
  const text = body.trim()
  const m = text.match(ASSET_CMD_RE)
  if (!m) {
    return undefined
  }
  return m[2] ? { path: m[1], topic: m[2] } : { path: m[1] }
}

// /thread-pending 命令（1.3）：list | confirm <id> | cancel <id> | defer <id> | cancel-all
export interface PendingCommand {
  action: 'list' | 'confirm' | 'cancel' | 'defer' | 'cancel-all'
  id?: number
}

export function parsePendingCommand(body: string): PendingCommand | undefined {
  const text = body.trim()
  if (PENDING_LIST_RE.test(text)) {
    return { action: 'list' }
  }
  if (PENDING_CANCEL_ALL_RE.test(text)) {
    return { action: 'cancel-all' }
  }
  const m = text.match(PENDING_CMD_RE)
  if (m) {
    return { action: m[1] as 'confirm' | 'cancel' | 'defer', id: Number(m[2]) }
  }
  return undefined
}

export function isClosingWord(body: string): boolean {
  return CLOSING_WORD_RE.test(body.trim())
}

// /thread-pending 执行（1.3）：list/confirm/cancel/defer/cancel-all + 回执文本（经 respond 注入）
export function handlePendingCommand(
  store: ThreadStore,
  sessionId: string,
  cmd: PendingCommand,
  projectKey: string | undefined,
  respond: (text: string) => void,
): void {
  if (cmd.action === 'list') {
    const candidates = store.listPendingCandidates(projectKey ? { sessionId, projectKey } : { sessionId })
    if (candidates.length === 0) {
      respond('[Thread 待确认候选] 当前无待确认候选。')
      return
    }
    const lines = candidates.map((c) => `  #${c.id} [${c.kind === 'decision' ? '决策' : '偏好'}] ${c.text}`)
    respond(`[Thread 待确认候选]\n${lines.join('\n')}\n操作：/thread-pending confirm <id> 确认 | cancel <id> 取消 | defer <id> 推迟 | cancel-all 全弃`)
    return
  }
  if (cmd.action === 'confirm') {
    const c = store.confirmCandidate(cmd.id ?? -1)
    respond(c ? `[Thread] 候选 #${cmd.id} 已确认。` : `[Thread] 候选 #${cmd.id} 不存在或已处理。`)
    return
  }
  if (cmd.action === 'cancel') {
    const c = store.ignoreCandidate(cmd.id ?? -1)
    respond(c ? `[Thread] 候选 #${cmd.id} 已取消。` : `[Thread] 候选 #${cmd.id} 不存在或已处理。`)
    return
  }
  if (cmd.action === 'defer') {
    respond(`[Thread] 候选 #${cmd.id} 保持待确认（推迟）。`)
    return
  }
  const count = store.ignoreAllPendingCandidates(projectKey ? { sessionId, projectKey } : { sessionId })
  respond(`[Thread] 已丢弃 ${count} 条待确认候选。`)
}

// tool/call meta 构建（自检修正⑦：dsh 侧缺 file_path 的采集修复）——
// 从 arguments（JSON 字符串）解析 file_path 存 meta，产出识别依赖它
export function buildToolCallMeta(name: string, callId: string, argumentsRaw: string): Record<string, unknown> {
  const meta: Record<string, unknown> = { tool_name: name, call_id: callId }
  const parsed = parseToolArgs(argumentsRaw)
  const filePath = typeof parsed?.file_path === "string" ? parsed.file_path : undefined
  if (filePath) {
    meta.file_path = filePath
  }
  return meta
}

export function apply(ctx: Context, config: Config) {
  // MAX v3 批 0 探针（env 门控，spike 专用；正常会话 THREAD_B0_PROBE 未设 = 零行为差异）
  if (process.env.THREAD_B0_PROBE === '1') {
    runBatch0Probes(ctx, {
      fixturePath: process.env.THREAD_B0_FIXTURE ?? 'C:/Users/tony/.thread-b0/batch0.jsonl',
      compact: process.env.THREAD_B0_COMPACT === '1',
      followup: process.env.THREAD_B0_FOLLOWUP === '1',
    })
  }
  const budgetLines = config.budgetLines ?? 200
  const feedbackRows = config.feedbackRows ?? 50
  const busyRetries = config.busyRetries ?? 20
  const busyRetryDelayMs = config.busyRetryDelayMs ?? 100
  const compactPressureTokens = config.compactPressureTokens ?? 0
  const cwd = process.env.THREAD_CWD ?? process.cwd()
  const projectKey = deriveProjectKey(cwd)
  const paths = defaultPaths(cwd)
  mkdirSync(dirname(paths.eventsDbPath), { recursive: true })
  mkdirSync(dirname(paths.structuredDbPath), { recursive: true })

  let store: ThreadStore | undefined

  function openStore(): ThreadStore {
    if (store) {
      return store
    }
    store = new ThreadStore({ eventsPath: paths.eventsDbPath, structuredPath: paths.structuredDbPath, projectKey })
    return store
  }

  // 代理注册表：事件驱动的响应注入（/thread-pending 回执）经 agents.get(sessionId).inject
  interface AgentsRegistryLike {
    get(id: string | number): { inject(message: unknown): void; whenIdle(): Promise<void> } | undefined
  }
  const agents = ctx.get?.('agents') as AgentsRegistryLike | undefined

  // 收尾沉淀状态（1.2）：turn 内出现过收尾词 → turn/end 沉淀一次
  let turnClosingWord = false
  let turnClosingSession = ''
  // 主动压缩节流（3.2 增强层）：每回合最多尝试一次
  let turnCompactAttempted = false

  // 事件驱动注入统一入口（批 0 实测约束 #2：session/event 分发内同步 inject 必被 append 重入拒绝）
  function injectFromEvent(sessionId: string, text: string): void {
    queueMicrotask(() => {
      try {
        const agent = agents?.get(sessionId)
        agent?.inject(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'instructions' },
        }))
      } catch (err) {
        console.error(`thread dsh: event inject failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  // G3 原生工具注册（max 2.5）：query_session_memory 经 ctx.tools.register 进模型 tools 参数区。
  // 与 MCP overlay 共用 core runQueryTool（防两处漂移）；MCP 通道保留（多底座适配器 + 回退）。
  const disposeQueryTool = ctx.tools.register(defineTool({
    name: 'query_session_memory',
    description: '查询会话记忆：事件流水与结构化表（目标/决策/反馈）的按需检索，支持导航原语（ls/cd/cat/grep）。需要历史细节、上下文或不确定时调用，不要编造；未找到时返回 not-found 标记。',
    parameters: {
      query: { type: 'string', description: '检索查询（grep 导航时为其关键词），如 "登录方案 决策"' },
      nav: { type: 'string', enum: ['ls', 'cd', 'cat', 'grep'], description: '导航指令：ls 列子项（会话产出/待办或产出关联）| cd 节点详情 | cat 全文 | grep 检索带关联上下文' },
      target: { type: 'string', description: '导航目标（会话 id / asset id / 文档路径）' },
      limit: { type: 'integer', description: '最大返回片段数' },
      session_id: { type: 'string', description: '会话 ID；缺省使用最近活跃会话' },
      kind: { type: 'string', enum: ['user_message', 'assistant_message', 'tool_call', 'tool_result', 'compact_checkpoint', 'goal', 'decision', 'feedback'], description: '按类型过滤：事件类或结构化表类 goal/decision/feedback' },
      since: { type: 'string', description: '时间下界 ISO（精确查询路径）' },
      until: { type: 'string', description: '时间上界 ISO（精确查询路径）' },
      order: { type: 'string', enum: ['asc', 'desc'], description: '排序方向，默认 desc' },
      count_only: { type: 'boolean', description: '只返回计数' },
      token_budget: { type: 'integer', description: '返回结果 token 预算' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args) => {
      const result = runQueryTool(openStore(), {
        query: args.query,
        nav: args.nav,
        target: args.target,
        limit: args.limit,
        session_id: args.session_id,
        kind: args.kind,
        since: args.since,
        until: args.until,
        order: args.order,
        count_only: args.count_only,
        token_budget: args.token_budget,
      })
      return result.text
    },
  }))
  ctx.effect(() => () => disposeQueryTool())

  // ② 动态 SKILL（max 2.1，G2 双保险之一）：注册进 <available_skills> 目录（模型可经 skill 工具加载）；
  // 正文 = core behavior-contract 常量（与首轮锚定注入单一来源）；锚点注入 = 双保险之二（批 2 已实现）
  const skills = ctx.get?.('skills') as { register(skill: { name: string; description: string; source: string; content: string }): () => void } | undefined
  if (skills) {
    try {
      const disposeSkill = skills.register({
        name: 'thread',
        description: 'Thread 会话记忆行为契约：何时查记忆（需要细节就调 query_session_memory）、收尾沉淀纪律、状态卡轮次纪律。',
        source: 'runtime',
        content: THREAD_BEHAVIOR_CONTRACT,
      })
      ctx.effect(() => () => disposeSkill())
    } catch (err) {
      console.error(`thread dsh: skill registration failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // B⑥-② 反馈拦截：tools/pre-execute 后同步守卫——反馈表命中教训即拒绝（零 LLM、确定性）。
  // 官方 ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined；
  // guard() 返回 disposer，经 ctx.effect 注册后在插件卸载/HMR 时连同 SQLite 连接一起清理。
  ctx.effect(() => {
    const disposeGuard = ctx.tools.guard((execution) => {
      try {
        const sessionId = execution.agent?.session?.id
        if (typeof sessionId !== 'string' && typeof sessionId !== 'number') {
          return undefined
        }
        const s = openStore()
        const rows = s.getFeedbackMerged(String(sessionId), projectKey, feedbackRows)
        const hit = matchToolFeedback(rows, execution.name)
        if (hit) {
          return `[Thread 反馈拦截] 已拦截工具「${execution.name}」——教训（反馈 #${hit.id}）：${hit.text}。请改用其他方式完成，或与用户确认后再执行。`
        }
      } catch (err) {
        console.error(`thread dsh: tool guard failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      return undefined
    })
    return () => {
      disposeGuard()
      store?.close()
    }
  })

  // 采集：session/event 订阅 → Thread 事件（origin 幂等，SQLITE_BUSY 重试）
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    try {
      const s = openStore()
      const sessionId = String(session.id)
      // 压缩边界 → compact_checkpoint（§1.5 情境 C：post-compact 判定依赖此事件）。
      // dsh 压缩事务事件顺序 = compaction/start → compaction/summary → user/message(checkpoint 摘要) → compaction/end；
      // 此前四类全落 default 分支被丢弃 → post-compact 情境在 dsh 上从未触发（2026-08-18 修复）。
      // SessionEventMap 未展开 compaction/* 类型，先 cast 宽类型做字符串比较（TS2367 规避）。
      const eventType = (event as unknown as { type: string }).type
      if (eventType === 'turn/start') {
        // 收尾沉淀 + 主动压缩节流按回合复位（1.2 / 3.2）：每 turn 独立判定
        turnClosingWord = false
        turnClosingSession = sessionId
        turnCompactAttempted = false
      }
      if (eventType === 'turn/end' && turnClosingWord && turnClosingSession === sessionId) {
        // 收尾自动沉淀（1.2）：进行中目标 → todos + pending 候选归集；幂等（basis 去重）防重复
        try {
          const result = sedimentClosingTodos(s, sessionId, {
            projectKey,
            isolation: s.getSessionIsolation(sessionId),
          })
          if (result.goalTodosCreated > 0 || result.pendingTodoCreated) {
            injectFromEvent(sessionId, `[Thread 收尾沉淀] 进行中目标 ${result.goalTodosCreated} 条 → 待办；待确认候选归集 ${result.pendingTodoCreated ? '1' : '0'} 条。`)
          }
        } catch (err) {
          console.error(`thread dsh: closing sediment failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        turnClosingWord = false
      }
      if (eventType === 'turn/end' && compactPressureTokens > 0 && !turnCompactAttempted) {
        // 3.2 主动压缩（dsh 增强层，可选）：回合边界 tokenMeter 监控 + compactNow 静默触发。
        // 批 0 实测约束：compactNow 内部自带 runMaintenance（直调，勿再包）；busy/取消降级只记日志。
        turnCompactAttempted = true
        try {
          const compaction = ctx.get?.('compaction', true) as { compactNow(agent: unknown, signal: AbortSignal): Promise<{ compactionId?: string } | null> } | undefined
          const meter = ctx.get?.('tokenMeter', true) as { measure(s: unknown): { totalTokens?: number } } | undefined
          const agent = agents?.get(sessionId)
          if (!compaction || !meter || !agent) {
            console.error(`thread dsh: auto-compact unavailable (compaction=${!!compaction} meter=${!!meter} agent=${!!agent})`)
          } else {
            const m = meter.measure(session)
            if ((m.totalTokens ?? 0) >= compactPressureTokens) {
              void (async () => {
                try {
                  await agent.whenIdle()
                  const result = await compaction.compactNow(agent, AbortSignal.timeout(120000))
                  if (result) {
                    injectFromEvent(sessionId, '[Thread] 上下文压缩完成（主动触发）。')
                  }
                } catch (err) {
                  console.error(`thread dsh: auto-compact failed: ${err instanceof Error ? err.message : String(err)}`)
                }
              })()
            }
          }
        } catch (err) {
          console.error(`thread dsh: auto-compact check failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (eventType === 'compaction/summary') {
        handleCompactionSummary(s, sessionId, event as unknown as { time: number; data: CompactionSummaryData }, {
          projectKey,
          isolation: s.getSessionIsolation(sessionId),
        })
        // 3.1 压缩后重锚定（core 不变量）：事件驱动注入重锚定组合包（post-compact 卡 + skill 正文）。
        // inject 不唤醒 driver——安静等下一轮；injectFromEvent 内部 queueMicrotask 防 append 重入（批 0 约束 #2）
        try {
          const reanchorCard = buildStatusCard(s, {
            sessionId,
            projectKey,
            budgetLines,
            isolated: s.getSessionIsolation(sessionId),
            situation: 'post-compact',
          })
          injectFromEvent(sessionId, `[Thread 压缩后重锚定]\n${THREAD_BEHAVIOR_CONTRACT}\n\n${reanchorCard}`)
        } catch (err) {
          console.error(`thread dsh: re-anchor failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        return
      }
      switch (event.type) {
        case 'user/message': {
          const source = event.data.source
          // 跳过 Thread 自身的注入（状态卡正文不回流事件流，防自我循环）+ dsh 压缩 checkpoint 摘要
          //（摘要已由 compaction/summary → compact_checkpoint 落库，见 isCompactCheckpointSource）
          if (source.kind === 'plugin' && (source.plugin === PLUGIN_NAME || isCompactCheckpointSource(source))) {
            return
          }
          const body = extractText(event.data.content)
          if (!body) {
            return
          }
          const cmd = parseIsolationCommand(body)
          if (cmd?.action === 'isolate') {
            s.setSessionIsolation(sessionId, true)
          } else if (cmd?.action === 'unisolate') {
            s.setSessionIsolation(sessionId, false)
          } else if (cmd?.action === 'publish') {
            if (cmd.kind && cmd.id) {
              s.unisolateRow(sessionId, tableForKind(cmd.kind), cmd.id)
            } else {
              publishLatestIsolated(s, sessionId)
            }
          } else if (cmd?.action === 'feedback-del' && cmd.id) {
            // 反馈治理恢复通道：删除教训行（教训可删即恢复，B⑥-②）
            s.deleteFeedback(cmd.id)
          }
          const after = s.getSessionIsolation(sessionId)
          const appended = appendWithRetry(s, {
            session_id: sessionId,
            kind: 'user_message',
            ts: iso(event.time),
            body,
          }, { projectKey, origin: `dsh://msg#${event.data.id}`, isolation: after }, busyRetries, busyRetryDelayMs)
          applyAnalysis(s, sessionId, { user_msg: body }, {
            sourceEvent: appended.id,
            ts: iso(event.time),
            projectKey,
            origin: `dsh://msg#${event.data.id}`,
            isolation: after,
          })
          // /thread-asset <path> [--topic <t>] 显式登记（0.2 显式登记入口）：source_event = 命令消息
          const assetCmd = parseAssetCommand(body)
          if (assetCmd) {
            try {
              withBusyRetry(() => s.registerAsset({
                sessionId,
                path: assetCmd.path,
                title: readAssetTitle(assetCmd.path, cwd),
                topic: assetCmd.topic,
                sourceEvent: appended.id,
                projectKey,
                isolation: after,
              }), busyRetries, busyRetryDelayMs)
            } catch (err) {
              console.error(`thread dsh: explicit asset registration failed: ${err instanceof Error ? err.message : String(err)}`)
            }
          }
          // 收尾词标记（1.2）：turn/end 时沉淀
          if (isClosingWord(body)) {
            turnClosingWord = true
            turnClosingSession = sessionId
          }
          // /thread-pending 命令（1.3）：回执经事件驱动注入（queueMicrotask 防 append 重入）
          const pendingCmd = parsePendingCommand(body)
          if (pendingCmd) {
            handlePendingCommand(s, sessionId, pendingCmd, projectKey, (text) => injectFromEvent(sessionId, text))
          }
          break
        }
        case 'assistant/message': {
          const body = extractText(event.data.message.content)
          if (!body) {
            return
          }
          appendWithRetry(s, {
            session_id: sessionId,
            kind: 'assistant_message',
            ts: iso(event.time),
            body,
          }, { projectKey, origin: `dsh://msg#${event.data.message.id}`, isolation: s.getSessionIsolation(sessionId) }, busyRetries, busyRetryDelayMs)
          break
        }
        case 'tool/call': {
          const argumentsRaw = event.data.arguments
          const appended = appendWithRetry(s, {
            session_id: String(session.id),
            kind: 'tool_call',
            ts: iso(event.time),
            body: `${event.data.name} 调用参数：${String(argumentsRaw).slice(0, 2000)}`,
            meta: buildToolCallMeta(event.data.name, event.data.callId, argumentsRaw),
          }, { projectKey, origin: `dsh://tool#${event.data.callId}` }, busyRetries, busyRetryDelayMs)
          // 产出识别（0.2）：文档/报告产出 → knowledge_assets 登记 + produces/references 写时建边。
          // 失败降级：登记异常只记日志不阻塞采集主路径（旁路可失败原则）
          const classification = classifyWriteEvent(event.data.name, argumentsRaw) ?? classifyReportEvent(event.data.name, argumentsRaw, event.data.callId)
          if (classification) {
            try {
              withBusyRetry(() => s.registerAsset({
                sessionId: String(session.id),
                path: classification.path,
                title: classification.title,
                sourceEvent: appended.id,
                projectKey,
                isolation: s.getSessionIsolation(String(session.id)),
              }), busyRetries, busyRetryDelayMs)
            } catch (err) {
              console.error(`thread dsh: asset registration failed: ${err instanceof Error ? err.message : String(err)}`)
            }
          }
          break
        }
        case 'tool/result': {
          const resultBlock = event.data.message.content[0] as ToolResultBlock | undefined
          const callId = resultBlock?.toolCallId ?? 'unknown'
          const body = extractText(event.data.message.content)
          appendWithRetry(s, {
            session_id: String(session.id),
            kind: 'tool_result',
            ts: iso(event.time),
            body: body.slice(0, 2000),
            meta: { call_id: callId },
          }, { projectKey, origin: `dsh://toolresult#${callId}` }, busyRetries, busyRetryDelayMs)
          break
        }
        default:
          break
      }
    } catch (err) {
      console.error(`thread dsh: capture failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // 注入：每 turn 首次 pre-step 注入状态卡（预算 ≤200 行，dsh 系统侧分档）
  // 注意：pre-step 的 step 从 1 开始，按 turn 去重即可，不能判 step === 0
  const injectedTurns = new Set<number>()
  ctx.on('agent/pre-step', async (payload, next) => {
    if (isOwnInjection((payload as { messages?: readonly unknown[] }).messages ?? [])) {
      return next()
    }
    const turn = payload.turn
    if (injectedTurns.has(turn)) return next()
    injectedTurns.add(turn)
    try {
      const s = openStore()
      const sessionId = payload.agent.session?.id ?? ''
      // G5 跨会话 delta（2.3.2）：回合边界水位判定，他代理有新决策/目标/偏好/候选变更才注入
      if (sessionId && !s.getSessionIsolation(String(sessionId))) {
        try {
          const key = `lastDeltaAt:${String(sessionId)}`
          const since = s.getMeta(key)
          if (since === undefined) {
            // 首轮水位初始化：历史状态由首轮锚定 + 接续包承载，不重放全部历史
            s.setMeta(key, new Date().toISOString())
          } else {
            const delta = getStateDelta(s, {
              projectKey,
              since,
              excludeSessionId: String(sessionId),
              viewerSessionId: String(sessionId),
            })
            const deltaText = renderStateDelta(delta)
            if (deltaText) {
              payload.agent.inject(createUserMessage({
                content: [{ type: 'text', text: deltaText }],
                source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'instructions' },
              }))
              s.setMeta(key, new Date().toISOString())
            }
          }
        } catch (err) {
          console.error(`thread dsh: delta failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      // 三触发送达（v3）：锚点 = 首轮（锚定/续接卡）与压缩后（事件驱动重锚定）+ 每回合 G5 delta。
      // 非首轮不再注入每轮状态卡（G4 交换：模型忘状态 → skill 教"需要细节就调工具查" + delta/重锚定兜底）
      if (turn === 1 && sessionId) {
        const card = buildStatusCard(s, {
          sessionId: String(sessionId),
          projectKey,
          budgetLines,
          isolated: s.getSessionIsolation(String(sessionId)),
          firstTurn: true,
          // 情境判定（§1.5 P0 C+A）：new-session=首轮有历史 → 续接块
          situation: detectSituation(s, { sessionId: String(sessionId), turn, projectKey }),
        })
        // 首轮锚定组合包（1.1）：全新会话（turn===1 且本会话无事件）→ init 锚定 + 行为契约正文 + 状态卡
        const isFreshSession = s.getRecentEvents(String(sessionId), 1).length === 0
        const text = isFreshSession
          ? `[Thread 首轮锚定]\n项目: ${projectKey}\n${THREAD_NORTH_STAR}\n\n${THREAD_BEHAVIOR_CONTRACT}\n\n${card}`
          : card
        payload.agent.inject(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'instructions' },
        }))
      }

      // 轻确认弹窗（§1.5.3d 通道一）：本会话有待确认的决策候选（未提示过）→ 弹窗问用户
      // 选项：确认（转正）/ 取消（丢弃）/ 推迟（保持 pending 等唤醒）；不阻塞 pre-step（fire-and-forget）
      if (!s.getSessionIsolation(String(sessionId))) {
        void promptPendingCandidates(ctx, s, String(sessionId), projectKey)
      }
    } catch (err) {
      console.error(`thread dsh: injection failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    return next()
  })
}

function appendWithRetry(store: ThreadStore, event: Parameters<ThreadStore['append']>[0], opts: Parameters<ThreadStore['append']>[1], retries: number, retryDelayMs: number, tries = 0) {
  try {
    return store.append(event, opts)
  } catch (err) {
    if ((err as { code?: string })?.code === 'SQLITE_BUSY' || String(err).includes('database is locked')) {
      if (tries < retries) {
        sleepSync(retryDelayMs)
        return appendWithRetry(store, event, opts, retries, retryDelayMs, tries + 1)
      }
    }
    throw err
  }
}

// 自然语言沉淀兜底：把本会话最近一条隔离的结构化行转共享
function publishLatestIsolated(store: ThreadStore, sessionId: string): void {
  for (const table of ['decisions', 'feedback', 'goals'] as const) {
    const row = store.structuredDb
      .prepare(`SELECT id FROM ${table} WHERE session_id = ? AND isolation = 1 ORDER BY id DESC LIMIT 1`)
      .get(sessionId) as { id: number } | undefined
    if (row) {
      store.unisolateRow(sessionId, table, row.id)
      return
    }
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// SQLITE_BUSY 重试泛化（registerAsset 等结构化写同事件采集共用重试语义）
function withBusyRetry<T>(fn: () => T, retries: number, retryDelayMs: number, tries = 0): T {
  try {
    return fn()
  } catch (err) {
    if ((err as { code?: string })?.code === 'SQLITE_BUSY' || String(err).includes('database is locked')) {
      if (tries < retries) {
        sleepSync(retryDelayMs)
        return withBusyRetry(fn, retries, retryDelayMs, tries + 1)
      }
    }
    throw err
  }
}

// /thread-asset 标题：读文件首行 # 标题，不可读兜底 basename（显式登记不因文件不可读而失败）
function readAssetTitle(path: string, cwd: string): string {
  const resolved = isAbsolute(path) ? path : join(cwd, path)
  try {
    const content = readFileSync(resolved, 'utf8').slice(0, 800)
    return extractTitleFromContent(content, path)
  } catch {
    return extractTitleFromContent(undefined, path)
  }
}

// ─── 轻确认弹窗（§1.5.3d 通道一）───
// userQuestions 服务类型（dsh 主程序注入，UI 弹窗暂停等用户回答）
interface UserQuestionServiceLike {
  ask(request: {
    questions: Array<{
      id: string
      question: string
      detail?: string
      header?: string
      options?: Array<{ label: string; description?: string }>
    }>
  }): Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }>
}

// 弹窗待确认的决策候选（仅未提示过的，避免每轮弹）；fire-and-forget，不阻塞 pre-step
async function promptPendingCandidates(
  ctx: { userQuestions?: UserQuestionServiceLike; get?: (name: string) => unknown },
  store: ThreadStore,
  sessionId: string,
  projectKey?: string,
): Promise<void> {
  try {
    const uq = ctx.userQuestions ?? (ctx.get?.('userQuestions') as UserQuestionServiceLike | undefined)
    if (!uq) return // dsh 无 UI 环境（headless）→ 走状态卡计数通道
    const candidates = store.listPendingCandidates({ sessionId, projectKey }).filter((c) => c.kind === 'decision' && c.prompt_count === 0)
    if (candidates.length === 0) return
    const c = candidates[0]
    store.markCandidatePrompted(c.id)
    const answer = await uq.ask({
      questions: [{
        id: `pending-${c.id}`,
        header: 'Thread 轻确认',
        question: `我注意到你可能定了这条决策，确认吗？`,
        detail: c.text,
        options: [
          { label: '确认', description: '转为正式决策' },
          { label: '取消', description: '丢弃这条候选' },
          { label: '推迟', description: '暂不处理，之后可再确认' },
        ],
      }],
    })
    const selected = answer.answers[0]?.selected?.[0]
    handlePendingAnswer(store, sessionId, c.id, selected ?? '', { projectKey })
  } catch {
    // 弹窗失败降级（用户环境无 UI 或无应答），候选保持 pending，走状态卡计数通道
  }
}

// 弹窗选项处理（导出便于单测）：确认 → 转正 active；取消 → 丢弃；推迟/未知 → 保持 pending
export function handlePendingAnswer(
  store: ThreadStore,
  sessionId: string,
  candidateId: number,
  selected: string,
  opts: { projectKey?: string } = {},
): void {
  if (selected === '确认') {
    const confirmed = store.confirmCandidate(candidateId)
    if (confirmed) {
      store.proposeDecision(sessionId, confirmed.text, { projectKey: opts.projectKey })
      store.confirmLatestProposed(sessionId)
    }
  } else if (selected === '取消') {
    store.ignoreCandidate(candidateId)
  }
  // '推迟' 与未知选项：保持 pending（prompt_count 已 +1，后续靠唤醒/超时）
}

// 压缩边界落库（导出便于单测）：dsh compaction/summary → compact_checkpoint。
// post-compact 情境判定（detectSituation）依赖本会话最近事件含 compact_checkpoint，
// 此事件此前缺失导致该情境在 dsh 上从未触发（2026-08-18 修复）。
export function handleCompactionSummary(
  store: ThreadStore,
  sessionId: string,
  event: { time: number; data: CompactionSummaryData },
  opts: { projectKey?: string; isolation?: boolean } = {},
): void {
  const { summary, compactionId } = event.data
  if (!summary || !compactionId) {
    // 契约防御：缺摘要/缺事务 id 不落库（压缩事务异常时不产生 checkpoint 标记）
    return
  }
  appendWithRetry(store, {
    session_id: sessionId,
    kind: 'compact_checkpoint',
    ts: iso(event.time),
    body: summary,
    meta: {
      trigger: event.data.sourceCommandId !== undefined ? 'manual' : 'auto',
      model: event.data.model,
      provider: event.data.provider,
      compactionId,
    },
  }, {
    projectKey: opts.projectKey,
    origin: `dsh://compaction#${compactionId}`,
    isolation: opts.isolation,
  }, 20, 100)
}
