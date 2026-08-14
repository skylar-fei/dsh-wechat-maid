import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { getWeixinApi } from './state.ts'
import type { WeixinScheduledTask } from './api.ts'
import css from './settings-card.module.css'

/** The scheduled-tasks settings card props: just the framework-injected locale seat. */
export type WeixinSettingsCardProps = PropsLocale<'dsh-weixin'>

/** Format an epoch ms as HH:MM. */
function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/**
 * Renders the dsh-weixin scheduled tasks as a compact list. The top level shows
 * each task's title, human-readable time, last-run outcome, and an enable
 * switch; clicking a task expands a detail view with the instruction content
 * and an edit field.
 */
export function WeixinSettingsCard({ t }: WeixinSettingsCardProps) {
  const api = getWeixinApi()
  const [tasks, setTasks] = useState<WeixinScheduledTask[]>([])
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState<string>('')

  const refresh = useCallback(async () => {
    if (api === undefined) return
    try {
      const view = await api.tasks()
      setTasks(view.tasks)
    } catch {
      // keep last-known state on a transient read failure
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const persist = async (next: WeixinScheduledTask[]): Promise<void> => {
    setTasks(next)
    try {
      await api?.saveTasks(next)
    } catch {
      // optimistic state stays until the next refresh
    }
    void refresh()
  }

  const toggleTask = (task: WeixinScheduledTask): void => {
    void persist(tasks.map((item) => item.id === task.id ? { ...item, enabled: !item.enabled } : item))
  }

  const openDetail = (task: WeixinScheduledTask): void => {
    setEditingId(task.id)
    setDraft(task.prompt)
  }

  const saveDetail = (task: WeixinScheduledTask): void => {
    void persist(tasks.map((item) => item.id === task.id ? { ...item, prompt: draft } : item))
    setEditingId(undefined)
  }

  const closeDetail = (): void => {
    setEditingId(undefined)
    setDraft('')
  }

  return (
    <li className={css.card}>
      <div className={css.header}>
        <span className={css.name}>{t('settings.title')}</span>
        <span className={css.description}>{t('settings.description')}</span>
      </div>
      <div className={css.body}>
        {tasks.length === 0
          ? <p className={css.empty}>{t('settings.empty')}</p>
          : (
            <ul className={css.tasks}>
              {tasks.map((task) => {
                const open = editingId === task.id
                const failed = task.lastResult === 'error'
                return (
                  <li key={task.id} className={css.task}>
                    <div className={css.taskRow}>
                      <button type="button" className={css.taskMain} onClick={() => { open ? closeDetail() : openDetail(task) }}>
                        <span className={css.taskTop}>
                          <span className={css.taskTitle}>{task.title}</span>
                          <span className={css.taskTime}>{task.timeText ?? task.cron}</span>
                        </span>
                        {task.lastRunAt !== undefined && (
                          <span className={css.taskLast} data-result={failed ? 'error' : 'ok'} title={task.lastSummary}>
                            {t('settings.lastRun')} {formatTime(task.lastRunAt)} · {failed ? t('settings.runError') : t('settings.runOk')}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={task.enabled}
                        aria-label={task.title}
                        className={css.switch}
                        data-on={task.enabled ? 'true' : undefined}
                        onClick={() => { toggleTask(task) }}
                      >
                        <span className={css.knob} />
                      </button>
                    </div>
                    {open
                      ? (
                        <div className={css.detail}>
                          <textarea
                            className={css.textarea}
                            value={draft}
                            onChange={(event) => { setDraft(event.target.value) }}
                            rows={10}
                          />
                          <div className={css.actions}>
                            <button type="button" className={css.button} onClick={() => { saveDetail(task) }}>{t('settings.save')}</button>
                            <button type="button" className={css.buttonGhost} onClick={closeDetail}>{t('settings.cancel')}</button>
                          </div>
                        </div>
                      )
                      : null}
                  </li>
                )
              })}
            </ul>
          )}
      </div>
    </li>
  )
}
