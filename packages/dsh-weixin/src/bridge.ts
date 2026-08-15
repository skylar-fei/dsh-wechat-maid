/**
 * WeixinBridge - implements the weixin-agent-sdk Agent interface by routing
 * every inbound WeChat message into one shared DSH agent session (created
 * lazily and kept alive for the process lifetime). The same session also
 * appears in the web session list, so WeChat and the web GUI share one agent
 * and one memory.
 *
 * Agent creation composes the deployment's default preset (full tool set:
 * pwsh, web_search, read, write, ...), then installs the model selection on
 * top. Scheduled tasks are serialized so two tasks firing close together never
 * interleave their turns in the shared session.
 */

import { installModelSelection, type Agent as DshAgent, type AgentHandle, type ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type { Agent as WeixinAgent, ChatRequest, ChatResponse } from 'weixin-agent-sdk'

/** Live config the bridge reads lazily (survives settings edits without reconnecting). */
export interface WeixinBridgeConfig {
  agentProvider?: string
  agentModel?: string
  replyTimeoutMs?: number
}

/** Stable id for the shared agent session (also shown in the web session list). */
const WEIXIN_SESSION_ID = 'dsh-weixin'

/** Resolve the model selection: plugin config overrides the deployment default. */
export function resolveModelSelection(config: WeixinBridgeConfig, defaults: ModelSelection): ModelSelection {
  const result: ModelSelection = {
    provider: config.agentProvider?.trim() || defaults.provider,
    model: config.agentModel?.trim() || defaults.model,
  }
  if (defaults.reasoningEffort !== undefined) result.reasoningEffort = defaults.reasoningEffort
  return result
}

/** Extract the text of one content block list. */
function textOf(content: readonly { type: string; text?: string }[]): string {
  return content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
}

/**
 * Walk the events after a baseline to summarize one turn's outcome.
 *
 * The authoritative failure signals are a turn-level error and a failed
 * weixin_send call (the notification the task is supposed to deliver). Text
 * heuristics are avoided: a successful reply can legitimately mention 失败 /
 * 没有 in passing.
 */
export function extractTurnOutcome(events: readonly SessionEvent[], baseline: number): { ok: boolean; summary: string } {
  let ok = true
  let summary = ''
  const weixinSendCallIds = new Set<string>()
  for (let i = baseline; i < events.length; i++) {
    const event = events[i]
    if (event.type === 'assistant/message') {
      const text = textOf(event.data.message.content as { type: string; text?: string }[])
      if (text !== '') summary = text
    }
    if (event.type === 'turn/end') {
      const reason = event.data.reason
      if (reason.kind === 'error') {
        ok = false
        const failure = reason.error as { message?: string } | undefined
        summary = failure?.message ?? '执行出错'
      }
    }
    if (event.type === 'tool/call' && event.data.name === 'weixin_send') {
      weixinSendCallIds.add(event.data.callId)
    }
  }
  // A weixin_send that failed means the notification never reached the user.
  for (let i = baseline; i < events.length; i++) {
    const event = events[i]
    if (event.type !== 'tool/result') continue
    const source = event.data.message.source as { callId?: string } | undefined
    if (source?.callId === undefined || !weixinSendCallIds.has(source.callId)) continue
    const text = textOf(event.data.message.content as { type: string; text?: string }[])
    if (text.includes('发送失败')) ok = false
  }
  if (summary.length > 120) summary = summary.slice(0, 120) + '…'
  if (summary === '') summary = ok ? '完成' : '未知错误'
  return { ok, summary }
}

/** Walk backwards from the baseline to find the last non-empty assistant text. */
export function extractLatestAssistantText(events: readonly SessionEvent[], baseline: number): string {
  for (let i = events.length - 1; i >= baseline; i--) {
    const event = events[i]
    if (event.type === 'assistant/message') {
      const text = textOf(event.data.message.content as { type: string; text?: string }[])
      if (text !== '') return text
    }
  }
  return ''
}

/** The inbound-message -> shared-agent bridge. */
export class WeixinBridge implements WeixinAgent {
  private handle: AgentHandle | undefined
  private pending: Promise<DshAgent> | undefined
  private taskChain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly ctx: Context,
    private readonly getConfig: () => WeixinBridgeConfig,
  ) {}

  /** Resolve the workspace directory the shared session should live in. */
  private resolveCwd(): string | undefined {
    try {
      const workspace = this.ctx.workspaceRegistry.list()[0]
      if (workspace !== undefined) return workspace.path
    } catch {
      // workspaceRegistry unavailable - fall through
    }
    return process.cwd()
  }

  /** Lazily create (once) and return the shared agent. */
  private ensureAgent(): Promise<DshAgent> {
    if (this.handle !== undefined) return Promise.resolve(this.handle.agent)
    if (this.pending === undefined) {
      this.pending = (async () => {
        const defaultModel = this.ctx.agentDefaultModel
        if (defaultModel === undefined) {
          throw new Error('dsh-weixin: ctx.agentDefaultModel 服务不可用（请确认 dsh-agent-default-model 已加载）')
        }
        const selection = resolveModelSelection(this.getConfig(), defaultModel.currentSelection())
        if (!selection.provider || !selection.model) {
          throw new Error('dsh-weixin: 未找到默认模型，请先在设置里配置 agent 默认模型')
        }
        const agentOptions = {
          provider: selection.provider,
          model: selection.model,
        }
        // Compose the agent from the deployment's default preset so it carries
        // the full tool set (pwsh, web_search, read, write, ...).
        const preset = await this.ctx.agentPresets.resolve()
        const setup = async (agentCtx: Context): Promise<void> => {
          await this.ctx.agentPresets.mount(agentCtx, preset.id)
          installModelSelection(agentCtx, {
            current: selection,
            assembled: undefined,
          })
        }

        let handle: AgentHandle
        try {
          handle = await this.ctx.agents.resume({
            resumeSessionId: SessionId(WEIXIN_SESSION_ID),
            agentOptions,
            setup,
          })
        } catch {
          handle = await this.ctx.agents.create({
            sessionId: SessionId(WEIXIN_SESSION_ID),
            meta: { cwd: this.resolveCwd(), agentPreset: preset.id },
            agentOptions,
            setup,
          })
        }
        this.handle = handle
        // Wait for the freshly started agent to reach its initial idle state,
        // so the first followup below opens a clean turn boundary.
        await handle.agent.whenIdle()
        return handle.agent
      })()
    }
    return this.pending
  }

  /** Route one WeChat message through the agent and return its reply. */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const agent = await this.ensureAgent()
      const baseline = agent.session.seq
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: request.text }],
        source: { kind: 'user' },
      }))
      await this.awaitIdle(agent)
      const text = extractLatestAssistantText(agent.session.events, baseline)
      return { text: text === '' ? '(没有文本回复)' : text }
    } catch (error) {
      return { text: '处理消息失败：' + (error instanceof Error ? error.message : String(error)) }
    }
  }

  /** Eagerly create the shared agent (best-effort) so scheduled tasks can fire even before the first WeChat message. */
  start(): void {
    void this.ensureAgent().catch((error) => {
      console.error('[dsh-weixin] eager agent creation failed:', error instanceof Error ? error.message : String(error))
    })
  }

  /** Drive the shared agent with a scheduled-task prompt, serialized so tasks never interleave. */
  async runPrompt(prompt: string): Promise<{ ok: boolean; summary: string }> {
    const run = this.taskChain.then(() => this.doRunPrompt(prompt))
    this.taskChain = run.catch(() => {})
    return run
  }

  private async doRunPrompt(prompt: string): Promise<{ ok: boolean; summary: string }> {
    const agent = await this.ensureAgent()
    const baseline = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }))
    await this.awaitIdle(agent)
    return extractTurnOutcome(agent.session.events, baseline)
  }

  /** Await agent quiescence with a bounded fallback so a stuck turn cannot hang a reply forever. */
  private async awaitIdle(agent: DshAgent): Promise<void> {
    const timeoutMs = this.getConfig().replyTimeoutMs ?? 300000
    await Promise.race([
      agent.whenIdle(),
      new Promise<void>((resolve) => { setTimeout(resolve, timeoutMs) }),
    ])
  }

  /** Dispose the shared agent on plugin unload. */
  async dispose(): Promise<void> {
    if (this.handle !== undefined) {
      await this.handle.dispose()
      this.handle = undefined
    }
    this.pending = undefined
  }
}
