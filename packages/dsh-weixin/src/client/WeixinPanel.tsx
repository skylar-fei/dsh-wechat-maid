import { useCallback, useEffect, useState } from 'react'
import type { WeixinApi } from './api.ts'
import type { PanelController } from './state.ts'
import type { WeixinStatusPayload } from '../protocol.ts'
import { tt } from './helpers.ts'
import css from './panel.module.css'

/** Panel props. */
export interface WeixinPanelProps {
  controller: PanelController
  api: WeixinApi
}

/** Status -> locale key mapping. */
const STATE_LABEL: Record<string, 'status.disconnected' | 'status.connecting' | 'status.connected' | 'status.error'> = {
  disconnected: 'status.disconnected',
  connecting: 'status.connecting',
  connected: 'status.connected',
  error: 'status.error',
}

/** The WeChat connection panel: status + connect/disconnect controls. */
export function WeixinPanel({ controller, api }: WeixinPanelProps) {
  const [status, setStatus] = useState<WeixinStatusPayload | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 2000)
    return () => { clearInterval(timer) }
  }, [refresh])

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      setStatus(await api.connect())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      setStatus(await api.disconnect())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const state = status?.state ?? 'disconnected'
  const labelKey = STATE_LABEL[state] ?? 'status.disconnected'
  const connected = state === 'connected'
  const connecting = state === 'connecting'

  return (
    <div className={css.panel}>
      <div className={css.panelHeader}>
        <h2 className={css.panelTitle}>{tt('panel.title')}</h2>
        <button type="button" className={css.iconButton} title={tt('common.close')} aria-label={tt('common.close')} onClick={() => { controller.close() }}>x</button>
      </div>
      <div className={css.panelContent}>
        <div className={css.statusRow}>
          <span className={css.statusLabel}>{tt('status.label')}</span>
          <span className={css.statusBadge} data-state={state}>{tt(labelKey)}</span>
        </div>
        {status?.accountId !== undefined && (
          <div className={css.statusRow}>
            <span className={css.statusLabel}>{tt('status.account')}</span>
            <span className={css.statusValue}>{status.accountId}</span>
          </div>
        )}
        {status?.error !== undefined && (
          <div className={css.statusRow}><span className={css.statusError}>{status.error}</span></div>
        )}
        {error !== undefined && (
          <div className={css.statusRow}><span className={css.statusError}>{error}</span></div>
        )}
        {connecting && <div className={css.hint}>{tt('hint.scan')}</div>}
        {!connecting && state === 'disconnected' && <div className={css.hint}>{tt('hint.disconnected')}</div>}
        <div className={css.actions}>
          {!connected && (
            <button type="button" className={css.button} disabled={busy || connecting} onClick={() => { void connect() }}>{tt('action.connect')}</button>
          )}
          {(connected || connecting || state === 'error') && (
            <button type="button" className={css.button} disabled={busy} onClick={() => { void disconnect() }}>{tt('action.disconnect')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
