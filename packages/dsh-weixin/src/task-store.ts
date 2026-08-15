/**
 * TaskStore - durable scheduled-task persistence in ~/.dsh/dsh-weixin-tasks.json
 * (the same home as dsh-ssh's host config). The host reads and writes this file
 * directly, so toggles and edits persist without relying on the settings wire.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ScheduledTask } from './scheduler.ts'

/** The single durable file. */
const TASKS_FILE = join(homedir(), '.dsh', 'dsh-weixin-tasks.json')

/** The default task list seeded on first run (empty — users add their own tasks). */
export const DEFAULT_TASKS: ScheduledTask[] = []

/** Owns the durable task list: load (seeding the default) and save. */
export class TaskStore {
  load(): ScheduledTask[] {
    try {
      if (!existsSync(TASKS_FILE)) return DEFAULT_TASKS.map((task) => ({ ...task }))
      const parsed: unknown = JSON.parse(readFileSync(TASKS_FILE, 'utf8'))
      if (Array.isArray(parsed)) return parsed as ScheduledTask[]
    } catch {
      // corrupt or unreadable file: fall through to the default
    }
    return DEFAULT_TASKS.map((task) => ({ ...task }))
  }

  save(tasks: readonly ScheduledTask[]): void {
    mkdirSync(dirname(TASKS_FILE), { recursive: true })
    writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8')
  }

  /** Record one task's last-run outcome and persist it. */
  recordRun(id: string, outcome: { ok: boolean; summary: string }): void {
    const updated = this.load().map((task) => task.id === id
      ? {
          ...task,
          lastRunAt: Date.now(),
          lastResult: outcome.ok ? 'ok' as const : 'error' as const,
          lastSummary: outcome.summary,
        }
      : task)
    this.save(updated)
  }
}
