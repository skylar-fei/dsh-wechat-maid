/** API path root for the dsh-weixin route family. */
export const WEIXIN_API = {
  status: '/api/dsh-weixin/status',
  connect: '/api/dsh-weixin/connect',
  disconnect: '/api/dsh-weixin/disconnect',
  tasks: '/api/dsh-weixin/tasks',
} as const

/** Connection state of the WeChat bridge. */
export type WeixinState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Status payload returned by GET /status and the weixin_status tool. */
export interface WeixinStatusPayload {
  state: WeixinState
  loggedIn: boolean
  accountId?: string
  error?: string
}
