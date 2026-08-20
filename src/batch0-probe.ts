// MAX v3 批 0 底座能力验证探针（spike 产物，env 门控：THREAD_B0_PROBE=1 时随 dsh-thread 加载）。
// 六项 smoke 结论写 JSONL fixture（THREAD_B0_FIXTURE），供批 1-4 决策 + live 事件形状快照固件。
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const B0_MARKER_PREFIX = 'THREAD-B0-MARKER-'
// 复用主插件 source：主采集跳过 plugin=dsh-thread 的 user/message，探针标记不污染 Thread 事件流
const B0_PLUGIN_SOURCE = 'dsh-thread'

// 运行时形状声明（dsh-skill/dsh-compaction/dsh-token-meter 类型不在本仓依赖树，按官方契约声明最小面）
interface SkillRegistryLike {
  register(skill: { name: string; description?: string; source: string; content: string; invocation?: unknown }): () => void
  list(options?: { cwd?: string }): Promise<Array<{ name: string; description?: string }>>
}
interface CompactionEngineLike {
  compactNow(agent: unknown, signal: AbortSignal, sourceCommandId?: string): Promise<{ compactionId?: string } | null>
  compactRegion(start: number, end: number, agent: unknown, signal?: AbortSignal): Promise<{ compactionId?: string } | null>
}
interface TokenMeterLike {
  measure(session: Session, requestHeader?: unknown): { pressureTokens?: number; [key: string]: unknown }
}
interface ToolRuntimeLike {
  register(definition: unknown): () => void
  schemas(): Array<{ name: string }>
}
interface AgentsRegistryLike {
  get(id: string | number): Agent | undefined
}

export interface Batch0ProbeEnv {
  fixturePath: string
  compact: boolean
  followup: boolean
}

export function runBatch0Probes(ctx: Context, env: Batch0ProbeEnv): void {
  mkdirSync(dirname(env.fixturePath), { recursive: true })
  const log = (probe: string, data: Record<string, unknown> = {}): void => {
    try {
      appendFileSync(env.fixturePath, JSON.stringify({ t: new Date().toISOString(), probe, ...data }) + '\n')
    } catch {
      // fixture 写入失败不阻塞插件主路径
    }
  }
  const extractText = (content: readonly { type: string; text?: string }[] | undefined): string =>
    (content ?? []).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('\n').trim()
  // strict=true 强制激活惰性服务（headless 下 compaction/tokenMeter 无消费者拉取时不在注册表）
  const get = (name: string): unknown => {
    try {
      return ctx.get?.(name, true)
    } catch (err) {
      log('00-service-activate-error', { name, error: String(err) })
      return undefined
    }
  }
  const tools = get('tools') as ToolRuntimeLike | undefined
  const skills = get('skills') as SkillRegistryLike | undefined
  const compaction = get('compaction') as CompactionEngineLike | undefined
  const tokenMeter = get('tokenMeter') as TokenMeterLike | undefined
  const agents = get('agents') as AgentsRegistryLike | undefined
  log('00-services', {
    tools: tools !== undefined,
    skills: skills !== undefined,
    compaction: compaction !== undefined,
    tokenMeter: tokenMeter !== undefined,
    agents: agents !== undefined,
  })

  // ① ctx.tools.register → schemas() 含探针工具（模型工具面）
  try {
    if (!tools) {
      log('01-tool', { ok: false, reason: 'no tools service' })
    } else {
      const dispose = tools.register(defineTool({
        name: 'thread_b0_probe',
        description: '批 0 探针工具：回显 message 参数。仅用于验证 Thread 插件注册的工具出现在模型工具面并可被调用。',
        parameters: {
          message: { type: 'string', required: true, description: '要回显的文本' },
        },
        output: {
          schema: { type: 'object', properties: { echoed: { type: 'string' } }, additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: `thread_b0_probe 回显: ${String(value.echoed)}` }],
        },
        execute: async (args) => {
          log('01-tool-executed', { message: String(args.message) })
          return { echoed: String(args.message) }
        },
      }))
      ctx.effect(() => () => dispose())
      const names = tools.schemas().map((s) => s.name)
      log('01-tool', { ok: names.includes('thread_b0_probe'), inSchemas: names.includes('thread_b0_probe'), schemaCount: names.length })
    }
  } catch (err) {
    log('01-tool', { ok: false, error: String(err) })
  }

  // ② ctx.skills.register → list() 目录含 thread-b0（模型可发现面）
  void (async () => {
    try {
      if (!skills) {
        log('02-skill', { ok: false, reason: 'no skills service' })
        return
      }
      const dispose = skills.register({
        name: 'thread-b0',
        description: '批 0 探针技能：验证动态 SKILL 注册进目录且可被 skill 工具加载。',
        source: 'runtime',
        content: 'thread-b0 探针技能正文。调用方加载本技能即证明动态注册生效。',
      })
      ctx.effect(() => () => dispose())
      const catalog = await skills.list()
      log('02-skill', { ok: catalog.some((s) => s.name === 'thread-b0'), catalogNames: catalog.map((s) => s.name) })
    } catch (err) {
      log('02-skill', { ok: false, error: String(err) })
    }
  })()

  // ⑤ compaction/* 事件形状 + 事件类型目录（快照固件）+ ④ tokenMeter + ③ compactNow + ⑥ 压缩后重锚定
  const seenTypes = new Set<string>()
  // ③ compactNow/compactRegion 已多轮实测完毕（见 spike 报告），后续轮次不再触发压缩
  const compactionTriggered = false
  let markerInjected = false
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    try {
      const eventType = (event as unknown as { type: string }).type
      if (!seenTypes.has(eventType)) {
        seenTypes.add(eventType)
        log('05-event-type', { type: eventType })
      }
      if (eventType.startsWith('compaction/')) {
        log('05-compaction-event', { type: eventType, data: (event as { data: unknown }).data })
      }
      if (eventType === 'compaction/summary') {
        const compactionId = (event as { data: { compactionId?: string } }).data?.compactionId ?? 'unknown'
        // ⑥ 压缩后重锚定：事件驱动 agent.inject。
        // 关键约束（round6 实证）：session/event 分发内同步 inject 会 append 重入被拒——
        // 必须推迟到当前事件 append 完成后（queueMicrotask）
        queueMicrotask(() => {
          try {
            const agent = agents?.get(String(session.id))
            if (agent) {
              agent.inject(createUserMessage({
                content: [{ type: 'text', text: `${B0_MARKER_PREFIX}${compactionId}（压缩后重锚定探针标记）` }],
                source: { kind: 'plugin', plugin: B0_PLUGIN_SOURCE, form: 'instructions' },
              }))
              log('06-reanchor', { injected: true, compactionId, agentStatus: agent.status })
              if (env.followup) {
                agent.steer(createUserMessage({
                  content: [{ type: 'text', text: '批 0 探针问题：如果你当前上下文里看到了以 THREAD-B0-MARKER- 开头的标记，请在你的最终汇报里原样包含该标记。' }],
                  source: { kind: 'plugin', plugin: B0_PLUGIN_SOURCE, form: 'instructions' },
                }))
                log('06-reanchor', { steerQueued: true, compactionId })
              }
            } else {
              log('06-reanchor', { injected: false, reason: 'no agent handle', compactionId })
            }
          } catch (err) {
            log('06-reanchor', { injected: false, error: String(err), compactionId })
          }
        })
      }
      if (eventType === 'user/message') {
        const body = extractText((event as { data: { content: Array<{ type: string; text?: string }> } }).data.content ?? [])
        if (body.includes(B0_MARKER_PREFIX)) {
          log('06-marker-landed', { body: body.slice(0, 200) })
        }
      }
      if (eventType === 'assistant/message') {
        const body = (event as { data: { message: { content: Array<{ type: string; text?: string }> } } }).data.message.content
          .map((b) => (b.type === 'text' ? b.text ?? '' : ''))
          .join('\n')
        if (body.includes(B0_MARKER_PREFIX)) {
          log('06-marker-visible', { body: body.slice(0, 500) })
        }
      }
      if (eventType === 'turn/end' && !compactionTriggered) {
        // ④ tokenMeter 压力读取点（回合边界）
        try {
          if (!tokenMeter) {
            log('04-token-meter', { ok: false, reason: 'no tokenMeter service' })
          } else {
            const m = tokenMeter.measure(session)
            log('04-token-meter', {
              ok: true,
              totalTokens: m.totalTokens,
              surfaceTokens: m.surfaceTokens,
              surfaceDeltaTokens: m.surfaceDeltaTokens,
              keys: Object.keys(m),
              nodesSample: JSON.stringify(m.nodes).slice(0, 400),
            })
          }
        } catch (err) {
          log('04-token-meter', { ok: false, error: String(err) })
        }
      }
      // ⑥ 直达测试（不依赖压缩事务）：事件驱动 inject + steer → 下一 step 模型可见性。
      // 压缩后重锚定 = 同一机制把触发点换成 compaction/summary（⑤ 订阅已证、compaction/start 锁语义已证）。
      // compactNow 契约已另证（内部 runMaintenance + idle 认领 + busy 语义；one-shot 终轮被 teardown 赛跑取消）
      if (eventType === 'tool/result' && !markerInjected && env.followup) {
        markerInjected = true
        queueMicrotask(() => {
          const agent = agents?.get(String(session.id))
          if (!agent) {
            log('06-direct', { ok: false, reason: 'no agent handle' })
            return
          }
          try {
            agent.inject(createUserMessage({
              content: [{ type: 'text', text: `${B0_MARKER_PREFIX}direct-${Date.now()}` }],
              source: { kind: 'plugin', plugin: B0_PLUGIN_SOURCE, form: 'instructions' },
            }))
            agent.steer(createUserMessage({
              content: [{ type: 'text', text: '批 0 探针问题：如果你当前上下文里看到了以 THREAD-B0-MARKER- 开头的标记，请在你的最终汇报中原样包含该标记。' }],
              source: { kind: 'plugin', plugin: B0_PLUGIN_SOURCE, form: 'instructions' },
            }))
            log('06-direct', { injected: true, steered: true })
          } catch (err) {
            log('06-direct', { ok: false, error: String(err) })
          }
        })
      }
    } catch (err) {
      log('05-error', { error: String(err) })
    }
  })
  log('00-registered', { env })
}
