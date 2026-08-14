/**
 * Module-level panel state: the controller and API client are created in
 * apply() and shared with the slot components through these accessors.
 */
import type { WeixinApi } from './api.ts'

/** Immutable controller snapshot for UI subscriptions. */
export interface PanelControllerSnapshot {
  panelOpen: boolean
}

/** The panel state owner the sidebar entry toggles and the view renders from. */
export class PanelController {
  private panelOpen = false
  private listeners = new Set<() => void>()

  getSnapshot(): PanelControllerSnapshot {
    return { panelOpen: this.panelOpen }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  open(): void {
    if (this.panelOpen) return
    this.panelOpen = true
    this.notify()
  }

  close(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.notify()
  }

  toggle(): void {
    if (this.panelOpen) this.close()
    else this.open()
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}

let controller: PanelController | undefined
let api: WeixinApi | undefined

/** Record the live panel state (called once from apply). */
export function setPanelState(nextController: PanelController, nextApi: WeixinApi): void {
  controller = nextController
  api = nextApi
}

/** The panel controller (undefined before apply). */
export function getPanelController(): PanelController | undefined {
  return controller
}

/** The Weixin API client (undefined before apply). */
export function getWeixinApi(): WeixinApi | undefined {
  return api
}
