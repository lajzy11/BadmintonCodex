import type { WorkspacePlan } from '../activities/activityWorkspaceApi'

export type ImportPreviewRow = {
  line: number
  raw: string
  displayName: string
  level: number | null
  planId: string | null
  planCode: string | null
  gender: 'M' | 'F' | null
  note: string
  status: 'ready' | 'warning' | 'error'
  issues: string[]
}

function timeParts(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value))
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)])) as Record<string, number>
}

function planTimeHint(plan: WorkspacePlan): [number, number] {
  const start = timeParts(plan.start_at)
  const end = timeParts(plan.end_at)
  const crossesDate = start.year !== end.year || start.month !== end.month || start.day !== end.day
  return [start.hour, crossesDate && end.hour === 0 ? 24 : end.hour]
}

function normalizeGender(value: string): 'M' | 'F' | null {
  const normalized = value.trim().toUpperCase()
  if (normalized === 'M' || normalized === '男') return 'M'
  if (normalized === 'F' || normalized === '女') return 'F'
  return null
}

function stripSequenceNumber(value: string): string {
  return value.replace(/^\s*\d+\s*[.．、)]\s*/, '').trim()
}

function parseGenericLine(raw: string, line: number, plans: WorkspacePlan[]): ImportPreviewRow {
  let value = stripSequenceNumber(raw).replace(/[（]/g, '(').replace(/[）]/g, ')').trim()
  const issues: string[] = []
  let hintedPlan: WorkspacePlan | undefined
  const timeHint = value.match(/\(\s*(\d{1,2})(?::\d{2})?\s*[-–~～]\s*(\d{1,2})(?::\d{2})?\s*\)/)
  if (timeHint) {
    const hint: [number, number] = [Number(timeHint[1]), Number(timeHint[2])]
    hintedPlan = plans.find((plan) => { const candidate = planTimeHint(plan); return candidate[0] === hint[0] && candidate[1] === hint[1] })
    if (!hintedPlan) issues.push(`找不到 ${timeHint[1]}–${timeHint[2]} 對應方案`)
    value = value.replace(timeHint[0], '').trim()
  }

  const normalized = value.replace(/[／＼\\，,、\t]/g, '/').replace(/\s*\/\s*/g, '/').replace(/\/+/g, '/')
  let tokens = normalized.split('/').map((token) => token.trim()).filter(Boolean)
  let displayName = ''
  let level: number | null = null
  let gender: 'M' | 'F' | null = null
  let explicitPlan: WorkspacePlan | undefined
  const notes: string[] = []

  if (tokens.length === 1) {
    const compact = tokens[0].match(/^(.*?\D)\s*(\d{1,2})$/u)
    if (compact) tokens = [compact[1].trim(), compact[2]]
  }

  for (const token of tokens) {
    const numeric = /^\d{1,2}$/.test(token) ? Number(token) : null
    const tokenGender = normalizeGender(token)
    const tokenPlan = plans.find((plan) => plan.code.toUpperCase() === token.toUpperCase())
    if (level === null && numeric !== null) level = numeric
    else if (!gender && tokenGender) gender = tokenGender
    else if (!explicitPlan && tokenPlan) explicitPlan = tokenPlan
    else if (!displayName) displayName = token
    else notes.push(token)
  }

  if (!displayName) issues.push('缺少姓名')
  if (level === null || level < 1 || level > 18) issues.push('級數需為 1–18')
  const defaultPlan = plans.find((plan) => plan.code.toUpperCase() === 'A')
  const plan = explicitPlan ?? hintedPlan ?? (timeHint ? undefined : defaultPlan)
  if (!plan) issues.push('無法判斷方案')

  return { line, raw, displayName, level, planId: plan?.id ?? null, planCode: plan?.code ?? null, gender, note: notes.join(' / '), status: issues.length ? 'error' : 'ready', issues }
}

export function parseImportText(text: string, plans: WorkspacePlan[], existingNames: string[], skillRange: [number, number]): ImportPreviewRow[] {
  let lines = text.split(/\r?\n/).map((raw, index) => ({ raw: raw.trim(), line: index + 1 })).filter((item) => item.raw)
  if (lines[0] && /(姓名|name)/i.test(lines[0].raw) && /(級數|level)/i.test(lines[0].raw)) lines = lines.slice(1)
  const seen = new Set(existingNames.map((name) => name.trim().toLowerCase()))
  return lines.map(({ raw, line }) => {
    const row = parseGenericLine(raw, line, plans)
    const normalizedName = row.displayName.trim().toLowerCase()
    if (normalizedName && seen.has(normalizedName)) row.issues.push('疑似重名')
    if (normalizedName) seen.add(normalizedName)
    if (row.level !== null && (row.level < skillRange[0] || row.level > skillRange[1])) row.issues.push(`級數超出活動 ${skillRange[0]}–${skillRange[1]}`)
    if (row.status !== 'error' && row.issues.length) row.status = 'warning'
    return row
  })
}
