// Thread dsh adapter — 采集（session/event → Thread 双库）+ 注入（pre-step → 状态卡）。
// 查询通道走 MCP（thread-sms overlay），本插件不注册工具（旗舰形态，spike ② 三接缝产品化）。
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage, type ContentBlock, type ToolResultBlock } from '@deepseek-ai/dsh-llm'
import {
  ThreadStore,
  applyAnalysis,
  buildStatusCard,
  defaultPaths,
  deriveProjectKey,
} from '@thread/core'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const name = 'dsh-thread'

export const inject = ['tools']

const PLUGIN_NAME = name

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

// 会话临时隔离指令识别：显式命令 + 自然语言（用户偏好各异，双通道都支持）
const ISOLATE_RE = /^(?:\/isolate|[/／]isolate)\b|(?:进入|开启|启用|先)?(?:临时)?(?:隔离|静默|免打扰|别打扰|屏蔽)/
const UNISOLATE_RE = /^(?:\/unisolate|[/／]unisolate)\b|(?:解除|退出|关闭)(?:隔离|静默)|恢复共享/
const PUBLISH_CMD_RE = /^\/thread-publish\s+(goal|decision|feedback)\s+(\d+)\b/
const PUBLISH_NL_RE = /把(?:刚才|刚才的)?(?:这个)?(?:决策|决定|目标|偏好)(?:共享|公开|同步)(?:出去|给项目)?/

interface IsolationCommand {
  action: 'isolate' | 'unisolate' | 'publish'
  kind?: 'goal' | 'decision' | 'feedback'
  id?: number
}

function tableForKind(kind: 'goal' | 'decision' | 'feedback'): 'goals' | 'decisions' | 'feedback' {
  return kind === 'goal' ? 'goals' : kind === 'decision' ? 'decisions' : 'feedback'
}

function parseIsolationCommand(body: string): IsolationCommand | undefined {
  if (PUBLISH_CMD_RE.test(body)) {
    const m = body.match(PUBLISH_CMD_RE)
    return { action: 'publish', kind: m?.[1] as 'goal' | 'decision' | 'feedback', id: Number(m?.[2]) }
  }
  if (PUBLISH_NL_RE.test(body)) {
    // 自然语言沉淀：作用于本会话最近一条隔离结构化行
    return { action: 'publish' }
  }
  if (ISOLATE_RE.test(body)) {
    return { action: 'isolate' }
  }
  if (UNISOLATE_RE.test(body)) {
    return { action: 'unisolate' }
  }
  return undefined
}

export function apply(ctx: Context) {
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

  // 采集：session/event 订阅 → Thread 事件（origin 幂等，SQLITE_BUSY 重试）
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    try {
      const s = openStore()
      switch (event.type) {
        case 'user/message': {
          const source = event.data.source
          // 跳过 Thread 自身的注入（状态卡正文不回流事件流，防自我循环）
          if (source.kind === 'plugin' && source.plugin === PLUGIN_NAME) {
            return
          }
          const body = extractText(event.data.content)
          if (!body) {
            return
          }
          const sessionId = String(session.id)
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
          }
          const after = s.getSessionIsolation(sessionId)
          const appended = appendWithRetry(s, {
            session_id: sessionId,
            kind: 'user_message',
            ts: iso(event.time),
            body,
          }, { projectKey, origin: `dsh://msg#${event.data.id}`, isolation: after })
          applyAnalysis(s, sessionId, { user_msg: body }, {
            sourceEvent: appended.id,
            ts: iso(event.time),
            projectKey,
            origin: `dsh://msg#${event.data.id}`,
            isolation: after,
          })
          break
        }
        case 'assistant/message': {
          const body = extractText(event.data.message.content)
          if (!body) {
            return
          }
          const sessionId = String(session.id)
          appendWithRetry(s, {
            session_id: sessionId,
            kind: 'assistant_message',
            ts: iso(event.time),
            body,
          }, { projectKey, origin: `dsh://msg#${event.data.message.id}`, isolation: s.getSessionIsolation(sessionId) })
          break
        }
        case 'tool/call': {
          appendWithRetry(s, {
            session_id: String(session.id),
            kind: 'tool_call',
            ts: iso(event.time),
            body: `${event.data.name} 调用参数：${event.data.arguments.slice(0, 2000)}`,
            meta: { tool_name: event.data.name, call_id: event.data.callId },
          }, { projectKey, origin: `dsh://tool#${event.data.callId}` })
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
          }, { projectKey, origin: `dsh://toolresult#${callId}` })
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
      const card = sessionId
        ? buildStatusCard(s, {
            sessionId: String(sessionId),
            projectKey,
            budgetLines: 200,
            isolated: s.getSessionIsolation(String(sessionId)),
          })
        : '[Thread 会话记忆状态卡]'
      payload.agent.inject(createUserMessage({
        content: [{ type: 'text', text: card }],
        source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'instructions' },
      }))
    } catch (err) {
      console.error(`thread dsh: injection failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    return next()
  })
}

function appendWithRetry(store: ThreadStore, event: Parameters<ThreadStore['append']>[0], opts: Parameters<ThreadStore['append']>[1], tries = 0) {
  try {
    return store.append(event, opts)
  } catch (err) {
    if ((err as { code?: string })?.code === 'SQLITE_BUSY' || String(err).includes('database is locked')) {
      if (tries < 20) {
        sleepSync(100)
        return appendWithRetry(store, event, opts, tries + 1)
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
