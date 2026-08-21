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
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
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
  // 候选超时天数（2026-08-20 收口）：0=不超时；超龄 pending 候选转 ignored（原文在事件流水，决策不丢）
  candidateTtlDays: z.number().int().nonnegative().default(Number(process.env.THREAD_CANDIDATE_TTL_DAYS ?? 14)),
})
export type Config = z.infer<typeof Config>

// 文本提取（2026-08-21 升级探针修复）：dsh 的 tool/result 块把文本嵌在 content[].content[].text
// （外层 type='tool-result'），只认顶层 text 会丢全部工具输出（生产库实证：tool_result body 全空）。
// 递归下钻任意含 content 数组的块；text 块按行拼接。
export function extractText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  const walk = (blocks: readonly ContentBlock[]): void => {
    for (const block of blocks) {
      if (block.type === 'text') {
        parts.push(block.text)
      } else {
        const nested = (block as { content?: readonly ContentBlock[] }).content
        if (nested && nested.length > 0) {
          walk(nested)
        }
      }
    }
  }
  walk(content)
  return parts.filter(Boolean).join('\n').trim()
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

// ─── 命令语法（2026-08-21 全量重构，用户定案）───
// 资源四类：ast 产出 / dec 决策 / fdb 偏好·教训 / gol 目标。
// thread-reg 注册（无参列资源行）/ thread-rev 解除（决策·偏好·产出删除、目标废弃）/
// thread-pub 隔离行转共享 / thread-cfm 待处理收件箱（t#待办 / c#候选命名空间）/
// thread-iso / thread-uniso 隔离开关。自然语言白名单（隔离/静默等）保留为副通道。
const RESOURCE = '(ast|dec|fdb|gol)'
const REG_LIST_RE = new RegExp(`^\\/thread-reg\\s+${RESOURCE}$`)
const REG_TEXT_RE = new RegExp(`^\\/thread-reg\\s+${RESOURCE}\\s+(.+)$`, 's')
const DEC_SUPERSEDES_RE = /^(.*?)\s+--supersedes\s+(\d+)$/s
const REV_LIST_RE = new RegExp(`^\\/thread-rev\\s+${RESOURCE}$`)
const REV_IDS_RE = new RegExp(`^\\/thread-rev\\s+${RESOURCE}\\s+(all|\\d+(?:\\s*,\\s*\\d+)*)$`)
const PUB_BARE_LIST_RE = /^\/thread-pub$/
const PUB_LIST_RE = new RegExp(`^\\/thread-pub\\s+${RESOURCE}$`)
const PUB_IDS_RE = new RegExp(`^\\/thread-pub\\s+${RESOURCE}\\s+(all|\\d+(?:\\s*,\\s*\\d+)*)$`)
const PUBLISH_NL_RE = /^把(?:刚才|刚才的)?(?:这个)?(?:决策|决定|目标|偏好)(?:共享|公开|同步)(?:出去|给项目)?$/
const ISOLATE_RE = /^(?:\/thread-iso|隔离|开始隔离|进入隔离|临时隔离|静默|免打扰|别打扰)$/
const UNISOLATE_RE = /^(?:\/thread-uniso|解除隔离|退出隔离|恢复共享)$/
const CFM_LIST_RE = /^\/thread-cfm$/
const CFM_DO_RE = /^\/thread-cfm\s+do\s+([tc]#\d+)(?:\s+(.+))?$/s
const CFM_CNL_RE = /^\/thread-cfm\s+cnl\s+([tc]#\d+)$/
const CFM_CNL_ALL_RE = /^\/thread-cfm\s+cnl\s+all$/
// 收尾词白名单（1.2 收尾自动沉淀触发，整条消息精确匹配，防讨论性语句误触发）
const CLOSING_WORD_RE = /^(?:先收了|先收|收工了|收工|今天到这|明天继续|歇了|歇|先记|暂时这样)$/

export type ThreadResource = 'ast' | 'dec' | 'fdb' | 'gol'

const RESOURCE_TO_KIND: Record<ThreadResource, string> = { ast: 'ast', dec: 'decision', fdb: 'feedback', gol: 'goal' }
const KIND_TO_RESOURCE: Record<string, ThreadResource> = { ast: 'ast', decision: 'dec', feedback: 'fdb', goal: 'gol' }
const RESOURCE_LABEL: Record<ThreadResource, string> = { ast: '产出', dec: '决策', fdb: '反馈', gol: '目标' }

function tableForResource(kind: ThreadResource): 'knowledge_assets' | 'goals' | 'decisions' | 'feedback' {
  return kind === 'ast' ? 'knowledge_assets' : kind === 'dec' ? 'decisions' : kind === 'fdb' ? 'feedback' : 'goals'
}

function parseIds(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
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

export type IsoCommand = { action: 'isolate' } | { action: 'unisolate' }

export function parseIsoCommand(body: string): IsoCommand | undefined {
  const text = body.trim()
  if (ISOLATE_RE.test(text)) {
    return { action: 'isolate' }
  }
  if (UNISOLATE_RE.test(text)) {
    return { action: 'unisolate' }
  }
  return undefined
}

export type RegCommand =
  | { action: 'list'; resource: ThreadResource }
  | { action: 'register'; resource: ThreadResource; text: string; supersedesId?: number }

// /thread-reg <ast|dec|fdb|gol> [无参列资源行 | <text>]（2026-08-21 命令重构）：
// dec 支持 --supersedes <id>（取代链保真）；ast 的 text = 路径（目录递归展开）
export function parseRegCommand(body: string): RegCommand | undefined {
  const text = body.trim()
  const list = text.match(REG_LIST_RE)
  if (list) {
    return { action: 'list', resource: list[1] as ThreadResource }
  }
  const m = text.match(REG_TEXT_RE)
  if (!m) {
    return undefined
  }
  const resource = m[1] as ThreadResource
  const rest = m[2].trim()
  if (resource === 'dec') {
    const sm = rest.match(DEC_SUPERSEDES_RE)
    if (sm && sm[1].trim()) {
      return { action: 'register', resource, text: sm[1].trim(), supersedesId: Number(sm[2]) }
    }
  }
  if (!rest || rest.startsWith('--')) {
    // 无正文或只有 flag = 非法输入
    return undefined
  }
  return { action: 'register', resource, text: rest }
}

export type RevCommand =
  | { action: 'list'; resource: ThreadResource }
  | { action: 'revoke'; resource: ThreadResource; ids?: number[] }

// /thread-rev <ast|dec|fdb|gol> [无参列资源行 | <ids> | all]：ids 逗号分隔；ids 缺省 = all
export function parseRevCommand(body: string): RevCommand | undefined {
  const text = body.trim()
  const list = text.match(REV_LIST_RE)
  if (list) {
    return { action: 'list', resource: list[1] as ThreadResource }
  }
  const m = text.match(REV_IDS_RE)
  if (!m) {
    return undefined
  }
  return { action: 'revoke', resource: m[1] as ThreadResource, ids: m[2] === 'all' ? undefined : parseIds(m[2]) }
}

export type PubCommand =
  | { action: 'list'; resource?: ThreadResource }
  | { action: 'publish'; resource: ThreadResource; ids?: number[] }

// /thread-pub [无参列全部隔离行 | <ast|dec|fdb|gol> [无参列该资源隔离行 | <ids> | all]]
export function parsePubCommand(body: string): PubCommand | undefined {
  const text = body.trim()
  if (PUB_BARE_LIST_RE.test(text)) {
    return { action: 'list' }
  }
  const list = text.match(PUB_LIST_RE)
  if (list) {
    return { action: 'list', resource: list[1] as ThreadResource }
  }
  const m = text.match(PUB_IDS_RE)
  if (!m) {
    return undefined
  }
  return { action: 'publish', resource: m[1] as ThreadResource, ids: m[2] === 'all' ? undefined : parseIds(m[2]) }
}

export type CfmCommand =
  | { action: 'list' }
  | { action: 'do'; target: 't' | 'c'; id: number; text?: string }
  | { action: 'cnl'; target: 't' | 'c'; id: number }
  | { action: 'cnl-all' }

// /thread-cfm 待处理收件箱（2026-08-21 命令重构）：待办 t# + 候选 c# 命名空间（两张表 id 单空间冲突）；
// do t#=完成 / do c#[text]=转正（可带修正文本）；cnl t#=丢弃 / cnl c#=取消；cnl all=全清
export function parseCfmCommand(body: string): CfmCommand | undefined {
  const text = body.trim()
  if (CFM_LIST_RE.test(text)) {
    return { action: 'list' }
  }
  if (CFM_CNL_ALL_RE.test(text)) {
    return { action: 'cnl-all' }
  }
  const d = text.match(CFM_DO_RE)
  if (d) {
    return { action: 'do', target: d[1][0] as 't' | 'c', id: Number(d[1].slice(2)), text: d[2]?.trim() || undefined }
  }
  const c = text.match(CFM_CNL_RE)
  if (c) {
    return { action: 'cnl', target: c[1][0] as 't' | 'c', id: Number(c[1].slice(2)) }
  }
  return undefined
}

// thread-asset 路径展开（2026-08-21）：文件 → [文件]；目录 → 递归登记目录内常规文件
// （跳过隐藏目录如 node_modules/.git，上限 50 防失控）；不存在 → [原路径]（标题兜底 basename）
const MAX_ASSET_DIR_FILES = 50
const ASSET_SKIP_DIRS = new Set(['node_modules', '.git', '.dsh', 'dist', 'coverage'])

export function expandAssetPaths(path: string, cwd: string): string[] {
  const resolved = isAbsolute(path) ? path : join(cwd, path)
  let st
  try {
    st = statSync(resolved)
  } catch {
    return [path]
  }
  if (st.isFile()) {
    return [path]
  }
  if (!st.isDirectory()) {
    return [path]
  }
  const files: string[] = []
  const walk = (dir: string, rel: string): boolean => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return true
    }
    for (const e of entries) {
      if (files.length >= MAX_ASSET_DIR_FILES) {
        return false
      }
      if (e.isDirectory()) {
        if (ASSET_SKIP_DIRS.has(e.name) || e.name.startsWith('.')) {
          continue
        }
        if (!walk(join(dir, e.name), `${rel}/${e.name}`)) {
          return false
        }
      } else if (e.isFile()) {
        files.push(`${rel}/${e.name}`.replace(/^\//, ''))
      }
    }
    return true
  }
  walk(resolved, path.replace(/[\\/]+$/, '').replace(/\\/g, '/'))
  return files
}

// /thread-pending 命令（1.3）：list | confirm <id> | cancel <id> | defer <id> | cancel-all
export function isClosingWord(body: string): boolean {
  return CLOSING_WORD_RE.test(body.trim())
}

// 资源列表渲染（thread-reg/thread-rev 无参）：id 可见来源（rev/--supersedes 取 id 用）。
// mode='rev'（2026-08-21 狗粮修正）：只列可操作集合——gol 只列 active（rev 只对进行中生效，
// 已完成/已废弃列出来却不可操作 = 提示不准确）
export function renderResourceList(store: ThreadStore, sessionId: string, resource: ThreadResource, mode: 'reg' | 'rev' = 'reg'): string {
  if (resource === 'ast') {
    const rows = store.listAssets({ sessionId, limit: 500 })
    if (rows.length === 0) {
      return '[Thread 产出] 本会话当前无登记产出。'
    }
    const lines = rows.map((r) => `  #${r.id} ${r.path}${r.title && r.title !== r.path ? `（${r.title.slice(0, 40)}）` : ''}`)
    return `[Thread 产出]\n${lines.join('\n')}\n操作：/thread-rev ast <ids> 解除登记`
  }
  if (resource === 'dec') {
    const rows = store.getDecisions(sessionId).slice(-20).reverse()
    if (rows.length === 0) {
      return '[Thread 决策] 本会话当前无决策。'
    }
    const statusText = (s: string): string =>
      s === 'active' ? '生效' : s === 'superseded' ? '已取代' : s === 'revoked' ? '已撤销' : s
    const lines = rows.map((r) => `  #${r.id} [${statusText(r.status)}] ${r.text.slice(0, 60)}`)
    return `[Thread 决策]\n${lines.join('\n')}\n操作：/thread-reg dec <text> 新建 | --supersedes <id> 取代 | /thread-rev dec <ids> 删除`
  }
  if (resource === 'fdb') {
    const rows = store.getFeedback(sessionId, 50)
    if (rows.length === 0) {
      return '[Thread 反馈] 当前无反馈记录。'
    }
    const lines = rows.map((r) => `  #${r.id} [${r.kind === 'correction' ? '教训' : '偏好'}] ${r.text.slice(0, 60)}`)
    return `[Thread 反馈]\n${lines.join('\n')}\n操作：/thread-reg fdb <text> 新建 | /thread-rev fdb <ids> 删除`
  }
  const all = store.getGoals(sessionId)
  const rows = mode === 'rev' ? all.filter((g) => g.status === 'active') : all
  if (rows.length === 0) {
    return mode === 'rev'
      ? '[Thread 目标] 本会话当前无进行中目标（已完成/已废弃的目标不可废弃）。'
      : '[Thread 目标] 本会话当前无目标。'
  }
  const statusText = (s: string): string => (s === 'active' ? '进行中' : s === 'completed' ? '已完成' : '已废弃')
  const lines = rows.map((r) => `  #${r.id} [${statusText(r.status)}] ${r.text.slice(0, 60)}`)
  const tail = mode === 'rev'
    ? '操作：/thread-rev gol <ids> 废弃（仅进行中目标）'
    : '操作：/thread-reg gol <text> 新建 | /thread-rev gol <ids> 废弃'
  return `[Thread 目标]\n${lines.join('\n')}\n${tail}`
}

// 隔离行清单渲染（thread-pub 无参）：pub 只对 isolation=1 行生效，此清单即用户可见 id 来源
export function renderIsolatedRows(store: ThreadStore, sessionId: string, resource?: ThreadResource): string {
  const rows = store.listIsolatedRows(sessionId).filter((r) => (resource ? r.kind === RESOURCE_TO_KIND[resource] : true))
  const label = resource ? RESOURCE_LABEL[resource] : '隔离行'
  if (rows.length === 0) {
    return resource
      ? `[Thread 隔离${label}] 当前无隔离的${label}。`
      : '[Thread 隔离行] 本会话当前无隔离的结构化行（隔离期间的目标/决策/反馈/产出会出现在这里）。'
  }
  const lines = rows.map((r) => `  #${r.id} [${KIND_TO_RESOURCE[r.kind]}] ${r.text.slice(0, 60)}`)
  return `[Thread 隔离${label}]\n${lines.join('\n')}\n操作：/thread-pub ${resource ?? '<ast|dec|fdb|gol>'} <ids|all> 共享`
}

// 待处理收件箱渲染（thread-cfm 无参）：待办 = 本会话（sessionId 过滤，跨会话待办属接续视图不属本收件箱）；
// 候选 = 项目级（projectKey 过滤，与状态卡候选唤醒视图一致）；t#/c# 命名空间防双表 id 冲突
export function renderCfmList(store: ThreadStore, sessionId: string, projectKey?: string): string {
  const todos = store.listTodos({ sessionId, status: 'pending', limit: 20 })
  const candidates = store.listPendingCandidates(projectKey ? { sessionId, projectKey } : { sessionId })
  if (todos.length === 0 && candidates.length === 0) {
    return '[Thread 待处理] 当前无待处理事项。'
  }
  const lines: string[] = []
  for (const t of todos) {
    lines.push(`  t#${t.id} [待办] ${t.text.slice(0, 60)}${t.basis ? `（${t.basis}）` : ''}`)
  }
  for (const c of candidates) {
    lines.push(`  c#${c.id} [候选${c.kind === 'decision' ? '决策' : '偏好'}] ${c.text.slice(0, 60)}`)
  }
  return `[Thread 待处理]\n${lines.join('\n')}\n操作：/thread-cfm do <id> 完成/转正（候选可带修正文本） | cnl <id> 丢弃/取消 | cnl all`
}

// 命令行判定（2026-08-21）：Thread 命令消息只走命令处理，不喂 applyAnalysis——
// 防双创建/副作用（实锤：/thread-reg fdb 不要用 pwsh → 显式 1 条 + CORRECTION_RE 再 1 条）
export function isThreadCommandLine(body: string): boolean {
  return parseIsoCommand(body) !== undefined
    || parseRegCommand(body) !== undefined
    || parseRevCommand(body) !== undefined
    || parsePubCommand(body) !== undefined
    || parseCfmCommand(body) !== undefined
}

// dsh-commands 最小运行时形状（类型不在本仓依赖树，按官方契约声明）
interface CommandRuntimeLike {
  register(def: {
    name: string
    description: string
    input?: { hint: string }
    handler: (inv: { agent: { session?: { id?: unknown } }; rawInput: string }) => { kind: 'success' | 'error'; text?: string }
  }): () => void
}

// dsh 真命令注册（2026-08-20）：命令面板/斜杠补全/直接执行，handler 文本由 UI 直接呈现。
// rawInput = 命令名后的原文（含分隔空白）→ 重建完整行复用现有白名单解析器（单一解析来源）。
function registerThreadCommands(
  ctx: Context,
  deps: { openStore: () => ThreadStore; projectKey: string; busyRetries: number; busyRetryDelayMs: number },
): void {
  const commands = ctx.get?.('commands') as CommandRuntimeLike | undefined
  if (!commands) {
    return
  }
  const sessionIdOf = (inv: { agent: { session?: { id?: unknown } } }): string => String(inv.agent.session?.id ?? '')
  const reg = (name: string, description: string, hint: string, run: (inv: { agent: { session?: { id?: unknown } }; rawInput: string }) => string): void => {
    try {
      const dispose = commands.register({
        name,
        description,
        // 无输入命令不得给空 hint（实测契约：input hint must not be empty）
        ...(hint ? { input: { hint } } : {}),
        handler: (inv) => {
          try {
            return { kind: 'success' as const, text: run(inv) }
          } catch (err) {
            return { kind: 'error' as const, text: err instanceof Error ? err.message : String(err) }
          }
        },
      })
      ctx.effect(() => () => dispose())
    } catch (err) {
      console.error(`thread dsh: command registration failed (${name}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  reg('thread-reg', '注册产出/决策/偏好·教训/目标（资源名后无 text = 列出该资源取 id）', '<ast|dec|fdb|gol> [text]', (inv) => {
    const sid = sessionIdOf(inv)
    const cmd = parseRegCommand(`/thread-reg${inv.rawInput}`)
    if (!cmd) {
      return '[Thread] 用法：/thread-reg <ast|dec|fdb|gol>（列该资源）或 /thread-reg <ast|dec|fdb|gol> <text>（dec 支持 --supersedes <id>）'
    }
    const s = deps.openStore()
    let text = ''
    handleRegCommand(s, sid, cmd, { projectKey: deps.projectKey, isolation: s.getSessionIsolation(sid), cwd: process.cwd(), busyRetries: deps.busyRetries, busyRetryDelayMs: deps.busyRetryDelayMs }, (t) => {
      text = t
    })
    return text
  })

  reg('thread-rev', '解除注册：决策/偏好/产出删除、目标废弃（资源名后无 ids = 列出该资源）', '<ast|dec|fdb|gol> [ids|all]', (inv) => {
    const sid = sessionIdOf(inv)
    const cmd = parseRevCommand(`/thread-rev${inv.rawInput}`)
    if (!cmd) {
      return '[Thread] 用法：/thread-rev <ast|dec|fdb|gol>（列该资源）或 /thread-rev <ast|dec|fdb|gol> <ids|all>'
    }
    const s = deps.openStore()
    let text = ''
    handleRevCommand(s, sid, cmd, (t) => {
      text = t
    })
    return text
  })

  reg('thread-cfm', '待处理收件箱（待办 t# + 候选 c#；无参 = 列收件箱）', '[无参列收件箱 | do <id> [text] | cnl <id> | cnl all]', (inv) => {
    const sid = sessionIdOf(inv)
    const cmd = parseCfmCommand(`/thread-cfm${inv.rawInput}`)
    if (!cmd) {
      return '[Thread] 用法：/thread-cfm（无参列收件箱）或 /thread-cfm <do|cnl> <t#id|c#id>（cnl all 全清；无前缀数字无法定位）'
    }
    const s = deps.openStore()
    let text = ''
    handleCfmCommand(s, sid, cmd, { projectKey: deps.projectKey }, (t) => {
      text = t
    })
    return text
  })

  reg('thread-pub', '隔离行转共享（无参 = 列出隔离行取 id）', '[无参列隔离行 | <ast|dec|fdb|gol> [ids|all]]', (inv) => {
    const sid = sessionIdOf(inv)
    const cmd = parsePubCommand(`/thread-pub${inv.rawInput}`)
    if (!cmd) {
      return '[Thread] 用法：/thread-pub（无参列全部隔离行）或 /thread-pub <ast|dec|fdb|gol>（列该资源）| <ast|dec|fdb|gol> <ids|all>'
    }
    const s = deps.openStore()
    let text = ''
    handlePubCommand(s, sid, cmd, (t) => {
      text = t
    })
    return text
  })

  reg('thread-iso', '隔离本会话（上下文对其他代理不可见，工具事实仍共享）', '', (inv) => {
    const sid = sessionIdOf(inv)
    deps.openStore().setSessionIsolation(sid, true)
    return '[Thread] 本会话已隔离。'
  })

  reg('thread-uniso', '解除本会话隔离', '', (inv) => {
    const sid = sessionIdOf(inv)
    deps.openStore().setSessionIsolation(sid, false)
    return '[Thread] 本会话已解除隔离。'
  })
}

// ─── 命令执行（2026-08-21 命令重构；注册命令 handler 与消息回退路径共用，防两处漂移）───

// /thread-reg 执行：注册四资源；无参 = 列资源行（respond 回执）
export function handleRegCommand(
  store: ThreadStore,
  sessionId: string,
  cmd: RegCommand,
  opts: { projectKey?: string; isolation?: boolean; cwd?: string; busyRetries?: number; busyRetryDelayMs?: number },
  respond: (text: string) => void,
): void {
  if (cmd.action === 'list') {
    respond(renderResourceList(store, sessionId, cmd.resource))
    return
  }
  const { resource, text } = cmd
  if (resource === 'ast') {
    const cwd = opts.cwd ?? process.cwd()
    const paths = expandAssetPaths(text, cwd)
    for (const p of paths) {
      withBusyRetry(() => store.registerAsset({
        sessionId,
        path: p,
        title: readAssetTitle(p, cwd),
        projectKey: opts.projectKey,
        isolation: opts.isolation,
      }), opts.busyRetries ?? 20, opts.busyRetryDelayMs ?? 100)
    }
    respond(paths.length === 1
      ? `[Thread] 已登记产出：${text}`
      : `[Thread] 已登记 ${paths.length} 个产出（目录递归，上限 ${MAX_ASSET_DIR_FILES}）：${text}/...`)
    return
  }
  if (resource === 'dec') {
    if (cmd.supersedesId !== undefined) {
      const r = store.supersedeDecisionById(sessionId, cmd.supersedesId, text)
      respond(r
        ? `[Thread] 已记录决策 #${r.replacement.id}（取代 #${r.superseded.id}）。`
        : `[Thread] #${cmd.supersedesId} 不存在、非本会话或已失效。`)
      return
    }
    const d = store.addDecision(sessionId, text, { projectKey: opts.projectKey, isolation: opts.isolation })
    respond(`[Thread] 已记录决策 #${d.id}。`)
    return
  }
  if (resource === 'fdb') {
    // 自动分类：纠正句式（不要/别/别再/不要再）→ 教训（关联工具守卫语义），否则偏好
    const kind = /不要|别|别再|不要再/.test(text) ? 'correction' : 'preference'
    store.addFeedback(sessionId, text, kind, { projectKey: opts.projectKey, isolation: opts.isolation })
    respond(`[Thread] 已记录${kind === 'correction' ? '教训' : '偏好'}：${text.slice(0, 60)}`)
    return
  }
  const g = store.addGoal(sessionId, text, { projectKey: opts.projectKey, isolation: opts.isolation })
  respond(`[Thread] 已记录目标 #${g.id}。`)
}

// /thread-rev 执行：决策/偏好/产出硬删除（事件流水保留原文）、目标废弃（状态机 + 待办自愈）
export function handleRevCommand(
  store: ThreadStore,
  sessionId: string,
  cmd: RevCommand,
  respond: (text: string) => void,
): void {
  if (cmd.action === 'list') {
    respond(renderResourceList(store, sessionId, cmd.resource, 'rev'))
    return
  }
  const { resource, ids } = cmd
  if (resource === 'ast') {
    // 上限放宽（2026-08-21 狗粮实证）：listAssets 默认 LIMIT 50 → rev ast all 只删最新 50 行、残留最老 11 行
    const targets = ids ?? store.listAssets({ sessionId, limit: 100000 }).map((a) => a.id)
    let n = 0
    for (const id of targets) {
      if (store.deleteAsset(id)) n++
    }
    respond(`[Thread] 已解除 ${n} 个产出登记。`)
    return
  }
  if (resource === 'dec') {
    const targets = ids ?? store.getDecisions(sessionId).map((d) => d.id)
    let n = 0
    for (const id of targets) {
      if (store.deleteDecision(id)) n++
    }
    respond(`[Thread] 已删除 ${n} 条决策（事件流水保留原文）。`)
    return
  }
  if (resource === 'fdb') {
    const targets = ids ?? store.getFeedback(sessionId, 1000).map((f) => f.id)
    let n = 0
    for (const id of targets) {
      if (store.deleteFeedback(id)) n++
    }
    respond(`[Thread] 已删除 ${n} 条反馈。`)
    return
  }
  // gol：只废弃 active 目标（已完成/已废弃不重复动，ids 命中时明示跳过）；todo 随目标状态自愈 dropped
  const active = store.getActiveGoals(sessionId).map((g) => g.id)
  const targets = ids ?? active
  let n = 0
  let skipped = 0
  for (const id of targets) {
    if (active.includes(id)) {
      if (store.updateGoalStatus(sessionId, id, 'abandoned')) n++
    } else {
      skipped++
    }
  }
  respond(`[Thread] 已废弃 ${n} 个目标（关联待办已同步）${skipped > 0 ? `，跳过 ${skipped} 个已完成/已废弃目标` : ''}。`)
}

// /thread-pub 执行：隔离行转共享；无参 = 列隔离行（全部或单资源）
export function handlePubCommand(
  store: ThreadStore,
  sessionId: string,
  cmd: PubCommand,
  respond: (text: string) => void,
): void {
  if (cmd.action === 'list') {
    respond(renderIsolatedRows(store, sessionId, cmd.resource))
    return
  }
  const table = tableForResource(cmd.resource)
  const kind = RESOURCE_TO_KIND[cmd.resource]
  const rows = store.listIsolatedRows(sessionId).filter((r) => r.kind === kind)
  const targets = cmd.ids ?? rows.map((r) => r.id)
  let n = 0
  for (const id of targets) {
    if (store.unisolateRow(sessionId, table, id)) n++
  }
  respond(`[Thread] 已共享 ${n} 条${RESOURCE_LABEL[cmd.resource]}。`)
}

// /thread-cfm 执行：待处理收件箱（t# 待办 / c# 候选）
export function handleCfmCommand(
  store: ThreadStore,
  sessionId: string,
  cmd: CfmCommand,
  opts: { projectKey?: string },
  respond: (text: string) => void,
): void {
  if (cmd.action === 'list') {
    respond(renderCfmList(store, sessionId, opts.projectKey))
    return
  }
  if (cmd.action === 'do') {
    if (cmd.target === 't') {
      const ok = store.updateTodoStatus(cmd.id, 'done')
      respond(ok ? `[Thread] 待办 t#${cmd.id} 已完成。` : `[Thread] 待办 t#${cmd.id} 不存在。`)
    } else {
      const d = store.promoteCandidate(cmd.id, cmd.text)
      respond(d
        ? `[Thread] 候选 c#${cmd.id} 已转正为决策 #${d.id}${cmd.text ? '（文本已更新）' : ''}。`
        : `[Thread] 候选 c#${cmd.id} 不存在或已处理。`)
    }
    return
  }
  if (cmd.action === 'cnl') {
    if (cmd.target === 't') {
      const ok = store.updateTodoStatus(cmd.id, 'dropped')
      respond(ok ? `[Thread] 待办 t#${cmd.id} 已丢弃。` : `[Thread] 待办 t#${cmd.id} 不存在。`)
    } else {
      const c = store.ignoreCandidate(cmd.id)
      respond(c ? `[Thread] 候选 c#${cmd.id} 已取消。` : `[Thread] 候选 c#${cmd.id} 不存在或已处理。`)
    }
    return
  }
  // cnl all：待办全弃（本会话）+ 候选全弃（项目级），分列两类计数
  let td = 0
  for (const t of store.listTodos({ sessionId, status: 'pending', limit: 1000 })) {
    if (store.updateTodoStatus(t.id, 'dropped')) td++
  }
  const cc = store.ignoreAllPendingCandidates(opts.projectKey ? { sessionId, projectKey: opts.projectKey } : { sessionId })
  respond(`[Thread] 已丢弃 ${td} 条待办、${cc} 条候选。`)
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
      deltaDrill: process.env.THREAD_B0_DELTA_DRILL === '1',
    })
  }
  const budgetLines = config.budgetLines ?? 200
  const feedbackRows = config.feedbackRows ?? 50
  const busyRetries = config.busyRetries ?? 20
  const busyRetryDelayMs = config.busyRetryDelayMs ?? 100
  const compactPressureTokens = config.compactPressureTokens ?? 0
  const candidateTtlDays = config.candidateTtlDays ?? 14
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

  // 模型决策上报工具（2026-08-21 结构通道化）：决策 NL 判定停用后，模型通道 = record_decision 工具。
  // 行为契约（thread skill）指示模型在用户定案/自己确定采用某方案时调用；一条调用记一条 active 决策。
  // supersedes_id 可选：跨会话接续时取代旧决策（id 从状态卡/决策列表/query_session_memory 获取）。
  const disposeRecordTool = ctx.tools.register(defineTool({
    name: 'record_decision',
    description: '把用户定案或你做出的影响后续的决策记录为 Thread 正式决策（决策链）。用户拍板方案、你确定采用某做法、或用户说"就按X"时调用；一条调用记一条决策，text = 决策本身（不带论证）。',
    parameters: {
      text: { type: 'string', description: '决策文本（一句话，不含论证过程）' },
      supersedes_id: { type: 'integer', description: '可选：被本决策取代的旧决策 id（查询状态卡/决策列表后确定）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args, exec) => {
      const s = openStore()
      const sid = String(exec.agent?.session?.id ?? s.getRecentSessionId() ?? '')
      const text = String(args.text ?? '').trim().slice(0, 200)
      if (!text) {
        return '[Thread] record_decision 未记录：决策文本为空。'
      }
      const isolation = s.getSessionIsolation(sid)
      const supersedesId = typeof args.supersedes_id === 'number' ? args.supersedes_id : undefined
      if (supersedesId !== undefined) {
        const r = s.supersedeDecisionById(sid, supersedesId, text)
        return r
          ? `[Thread] 已记录决策 #${r.replacement.id}（取代 #${r.superseded.id}）。`
          : `[Thread] record_decision：决策 #${supersedesId} 不存在、非本会话或已失效，未记录。`
      }
      const d = s.addDecision(sid, text, { projectKey, isolation })
      return `[Thread] 已记录决策 #${d.id}：${text.slice(0, 60)}`
    },
  }))
  ctx.effect(() => () => disposeRecordTool())

  // ② 动态 SKILL（max 2.1，G2 双保险之一）：注册进 <available_skills> 目录（模型可经 skill 工具加载）；
  // 正文 = core behavior-contract 常量（与首轮锚定注入单一来源）；锚点注入 = 双保险之二（批 2 已实现）
  const skills = ctx.get?.('skills') as { register(skill: { name: string; description: string; source: string; content: string; invocation?: { modelInvocable: boolean; userInvocable: boolean } }): () => void } | undefined
  if (skills) {
    try {
      const disposeSkill = skills.register({
        name: 'thread',
        description: 'Thread 会话记忆行为契约：何时查记忆（需要细节就调 query_session_memory）、决策记录（定案时调 record_decision）、收尾沉淀纪律、状态卡轮次纪律。',
        source: 'runtime',
        content: THREAD_BEHAVIOR_CONTRACT,
        // 技能是给模型的行为契约（锚点注入 + skill 工具加载）；不出现在用户 / 列表（2026-08-21 用户定）
        invocation: { modelInvocable: true, userInvocable: false },
      })
      ctx.effect(() => () => disposeSkill())
    } catch (err) {
      console.error(`thread dsh: skill registration failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // dsh 真命令注册（2026-08-20 用户定：命令发现性不能只靠 README/状态卡——状态卡面向模型）。
  // ctx.commands.register → 命令面板/斜杠补全/直接执行（不经模型一轮）；handler 返回文本由 UI 直接呈现。
  // 消息白名单解析保留为回退（headless / 无命令 UI 的底座；web 命令被命令系统拦截不会到达 user/message，无双触发）。
  registerThreadCommands(ctx, { openStore, projectKey, busyRetries, busyRetryDelayMs })

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
  ctx.on('session/event', (session: Session, event: SessionEvent) => {    try {
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
      if (eventType === 'turn/end' && turnClosingSession === sessionId) {
        // 收尾沉淀（1.2 + 2026-08-20 关闭即沉淀）：每回合结束无条件沉淀——幂等（basis 去重）+
        // 目标完成时 todo 自愈 done（core updateGoalStatus 同步）；不再依赖用户记得说收尾词。
        // 收尾词只是额外给用户回执；直接关闭代理由 session/disposed 兜底。
        try {
          const result = sedimentClosingTodos(s, sessionId, {
            projectKey,
            isolation: s.getSessionIsolation(sessionId),
          })
          if (turnClosingWord && (result.goalTodosCreated > 0 || result.pendingTodoCreated)) {
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
          const isoCmd = parseIsoCommand(body)
          if (isoCmd?.action === 'isolate') {
            s.setSessionIsolation(sessionId, true)
          } else if (isoCmd?.action === 'unisolate') {
            s.setSessionIsolation(sessionId, false)
          }
          const after = s.getSessionIsolation(sessionId)
          const appended = appendWithRetry(s, {
            session_id: sessionId,
            kind: 'user_message',
            ts: iso(event.time),
            body,
          }, { projectKey, origin: `dsh://msg#${event.data.id}`, isolation: after }, busyRetries, busyRetryDelayMs)
          // 命令消息跳过 applyAnalysis（2026-08-21）：命令只走命令处理，防双创建/副作用
          if (!isThreadCommandLine(body)) {
            applyAnalysis(s, sessionId, { user_msg: body }, {
              sourceEvent: appended.id,
              ts: iso(event.time),
              projectKey,
              origin: `dsh://msg#${event.data.id}`,
              isolation: after,
            })
          }
          // 收尾词标记（1.2）：turn/end 时沉淀
          if (isClosingWord(body)) {
            turnClosingWord = true
            turnClosingSession = sessionId
          }
          // 命令执行（2026-08-21 重构）：回执经事件驱动注入（queueMicrotask 防 append 重入）
          const regCmd = parseRegCommand(body)
          if (regCmd) {
            handleRegCommand(s, sessionId, regCmd, { projectKey, isolation: after, cwd, busyRetries, busyRetryDelayMs }, (text) => injectFromEvent(sessionId, text))
          }
          const revCmd = parseRevCommand(body)
          if (revCmd) {
            handleRevCommand(s, sessionId, revCmd, (text) => injectFromEvent(sessionId, text))
          }
          const pubCmd = parsePubCommand(body)
          if (pubCmd) {
            handlePubCommand(s, sessionId, pubCmd, (text) => injectFromEvent(sessionId, text))
          } else if (PUBLISH_NL_RE.test(body.trim())) {
            // 自然语言沉淀：作用于本会话最近一条隔离行
            publishLatestIsolated(s, sessionId)
            injectFromEvent(sessionId, '[Thread] 已共享最近一条隔离行。')
          }
          const cfmCmd = parseCfmCommand(body)
          if (cfmCmd) {
            handleCfmCommand(s, sessionId, cfmCmd, { projectKey }, (text) => injectFromEvent(sessionId, text))
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

  // 关闭即沉淀（2026-08-20）：会话 dispose（web 关标签页/新会话/进程正常收尾）→ 最后一搏沉淀，
  // 幂等 + 目标完成时 todo 已自愈——直接关闭代理不丢进行中目标（用户常见使用习惯，北极星 #2）
  ctx.on('session/disposed', (session: Session) => {
    try {
      const s = openStore()
      const sid = String(session.id)
      sedimentClosingTodos(s, sid, {
        projectKey,
        isolation: s.getSessionIsolation(sid),
      })
    } catch (err) {
      console.error(`thread dsh: dispose sediment failed: ${err instanceof Error ? err.message : String(err)}`)
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
      if (sessionId && !s.getSessionIsolation(String(sessionId))) {        try {
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

      // 候选超时接线（2026-08-20 收口）：超龄 pending → ignored（防堆积；原文在事件流水，决策不丢）
      if (candidateTtlDays > 0) {
        try {
          s.expireCandidates({
            before: new Date(Date.now() - candidateTtlDays * 86400000).toISOString(),
            projectKey,
          })
        } catch (err) {
          console.error(`thread dsh: candidate expiry failed: ${err instanceof Error ? err.message : String(err)}`)
        }
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

// ─── 候选折叠卡片（§1.5.3d 通道一）───
// userQuestions 服务类型（dsh 主程序注入，UI 折叠卡片暂停等用户回答）
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

// 折叠卡片问待处理的决策候选（仅未提示过的，避免每轮弹）；fire-and-forget，不阻塞 pre-step。
// 2026-08-21：NL 判定停用后 1.0 期间基本无新候选（legacy 堆积 + 未来 LLM 抽取共用此通道）。
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
        header: 'Thread 候选转正',
        question: `这条候选决策要转正为正式决策吗？`,
        detail: c.text,
        options: [
          { label: '更新', description: '转正为正式决策' },
          { label: '取消', description: '丢弃这条候选' },
          { label: '推迟', description: '暂不处理，之后可再处理' },
        ],
      }],
    })
    const selected = answer.answers[0]?.selected?.[0]
    handlePendingAnswer(store, sessionId, c.id, selected ?? '', { projectKey })
  } catch {
    // 卡片失败降级（用户环境无 UI 或无应答），候选保持 pending，走状态卡计数通道
  }
}

// 折叠卡片选项处理（导出便于单测）：更新 → 转正 active；取消 → 丢弃；推迟/未知 → 保持 pending。
// 2026-08-21 修语义缺口：旧"确认"路径 confirmCandidate+proposeDecision+confirmLatestProposed 三连击
// 绕开候选会话/隔离字段——统一走 store.promoteCandidate（与 /thread-pending update 同一路径）。
export function handlePendingAnswer(
  store: ThreadStore,
  sessionId: string,
  candidateId: number,
  selected: string,
  opts: { projectKey?: string } = {},
): void {
  void sessionId
  void opts
  if (selected === '更新') {
    store.promoteCandidate(candidateId)
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
