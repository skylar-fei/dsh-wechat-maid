/**
 * pet companion component — the browser half's centerpiece. Renders a
 * fixed-position floating sprite (React portal onto document.body), plays
 * the spritesheet track matching the host animation snapshot, and exposes
 * the interaction surface: click to pet, hover panel with feed/hide, drag to
 * reposition (persisted via setConfig).
 * @module @deepseek-ai/dsh-pet-maid/client/MaidPet
 */

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactPortal } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStateView } from '../service.ts'
import type { PetFeedback } from './pet-store.ts'
import { framePosition, FRAME_WIDTH, FRAME_HEIGHT, FRAME_COLUMNS, FRAME_ROWS, TRACKS, rowOfTrack, trimTrack, detectFrameCounts } from './spritesheet.ts'
import type { PetAnimation } from '../state.ts'
import { NS } from './locales.ts'
import styles from './pet.module.css'

/** Browser URL of the maid atlas (served by the host half's own route). */
export const PET_SPRITESHEET_URL = '/pet/maid/spritesheet.png'

/** Browser URL of the maid manifest (authoritative per-row frame counts). */
export const PET_MANIFEST_URL = '/pet/maid/pet.json'

/** Props injected by the slot registration (store actions + locale). */
export interface MaidPetProps {
  /** Latest host snapshot; null while loading. */
  snapshot: PetStateView | null
  /** Display configuration (persisted by the host). */
  display: PetDisplayConfig
  /** Active reaction bubble, if any. */
  feedback: PetFeedback | null
  /** Pet the the maid (click). */
  onPet: () => void
  /** Feed the the maid (panel button). */
  onFeed: () => void
  /** Hide the the maid (panel button). */
  onHide: () => void
  /** Persist a drag position. */
  onDragEnd: (right: number, bottom: number) => void
  /** Rename the pet (persisted by the host). */
  onRename: (name: string) => void
  /** Toggle the auto-coding mode (WeChat ping after each completed turn). */
  onSetAutoCoding: (enabled: boolean) => void
  /** Clear the reaction bubble (after its CSS animation). */
  onFeedbackDone: () => void
  /** Locale translate seat (namespace-bound). */
  t: TranslateNS<typeof NS>
}

/** Clamp a drag offset inside the viewport with a margin. */
function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

/** Quiet duration before the pet dozes off, ms. */
const SLEEP_AFTER_MS = 60_000
/** Debounce window for resolving single / double / quad clicks, ms. */
const CLICK_WINDOW_MS = 350

/** Format a token count compactly (1234 -> 1.2k). */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

/** Format a 0..1 rate as a percentage string. */
function fmtPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

/** Format a millisecond duration compactly. */
function fmtDuration(ms: number): string {
  if (ms < 1000) return '0 秒'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return sec + ' 秒'
  const min = Math.floor(sec / 60)
  if (min < 60) return min + ' 分钟'
  const h = Math.floor(min / 60)
  return h + ' 小时 ' + (min % 60) + ' 分'
}

/** Proactive idle phrases; {name} is replaced with the pet's display name. */
const PHRASES = [
  '{name}在哦～需要帮忙吗？',
  '记得起来活动一下，喝点水～',
  '忙完记得摸摸我呀～',
  '有什么我可以帮你的吗？',
  '一直盯着屏幕，眼睛要休息一下哦～',
  '嘿嘿，{name}在这里陪着你～',
  '今天的任务进展如何呀？',
  '累了就歇一会儿，{name}不着急～',
  '工作再忙，也要照顾好自己哦～',
  '有需要查的资料可以叫我～',
]

/**
 * The floating pet. The spritesheet frame advances on requestAnimationFrame
 * with per-frame durations from TRACKS; the atlas image is loaded once and
 * the background position is written straight to the sprite element (no
 * per-frame React state).
 */
export function MaidPet(props: MaidPetProps): ReactPortal {
  const { snapshot, display, feedback } = props
  const spriteRef = useRef<HTMLDivElement | null>(null)
  const floatRef = useRef<HTMLDivElement | null>(null)
  const [imageReady, setImageReady] = useState(false)
  const [frameCounts, setFrameCounts] = useState<number[] | null>(null)
  const [hovered, setHovered] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [dragPos, setDragPos] = useState<{ right: number; bottom: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; right: number; bottom: number } | null>(null)
  const frameRef = useRef<{ track: PetAnimation | null; index: number; elapsed: number }>({
    track: null,
    index: 0,
    elapsed: 0,
  })
  const [sleeping, setSleeping] = useState(false)
  const [localBubble, setLocalBubble] = useState<{ text: string; at: number } | null>(null)
  const [reaction, setReaction] = useState<PetAnimation | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chatBubble, setChatBubble] = useState<{ text: string; at: number } | null>(null)
  const lastActivityRef = useRef(Date.now())
  const animRef = useRef<PetAnimation>('idle')
  const nameRef = useRef('牢梁')
  const chatTimerRef = useRef<number | undefined>(undefined)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const sleepingRef = useRef(false)
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<number | undefined>(undefined)

  // Load the atlas once; then resolve per-row frame counts so tracks never
  // play the transparent trailing cells of a short row. One decoded Image
  // feeds both the sprite render and the frame-count detection. The counts
  // prefer the authoritatively recorded `frames` field on the pet.json
  // manifest route and only fall back to the getImageData atlas scan when
  // that field is absent (older manifests).
  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setImageReady(true)
      fetch(PET_MANIFEST_URL)
        .then((res) => (res.ok ? res.json() : Promise.resolve<{ frames?: unknown }>({})))
        .then((manifest: { frames?: unknown }) => {
          if (cancelled) return
          const frames = manifest.frames
          if (Array.isArray(frames) && frames.length === FRAME_ROWS && frames.every((n) => typeof n === 'number')) {
            setFrameCounts(frames as number[])
          } else {
            setFrameCounts(detectFrameCounts(img))
          }
        })
        .catch(() => {
          if (!cancelled) setFrameCounts(detectFrameCounts(img))
        })
    }
    img.src = PET_SPRITESHEET_URL
    return () => {
      cancelled = true
      img.onload = null
    }
  }, [])

  // Frame loop: advance the current track and write background-position.
  // Offsets must be in SCALED coordinates (background-position applies to the
  // scaled background image), so the current sprite scale rides a ref that
  // the loop reads every tick. Under prefers-reduced-motion the sprite holds
  // its track's first frame instead of animating (presentation-only; the
  // animation state machine is untouched).
  const spriteScale = display.size / FRAME_HEIGHT
  const hostAnimation = snapshot?.animation ?? 'idle'
  const animation: PetAnimation = reaction !== null
    ? reaction
    : (hostAnimation === 'idle' && sleeping ? 'sleeping' : hostAnimation)
  sleepingRef.current = sleeping
  animRef.current = animation
  nameRef.current = snapshot?.name ?? '牢梁'
  const scaleRef = useRef(spriteScale)
  scaleRef.current = spriteScale
  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    // Paint one static sprite frame up front either way, so the pet is never
    // blank while the loop heat-up runs.
    const row = rowOfTrack(animation)
    const track = frameCounts === null
      ? TRACKS[animation]
      : trimTrack(TRACKS[animation], frameCounts[row] ?? TRACKS[animation].frames.length)
    const leadCol = track.frames[0]!
    const lead = framePosition(row, leadCol, scaleRef.current)
    if (spriteRef.current !== null) {
      spriteRef.current.style.backgroundPosition = `${lead.x}px ${lead.y}px`
    }
    if (reduceMotion) return
    let raf = 0
    let last = performance.now()
    const tick = (ts: number): void => {
      const delta = ts - last
      last = ts
      // Trim the track to the row's real frame count (transparent cells
      // would render as a vanishing pet).
      const row = rowOfTrack(animation)
      const track = frameCounts === null
        ? TRACKS[animation]
        : trimTrack(TRACKS[animation], frameCounts[row] ?? TRACKS[animation].frames.length)
      const st = frameRef.current
      if (st.track !== animation) {
        st.track = animation
        st.index = 0
        st.elapsed = 0
      }
      st.elapsed += delta
      const maxIndex = track.frames.length - 1
      while (st.elapsed >= (track.durations[st.index] ?? 0) && st.index < maxIndex) {
        st.elapsed -= track.durations[st.index] ?? 0
        st.index += 1
      }
      if (st.elapsed >= (track.durations[st.index] ?? 0)) {
        if (track.loop) {
          st.elapsed = 0
          st.index = 0
        } else {
          st.index = maxIndex // hold the final frame; the host switches tracks
        }
      }
      const col = track.frames[st.index]!
      const { x, y } = framePosition(row, col, scaleRef.current)
      if (spriteRef.current !== null) {
        spriteRef.current.style.backgroundPosition = `${x}px ${y}px`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animation, frameCounts])

  // Auto-clear the feedback bubble after its CSS animation. The callback
  // rides a ref so re-renders never reset the timer: the 800ms poll rebuilds
  // `props` every tick, and depending on it would starve the timeout.
  const feedbackDoneRef = useRef(props.onFeedbackDone)
  feedbackDoneRef.current = props.onFeedbackDone
  useEffect(() => {
    if (feedback === null) return
    const timer = window.setTimeout(() => feedbackDoneRef.current(), 2600)
    return () => window.clearTimeout(timer)
  }, [feedback])

  // Global activity + cursor tracking: any input keeps the pet awake and
  // records the cursor position (used for the idle lean). A sleeping pet
  // wakes on the first input after dozing off.
  useEffect(() => {
    const onActivity = (e: MouseEvent | KeyboardEvent): void => {
      lastActivityRef.current = Date.now()
      if (sleepingRef.current) {
        sleepingRef.current = false
        setSleeping(false)
        setLocalBubble({ text: '！', at: Date.now() })
      }
    }
    window.addEventListener('mousemove', onActivity)
    window.addEventListener('mousedown', onActivity)
    window.addEventListener('keydown', onActivity)
    return () => {
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('mousedown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [])

  // Sleep after a quiet spell while the host reports idle; the host resuming
  // work (non-idle animation) also clears the sleep state.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const idle = (snapshot?.animation ?? 'idle') === 'idle'
      const shouldSleep = idle && Date.now() - lastActivityRef.current > SLEEP_AFTER_MS
      if (shouldSleep !== sleepingRef.current) {
        sleepingRef.current = shouldSleep
        setSleeping(shouldSleep)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [snapshot?.animation])

  // Auto-clear the local (poke/flail/wake) bubble.
  useEffect(() => {
    if (localBubble === null) return
    const timer = window.setTimeout(() => setLocalBubble(null), 2000)
    return () => window.clearTimeout(timer)
  }, [localBubble])

  // Proactive chatter: while the pet idles, occasionally say a random line.
  // Scheduled once; reads the current animation/name from refs so the 800ms
  // poll never resets the timer.
  useEffect(() => {
    const schedule = (): void => {
      chatTimerRef.current = window.setTimeout(() => {
        if (animRef.current === 'idle') {
          const phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)]!
          setChatBubble({ text: phrase.replaceAll('{name}', nameRef.current), at: Date.now() })
        }
        schedule()
      }, 90_000 + Math.random() * 150_000)
    }
    schedule()
    return () => { if (chatTimerRef.current !== undefined) window.clearTimeout(chatTimerRef.current) }
  }, [])

  // Auto-clear the proactive chat bubble.
  useEffect(() => {
    if (chatBubble === null) return
    const timer = window.setTimeout(() => setChatBubble(null), 4000)
    return () => window.clearTimeout(timer)
  }, [chatBubble])

  // Close the settings panel when the pointer presses anywhere outside the pet.
  useEffect(() => {
    if (!settingsOpen) return
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && floatRef.current?.contains(e.target)) return
      setSettingsOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [settingsOpen])

  // Auto-clear a transient click-reaction animation after it plays.
  useEffect(() => {
    if (reaction === null) return
    const dur = reaction === 'flail' ? 1800 : reaction === 'angry' ? 1600 : 1200
    const timer = window.setTimeout(() => setReaction(null), dur)
    return () => window.clearTimeout(timer)
  }, [reaction])

  // Dragging: pointer events on the sprite; position is right/bottom based.
  // `draggedRef` records whether the pointer actually moved, so the browser's
  // trailing click (fired after pointerup) does not pet the maid.
  const draggedRef = useRef(false)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const current = dragPos ?? { right: display.right, bottom: display.bottom }
    dragRef.current = { startX: e.clientX, startY: e.clientY, ...current }
    draggedRef.current = false
    setHovered(false)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggedRef.current = true
    const right = clampOffset(drag.right - dx, window.innerWidth - 40)
    const bottom = clampOffset(drag.bottom - dy, window.innerHeight - 40)
    setDragPos({ right, bottom })
  }
  const onPointerUp = (): void => {
    if (dragRef.current === null) return
    dragRef.current = null
    if (dragPos !== null) props.onDragEnd(dragPos.right, dragPos.bottom)
  }

  // Click variants: one click pets, a double click pokes, four or more
  // clicks make the maid flail. Clicks are debounced so the variants resolve
  // cleanly instead of the single-click firing immediately.
  const handleClick = (): void => {
    if (draggedRef.current) return
    clickCountRef.current += 1
    if (clickTimerRef.current !== undefined) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = window.setTimeout(() => {
      const n = clickCountRef.current
      clickCountRef.current = 0
      clickTimerRef.current = undefined
      if (n >= 4) {
        setReaction('flail')
        setLocalBubble({ text: '别戳啦！！', at: Date.now() })
      } else if (n === 3) {
        setReaction('angry')
        setLocalBubble({ text: '再戳我就生气了！', at: Date.now() })
      } else if (n === 2) {
        setReaction('poked')
        setLocalBubble({ text: '戳我干嘛呀～', at: Date.now() })
      } else {
        setReaction('petted')
        props.onPet()
      }
    }, CLICK_WINDOW_MS)
  }

  const pos = dragPos ?? { right: display.right, bottom: display.bottom }
  const spriteWidth = Math.round(FRAME_WIDTH * spriteScale)
  const spriteHeight = Math.round(FRAME_HEIGHT * spriteScale)
  const stats = snapshot?.stats
  const tasks = snapshot?.tasks
  const totalTodayTokens = (stats?.inputTokens ?? 0) + (stats?.cacheReadTokens ?? 0) + (stats?.outputTokens ?? 0) + (stats?.cacheWriteTokens ?? 0)
  const totalTodayTurns = (stats?.todayTurns ?? 0) + (stats?.todayFailedTurns ?? 0)
  const avgTurnMs = (stats?.todayTurns ?? 0) > 0 ? (stats?.todayWorkMs ?? 0) / (stats?.todayTurns ?? 0) : 0
  const summary = totalTodayTurns === 0
    ? '今天还没开工，休息一下吧～'
    : '今天完成了 ' + (stats?.todayTurns ?? 0) + ' 个任务'
      + ((stats?.todayFailedTurns ?? 0) > 0 ? '（失败 ' + (stats?.todayFailedTurns ?? 0) + ' 个）' : '')
      + '，耗时 ' + fmtDuration(stats?.todayWorkMs ?? 0)
      + '，消耗 ' + fmtTokens(totalTodayTokens) + ' tokens，缓存命中 ' + fmtPercent(stats?.cacheHitRate ?? 0) + '。'

  const float = (
    <div
      ref={floatRef}
      className={styles.float}
      style={{ right: pos.right, bottom: pos.bottom, zIndex: 2147483000 }}
      onPointerEnter={() => {
        if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current)
        setHovered(true)
      }}
      onPointerLeave={(e) => {
        // The panel and bubble render OUTSIDE the container's box (absolute,
        // above the sprite), so moving onto them fires pointerleave on the
        // container. Treat a target still inside the container's DOM (the
        // overflowed panel) as "still hovering"; otherwise defer the hide a
        // beat so a quick reach for the buttons never dismisses them first.
        const next = e.relatedTarget
        if (next instanceof Node && floatRef.current?.contains(next)) return
        if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = window.setTimeout(() => setHovered(false), 200)
      }}
    >
      <div
        ref={spriteRef}
        className={styles.sprite}
        style={{
          width: spriteWidth,
          height: spriteHeight,
          backgroundImage: imageReady ? `url(${PET_SPRITESHEET_URL})` : undefined,
          backgroundSize: `${FRAME_WIDTH * FRAME_COLUMNS * spriteScale}px ${FRAME_HEIGHT * FRAME_ROWS * spriteScale}px`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: '0 0',
          cursor: dragRef.current === null ? 'grab' : 'grabbing',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={handleClick}
        role="button"
        aria-label="maid"
      />
      {feedback !== null && (
        <div key={feedback.at} className={`${styles.bubble} ${feedback.kind === 'feed' ? styles.bubbleFeed : styles.bubblePet}`}>
          {feedback.text}
        </div>
      )}
      {localBubble !== null && (
        <div key={localBubble.at} className={styles.bubble + ' ' + styles.bubblePet}>
          {localBubble.text}
        </div>
      )}
      {chatBubble !== null && (
        <div key={chatBubble.at} className={styles.bubble + ' ' + styles.bubbleChat}>
          {chatBubble.text}
        </div>
      )}
      {hovered && dragRef.current === null && !settingsOpen && (
        <div className={styles.panel}>
          <div className={styles.statsHeader}>
            <span className={styles.statsTitle}>{snapshot?.name ?? '牢梁'} 的工作面板</span>
          </div>
          <div className={styles.statsGrid}>
            <div className={styles.statsCell}><span className={styles.statsLabel}>今日任务</span><span className={styles.statsValue}>{stats?.todayTurns ?? 0}</span></div>
            <div className={styles.statsCell}><span className={styles.statsLabel}>累计任务</span><span className={styles.statsValue}>{stats?.totalTurns ?? 0}</span></div>
            <div className={styles.statsCell}><span className={styles.statsLabel}>今日总 tokens</span><span className={styles.statsValue}>{fmtTokens(totalTodayTokens)}</span></div>
            <div className={styles.statsCell}><span className={styles.statsLabel}>缓存节省</span><span className={styles.statsValue}>{fmtTokens(stats?.cacheReadTokens ?? 0)}</span></div>
            <div className={styles.statsCell}><span className={styles.statsLabel}>工作耗时</span><span className={styles.statsValue}>{fmtDuration(stats?.todayWorkMs ?? 0)}</span></div>
            <div className={styles.statsCell}><span className={styles.statsLabel}>平均/任务</span><span className={styles.statsValue}>{fmtDuration(avgTurnMs)}</span></div>
            <div className={styles.statsCell}><span className={styles.statsLabel}>模型</span><span className={styles.statsValue}>{stats?.model || '—'}</span></div>
            <div className={styles.statsCell}><span className={styles.statsLabel}>缓存命中</span><span className={styles.statsValue}>{fmtPercent(stats?.cacheHitRate ?? 0)}</span></div>
          </div>
          <div className={styles.statsSummary}>{summary}</div>
          <div className={styles.taskSection}>
            <div className={styles.taskSectionTitle}>未来任务</div>
            {tasks !== undefined && tasks.future.length > 0 ? tasks.future.map((task, i) => (
              <div key={i} className={styles.taskRow}>
                <span className={styles.taskName}>{task.title}</span>
                <span className={styles.taskTime}>{task.timeText}</span>
              </div>
            )) : <div className={styles.taskEmpty}>暂无未来任务</div>}
          </div>
          <div className={styles.taskSection}>
            <div className={styles.taskSectionTitle}>已执行任务</div>
            {tasks !== undefined && tasks.executed.length > 0 ? tasks.executed.map((task, i) => (
              <div key={i}>
                <div className={styles.taskRow}>
                  <span className={styles.taskName}>{task.title}</span>
                  <span className={task.ok ? styles.taskOk : styles.taskFail}>{task.ok ? '成功' : '失败'}</span>
                </div>
                {!task.ok && task.summary ? <div className={styles.taskFailReason}>{task.summary}</div> : null}
              </div>
            )) : <div className={styles.taskEmpty}>今天还没有执行任务</div>}
          </div>
          <div className={styles.rankRow}>
            <span className={styles.nameCell}>{snapshot?.name ?? '牢梁'}</span>
            <span>{props.t('pet.rank', { rank: snapshot?.affinity.rank ?? '?' })}</span>
          </div>
          <div className={styles.rankRow}>
            <span>{props.t('pet.treats', { n: snapshot?.treats.stocked ?? 0 })}</span>
            <span>{props.t('pet.points', { points: snapshot?.affinity.points ?? 0 })}</span>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.action} onClick={props.onFeed}>
              {props.t('pet.feed')}
            </button>
            <button
              type="button"
              className={styles.action + ((snapshot?.autoCoding ?? false) ? ' ' + styles.actionActive : '')}
              onClick={() => props.onSetAutoCoding(!(snapshot?.autoCoding ?? false))}
              aria-pressed={snapshot?.autoCoding ?? false}
              title={props.t('pet.autoCodingHint')}
            >
              {props.t('pet.autoCoding')}{' '}{props.t((snapshot?.autoCoding ?? false) ? 'settings.on' : 'settings.off')}
            </button>
            <button type="button" className={styles.action} onClick={() => setSettingsOpen(true)}>
              {props.t('pet.settings')}
            </button>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className={styles.statsPanel}>
          <div className={styles.statsHeader}>
            <span className={styles.statsTitle}>{props.t('pet.settings')}</span>
            <button type="button" className={styles.statsClose} onClick={() => setSettingsOpen(false)} aria-label="关闭">×</button>
          </div>
          {renaming ? (
            <div className={styles.renameRow}>
              <input
                className={styles.nameInput}
                value={nameDraft}
                maxLength={20}
                placeholder={props.t('pet.namePlaceholder')}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const trimmed = nameDraft.trim()
                    if (trimmed !== '') {
                      props.onRename(trimmed)
                      setRenaming(false)
                    }
                  } else if (e.key === 'Escape') {
                    setRenaming(false)
                  }
                }}
              />
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  const trimmed = nameDraft.trim()
                  if (trimmed !== '') {
                    props.onRename(trimmed)
                    setRenaming(false)
                  }
                }}
              >
                {props.t('pet.confirm')}
              </button>
            </div>
          ) : (
            <div className={styles.settingsList}>
              <button
                type="button"
                className={styles.settingsItem}
                onClick={() => {
                  setNameDraft(snapshot?.name ?? '')
                  setRenaming(true)
                }}
              >
                {props.t('pet.rename')}
              </button>
              <button type="button" className={styles.settingsItem} onClick={props.onHide}>
                {props.t('pet.hide')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )

  return createPortal(float, document.body)
}
