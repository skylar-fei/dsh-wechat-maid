/**
 * Host-side cron scheduler for the dsh-weixin plugin.
 *
 * The 5-field cron parser and next-run computation are adapted from the
 * dsh-task-board package's core/schedule.ts (same author, BSD-3-Clause).
 * Grammar: 分 时 日 月 周. Every field supports wildcard, step (/n), single
 * value, inclusive range a-b, and comma lists. Weekdays 0-7 (0 and 7 = Sunday);
 * a restricted day AND weekday field combine with OR (standard cron).
 */

/** One scheduled task: a stable id, a 5-field cron, and the agent prompt to run. */
export interface ScheduledTask {
  id: string
  title: string
  cron: string
  prompt: string
  /** Per-task enable switch (false disables this task). */
  enabled: boolean
  /** Last fire timestamp (epoch ms), when the task has run at least once. */
  lastRunAt?: number
  /** Last run outcome. */
  lastResult?: 'ok' | 'error'
  /** Short last-run summary (assistant reply or error message). */
  lastSummary?: string
}

/** The parsed match sets of one cron expression. */
interface CronSchedule {
  minutes: ReadonlySet<number>
  hours: ReadonlySet<number>
  days: ReadonlySet<number>
  months: ReadonlySet<number>
  weekdays: ReadonlySet<number>
  dayWildcard: boolean
  weekdayWildcard: boolean
}

/** Inclusive ranges per field, in cron order. */
const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minutes
  [0, 23], // hours
  [1, 31], // days
  [1, 12], // months
  [0, 7], // weekdays (7 = Sunday, normalized below)
]

/** Longest single timer arm (24h); longer delays re-arm on tick. */
const MAX_DELAY_MS = 24 * 60 * 60 * 1000

/** Parse a 5-field cron expression. Returns null when invalid. */
export function parseCron(expr: string): CronSchedule | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const sets: Set<number>[] = []
  for (let index = 0; index < 5; index++) {
    const [min, max] = FIELD_RANGES[index]
    const set = new Set<number>()
    if (!parseField(fields[index], min, max, set)) return null
    sets.push(set)
  }
  const weekdays = new Set<number>()
  for (const day of sets[4]) weekdays.add(day === 7 ? 0 : day)
  return {
    minutes: sets[0],
    hours: sets[1],
    days: sets[2],
    months: sets[3],
    weekdays,
    dayWildcard: fields[2] === '*',
    weekdayWildcard: fields[4] === '*',
  }
}

/** Whether the expression parses. */
export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null
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

function parseField(field: string, min: number, max: number, out: Set<number>): boolean {
  if (field === '*') {
    for (let value = min; value <= max; value++) out.add(value)
    return true
  }
  for (const part of field.split(',')) {
    if (part === '') return false
    const [range, stepRaw] = part.split('/')
    let low: number
    let high: number
    if (range === '*') {
      low = min
      high = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-')
      if (a === '' || b === '' || !isDigits(a) || !isDigits(b)) return false
      low = Number(a)
      high = Number(b)
    } else if (isDigits(range)) {
      low = Number(range)
      high = Number(range)
    } else {
      return false
    }
    if (low < min || high > max || low > high) return false
    const step = stepRaw === undefined ? 1 : isDigits(stepRaw) ? Number(stepRaw) : NaN
    if (!Number.isInteger(step) || step < 1) return false
    for (let value = low; value <= high; value += step) out.add(value)
  }
  return true
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

function isDigits(value: string): boolean {
  return /^\d+$/.test(value)
}

/**
 * Arns one setTimeout per task for its next cron occurrence and re-arms after
 * each fire. Runs in the host process, so it keeps firing while dsh web stays
 * up (no browser tab required).
 */
export class Scheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false

  constructor(
    private readonly tasks: readonly ScheduledTask[],
    private readonly runTask: (task: ScheduledTask) => Promise<void>,
    private readonly log?: (msg: string) => void,
  ) {}

  start(): void {
    for (const task of this.tasks) this.arm(task)
  }

  private arm(task: ScheduledTask): void {
    if (this.disposed) return
    const next = nextRunAtMs(task.cron, Date.now())
    if (next === undefined) {
      this.log?.('[scheduler] invalid cron for task ' + task.id + ': ' + task.cron)
      return
    }
    const delay = Math.max(next - Date.now(), 1000)
    const capped = Math.min(delay, MAX_DELAY_MS)
    const timer = setTimeout(() => { void this.tick(task, next) }, capped)
    this.timers.set(task.id, timer)
  }

  private async tick(task: ScheduledTask, expectedFire: number): Promise<void> {
    this.timers.delete(task.id)
    if (this.disposed) return
    if (Date.now() >= expectedFire - 1000) {
      this.log?.('[scheduler] firing task ' + task.id)
      try {
        await this.runTask(task)
      } catch (error) {
        this.log?.('[scheduler] task ' + task.id + ' failed: ' + (error instanceof Error ? error.message : String(error)))
      }
    }
    this.arm(task)
  }

  dispose(): void {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}

/** Two-digit zero-padded number. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Render a cron expression as a short human-readable label, covering the
 * common cases. Falls back to the raw expression when the pattern is not
 * one of the recognized shapes.
 */
export function describeCron(expr: string): string {
  const schedule = parseCron(expr)
  if (schedule === null) return expr
  const minute = schedule.minutes.size === 1 ? [...schedule.minutes][0] : undefined
  const hour = schedule.hours.size === 1 ? [...schedule.hours][0] : undefined
  if (minute === undefined || hour === undefined) return expr
  const time = pad2(hour) + ':' + pad2(minute)
  if (schedule.dayWildcard && schedule.weekdayWildcard) return '每日 ' + time
  if (schedule.dayWildcard && !schedule.weekdayWildcard) {
    const weekdays = [...schedule.weekdays].sort((a, b) => a - b)
    if (weekdays.length === 5 && weekdays.join(',') === '1,2,3,4,5') return '工作日 ' + time
    if (weekdays.length === 2 && weekdays[0] === 0 && weekdays[1] === 6) return '周末 ' + time
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return weekdays.map((d) => names[d]).join('、') + ' ' + time
  }
  return expr
}
