/**
 * Pet host service — the `pet.*` RPC domain. Owns the state machine wiring
 * (consumes `activity/status` session events and session lifecycle), the
 * affinity ledger, and the persisted display config. The API gateway maps
 * this service's methods onto `pet.state` / `pet.interact` /
 * `pet.setVisible` / `pet.setConfig` for browser consumers.
 * @module @deepseek-ai/dsh-pet-maid/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  applyInteraction,
  applyTurnReward,
  defaultAffinityConfig,
  rankOf,
  type AffinityConfig,
  type AffinityState,
  type PetInteraction,
} from './affinity.ts'
import {
  todayKey,
  loadPetPersist,
  petHomeDir,
  savePetPersist,
  DISPLAY_SIZE_MAX,
  DISPLAY_SIZE_MIN,
  DISPLAY_INSET_MAX,
  PET_NAME_MAX_LENGTH,
  type PetDisplayConfig,
  type PetPersist,
} from './persist.ts'
import {
  defaultTreatConfig,
  settleTreatGrants,
  consumeTreat,
  type TreatConfig,
} from './treats.ts'
import {
  defaultPetStateConfig,
  PetStateMachine,
  type PetStateConfig,
  type PetStateSnapshot,
} from './state.ts'
import { computeTasksView, readWeixinTasks, type PetTasksView } from './weixin-tasks.ts'

/** Plugin configuration. */
export interface PetConfig {
  /** Affinity tuning. */
  affinity?: Partial<AffinityConfig>
  /** State machine tuning. */
  state?: Partial<PetStateConfig>
  /** Treat economy tuning. */
  treats?: Partial<TreatConfig>
  /** Persistence directory override (defaults to $DSH_HOME). */
  persistDir?: string
  /** Master switch for the plugin (browser half + host routes). */
  enabled?: boolean
}

/**
 * The pet's settings-namespace section: the display fields and name the web
 * settings surface edits. `right`/`bottom` are also updated by drag
 * interactions, which keep the settings document in sync through the service.
 */
export interface PetSettingsSection {
  /** Master switch. */
  visible: boolean
  /** Scale of the rendered pet in px (sprite cell height). */
  size: number
  /** Horizontal inset from the viewport right edge, px. */
  right: number
  /** Vertical inset from the viewport bottom edge, px. */
  bottom: number
  /** User-customizable pet display name. */
  name: string
  /** Master switch for the plugin (browser half + host routes). */
  enabled?: boolean
}

/** Settings namespace of the pet capability. Spelled here rather than imported: the browser half spells the same value. */
export const PET_SETTINGS_NAMESPACE = 'pet-maid'

/** WeChat ping sent after every completed turn while auto-coding is on. */
export const AUTO_CODING_MESSAGE = '模型已响应，请继续对话'

/** WeChat ping sent when the model pauses to ask the user a question (auto-coding). */
export const ASK_QUESTION_MESSAGE = '有问题分支待解决'

/** Work-statistics snapshot surfaced by the stats panel. */
export interface PetStatsView {
  /** Completed turns today. */
  todayTurns: number
  /** Lifetime completed turns. */
  totalTurns: number
  /** Latest model id observed. */
  model: string
  /** Uncached input tokens today. */
  inputTokens: number
  /** Output tokens today. */
  outputTokens: number
  /** Cached-read input tokens today. */
  cacheReadTokens: number
  /** Cache-write tokens today. */
  cacheWriteTokens: number
  /** Cache hit rate today, 0..1. */
  cacheHitRate: number
  /** Failed (non-completed) turns today. */
  todayFailedTurns: number
  /** Accumulated active work time today, ms. */
  todayWorkMs: number
}

/** Snapshot returned by `pet.state`. */
export interface PetStateView {
  animation: PetStateSnapshot['animation']
  bubble?: string
  phase: PetStateSnapshot['phase']
  sessionActive: boolean
  /** Affinity ledger snapshot. */
  affinity: {
    points: number
    rank: string
    rankEmoji: string
    pets: number
    feeds: number
    turns: number
    /** True while the pet interaction is inside its cooldown. */
    petCooldown: boolean
    /** True while the feed is inside its cooldown. */
    feedCooldown: boolean
  }
  /** Display configuration. */
  display: PetDisplayConfig
  /** User-customizable pet display name. */
  name: string
  /** Treat (糖果) stock snapshot. */
  treats: {
    /** Stocked treats now. */
    stocked: number
    /** Stock cap. */
    max: number
  }
  /** Work-statistics snapshot for the panel. */
  stats: PetStatsView
  /** Scheduled (future) and executed task lists from the weixin plugin. */
  tasks: PetTasksView
  /** Auto-coding mode: ping WeChat after every completed turn. */
  autoCoding: boolean
}

/** Result of `pet.interact`. */
export interface PetInteractResult {
  /** Reaction copy bubble. */
  reaction: string
  /** Points gained (0 when inside the cooldown). */
  delta: number
  /** Full affinity snapshot (same shape as state view). */
  affinity: PetStateView['affinity']
}

/** Minimal proactive-send surface the dsh-weixin plugin exposes to siblings. */
interface WeixinNotify {
  sendMessage(text: string): Promise<{ ok: boolean; error?: string }>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pet: PetService
    weixin?: WeixinNotify
  }
}

/** Minimal token-usage shape consumed from `assistant/message` events. */
interface TokenUsageLike {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** One session/event guard: only the latest activity snapshot matters. */
interface ActivityStatusEventLike {
  phase?: string
  line?: string
  phrase?: string
}

/**
 * Cordis service exposing the pet RPC domain. Lazy: nothing is scanned or
 * written until a query or interaction arrives; event listeners update only
 * in-memory state, and persistence happens on interaction/config changes
 * plus every completed turn.
 */
export class PetService extends Service {
  static inject: string[] = []

  private readonly machine: PetStateMachine
  private readonly affinityConfig: AffinityConfig
  private readonly treatConfig: TreatConfig
  private readonly persistDir: string
  private persist: PetPersist
  private lastTurnRewardAt = 0
  private enabled: boolean
  private disposeActivity: (() => void) | undefined
  private turnStartAt = 0

  constructor(ctx: Context, config: PetConfig = {}) {
    super(ctx, 'pet')
    this.persistDir = config.persistDir ?? petHomeDir()
    this.affinityConfig = { ...defaultAffinityConfig, ...(config.affinity ?? {}) }
    this.treatConfig = { ...defaultTreatConfig, ...(config.treats ?? {}) }
    this.machine = new PetStateMachine({
      ...defaultPetStateConfig,
      ...(config.state ?? {}),
    })
    this.persist = loadPetPersist(this.persistDir)
    this.enabled = config.enabled ?? true

    this.syncActivity()
  }

  /** Whether the pet service consumes session activity while enabled. */
  isEnabled(): boolean {
    return this.enabled
  }

  /** RPC: current pet state snapshot. */
  async state(): Promise<PetStateView> {
    return this.view()
  }

  /** Current persisted display config (read-only view). */
  display(): PetDisplayConfig {
    return { ...this.persist.display }
  }

  /** Current persisted pet name (read-only view). */
  petName(): string {
    return this.persist.name
  }

  /** Start or stop the session-activity listeners that drive the pet. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.syncActivity()
  }

  private syncActivity(): void {
    if (this.disposeActivity !== undefined) {
      this.disposeActivity()
      this.disposeActivity = undefined
    }
    if (!this.enabled) return
    this.disposeActivity = (() => {
      const disposers = [
        this.ctx.on('session/event', (_session: Session, event: { type: string; data?: unknown }) => {
          if (event.type === 'activity/status') {
            const payload = (event.data ?? {}) as ActivityStatusEventLike
            if (payload.phase === undefined) return
            const phase = payload.phase as PetStateSnapshot['phase']
            // Guard against unknown phases from newer activity trackers.
            if (!['idle', 'waiting', 'thinking', 'tool', 'done'].includes(phase)) return
            this.machine.onActivityStatus({
              phase,
              ...(typeof payload.line === 'string' ? { line: payload.line } : {}),
              ...(typeof payload.phrase === 'string' ? { phrase: payload.phrase } : {}),
            })
            this.machine.onSessionActive()
            if (phase === 'done') this.rewardTurn()
            return
          }
          if (event.type === 'turn/start') {
            this.turnStartAt = Date.now()
            return
          }
          if (event.type === 'turn/end') {
            const reason = (event.data as { reason?: { kind?: string } } | undefined)?.reason
            this.recordTurn(reason?.kind === 'completed')
            return
          }
          if (event.type === 'tool/call' || event.type === 'tool/code-dispatch-start') {
            // A native tool call (non-code mode) vs a nested run_code sub-dispatch
            // (code mode): both carry the invoked tool's name in data.name.
            const name = (event.data as { name?: string } | undefined)?.name
            if (name === 'ask_user_question') this.notifyWeixin(ASK_QUESTION_MESSAGE)
            return
          }
          if (event.type === 'assistant/message') {
            const usage = (event.data as { usage?: TokenUsageLike } | undefined)?.usage
            if (usage !== undefined) this.recordUsage(usage)
            return
          }
          if (event.type === 'request/context') {
            const model = (event.data as { model?: string } | undefined)?.model
            if (typeof model === 'string' && model !== '') this.recordModel(model)
          }
        }),
        this.ctx.on('session/disposed', () => {
          this.machine.onSessionDisposed()
        }),
      ]
      return () => { for (const dispose of disposers) dispose() }
    })()
  }

  /** RPC: pet or feed the pet. */
  async interact(kind: PetInteraction): Promise<PetInteractResult> {
    const nowMs = Date.now()
    // Feeding consumes a treat: settle the economy first (work + time
    // output since the last settlement), then gate on the feed cooldown
    // BEFORE spending stock — a feed inside the cooldown must not burn a
    // treat for nothing.
    if (kind === 'feed') this.settleTreats(nowMs)
    const outcome = applyInteraction(this.persist.affinity, kind, nowMs, this.affinityConfig)
    // Substitute the pet's current name into any {name} placeholder so
    // reactions always use the user's custom name, not the default.
    const reaction = outcome.reaction.replaceAll('{name}', this.persist.name)
    if (kind === 'feed' && !outcome.accepted) {
      return { reaction, delta: 0, affinity: this.affinityView(this.persist.affinity) }
    }
    if (kind === 'feed') {
      const consume = consumeTreat(this.persist.treats)
      if (!consume.ok) {
        const affinity = this.affinityView(this.persist.affinity)
        return {
          reaction: '没有糖果了，多陪' + this.persist.name + '工作一会儿吧～',
          delta: 0,
          affinity,
        }
      }
      this.persist = { ...this.persist, treats: consume.ledger }
    }
    if (outcome.accepted) {
      this.persist = { ...this.persist, affinity: outcome.affinity }
      this.flush()
    }
    const affinity = this.affinityView(outcome.affinity)
    return { reaction, delta: outcome.delta, affinity }
  }

  /** RPC: show or hide the pet. */
  async setVisible(visible: boolean): Promise<{ ok: true; display: PetDisplayConfig }> {
    this.persist = { ...this.persist, display: { ...this.persist.display, visible } }
    this.flush()
    this.syncSettingsFromPet()
    return { ok: true, display: this.persist.display }
  }

  /** RPC: update display config (size / position). Values are clamped to whole pixels. */
  async setConfig(patch: Partial<PetDisplayConfig>): Promise<{ ok: true; display: PetDisplayConfig }> {
    const next = { ...this.persist.display, ...patch }
    next.size = Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, next.size)))
    next.right = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, next.right)))
    next.bottom = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, next.bottom)))
    this.persist = { ...this.persist, display: next }
    this.flush()
    this.syncSettingsFromPet()
    return { ok: true, display: this.persist.display }
  }

  /** RPC: rename the pet (trimmed, 1–20 chars). */
  async setName(name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    const trimmed = name.trim()
    if (trimmed === '') return { ok: false, error: 'name-empty' }
    if (trimmed.length > PET_NAME_MAX_LENGTH) return { ok: false, error: 'name-too-long' }
    this.persist = { ...this.persist, name: trimmed }
    this.flush()
    this.syncSettingsFromPet()
    return { ok: true, name: trimmed }
  }

  /** RPC: toggle the auto-coding mode (WeChat ping after every completed turn). */
  async setAutoCoding(enabled: boolean): Promise<{ ok: true; autoCoding: boolean }> {
    this.persist = { ...this.persist, autoCoding: enabled }
    this.flush()
    return { ok: true, autoCoding: enabled }
  }

  /**
   * Apply a committed settings section to the persisted display config. Called
   * by the settings surface on every change; values are clamped exactly like
   * the setConfig RPC so both write paths converge.
   * @param section - the resolved settings section.
   */
  applySettingsSection(section: PetSettingsSection): void {
    const next = { ...this.persist.display }
    next.visible = section.visible && (section.enabled ?? true)
    next.size = Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, section.size)))
    next.right = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, section.right)))
    next.bottom = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, section.bottom)))
    this.persist = { ...this.persist, display: next, name: section.name.trim() }
    this.flush()
  }

  /** Mirror the persisted display config into the settings document (best-effort). */
  private syncSettingsFromPet(): void {
    const settings = this.ctx.get('settings', false) as { update(ns: string, patch: object): Promise<void> } | undefined
    if (settings === undefined) return
    void settings.update(PET_SETTINGS_NAMESPACE, {
      visible: this.persist.display.visible,
      size: this.persist.display.size,
      right: this.persist.display.right,
      bottom: this.persist.display.bottom,
      name: this.persist.name,
    }).catch(() => {
      // A settings write failure must not break the pet's own persistence.
    })
  }

  /** Award the turn reward once per done phase (idempotent per transition). */
  private rewardTurn(): void {
    const nowMs = Date.now()
    // A done phase can repeat while celebrating; only reward the first.
    if (nowMs - this.lastTurnRewardAt < 5_000) return
    this.lastTurnRewardAt = nowMs
    this.persist = { ...this.persist, affinity: applyTurnReward(this.persist.affinity, this.affinityConfig) }
    this.flush()
  }

  /**
   * Settle the treat economy (work + time output since the last
   * settlement); persists only when treats were actually granted.
   */
  private settleTreats(nowMs: number): void {
    const settlement = settleTreatGrants(
      this.persist.treats,
      this.persist.affinity.turns,
      nowMs,
      this.treatConfig,
    )
    if (settlement.gained > 0) {
      this.persist = { ...this.persist, treats: settlement.ledger }
      this.flush()
    }
  }

  private view(): PetStateView {
    const snapshot = this.machine.render()
    // Time-output treats accrue while the host is idle too; settle on read.
    this.settleTreats(Date.now())
    return {
      animation: snapshot.animation,
      ...(snapshot.bubble === undefined ? {} : { bubble: snapshot.bubble }),
      phase: snapshot.phase,
      sessionActive: snapshot.sessionActive,
      affinity: this.affinityView(this.persist.affinity),
      display: { ...this.persist.display },
      name: this.persist.name,
      treats: {
        stocked: this.persist.treats.treats,
        max: this.treatConfig.maxTreats,
      },
      stats: this.statsView(),
      tasks: this.tasksView(),
      autoCoding: this.persist.autoCoding,
    }
  }

  private affinityView(affinity: AffinityState): PetStateView['affinity'] {
    const nowMs = Date.now()
    const rank = rankOf(affinity.points)
    return {
      points: affinity.points,
      rank: rank.name,
      rankEmoji: rank.emoji,
      pets: affinity.pets,
      feeds: affinity.feeds,
      turns: affinity.turns,
      petCooldown: nowMs - affinity.lastPetAt < this.affinityConfig.petCooldownMs,
      feedCooldown: nowMs - affinity.lastFeedAt < this.affinityConfig.feedCooldownMs,
    }
  }

  /** Reset the daily stats bucket when the stored date is stale. */
  private ensureTodayStats(): void {
    const today = todayKey()
    if (this.persist.stats.today === today) return
    this.persist = {
      ...this.persist,
      stats: {
        ...this.persist.stats,
        today,
        todayTurns: 0,
        todayInputTokens: 0,
        todayOutputTokens: 0,
        todayCacheReadTokens: 0,
        todayCacheWriteTokens: 0,
        todayFailedTurns: 0,
        todayWorkMs: 0,
      },
    }
    this.flush()
  }

  private recordTurn(completed: boolean): void {
    this.ensureTodayStats()
    const duration = this.turnStartAt > 0 ? Date.now() - this.turnStartAt : 0
    this.turnStartAt = 0
    const s = this.persist.stats
    this.persist = {
      ...this.persist,
      stats: {
        ...s,
        todayWorkMs: s.todayWorkMs + duration,
        ...(completed
          ? { todayTurns: s.todayTurns + 1, totalTurns: s.totalTurns + 1 }
          : { todayFailedTurns: s.todayFailedTurns + 1 }),
      },
    }
    this.flush()
    if (completed) this.notifyWeixin(AUTO_CODING_MESSAGE)
  }

  /**
   * Auto-coding: when enabled, ping the user's WeChat. Used for both a
   * completed turn ("模型已响应，请继续对话") and a pending question branch
   * ("有问题分支待解决"). Best-effort — a missing weixin plugin or a failed
   * send only logs, never fails the turn.
   */
  private notifyWeixin(message: string): void {
    if (!this.persist.autoCoding) return
    const weixin = this.ctx.get('weixin', false) as WeixinNotify | undefined
    if (weixin === undefined) {
      console.log('[pet-maid] auto-coding: weixin plugin not loaded, skip ping')
      return
    }
    void weixin.sendMessage(message).then(
      (outcome) => {
        if (!outcome.ok) console.log('[pet-maid] auto-coding ping failed: ' + (outcome.error ?? 'unknown error'))
      },
      (error: unknown) => {
        console.log('[pet-maid] auto-coding ping error: ' + (error instanceof Error ? error.message : String(error)))
      },
    )
  }

  private recordUsage(usage: TokenUsageLike): void {
    this.ensureTodayStats()
    const s = this.persist.stats
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    this.persist = {
      ...this.persist,
      stats: {
        ...s,
        todayInputTokens: s.todayInputTokens + num(usage.inputTokens),
        todayOutputTokens: s.todayOutputTokens + num(usage.outputTokens),
        todayCacheReadTokens: s.todayCacheReadTokens + num(usage.cacheReadTokens),
        todayCacheWriteTokens: s.todayCacheWriteTokens + num(usage.cacheWriteTokens),
      },
    }
    this.flush()
  }

  private recordModel(model: string): void {
    if (this.persist.stats.model === model) return
    this.persist = { ...this.persist, stats: { ...this.persist.stats, model } }
    this.flush()
  }

  /** Current work-statistics snapshot for the panel. */
  /** Scheduled (future) and executed task lists for the panel. */
  private tasksView(): PetTasksView {
    return computeTasksView(readWeixinTasks(this.persistDir))
  }

  private statsView(): PetStatsView {
    this.ensureTodayStats()
    const s = this.persist.stats
    const denom = s.todayInputTokens + s.todayCacheReadTokens
    return {
      todayTurns: s.todayTurns,
      totalTurns: s.totalTurns,
      model: s.model,
      inputTokens: s.todayInputTokens,
      outputTokens: s.todayOutputTokens,
      cacheReadTokens: s.todayCacheReadTokens,
      cacheWriteTokens: s.todayCacheWriteTokens,
      cacheHitRate: denom > 0 ? s.todayCacheReadTokens / denom : 0,
      todayFailedTurns: s.todayFailedTurns,
      todayWorkMs: s.todayWorkMs,
    }
  }

  private flush(): void {
    try {
      savePetPersist(this.persist, this.persistDir)
    } catch {
      // Persistence is best-effort; the in-memory ledger keeps working.
    }
  }
}
