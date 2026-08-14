import { useEffect, useState } from 'react'
import css from './panel.module.css'
import { WeixinPanel } from './WeixinPanel.tsx'
import { getPanelController, getWeixinApi } from './state.ts'

/** Weixin panel overlay occupant (renders nothing while the panel is closed). */
export function WeixinOverlay() {
  const controller = getPanelController()
  const api = getWeixinApi()
  const [open, setOpen] = useState(() => controller?.getSnapshot().panelOpen ?? false)
  useEffect(() => controller?.subscribe(() => setOpen(controller.getSnapshot().panelOpen)), [controller])
  if (controller === undefined || api === undefined || !open) return null
  return (
    <div className={css.view} data-dsh-weixin-view="">
      <WeixinPanel controller={controller} api={api} />
    </div>
  )
}
