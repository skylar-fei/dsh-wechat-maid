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

/** The default task list seeded on first run. */
export const DEFAULT_TASKS: ScheduledTask[] = [
  {
    id: 'tg-checkin',
    title: 'TG签到',
    cron: '0 6 * * *',
    prompt: "执行 Telegram 每日签到任务。用户在国内，签到依赖本地代理，所以第一步必须先确保 Clash Party 已开启：\n\n第1步：检查并启动 Clash Party\n- 用 pwsh 工具检查 Clash Party 进程是否在运行（Get-Process 或 tasklist 检查 ClashParty.exe）。\n- 若未运行：用 pwsh 在 D:\\ 下递归搜索可执行文件（Get-ChildItem -Path D:\\ -Recurse -Filter \"*Clash*Party*.exe\" -ErrorAction SilentlyContinue，常见位置如 D:\\Clash Party\\Clash Party.exe），找到后用 Start-Process 启动它。\n- 启动后等待约 10 秒让代理就绪，然后确认本地代理端口 127.0.0.1:7891 可访问（用 curl 或 Test-NetConnection 检查）。若无法找到/启动 Clash Party，如实记录该情况。\n\n第2步：执行签到\n- 用 pwsh 工具运行：cmd /c \"C:\\Users\\31785\\scripts\\tg-checkin\\run_checkin.bat\"（该脚本内部调用 python tg_checkin.py，把输出追加写入 C:\\Users\\31785\\scripts\\tg-checkin\\checkin_log.txt）。\n\n第3步：汇总并通知\n- 读取 C:\\Users\\31785\\scripts\\tg-checkin\\checkin_log.txt 的最后约 20 行，总结本次签到结果：汇总成功/失败数量（如「2/2 成功」）、每个 bot（jrsgk、QingBaoJuXWsgkbot）的状态和积分信息。\n- 若脚本运行失败、找不到 python、代理未启动导致失败、或日志显示签到失败，如实报告错误信息，不要重复尝试多次。\n- 最后，调用 weixin_send 发送一条通知，用一句话明确告知签到成没成功：成功如「今日 TG 签到完成：2/2 成功」；失败如「今日 TG 签到失败：<原因>」（若因 Clash Party 未启动，说明代理未就绪）。只发送这一条通知，不要做其他操作，不要创建或修改任何定时任务。",
    enabled: true,
  },
]

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
