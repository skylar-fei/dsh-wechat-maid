/**
 * Reads the dsh-weixin plugin's scheduled-task store so the pet panel can
 * surface upcoming (future) tasks and today's executed tasks. The weixin
 * plugin persists them in $DSH_HOME/dsh-weixin-tasks.json (default ~/.dsh).
 * @module @deepseek-ai/dsh-pet-maid/weixin-tasks
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Minimal task shape read from the weixin store (unknown fields ignored). */
export interface WeixinTask {
  id?: string
  title?: string
  cron?: string
  enabled?: boolean
  lastRunAt?: number
  lastResult?: 'ok' | 'error'
  lastSummary?: string
}

/** Panel view of the scheduled tasks. */
export interface PetTasksView {
  /** Enabled (upcoming) tasks with their next concrete run time. */
  future: Array<{ title: string; timeText: string }>
  /** Tasks executed today, most recent first, with success flag and failure reason. */
  executed: Array<{ title: string; ok: boolean; summary?: string }>
}

/** Read the weixin scheduled tasks; a missing/corrupt file yields []. */
export function readWeixinTasks(dir: string): WeixinTask[] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'dsh-weixin-tasks.json'), 'utf8'))
    return Array.isArray(raw) ? raw as WeixinTask[] : []
  } catch {
    return []
  }
}

// ---- minimal cron parser (adapted from dsh-weixin/src/scheduler.ts) ----
const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59], [0, 23], [1, 31], [1, 12], [0, 7],
]
interface CronSchedule {
  minutes: ReadonlySet<number>
  hours: ReadonlySet<number>
  days: ReadonlySet<number>
  months: ReadonlySet<number>
  weekdays: ReadonlySet<number>
  dayWildcard: boolean
  weekdayWildcard: boolean
}
function isDigits(value: string): boolean { return /^\d+$/.test(value) }
function parseField(field: string, min: number, max: number, out: Set<number>): boolean {
  if (field === '*') { for (let v = min; v <= max; v++) out.add(v); return true }
  for (const part of field.split(',')) {
    if (part === '') return false
    const [range, stepRaw] = part.split('/')
    let low: number
    let high: number
    if (range === '*') { low = min; high = max }
    else if (range.includes('-')) {
      const [a, b] = range.split('-')
      if (a === '' || b === '' || !isDigits(a) || !isDigits(b)) return false
      low = Number(a); high = Number(b)
    } else if (isDigits(range)) { low = Number(range); high = Number(range) }
    else return false
    if (low < min || high > max || low > high) return false
    const step = stepRaw === undefined ? 1 : isDigits(stepRaw) ? Number(stepRaw) : NaN
    if (!Number.isInteger(step) || step < 1) return false
    for (let v = low; v <= high; v += step) out.add(v)
  }
  return true
}
function parseCron(expr: string): CronSchedule | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const sets: Set<number>[] = []
  for (let i = 0; i < 5; i++) {
    const [min, max] = FIELD_RANGES[i]!
    const set = new Set<number>()
    if (!parseField(fields[i]!, min, max, set)) return null
    sets.push(set)
  }
  const weekdays = new Set<number>()
  for (const d of sets[4]!) weekdays.add(d === 7 ? 0 : d)
  return {
    minutes: sets[0]!, hours: sets[1]!, days: sets[2]!, months: sets[3]!,
    weekdays, dayWildcard: fields[2] === '*', weekdayWildcard: fields[4] === '*',
  }
}
function matches(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.minutes.has(date.getMinutes())) return false
  if (!schedule.hours.has(date.getHours())) return false
  if (!schedule.months.has(date.getMonth() + 1)) return false
  const dayMatches = schedule.days.has(date.getDate())
  const weekdayMatches = schedule.weekdays.has(date.getDay())
  if (schedule.dayWildcard) return weekdayMatches
  if (schedule.weekdayWildcard) return dayMatches
  return dayMatches || weekdayMatches
}
/** Next matching minute's start (ms epoch) strictly after fromMs, or undefined. */
export function nextRunAtMs(expr: string, fromMs: number): number | undefined {
  const schedule = parseCron(expr)
  if (schedule === null) return undefined
  const from = new Date(fromMs)
  const scan = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1, 0, 0)
  const limitMs = fromMs + 366 * 24 * 60 * 60 * 1000
  while (scan.getTime() <= limitMs) {
    if (matches(schedule, scan)) return scan.getTime()
    scan.setMinutes(scan.getMinutes() + 1)
  }
  return undefined
}
function pad2(v: number): string { return String(v).padStart(2, '0') }
/** Render a cron expression as a short human-readable schedule label (fallback). */
export function describeCron(expr: string): string {
  const s = parseCron(expr)
  if (s === null) return expr
  const minute = s.minutes.size === 1 ? [...s.minutes][0] : undefined
  const hour = s.hours.size === 1 ? [...s.hours][0] : undefined
  if (minute === undefined || hour === undefined) return expr
  const time = pad2(hour!) + ':' + pad2(minute!)
  if (s.dayWildcard && s.weekdayWildcard) return '每日 ' + time
  if (s.dayWildcard && !s.weekdayWildcard) {
    const weekdays = [...s.weekdays].sort((a, b) => a - b)
    if (weekdays.length === 5 && weekdays.join(',') === '1,2,3,4,5') return '工作日 ' + time
    if (weekdays.length === 2 && weekdays[0] === 0 && weekdays[1] === 6) return '周末 ' + time
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return weekdays.map((d) => names[d]!).join('、') + ' ' + time
  }
  return expr
}

/** Format the next concrete run time relative to today. */
function formatNextRun(ms: number, now: Date): string {
  const d = new Date(ms)
  const hhmm = pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((dayStart - nowStart) / 86400000)
  if (diffDays === 0) return '今天 ' + hhmm
  if (diffDays === 1) return '明天 ' + hhmm
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hhmm
}

/** Compute the panel view from the raw task list. */
export function computeTasksView(tasks: WeixinTask[], now: Date = new Date()): PetTasksView {
  const future: PetTasksView['future'] = []
  const executed: Array<{ title: string; ok: boolean; summary?: string; at: number }> = []
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  for (const t of tasks) {
    const title = (t.title ?? '').trim()
    if (title === '') continue
    if (t.enabled !== false) {
      const cron = t.cron ?? ''
      const next = nextRunAtMs(cron, now.getTime())
      future.push({ title, timeText: next !== undefined ? formatNextRun(next, now) : describeCron(cron) })
    }
    if (typeof t.lastRunAt === 'number' && t.lastRunAt >= todayStart) {
      executed.push({ title, ok: t.lastResult === 'ok', summary: t.lastSummary, at: t.lastRunAt })
    }
  }
  future.sort((a, b) => a.timeText.localeCompare(b.timeText, 'zh'))
  executed.sort((a, b) => b.at - a.at)
  return {
    future,
    executed: executed.map(({ title, ok, summary }) => ({ title, ok, ...(summary !== undefined ? { summary } : {}) })),
  }
}
