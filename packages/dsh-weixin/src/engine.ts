/**
 * WeixinEngine - wraps the weixin-agent-sdk (official WeChat ClawBot
 * protocol) into a small state machine the plugin surfaces can drive:
 * connect (QR login, prints to the host terminal), disconnect, status, and
 * proactive sendMessage. The long-poll monitor runs in the host process for
 * the lifetime of the connection.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isLoggedIn, login, logout, start, type Agent as WeixinAgent, type Bot } from 'weixin-agent-sdk'
import type { WeixinState, WeixinStatusPayload } from './protocol.ts'

/** Engine log sink (host console + diagnostics). */
export interface WeixinEngineOptions {
  log?: (msg: string) => void
}

/** Outcome of a proactive send attempt. */
export interface SendOutcome {
  ok: boolean
  error?: string
}

/** Read the first registered account id from the SDK credential index (best-effort). */
function readFirstAccountId(): string | undefined {
  try {
    const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim() || join(homedir(), '.openclaw')
    const raw = readFileSync(join(stateDir, 'openclaw-weixin', 'accounts.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0])
  } catch {
    // no stored accounts
  }
  return undefined
}

/**
 * The WeChat bridge: owns the login flow, the long-poll monitor, and the
 * proactive-send capability. The agent it runs is the bridge that routes
 * inbound WeChat messages into the shared DSH agent session.
 */
export class WeixinEngine {
  private state: WeixinState = 'disconnected'
  private bot: Bot | undefined
  private abort: AbortController | undefined
  private accountId: string | undefined
  private lastError: string | undefined

  constructor(
    private readonly agent: WeixinAgent,
    private readonly opts: WeixinEngineOptions = {},
  ) {}

  private log(msg: string): void {
    this.opts.log?.(msg)
  }

  /** Current connection snapshot (lossless-JSON-safe: omits undefined fields). */
  status(): WeixinStatusPayload {
    const payload: WeixinStatusPayload = {
      state: this.state,
      loggedIn: isLoggedIn(),
    }
    if (this.accountId !== undefined) payload.accountId = this.accountId
    if (this.lastError !== undefined) payload.error = this.lastError
    return payload
  }

  /**
   * Begin connecting: spawns the QR login in the background (it blocks until
   * the user scans, so it must not hold a route handler). The QR code prints
   * to the host terminal. On success the monitor starts and state flips to
   * connected.
   */
  connect(): void {
    if (this.state === 'connecting' || this.state === 'connected') return
    this.state = 'connecting'
    this.lastError = undefined
    void this.doConnect()
  }

  /** Auto-connect on plugin load when stored credentials exist (no QR, no click). */
  autoConnect(): void {
    if (isLoggedIn()) this.connect()
  }

  private async doConnect(): Promise<void> {
    try {
      if (isLoggedIn()) {
        // Reuse stored credentials: skip the QR scan and start the monitor directly.
        this.accountId = readFirstAccountId()
        this.abort = new AbortController()
        this.bot = start(this.agent, {
          abortSignal: this.abort.signal,
          log: (msg) => this.log(msg),
        })
        this.state = 'connected'
        this.log('[weixin] reconnected (reused stored credentials)')
      } else {
        const accountId = await login({ log: (msg) => this.log(msg) })
        this.accountId = accountId
        this.abort = new AbortController()
        this.bot = start(this.agent, {
          accountId,
          abortSignal: this.abort.signal,
          log: (msg) => this.log(msg),
        })
        this.state = 'connected'
        this.log('[weixin] connected as ' + accountId)
      }
    } catch (error) {
      this.state = 'error'
      this.lastError = error instanceof Error ? error.message : String(error)
      this.log('[weixin] connect failed: ' + this.lastError)
    }
  }

  /** Stop the monitor and clear stored credentials (explicit user action). */
  async disconnect(): Promise<void> {
    this.stopMonitor()
    try {
      logout({ log: (msg) => this.log(msg) })
    } catch (error) {
      this.log('[weixin] logout failed: ' + (error instanceof Error ? error.message : String(error)))
    }
    this.accountId = undefined
    this.lastError = undefined
    this.state = 'disconnected'
  }

  /**
   * Proactively send text to the logged-in WeChat user. Requires at least one
   * inbound message within the last ~24h (WeChat platform context_token
   * constraint); returns a clear error otherwise.
   */
  async sendMessage(text: string): Promise<SendOutcome> {
    if (this.bot === undefined || this.state !== 'connected') {
      return { ok: false, error: '微信未连接（请先在侧边栏「微信」面板完成扫码登录）' }
    }
    try {
      await this.bot.sendMessage(text)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Stop the long-poll monitor (keeps stored credentials for fast reconnect). */
  private stopMonitor(): void {
    this.abort?.abort()
    this.abort = undefined
    this.bot = undefined
  }

  /** Tear down on plugin unload (stop monitor; keep credentials). */
  dispose(): void {
    this.stopMonitor()
  }
}
