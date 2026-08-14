/**
 * Browser-half entry for the dsh-weixin plugin - runs inside the dsh web GUI.
 * Registers the dsh-weixin locale dictionaries and mounts the WeChat
 * connection panel through the official slot system (sidebar footer action
 * plus the shell overlay layer).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { WeixinApi } from './api.ts'
import { en, zh, type WeixinKey } from './locales.ts'
import { WeixinOverlay } from './panel-overlay.tsx'
import { WeixinSettingsCard } from './WeixinSettingsCard.tsx'
import { WeixinSidebarEntry } from './sidebar-entry.tsx'
import { PanelController, setPanelState } from './state.ts'
import { tt } from './helpers.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-weixin'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-weixin': WeixinKey
  }
  interface SlotMap {
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: { wide: boolean } }
    'shell.overlay': { kind: 'list'; scope: 'root'; owner: { children?: never } }
    'settings.plugin.item': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

/** Required services. */
export const inject = ['slots', 'locale']

/** Mount the WeChat panel. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-weixin: dictionaries')

  setPanelState(new PanelController(), new WeixinApi())

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'dsh-weixin',
    order: 120,
    locale: NS,
  }, WeixinSettingsCard))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'weixin',
    order: 80,
    label: () => tt('entry.label'),
  }, WeixinSidebarEntry))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'weixin-panel',
    order: 80,
  }, WeixinOverlay))
}
