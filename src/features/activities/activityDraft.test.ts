import { describe, expect, test } from 'vitest'
import { initialActivityDraft, validateActivityStep } from './activityDraft'

describe('activity draft validation', () => {
  test('requires venue location in step one', () => {
    const draft = initialActivityDraft()
    expect(validateActivityStep(draft, 1)).toEqual([
      '請填寫球館名稱',
      '請填寫縣市',
      '請填寫行政區',
    ])
  })

  test('accepts a complete default plan and finance setup', () => {
    const draft = initialActivityDraft()
    expect(validateActivityStep(draft, 2)).toEqual([])
  })

  test('requires an amount when finance is enabled', () => {
    const draft = initialActivityDraft()
    draft.plans[0].amount = ''
    expect(validateActivityStep(draft, 2)).toContain('方案 A 金額需為 0–10,000 元整數')
  })

  test('accepts an optional default payment method', () => {
    const draft = initialActivityDraft()
    draft.defaultPaymentMethod = ''
    expect(validateActivityStep(draft, 2)).toEqual([])
  })

  test('requires 24-hour plan times', () => {
    const draft = initialActivityDraft()
    draft.plans[0].startTime = '9:00 AM'
    expect(validateActivityStep(draft, 2)).toContain('方案 A 時間需使用 24 小時制 HH:mm')
  })

  test('validates voice call limits', () => {
    const draft = initialActivityDraft()
    draft.ttsSettings.repeatCount = 4
    draft.ttsSettings.rate = 2
    expect(validateActivityStep(draft, 1)).toEqual(expect.arrayContaining([
      '語音重複次數需為 1–3 次',
      '語音速度需為 0.5–1.5',
    ]))
  })
})
