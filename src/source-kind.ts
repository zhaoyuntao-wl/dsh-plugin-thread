// dsh 消息来源契约（0.2.0 起）：@deepseek-ai/dsh-llm 的 MessageSourceMap 是**按生产者合并扩展**的
// 和类型——没有共享的 catch-all 'plugin' kind，每个生产者在自己的模块里声明自己的 kind
// （同款写法见 dsh-tools 'tool-registry'/'ptc-mode'、dsh-agent-instructions 'agent-instructions'、
// dsh-compaction 'compact-checkpoint'）。0.1.x 的 { kind: 'plugin', plugin: <name> } 在 0.2.0-rc.2 下
// 不可赋值（类型探针 2026-10-07 实证），故本插件声明自己的两个 kind；form 仍走官方 ContextFormed
// 词表（instructions/catalog/snapshot/notice/relay/recall）。
import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Thread 会话记忆插件注入：状态卡、首轮锚定/续接包、跨会话 delta、决策弹窗回执。 */
    'dsh-thread': { kind: 'dsh-thread' } & ContextFormed
    /** batch-0 契约探针注入（开发期，THREAD_B0_PROBE=1 才激活）。 */
    'dsh-thread-b0': { kind: 'dsh-thread-b0' } & ContextFormed
    /** batch-0 双代理 drill 注入：刻意用非本插件 kind，让主插件按真实轮处理（delta 块才会跑）。 */
    'dsh-thread-b0-drill': { kind: 'dsh-thread-b0-drill' } & ContextFormed
  }
}

/** 本插件注入内容的来源 kind（= 插件名，用于识别自身注入、防自我循环采集）。 */
export const THREAD_SOURCE_KIND = 'dsh-thread'
/** batch-0 探针注入内容的来源 kind。 */
export const B0_SOURCE_KIND = 'dsh-thread-b0'
/** batch-0 双代理 drill 注入内容的来源 kind（刻意区别于本插件 kind）。 */
export const B0_DRILL_SOURCE_KIND = 'dsh-thread-b0-drill'

export type SourceLike = { kind?: string } | undefined

export function isThreadSource(source: SourceLike): boolean {
  return source?.kind === THREAD_SOURCE_KIND
}

// dsh 压缩 checkpoint 摘要来源标记（官方 @deepseek-ai/dsh-compaction/checkpoint 契约）。
// 0.2.0-rc.2 起 kind = 'compact-checkpoint'（0.1.x 为 { kind: 'plugin', plugin: 'compact' }）。
// 官方谓词 isCompactCheckpointSource(source) 是运行时依赖，本插件不引 dsh-compaction（保持 peer 面最小）：
// 这里保留逐字常量，并用单测「官方谓词一致」用例 import 官方谓词交叉验证（官方改名 → 测试红，而非静默失配）。
export const COMPACT_CHECKPOINT_SOURCE_KIND = 'compact-checkpoint'

export function isCompactCheckpointSource(source: SourceLike): boolean {
  return source?.kind === COMPACT_CHECKPOINT_SOURCE_KIND
}
