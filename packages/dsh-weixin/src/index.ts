/**
 * dsh-weixin - host half. Mounts the Weixin engine (official WeChat ClawBot
 * login + long-poll monitor + proactive send), the /api/dsh-weixin route
 * family, the agent tools (weixin_send, weixin_status), a system-prompt
 * announcement, and the host-side scheduled-task scheduler (persisted in
 * ~/.dsh/dsh-weixin-tasks.json). Everything rides official NPM SDK packages -
 * no dsh source changes.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-workspace'
import { WeixinBridge } from './bridge.ts'
import { WeixinEngine } from './engine.ts'
import { makeRoutes } from './routes.ts'
import { Scheduler, type ScheduledTask } from './scheduler.ts'
import { TaskStore } from './task-store.ts'
import { weixinSendTool, weixinStatusTool } from './tools.ts'

/** Stable cordis plugin name. */
export const name = 'weixin'

/** Services required before the Weixin surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt', 'agents', 'agentDefaultModel', 'workspaceRegistry']

/** Settings namespace of the Weixin capability. */
export const WEIXIN_SETTINGS_NAMESPACE = settingsNamespace('dsh-weixin')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** When true (default), a system-prompt section announces the plugin to every agent. */
  announceToAgent?: boolean
  /** Master switch for the plugin (routes, tools, prompt section). */
  enabled?: boolean
  /** Optional provider route for the shared agent (empty = default). */
  agentProvider?: string
  /** Optional model id for the shared agent (empty = default). */
  agentModel?: string
  /** Upper bound (ms) on waiting for the shared agent to reply to one WeChat message. */
  replyTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
  agentProvider: z.string().default(''),
  agentModel: z.string().default(''),
  replyTimeoutMs: z.number().default(300000),
})

/** Schema default, re-read for hand-built test contexts. */
const DEFAULT_ANNOUNCE = true

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 160

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const WEIXIN_GUIDANCE = '本机已安装 dsh-weixin 插件（DSH 微信个人号接入，走微信官方 ClawBot 接口）：侧边栏「微信」入口；在独立项目 dsh-weixin 目录统一维护。能力：通过微信个人号与 agent 单聊，与 Web 共享同一会话与记忆；weixin_send 主动发消息到用户微信；weixin_status 查看连接状态。定时任务：插件内置定时任务（存于 ~/.dsh/dsh-weixin-tasks.json，cron 表达式如 0 6 * * * 为每日早 6 点），到点自动唤醒 agent 执行任务，agent 完成后调用 weixin_send 把结果推到微信。限制：主动推送需最近约 24 小时内收到过至少一条微信消息（微信平台 context_token 限制）；首次连接需在运行 dsh web 的终端扫码；消息可能含敏感信息，先确认再发送。用户提到「微信 / 微信机器人 / 主动消息 / 推送 / 定时任务」时即指本插件，请据此协作。'

/**
 * Mount the Weixin engine, routes, tools, announcement, and scheduler.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt/agents.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  let current: () => Config = () => config ?? {}
  const resolve = (): Config => {
    const value = current()
    return {
      announceToAgent: value.announceToAgent ?? DEFAULT_ANNOUNCE,
      enabled: value.enabled ?? true,
      agentProvider: value.agentProvider ?? '',
      agentModel: value.agentModel ?? '',
      replyTimeoutMs: value.replyTimeoutMs ?? 300000,
    }
  }

  // The engine + bridge persist across settings edits so the WeChat connection
  // is not dropped by a config change (only enabled=false or plugin unload
  // tears them down).
  const bridge = new WeixinBridge(ctx, () => resolve())
  const engine = new WeixinEngine(bridge)
  // Reconnect silently on load when stored credentials exist (no QR, no click).
  engine.autoConnect()

  // Expose a minimal proactive-send surface to sibling host plugins: the
  // dsh-pet-maid "auto coding" mode pings WeChat after every completed turn.
  ctx.provide('weixin', {
    sendMessage: (text: string) => engine.sendMessage(text),
    status: () => engine.status(),
  })

  // Scheduled tasks are host-owned, persisted in a plain JSON file (not the
  // settings wire), so toggles and edits land durably and re-arm immediately.
  const store = new TaskStore()

  let scheduler: Scheduler | undefined
  const syncScheduler = (): void => {
    if (scheduler !== undefined) {
      scheduler.dispose()
      scheduler = undefined
    }
    const tasks = store.load().filter((task) => task.enabled !== false)
    if (tasks.length > 0) {
      scheduler = new Scheduler(
        tasks,
        async (task) => {
          const outcome = await bridge.runPrompt(task.prompt)
          store.recordRun(task.id, outcome)
        },
        (msg) => console.log('[dsh-weixin] ' + msg),
      )
      scheduler.start()
      bridge.start()
    }
  }

  // The task read/write surface handed to the /tasks routes.
  const taskDeps = {
    getTasks: (): ScheduledTask[] => store.load(),
    saveTasks: (tasks: ScheduledTask[]): void => {
      store.save(tasks)
      syncScheduler()
    },
  }

  ctx.effect(() => () => {
    engine.dispose()
    scheduler?.dispose()
    void bridge.dispose()
  }, 'dsh-weixin: engine')

  let disposeRoutes: (() => void) | undefined
  let disposeTools: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeTools !== undefined) {
      disposeTools()
      disposeTools = undefined
    }
    const value = resolve()
    if (!value.enabled) return
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-weixin',
        order: SECTION_ORDER,
        text: WEIXIN_GUIDANCE,
      })
    }
    const routes = makeRoutes(engine, taskDeps)
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map((route) => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-weixin: routes',
    )
    const tools = [weixinSendTool(engine), weixinStatusTool(engine)]
    disposeTools = ctx.effect(
      () => {
        const disposers = tools.map((tool) => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-weixin: tools',
    )
    syncScheduler()
  }

  installSettingsSection(ctx, WEIXIN_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => {
      current = source
      sync()
    },
    onChange: sync,
  })

  sync()
}
