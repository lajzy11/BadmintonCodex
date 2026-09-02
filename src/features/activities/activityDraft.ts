export type ActivityPlanDraft = { code: string; startTime: string; endTime: string; amount: string }
export type ActivityMatchingSettings = { priority: string; levelMatch: string; repeatAvoidance: string; genderPreference: string }
export type ActivityTtsSettings = { enabled: boolean; repeatCount: number; rate: number }

export type ActivityDraft = {
  activityDate: string
  venue: { name: string; region: string; district: string; address: string; floorType: string; note: string }
  venueId: string | null
  saveVenue: boolean
  initialCourtCount: number
  capacityMode: 'unlimited' | 'limited'
  capacityLimit: number
  skillMin: number
  skillMax: number
  assignMode: 'system_assign' | 'manual_assign' | 'free_play'
  customTitle: string
  shuttlecock: string
  contactInfo: string
  description: string
  plans: ActivityPlanDraft[]
  financeEnabled: boolean
  paymentMethods: string[]
  defaultPaymentMethod: string
  autoTimeEligibilityEnabled: boolean
  matchingSettings: ActivityMatchingSettings
  ttsSettings: ActivityTtsSettings
  saveAsTemplate: boolean
  templateName: string
}

export function todayInTaipei(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
}

export function initialActivityDraft(): ActivityDraft {
  return {
    activityDate: todayInTaipei(),
    venue: { name: '', region: '', district: '', address: '', floorType: '', note: '' },
    venueId: null,
    saveVenue: true,
    initialCourtCount: 1,
    capacityMode: 'limited',
    capacityLimit: 8,
    skillMin: 1,
    skillMax: 18,
    assignMode: 'system_assign',
    customTitle: '',
    shuttlecock: '',
    contactInfo: '',
    description: '',
    plans: [{ code: 'A', startTime: '09:00', endTime: '12:00', amount: '300' }],
    financeEnabled: true,
    paymentMethods: ['cash'],
    defaultPaymentMethod: 'cash',
    autoTimeEligibilityEnabled: true,
    matchingSettings: { priority: 'balanced', levelMatch: 'balanced', repeatAvoidance: 'moderate', genderPreference: 'none' },
    ttsSettings: { enabled: true, repeatCount: 2, rate: 1 },
    saveAsTemplate: false,
    templateName: '',
  }
}

export function validateActivityStep(draft: ActivityDraft, step: number): string[] {
  const errors: string[] = []
  if (step === 1) {
    if (draft.activityDate < todayInTaipei()) errors.push('活動日期不可早於今天')
    if (!draft.venue.name.trim()) errors.push('請填寫球館名稱')
    if (!draft.venue.region.trim()) errors.push('請填寫縣市')
    if (!draft.venue.district.trim()) errors.push('請填寫行政區')
    if (draft.initialCourtCount < 1 || draft.initialCourtCount > 20) errors.push('初始場地數需為 1–20')
    if (draft.capacityMode === 'limited' && (draft.capacityLimit < 1 || draft.capacityLimit > 100)) errors.push('招收人數需為 1–100')
    if (draft.skillMin < 1 || draft.skillMax > 18 || draft.skillMin > draft.skillMax) errors.push('請確認級數範圍')
    if (draft.customTitle.length > 50) errors.push('活動標題不可超過 50 個字元')
    if (draft.venue.name.length > 60) errors.push('球館名稱不可超過 60 個字元')
    if (draft.venue.address.length > 120) errors.push('地址不可超過 120 個字元')
    if (draft.venue.floorType.length > 30) errors.push('地板材質不可超過 30 個字元')
    if (draft.venue.note.length > 200) errors.push('球館備註不可超過 200 個字元')
    if (draft.shuttlecock.length > 50) errors.push('指定用球不可超過 50 個字元')
    if (draft.contactInfo.length > 100) errors.push('團主聯絡資料不可超過 100 個字元')
    if (draft.description.length > 500) errors.push('注意事項不可超過 500 個字元')
    if (!['balanced', 'waiting', 'games'].includes(draft.matchingSettings.priority)
      || !['loose', 'balanced', 'strict'].includes(draft.matchingSettings.levelMatch)
      || !['none', 'moderate', 'strong'].includes(draft.matchingSettings.repeatAvoidance)
      || !['none', 'mixed', 'separate'].includes(draft.matchingSettings.genderPreference)) errors.push('請確認進階排點設定')
    if (!Number.isInteger(draft.ttsSettings.repeatCount) || draft.ttsSettings.repeatCount < 1 || draft.ttsSettings.repeatCount > 3) errors.push('語音重複次數需為 1–3 次')
    if (draft.ttsSettings.rate < 0.5 || draft.ttsSettings.rate > 1.5) errors.push('語音速度需為 0.5–1.5')
  }
  if (step === 2) {
    const timePattern = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/
    if (draft.plans.length < 1 || draft.plans.length > 5) errors.push('方案需為 1–5 個')
    for (const plan of draft.plans) {
      if (!timePattern.test(plan.startTime) || !timePattern.test(plan.endTime)) errors.push(`方案 ${plan.code} 時間需使用 24 小時制 HH:mm`)
      const amount = Number(plan.amount)
      if (draft.financeEnabled && (plan.amount.trim() === '' || !Number.isInteger(amount) || amount < 0 || amount > 10000)) errors.push(`方案 ${plan.code} 金額需為 0–10,000 元整數`)
    }
    if (draft.financeEnabled && draft.paymentMethods.length === 0) errors.push('請至少選擇一種付款方式')
    if (draft.financeEnabled && draft.defaultPaymentMethod && !draft.paymentMethods.includes(draft.defaultPaymentMethod)) errors.push('預設付款方式必須是已啟用的付款方式')
  }
  if (draft.saveAsTemplate && draft.templateName.length > 50) errors.push('範本名稱不可超過 50 個字元')
  return errors
}
