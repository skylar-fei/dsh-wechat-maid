import { useEffect, useState } from 'react'
import { tt } from './helpers.ts'
import css from './panel.module.css'
import { getPanelController } from './state.ts'

/** Inline icon: a chat bubble glyph. */
const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>'

export interface WeixinSidebarEntryProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Sidebar footer action cell. */
export function WeixinSidebarEntry({ wide }: WeixinSidebarEntryProps) {
  const controller = getPanelController()
  const [open, setOpen] = useState(() => controller?.getSnapshot().panelOpen ?? false)
  useEffect(() => controller?.subscribe(() => setOpen(controller.getSnapshot().panelOpen)), [controller])
  if (controller === undefined) return null
  return (
    <button type="button" className={css.entry} data-active={open ? 'true' : undefined} aria-label={tt('entry.label')} title={tt('entry.tooltip')} onClick={() => { controller.toggle() }}>
      <span className={css.entryIcon} dangerouslySetInnerHTML={{ __html: ICON }} />
      {wide && <span className={css.entryLabel}>{tt('entry.label')}</span>}
    </button>
  )
}
