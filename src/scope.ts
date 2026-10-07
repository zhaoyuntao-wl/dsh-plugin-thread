// 会话作用域解析（2026-10-07 D1 修复）：项目键跟随**会话工作区**（dsh Session.meta.cwd），
// 不再取进程 cwd——一个 dsh 进程服务的多工作区会话曾共用同一个桶（跨工作区串桶 + 同会话历史跨桶劈裂）。
// THREAD_CWD 仍是最优先的显式覆盖；无会话上下文时退回进程 cwd。
// 抽成独立模块：可单测、可复用（插件主路径与命令通道共用同一解析）。
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ThreadStore, deriveProjectKey, hashProjectKey } from '@thread-memory/core'

export interface SessionLike {
  id?: unknown
  meta?: { cwd?: string }
}

export interface SessionScopesOptions {
  /** Thread 根目录（threadRoot()） */
  root: string
  /** 无会话上下文时的兜底 cwd（= THREAD_CWD ?? process.cwd()） */
  fallbackCwd: string
  /** 仅知 sessionId 时的会话查询（通常是 dsh agents 注册表） */
  lookupAgent?: (sessionId: string) => { session?: unknown } | undefined
}

export interface SessionScopes {
  /** 记住会话对象（含 meta.cwd），供后续按 sessionId 解析 */
  remember(session: unknown): void
  /** 会话对象的项目键（会话级缓存） */
  keyForSession(session: unknown): string
  /** 仅知 sessionId 时的项目键：已见会话 → agents 注册表 → 进程 cwd 兜底 */
  keyOf(sessionId: string): string
  /** 兜底项目键（无会话上下文） */
  fallbackKey(): string
  /** 按项目键取库（structured.db 全局共享，events.db 按项目键分目录；同键复用同一实例） */
  storeFor(key: string): ThreadStore
  /** 关闭全部已打开的库（插件卸载 / HMR） */
  closeAll(): void
}

export function createSessionScopes(opts: SessionScopesOptions): SessionScopes {
  const sessionsById = new Map<string, SessionLike>()
  const keyBySession = new Map<string, string>()
  const storesByKey = new Map<string, ThreadStore>()
  const structuredPath = join(opts.root, 'structured.db')

  const overrideCwd = (): string | undefined => process.env.THREAD_CWD

  return {
    remember(session: unknown): void {
      const s = session as SessionLike | undefined
      if (s?.id === undefined || s.id === null) {
        return
      }
      const id = String(s.id)
      if (!sessionsById.has(id)) {
        sessionsById.set(id, s)
      }
    },

    keyForSession(session: unknown): string {
      const s = session as SessionLike | undefined
      const id = s?.id === undefined || s?.id === null ? '' : String(s.id)
      const cached = id ? keyBySession.get(id) : undefined
      if (cached !== undefined) {
        return cached
      }
      const key = deriveProjectKey(overrideCwd() ?? s?.meta?.cwd ?? opts.fallbackCwd)
      if (id) {
        keyBySession.set(id, key)
      }
      return key
    },

    keyOf(sessionId: string): string {
      const known = sessionsById.get(sessionId)
      if (known) {
        return this.keyForSession(known)
      }
      const agent = opts.lookupAgent?.(sessionId)
      if (agent?.session) {
        this.remember(agent.session)
        return this.keyForSession(agent.session)
      }
      return this.fallbackKey()
    },

    fallbackKey(): string {
      return deriveProjectKey(overrideCwd() ?? opts.fallbackCwd)
    },

    storeFor(key: string): ThreadStore {
      const existing = storesByKey.get(key)
      if (existing) {
        return existing
      }
      const eventsPath = join(opts.root, 'projects', hashProjectKey(key), 'events.db')
      mkdirSync(dirname(eventsPath), { recursive: true })
      mkdirSync(dirname(structuredPath), { recursive: true })
      const created = new ThreadStore({ eventsPath, structuredPath, projectKey: key })
      storesByKey.set(key, created)
      return created
    },

    closeAll(): void {
      for (const opened of storesByKey.values()) {
        opened.close()
      }
      storesByKey.clear()
    },
  }
}
