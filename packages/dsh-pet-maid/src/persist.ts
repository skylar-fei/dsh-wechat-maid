/**
 * Pet persistence — tiny JSON store for affinity + display config, written
 * under $DSH_HOME (defaults to ~/.dsh) as `pet-maid.json`. Deliberately minimal:
 * one file, atomic rename write, tolerant read (corrupt file → defaults).
 * @module @deepseek-ai/dsh-pet-maid/persist
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { AFFINITY_MAX, emptyAffinity, type AffinityState } from './affinity.ts'
import { defaultTreatConfig, emptyTreatLedger, type TreatLedger } from './treats.ts'

/** Display configuration the user can tweak. */
export interface PetDisplayConfig {
  /** Master switch. */
  visible: boolean
  /** Scale of the rendered pet in px (sprite cell height). */
  size: number
  /** Horizontal inset from the viewport right edge, px. */
  right: number
  /** Vertical inset from the viewport bottom edge, px. */
  bottom: number
}

export const defaultDisplayConfig: PetDisplayConfig = {
  visible: true,
  size: 160,
  right: 24,
  bottom: 20,
}

/** Display value bounds (shared by load-time validation and setConfig). */
export const DISPLAY_SIZE_MIN = 32
export const DISPLAY_SIZE_MAX = 512
export const DISPLAY_INSET_MAX = 10_000

/** Everything persisted for the pet. */
export interface PetPersist {
  /** User-customizable pet display name. */
  name: string
  affinity: AffinityState
  /** Treat (糖果) stock ledger. */
  treats: TreatLedger
  display: PetDisplayConfig
  /** Work-statistics ledger (today + lifetime). */
  stats: PetStats
  /** Auto-coding mode: ping WeChat after every completed turn. */
  autoCoding: boolean
}

/** Daily + lifetime work statistics surfaced by the stats panel. */
export interface PetStats {
  /** Local date key (YYYY-MM-DD) of the current daily bucket. */
  today: string
  /** Completed turns today. */
  todayTurns: number
  /** Uncached input tokens today. */
  todayInputTokens: number
  /** Output tokens today. */
  todayOutputTokens: number
  /** Cached-read input tokens today. */
  todayCacheReadTokens: number
  /** Cache-write tokens today. */
  todayCacheWriteTokens: number
  /** Lifetime completed turns. */
  totalTurns: number
  /** Failed (non-completed) turns today. */
  todayFailedTurns: number
  /** Accumulated active work time today, ms. */
  todayWorkMs: number
  /** Latest model id observed. */
  model: string
}

/** Local date key (YYYY-MM-DD). */
export function todayKey(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return now.getFullYear() + '-' + m + '-' + d
}

/** Empty statistics ledger. */
export function emptyStats(): PetStats {
  return {
    today: todayKey(),
    todayTurns: 0,
    todayInputTokens: 0,
    todayOutputTokens: 0,
    todayCacheReadTokens: 0,
    todayCacheWriteTokens: 0,
    totalTurns: 0,
    todayFailedTurns: 0,
    todayWorkMs: 0,
    model: '',
  }
}

/** Default pet name (used until the user renames the pet). */
export const DEFAULT_PET_NAME = '牢梁'

/** Name constraints. */
export const PET_NAME_MAX_LENGTH = 20

export function emptyPersist(): PetPersist {
  return {
    name: DEFAULT_PET_NAME,
    affinity: emptyAffinity(),
    treats: emptyTreatLedger(),
    display: { ...defaultDisplayConfig },
    stats: emptyStats(),
    autoCoding: false,
  }
}

/** Resolve the persistence directory ($DSH_HOME or ~/.dsh). */
export function petHomeDir(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Numeric field guard: finite numbers only, else the fallback. */
function finiteNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Clamp one count/score into [0, max]. */
function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value))
}

/** Load persisted state; missing or corrupt files fall back to defaults. */
export function loadPetPersist(dir: string = petHomeDir()): PetPersist {
  try {
    const raw = readFileSync(join(dir, 'pet-maid.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PetPersist>
    const base = emptyPersist()
    const rawAffinity = (parsed.affinity ?? {}) as Partial<AffinityState>
    const affinity: AffinityState = {
      points: clamp(finiteNum(rawAffinity.points, 0), AFFINITY_MAX),
      lastPetAt: clamp(finiteNum(rawAffinity.lastPetAt, 0), Number.MAX_SAFE_INTEGER),
      lastFeedAt: clamp(finiteNum(rawAffinity.lastFeedAt, 0), Number.MAX_SAFE_INTEGER),
      pets: clamp(finiteNum(rawAffinity.pets, 0), Number.MAX_SAFE_INTEGER),
      feeds: clamp(finiteNum(rawAffinity.feeds, 0), Number.MAX_SAFE_INTEGER),
      turns: clamp(finiteNum(rawAffinity.turns, 0), Number.MAX_SAFE_INTEGER),
    }
    const rawTreats = (parsed.treats ?? {}) as Partial<TreatLedger>
    const treats: TreatLedger = {
      treats: clamp(finiteNum(rawTreats.treats, 0), defaultTreatConfig.maxTreats),
      lastTreatGrantAt: clamp(finiteNum(rawTreats.lastTreatGrantAt, 0), Number.MAX_SAFE_INTEGER),
      turnsAtLastTreatGrant: clamp(finiteNum(rawTreats.turnsAtLastTreatGrant, 0), Number.MAX_SAFE_INTEGER),
    }
    const rawDisplay = (parsed.display ?? {}) as Partial<PetDisplayConfig>
    const display: PetDisplayConfig = {
      visible: typeof rawDisplay.visible === 'boolean' ? rawDisplay.visible : base.display.visible,
      // The settings schema requires whole pixels; drag positions are
      // clamped but not integral, so round at the persistence boundary.
      size: Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, finiteNum(rawDisplay.size, base.display.size)))),
      right: Math.round(clamp(finiteNum(rawDisplay.right, base.display.right), DISPLAY_INSET_MAX)),
      bottom: Math.round(clamp(finiteNum(rawDisplay.bottom, base.display.bottom), DISPLAY_INSET_MAX)),
    }
    const rawStats = (parsed.stats ?? {}) as Partial<PetStats>
    const stats: PetStats = {
      today: typeof rawStats.today === 'string' ? rawStats.today : base.stats.today,
      todayTurns: clamp(finiteNum(rawStats.todayTurns, 0), Number.MAX_SAFE_INTEGER),
      todayInputTokens: clamp(finiteNum(rawStats.todayInputTokens, 0), Number.MAX_SAFE_INTEGER),
      todayOutputTokens: clamp(finiteNum(rawStats.todayOutputTokens, 0), Number.MAX_SAFE_INTEGER),
      todayCacheReadTokens: clamp(finiteNum(rawStats.todayCacheReadTokens, 0), Number.MAX_SAFE_INTEGER),
      todayCacheWriteTokens: clamp(finiteNum(rawStats.todayCacheWriteTokens, 0), Number.MAX_SAFE_INTEGER),
      totalTurns: clamp(finiteNum(rawStats.totalTurns, 0), Number.MAX_SAFE_INTEGER),
      todayFailedTurns: clamp(finiteNum(rawStats.todayFailedTurns, 0), Number.MAX_SAFE_INTEGER),
      todayWorkMs: clamp(finiteNum(rawStats.todayWorkMs, 0), Number.MAX_SAFE_INTEGER),
      model: typeof rawStats.model === 'string' ? rawStats.model : '',
    }
    // Reset the daily bucket when the stored date is stale.
    if (stats.today !== todayKey()) {
      stats.today = todayKey()
      stats.todayTurns = 0
      stats.todayInputTokens = 0
      stats.todayOutputTokens = 0
      stats.todayCacheReadTokens = 0
      stats.todayCacheWriteTokens = 0
      stats.todayFailedTurns = 0
      stats.todayWorkMs = 0
    }
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() !== ''
        ? parsed.name
        : base.name,
      affinity,
      treats,
      display,
      stats,
      autoCoding: typeof parsed.autoCoding === 'boolean' ? parsed.autoCoding : false,
    }
  } catch {
    return emptyPersist()
  }
}

/** Atomically persist state (write temp + rename). */
export function savePetPersist(data: PetPersist, dir: string = petHomeDir()): void {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'pet-maid.json')
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, target)
}
