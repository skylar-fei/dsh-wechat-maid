/**
 * Browser-side API client for the /api/dsh-weixin route family. Plain fetch,
 * same origin. The only data access path the panel components use.
 */
import { WEIXIN_API, type WeixinStatusPayload } from '../protocol.ts'

/** Error carrying the route's JSON error message. */
export class WeixinApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WeixinApiError'
  }
}

/** Parse a JSON response or throw a WeixinApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new WeixinApiError('HTTP ' + response.status + ': invalid JSON response')
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'HTTP ' + response.status
    throw new WeixinApiError(message)
  }
  return body as T
}

/** One scheduled task as the /tasks endpoint returns it. */
export interface WeixinScheduledTask {
  id: string
  title: string
  cron: string
  prompt: string
  enabled: boolean
  /** Human-readable schedule, filled by the host on GET. */
  timeText?: string
  /** Last fire timestamp (epoch ms). */
  lastRunAt?: number
  /** Last run outcome. */
  lastResult?: 'ok' | 'error'
  /** Short last-run summary. */
  lastSummary?: string
}

/** The scheduled-tasks list returned by GET /tasks. */
export interface WeixinTasksView {
  tasks: WeixinScheduledTask[]
}

/** The browser half's only data entry point. */
export class WeixinApi {
  async status(): Promise<WeixinStatusPayload> {
    const response = await fetch(WEIXIN_API.status)
    const body = await readJson<{ status: WeixinStatusPayload }>(response)
    return body.status
  }

  async connect(): Promise<WeixinStatusPayload> {
    const response = await fetch(WEIXIN_API.connect, { method: 'POST' })
    const body = await readJson<{ status: WeixinStatusPayload }>(response)
    return body.status
  }

  async disconnect(): Promise<WeixinStatusPayload> {
    const response = await fetch(WEIXIN_API.disconnect, { method: 'POST' })
    const body = await readJson<{ status: WeixinStatusPayload }>(response)
    return body.status
  }

  async tasks(): Promise<WeixinTasksView> {
    const response = await fetch(WEIXIN_API.tasks)
    return readJson<WeixinTasksView>(response)
  }

  async saveTasks(tasks: WeixinScheduledTask[]): Promise<void> {
    const response = await fetch(WEIXIN_API.tasks, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tasks }),
    })
    await readJson<{ ok: boolean }>(response)
  }
}
