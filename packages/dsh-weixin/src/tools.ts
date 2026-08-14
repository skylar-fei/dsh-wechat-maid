/**
 * Agent tools: weixin_send (proactive push to the user's WeChat) and
 * weixin_status (connection state). Both talk to the same engine the web
 * panel uses, so a connection made in the GUI is immediately operable by any
 * agent and vice versa.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SendOutcome, WeixinEngine } from './engine.ts'
import type { WeixinStatusPayload } from './protocol.ts'

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** The proactive-send tool. */
export function weixinSendTool(engine: WeixinEngine) {
  return defineTool({
    name: 'weixin_send',
    description: '主动发送一条文本消息到用户的微信（个人号，走微信官方 ClawBot 接口）。用于定时任务完成后的结果汇报、异常告警、或任何需要主动通知用户的场景。限制：需在最近约 24 小时内收到过至少一条微信消息（微信平台 context_token 限制）。',
    parameters: {
      text: { type: 'string', required: true, description: '要发送的文本内容（支持 markdown，发送时自动转为纯文本）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value: SendOutcome) => text(value.ok ? '已发送到微信' : '发送失败：' + (value.error ?? '未知错误')),
    },
    async execute(args) {
      return engine.sendMessage(args.text)
    },
  })
}

/** The connection-status tool. */
export function weixinStatusTool(engine: WeixinEngine) {
  return defineTool({
    name: 'weixin_status',
    description: '查看微信连接的当前状态（disconnected 未连接 / connecting 连接中 / connected 已连接 / error 出错）。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string', enum: ['disconnected', 'connecting', 'connected', 'error'], required: true },
          loggedIn: { type: 'boolean', required: true },
          accountId: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value: WeixinStatusPayload) => text('状态：' + value.state + (value.error !== undefined ? '，错误：' + value.error : '')),
    },
    async execute() {
      return engine.status()
    },
  })
}
