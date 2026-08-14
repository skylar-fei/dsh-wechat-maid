/**
 * dsh-weixin surface copy: zh is the key source, en mirrors every key.
 */

export const zh = {
  'entry.label': '微信',
  'entry.tooltip': '微信连接面板',
  'panel.title': '微信连接',
  'status.label': '状态',
  'status.disconnected': '未连接',
  'status.connecting': '连接中',
  'status.connected': '已连接',
  'status.error': '错误',
  'status.account': '账号',
  'hint.scan': '请查看运行 dsh web 的终端，用微信扫码完成连接。',
  'hint.disconnected': '尚未连接。点击「连接」后，在运行 dsh web 的终端扫码。',
  'action.connect': '连接',
  'action.disconnect': '断开',
  'settings.title': '定时任务',
  'settings.description': '到点自动唤醒 agent 执行任务，结果推送到微信',
  'settings.empty': '暂无定时任务',
  'settings.save': '保存',
  'settings.cancel': '取消',
  'settings.lastRun': '上次',
  'settings.runOk': '成功',
  'settings.runError': '失败',
  'common.close': '关闭',
  'common.error': '错误：{error}',
} as const

export const en: Record<keyof typeof zh, string> = {
  'entry.label': 'WeChat',
  'entry.tooltip': 'WeChat connection panel',
  'panel.title': 'WeChat connection',
  'status.label': 'Status',
  'status.disconnected': 'Disconnected',
  'status.connecting': 'Connecting',
  'status.connected': 'Connected',
  'status.error': 'Error',
  'status.account': 'Account',
  'hint.scan': 'Scan the QR code with WeChat in the terminal running dsh web.',
  'hint.disconnected': 'Not connected. Click "Connect" and scan the QR in the terminal running dsh web.',
  'action.connect': 'Connect',
  'action.disconnect': 'Disconnect',
  'settings.title': 'Scheduled tasks',
  'settings.description': 'Cron tasks run by the shared agent, results pushed to WeChat',
  'settings.empty': 'No scheduled tasks',
  'settings.save': 'Save',
  'settings.cancel': 'Cancel',
  'settings.lastRun': 'Last',
  'settings.runOk': 'success',
  'settings.runError': 'failed',
  'common.close': 'Close',
  'common.error': 'Error: {error}',
}

/** Locale key union. */
export type WeixinKey = keyof typeof zh

/** Tiny interpolation: {name} -> value. */
export function t(dictionary: Record<string, string>, key: string, values?: Record<string, string | number>): string {
  let text = dictionary[key] ?? key
  if (values !== undefined) {
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll('{' + name + '}', String(value))
    }
  }
  return text
}
