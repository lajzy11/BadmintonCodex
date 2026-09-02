import { describe, expect, test } from 'vitest'
import type { WorkspacePlan } from '../activities/activityWorkspaceApi'
import { parseImportText } from './importParser'

const plans: WorkspacePlan[] = [
  { id: 'plan-1', code: 'A', start_at: '2026-08-28T13:00:00Z', end_at: '2026-08-28T15:00:00Z', amount: 300 },
  { id: 'plan-2', code: 'B', start_at: '2026-08-28T14:00:00Z', end_at: '2026-08-28T16:00:00Z', amount: 300 },
]

describe('member import parser', () => {
  test('parses numbered LINE relay rows and time hints', () => {
    const [row] = parseImportText('12.Hugo/7 (21-23)', plans, [], [1, 10])
    expect(row).toMatchObject({ displayName: 'Hugo', level: 7, planCode: 'A', status: 'ready' })
  })

  test('supports full-width parentheses and compact name-level input', () => {
    const [row] = parseImportText('15.阿派9（22-24）', plans, [], [1, 10])
    expect(row).toMatchObject({ displayName: '阿派', level: 9, planCode: 'B', status: 'ready' })
  })

  test('defaults to plan A when no plan or time hint is written', () => {
    const [row] = parseImportText('古斌/9', plans, [], [1, 10])
    expect(row).toMatchObject({ status: 'ready', planCode: 'A' })
  })

  test('warns for duplicate names and levels outside the activity range', () => {
    const [row] = parseImportText('Vivian/4/A', plans, ['Vivian'], [5, 10])
    expect(row.status).toBe('warning')
    expect(row.issues).toEqual(expect.arrayContaining(['疑似重名', '級數超出活動 5–10']))
  })
})
