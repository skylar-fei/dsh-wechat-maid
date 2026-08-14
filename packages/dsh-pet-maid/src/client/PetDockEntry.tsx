/**
 * Dock anchor inside `conversation.input.selector.context`: the input
 * selector row mounts in EVERY conversation phase (no-session cold start,
 * the blank-session hero, and the active seat), so the floating pet stays on
 * screen on the new-conversation screen too. While visible it mounts the
 * floating MaidPet (portal); while hidden it renders the summon button.
 * @module @deepseek-ai/dsh-pet-maid/client/PetDockEntry
 */

import { useEffect, useSyncExternalStore, type ReactElement } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStoreInstance } from './pet-store.ts'
import { MaidPet } from './MaidPet.tsx'
import { NS } from './locales.ts'
import styles from './pet.module.css'

/** Injected actions handed to the dock entry component. */
export interface PetInjected {
  /** The app-wide pet store instance (snapshot + feedback). */
  store: PetStoreInstance
  /** Ensure the first snapshot is fetched (called on mount). */
  ensure: () => void
  /** Pet the maid (click). */
  pet: () => void
  /** Feed the maid. */
  feed: () => void
  /** Hide the maid. */
  hide: () => void
  /** Summon the hidden maid back. */
  summon: () => void
  /** Persist a drag position. */
  dragEnd: (right: number, bottom: number) => void
  /** Rename the pet (persisted by the host). */
  rename: (name: string) => void
  /** Toggle the auto-coding mode (WeChat ping after each completed turn). */
  setAutoCoding: (enabled: boolean) => void
  /** Clear the reaction bubble. */
  feedbackDone: () => void
}

/** Composed props of the dock entry (runtime + locale + injected). */
export type PetDockEntryProps =
  PropsRuntime<'shell.overlay'>
  & PetInjected
  & PropsLocale<typeof NS>

const DEFAULT_DISPLAY: PetDisplayConfig = { visible: true, size: 160, right: 24, bottom: 20 }

/**
 * Dock entry: while the pet is visible, mount the floating MaidPet (it
 * portals itself onto document.body); while hidden, render the summon
 * button so the pet can always come back. The store is the plugin-owned
 * single instance — the slot system provides none because the pet is
 * host-global, not session-scoped.
 */
export function PetDockEntry(props: PetDockEntryProps): ReactElement {
  const { store, ensure } = props
  const ui = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const snapshot = ui.snapshot
  const feedback = ui.feedback
  const visible = snapshot?.display.visible ?? true

  useEffect(() => {
    ensure()
  }, [ensure])

  if (visible) {
    return (
      <span data-pet-dock data-testid="pet-dock">
        <MaidPet
          snapshot={snapshot}
          display={snapshot?.display ?? DEFAULT_DISPLAY}
          feedback={feedback}
          onPet={props.pet}
          onFeed={props.feed}
          onHide={props.hide}
          onDragEnd={props.dragEnd}
          onRename={props.rename}
          onSetAutoCoding={props.setAutoCoding}
          onFeedbackDone={props.feedbackDone}
          t={props.t}
        />
      </span>
    )
  }
  return (
    <button
      type="button"
      className={styles.summon}
      onClick={props.summon}
      data-testid="pet-summon"
    >
      {props.t('pet.summon', { name: snapshot?.name ?? '牢梁' })}
    </button>
  )
}
