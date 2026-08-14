/**
 * Bridge-layer tests: the pure helpers that map a WeChat message onto the
 * shared agent must stay correct (model-selection resolution and assistant-text
 * extraction are the two decisions the bridge makes on every message).
 */

import { describe, expect, it } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { extractLatestAssistantText, resolveModelSelection } from '../src/bridge.ts'

describe('resolveModelSelection', () => {
  const defaults: ModelSelection = { provider: 'deepseek', model: 'deepseek-chat' }

  it('uses defaults when no override is set', () => {
    expect(resolveModelSelection({}, defaults)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(resolveModelSelection({ agentProvider: '  ', agentModel: '' }, defaults)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('overrides provider only', () => {
    expect(resolveModelSelection({ agentProvider: ' other ' }, defaults)).toEqual({ provider: 'other', model: 'deepseek-chat' })
  })

  it('overrides model only', () => {
    expect(resolveModelSelection({ agentModel: 'gpt-4' }, defaults)).toEqual({ provider: 'deepseek', model: 'gpt-4' })
  })

  it('overrides both provider and model', () => {
    expect(resolveModelSelection({ agentProvider: 'a', agentModel: 'b' }, defaults)).toEqual({ provider: 'a', model: 'b' })
  })
})

describe('extractLatestAssistantText', () => {
  const assistantEvent = (text: string) => ({
    seq: 0,
    time: 0,
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    },
  })

  it('returns the last non-empty assistant text at or after the baseline', () => {
    const events = [assistantEvent('first'), assistantEvent('second')] as never
    expect(extractLatestAssistantText(events as never, 0)).toBe('second')
  })

  it('ignores events before the baseline', () => {
    const events = [assistantEvent('before')] as never
    expect(extractLatestAssistantText(events as never, 1)).toBe('')
  })

  it('returns empty when no assistant text exists', () => {
    expect(extractLatestAssistantText([] as never, 0)).toBe('')
  })

  it('skips assistant messages with empty text', () => {
    const events = [assistantEvent(''), assistantEvent('real')] as never
    expect(extractLatestAssistantText(events as never, 0)).toBe('real')
  })
})
