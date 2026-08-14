/**
 * The /api/dsh-weixin route family: status, connect (spawns QR login),
 * disconnect, and the scheduled-tasks read/write surface (GET/POST /tasks).
 * Every route carries a loopback-only trust fence - these endpoints control a
 * real WeChat connection and durable tasks, so LAN-exposed dsh web deployments
 * must not serve them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { WeixinEngine } from './engine.ts'
import { describeCron, type ScheduledTask } from './scheduler.ts'
import { WEIXIN_API } from './protocol.ts'

/** Loopback literal check plus browser same-origin markers. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Guard helper: fence + method check. */
function guard(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { error: 'forbidden: loopback-only' })
    return false
  }
  if (req.method !== method) {
    writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') })
    return false
  }
  return true
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 1024 * 1024) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** The scheduled-tasks read/write surface. */
export interface TaskDeps {
  getTasks: () => ScheduledTask[]
  saveTasks: (tasks: ScheduledTask[]) => void
}

/** Build the /api/dsh-weixin routes. */
export function makeRoutes(engine: WeixinEngine, taskDeps: TaskDeps): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: WEIXIN_API.status,
      handler: (req, res) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, { status: engine.status() })
      },
    },
    {
      kind: 'exact',
      path: WEIXIN_API.tasks,
      handler: async (req, res) => {
        if (req.method === 'GET') {
          if (!guard(req, res, 'GET')) return
          const tasks = taskDeps.getTasks().map((task) => ({
            ...task,
            timeText: describeCron(task.cron),
          }))
          writeJson(res, 200, { tasks })
          return
        }
        if (req.method === 'POST') {
          if (!guard(req, res, 'POST')) return
          const body = await readJsonBody(req)
          const tasks = body?.tasks
          if (!Array.isArray(tasks)) {
            writeJson(res, 400, { error: 'invalid tasks payload' })
            return
          }
          const sanitized: ScheduledTask[] = tasks.map((task) => {
            const raw = task as Record<string, unknown>
            return {
              id: typeof raw.id === 'string' ? raw.id : '',
              title: typeof raw.title === 'string' ? raw.title : '',
              cron: typeof raw.cron === 'string' ? raw.cron : '',
              prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
              enabled: raw.enabled !== false,
              ...(typeof raw.lastRunAt === 'number' ? { lastRunAt: raw.lastRunAt } : {}),
              ...(raw.lastResult === 'ok' || raw.lastResult === 'error' ? { lastResult: raw.lastResult as 'ok' | 'error' } : {}),
              ...(typeof raw.lastSummary === 'string' ? { lastSummary: raw.lastSummary } : {}),
            }
          }).filter((task) => task.id !== '')
          taskDeps.saveTasks(sanitized)
          writeJson(res, 200, { ok: true })
          return
        }
        writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') })
      },
    },
    {
      kind: 'exact',
      path: WEIXIN_API.connect,
      handler: (req, res) => {
        if (!guard(req, res, 'POST')) return
        engine.connect()
        writeJson(res, 202, { status: engine.status() })
      },
    },
    {
      kind: 'exact',
      path: WEIXIN_API.disconnect,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        await engine.disconnect()
        writeJson(res, 200, { status: engine.status() })
      },
    },
  ]
}
