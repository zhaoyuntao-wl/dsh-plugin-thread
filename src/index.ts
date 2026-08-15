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
          const appended = appendWithRetry(s, {
            session_id: String(session.id),
            kind: 'user_message',
            ts: iso(event.time),
            body,
          }, { projectKey, origin: `dsh://msg#${event.data.id}` })
          applyAnalysis(s, String(session.id), { user_msg: body }, {
            sourceEvent: appended.id,
            ts: iso(event.time),
            projectKey,
            origin: `dsh://msg#${event.data.id}`,
          })
          break
        }
        case 'assistant/message': {
          const body = extractText(event.data.message.content)
          if (!body) {
            return
          }
          appendWithRetry(s, {
            session_id: String(session.id),
            kind: 'assistant_message',
            ts: iso(event.time),
            body,
          }, { projectKey, origin: `dsh://msg#${event.data.message.id}` })
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
    const turn = payload.turn
    if (injectedTurns.has(turn)) return next()
    injectedTurns.add(turn)
    try {
      const s = openStore()
      const sessionId = payload.agent.session?.id ?? ''
      const card = sessionId
        ? buildStatusCard(s, { sessionId: String(sessionId), projectKey, budgetLines: 200 })
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

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
