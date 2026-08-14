/**
 * Scheduler tests: the 5-field cron parser and next-run computation are the
 * only correctness-sensitive pieces of the scheduled-task feature.
 */

import { describe, expect, it } from 'vitest'
import { describeCron, isValidCron, nextRunAtMs, parseCron } from '../src/scheduler.ts'

describe('parseCron', () => {
  it('parses the daily 06:00 expression', () => {
    const schedule = parseCron('0 6 * * *')
    expect(schedule).not.toBeNull()
    expect(schedule?.minutes.has(0)).toBe(true)
    expect(schedule?.hours.has(6)).toBe(true)
    expect(schedule?.dayWildcard).toBe(true)
    expect(schedule?.weekdayWildcard).toBe(true)
  })

  it('rejects malformed expressions', () => {
    expect(parseCron('0 6 *')).toBeNull()
    expect(parseCron('bad cron expr here')).toBeNull()
    expect(parseCron('0 6 * * 8')).toBeNull()
  })
})

describe('nextRunAtMs', () => {
  it('computes the next 06:00 strictly after a known local time', () => {
    const from = new Date(2026, 0, 1, 7, 30, 0, 0).getTime() // Jan 1 2026 07:30 local
    const expected = new Date(2026, 0, 2, 6, 0, 0, 0).getTime() // Jan 2 2026 06:00 local
    expect(nextRunAtMs('0 6 * * *', from)).toBe(expected)
  })

  it('returns undefined for an invalid expression', () => {
    expect(nextRunAtMs('bad', Date.now())).toBeUndefined()
  })
})

describe('isValidCron', () => {
  it('accepts valid and rejects invalid', () => {
    expect(isValidCron('0 6 * * *')).toBe(true)
    expect(isValidCron('*/30 * * * *')).toBe(true)
    expect(isValidCron('nope')).toBe(false)
  })
})

describe('describeCron', () => {
  it('renders daily schedules', () => {
    expect(describeCron('0 6 * * *')).toBe('每日 06:00')
  })

  it('renders weekday schedules', () => {
    expect(describeCron('30 8 * * 1-5')).toBe('工作日 08:30')
  })

  it('falls back to the raw expression for unrecognized shapes', () => {
    expect(describeCron('*/10 * * * *')).toBe('*/10 * * * *')
  })
})
