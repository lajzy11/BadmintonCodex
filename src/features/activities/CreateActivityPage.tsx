import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MaterialIcon } from '../../app/MaterialIcon'
import { createActivity, updateActivity, updateActivityTemplate } from './createActivityApi'
import { initialActivityDraft, todayInTaipei, type ActivityDraft, validateActivityStep } from './activityDraft'
import { useActivityCopySource, useActivityTemplateSource, useOrganizerVenues } from './activitySourcesApi'
import { useAuth } from '../auth/AuthProvider'
import { useSettingsData } from '../settings/settingsApi'
import { VenueEditor } from '../settings/VenuesSection'
import { ContentNavigation } from '../../app/ContentWorkspace'

const paymentOptions = [['cash', '現金'], ['line_pay', 'LINE Pay'], ['transfer', '轉帳'], ['voucher', '球券'], ['other', '其他']]
const planCodes = ['A', 'B', 'C', 'D', 'E']
const assignOptions: Array<[ActivityDraft['assignMode'], string]> = [
  ['system_assign', '系統排點'],
  ['manual_assign', '人工排點'],
  ['free_play', '自由上場'],
]

function RequiredLabel({ children }: { children: string }) {
  return <span className="field-label">{children}<span className="required-mark" aria-hidden="true">*</span></span>
}

function planRange(start: string, end: string) {
  if (!start || !end) return '時間未完成'
  return `${start}–${end <= start ? `翌日 ${end}` : end}`
}

export function CreateActivityPage() {
  const [step, setStep] = useState(1)
  const [draft, setDraft] = useState<ActivityDraft>(initialActivityDraft)
  const [errors, setErrors] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showVenueEditor, setShowVenueEditor] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const copyActivityId = searchParams.get('copy')
  const editActivityId = searchParams.get('edit')
  const templateId = searchParams.get('template')
  const editTemplateId = searchParams.get('editTemplate')
  const venues = useOrganizerVenues()
  const copySource = useActivityCopySource(copyActivityId ?? editActivityId)
  const templateSource = useActivityTemplateSource(templateId ?? editTemplateId)
  const copyApplied = useRef(false)
  const defaultsApplied = useRef(false)
  const venueDefaultApplied = useRef(false)
  const auth = useAuth()
  const settings = useSettingsData(auth.user?.id)

  useEffect(() => {
    if (!copyApplied.current && copySource.data) {
      setDraft(copySource.data)
      setStep(editActivityId ? 1 : 3)
      copyApplied.current = true
    }
  }, [copySource.data, editActivityId])

  useEffect(() => {
    if (!copyApplied.current && templateSource.data) { setDraft(templateSource.data.draft); setStep(1); copyApplied.current = true }
  }, [templateSource.data])

  useEffect(() => {
    if (defaultsApplied.current || copyActivityId || editActivityId || templateId || editTemplateId || !settings.data) return
    setDraft((current) => ({ ...current, contactInfo: current.contactInfo || settings.data.organization.default_contact_info || '', shuttlecock: current.shuttlecock || settings.data.organization.default_shuttlecock || '' }))
    defaultsApplied.current = true
  }, [copyActivityId, editActivityId, templateId, editTemplateId, settings.data])

  useEffect(() => {
    if (venueDefaultApplied.current || copyActivityId || editActivityId || templateId || editTemplateId || !venues.data) return
    venueDefaultApplied.current = true
    const venue = venues.data[0]
    if (venue) setDraft((current) => ({ ...current, venueId: venue.id, venue: { name: venue.name, region: venue.region, district: venue.district, address: venue.address ?? '', floorType: venue.floor_type ?? '', note: venue.note ?? '' }, saveVenue: false }))
  }, [copyActivityId, editActivityId, templateId, editTemplateId, venues.data])

  function patch(values: Partial<ActivityDraft>) { setDraft((current) => ({ ...current, ...values })) }
  function next() {
    const nextErrors = validateActivityStep(draft, step)
    setErrors(nextErrors)
    if (nextErrors.length === 0) setStep((current) => Math.min(3, current + 1))
  }
  function back() { setErrors([]); setStep((current) => Math.max(1, current - 1)) }
  function goToStep(target: number) { setErrors([]); setStep(target) }
  function updatePlan(index: number, values: Partial<ActivityDraft['plans'][number]>) {
    patch({ plans: draft.plans.map((plan, planIndex) => planIndex === index ? { ...plan, ...values } : plan) })
  }
  function selectVenue(venueId: string) {
    if (!venueId) {
      patch({ venueId: null, venue: { name: '', region: '', district: '', address: '', floorType: '', note: '' }, saveVenue: true })
      return
    }
    const venue = venues.data?.find((item) => item.id === venueId)
    if (!venue) return
    patch({ venueId, venue: { name: venue.name, region: venue.region, district: venue.district, address: venue.address ?? '', floorType: venue.floor_type ?? '', note: venue.note ?? '' }, saveVenue: false })
  }
  function addPlan() {
    const code = planCodes.find((candidate) => !draft.plans.some((plan) => plan.code === candidate))
    if (code) patch({ plans: [...draft.plans, { code, startTime: '09:00', endTime: '12:00', amount: '300' }] })
  }
  function testVoice() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setErrors(['此瀏覽器不支援語音叫號。'])
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance('球場一，請王小明、林小美、陳大華、李小羽上場。')
    utterance.lang = 'zh-TW'
    utterance.rate = draft.ttsSettings.rate
    window.speechSynthesis.speak(utterance)
  }
  async function submit() {
    const nextErrors = [...validateActivityStep(draft, 1), ...validateActivityStep(draft, 2)]
    setErrors(nextErrors)
    if (nextErrors.length) return
    setIsSubmitting(true)
    try {
      if (editActivityId) {
        await updateActivity(editActivityId, draft)
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['activity-workspace', editActivityId] }), queryClient.invalidateQueries({ queryKey: ['activity-center'] })])
        navigate(`/activities/${editActivityId}`, { replace: true })
      } else if (editTemplateId) {
        await updateActivityTemplate(editTemplateId, draft)
        await queryClient.invalidateQueries({ queryKey: ['activity-templates'] })
        navigate('/club-settings?section=templates', { replace: true })
      } else {
        await createActivity(draft)
        await queryClient.invalidateQueries({ queryKey: ['activity-center'] })
        navigate('/activities', { replace: true })
      }
    } catch {
      setErrors([editActivityId ? '活動更新失敗；若方案已有球友，請確認沒有刪除該方案。' : editTemplateId ? '範本更新失敗，請稍後再試。' : '活動建立失敗，請稍後再試；若問題持續發生請保留此畫面。'])
    } finally { setIsSubmitting(false) }
  }

  return <div className="wizard-page">
    <ContentNavigation backTo={editActivityId ? `/activities/${editActivityId}` : editTemplateId ? '/club-settings?section=templates' : '/activities'} context={editActivityId ? '編輯活動' : editTemplateId ? `編輯「${templateSource.data?.name ?? '範本'}」` : '建立活動'} actions={<button className="text-button icon-text-button" onClick={() => navigate(editActivityId ? `/activities/${editActivityId}` : editTemplateId ? '/club-settings?section=templates' : '/activities')}><MaterialIcon name="close" />離開</button>} />
    <ol className="stepper" aria-label="建立活動進度">{['基本資料', '方案與帳務', editTemplateId ? '確認儲存' : '確認建立'].map((label, index) => <li className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''} key={label}><span>{step > index + 1 ? <MaterialIcon name="check" /> : index + 1}</span>{label}</li>)}</ol>
    {errors.length > 0 && <div className="validation-box" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    {(copyActivityId || editActivityId) && copySource.isLoading && <div className="validation-box">正在載入活動內容…</div>}
    {(copyActivityId || editActivityId) && copySource.isError && <div className="validation-box" role="alert"><p>無法載入原活動，請返回活動中心重試。</p></div>}
    {(templateId || editTemplateId) && templateSource.isLoading && <div className="validation-box">正在載入活動範本…</div>}
    {(templateId || editTemplateId) && templateSource.isError && <div className="validation-box" role="alert"><p>無法載入活動範本，請返回球團設定重試。</p></div>}

    {step === 1 && <section className="wizard-section">
      <div className="form-grid basic-grid">
        <label><RequiredLabel>活動日期</RequiredLabel><input type="date" min={todayInTaipei()} required value={draft.activityDate} onChange={(event) => patch({ activityDate: event.target.value })} /></label>
        <label>活動標題<input maxLength={50} value={draft.customTitle} onChange={(event) => patch({ customTitle: event.target.value })} placeholder="例如：週三消夜團" /></label>
      </div>

      <div className="venue-block">
        <div className="saved-venue-panel">{venues.data?.length ? <label>我的球館<select value={draft.venueId ?? ''} onChange={(event) => selectVenue(event.target.value)}><option value="">請選擇球館</option>{venues.data.map((venue) => <option key={venue.id} value={venue.id}>{venue.name} · {venue.region}{venue.district}</option>)}</select></label> : <p className="venue-empty-note">尚未建立我的球館，請先新增球館。</p>}<button type="button" className="secondary-button icon-text-button add-venue-button" onClick={() => setShowVenueEditor(true)}><MaterialIcon name="add" />新增球館</button>{draft.venue.name && <div className="venue-summary"><MaterialIcon name="place" /><div><strong>{draft.venue.name}</strong><span>{draft.venue.region}{draft.venue.district}{draft.venue.address ? ` · ${draft.venue.address}` : ''}</span>{(draft.venue.floorType || draft.venue.note) && <small>{[draft.venue.floorType, draft.venue.note].filter(Boolean).join(' · ')}</small>}</div></div>}</div>
      </div>

      <div className="activity-rules-grid"><label className="court-count-field"><RequiredLabel>場地數</RequiredLabel><input type="number" min="1" max="20" required value={draft.initialCourtCount} onChange={(event) => { const count = Number(event.target.value); patch({ initialCourtCount: count, capacityLimit: Math.min(100, count * 8) }) }} /></label><fieldset><legend>招收人數</legend><div className="capacity-mode-row"><label><input type="radio" name="capacityMode" checked={draft.capacityMode === 'unlimited'} onChange={() => patch({ capacityMode: 'unlimited' })} />不限制</label><label><input type="radio" name="capacityMode" checked={draft.capacityMode === 'limited'} onChange={() => patch({ capacityMode: 'limited' })} />限制</label>{draft.capacityMode === 'limited' && <input aria-label="招收人數上限" type="number" min="1" max="100" required value={draft.capacityLimit} onChange={(event) => patch({ capacityLimit: Number(event.target.value) })} />}</div></fieldset><fieldset><legend><RequiredLabel>級數範圍</RequiredLabel></legend><div className="range-row"><input aria-label="最低級數" type="number" min="1" max="18" value={draft.skillMin} onChange={(event) => patch({ skillMin: Number(event.target.value) })} /><span>到</span><input aria-label="最高級數" type="number" min="1" max="18" value={draft.skillMax} onChange={(event) => patch({ skillMax: Number(event.target.value) })} /></div></fieldset><fieldset><legend><RequiredLabel>上場方式</RequiredLabel></legend><div className="assign-choice-list">{assignOptions.map(([value, label]) => <label className={draft.assignMode === value ? 'choice-card selected' : 'choice-card'} key={value}><input type="radio" name="assignMode" checked={draft.assignMode === value} onChange={() => patch({ assignMode: value })} /><strong>{label}</strong></label>)}</div></fieldset></div>
      <div className="form-grid"><label>指定用球<input maxLength={50} value={draft.shuttlecock} onChange={(event) => patch({ shuttlecock: event.target.value })} placeholder="例如：RSL 4 號" /></label><label>團主聯絡資料<input maxLength={100} value={draft.contactInfo} onChange={(event) => patch({ contactInfo: event.target.value })} placeholder="例如：LINE ID：badminton99" /></label></div>
      <label className="full-field">注意事項<textarea maxLength={500} value={draft.description} onChange={(event) => patch({ description: event.target.value })} placeholder="例如：請提前 10 分鐘報到並自備球拍" /></label>
      {draft.assignMode === 'system_assign' && <details className="advanced-settings"><summary><span><strong>進階排點設定</strong><small>設定公平性、實力組合與語音叫號</small></span><MaterialIcon name="expandMore" /></summary><div className="advanced-settings-body">
        <div className="form-grid">
          <label>排點優先原則<select value={draft.matchingSettings.priority} onChange={(event) => patch({ matchingSettings: { ...draft.matchingSettings, priority: event.target.value } })}><option value="balanced">均衡公平</option><option value="waiting">等待優先</option><option value="games">場數優先</option></select></label>
          <label>實力接近程度<select value={draft.matchingSettings.levelMatch} onChange={(event) => patch({ matchingSettings: { ...draft.matchingSettings, levelMatch: event.target.value } })}><option value="loose">寬鬆</option><option value="balanced">均衡</option><option value="strict">嚴格</option></select></label>
          <label>避免重複同場<select value={draft.matchingSettings.repeatAvoidance} onChange={(event) => patch({ matchingSettings: { ...draft.matchingSettings, repeatAvoidance: event.target.value } })}><option value="none">不特別避免</option><option value="moderate">適度避免</option><option value="strong">強烈避免</option></select></label>
          <label>雙打組合偏好<select value={draft.matchingSettings.genderPreference} onChange={(event) => patch({ matchingSettings: { ...draft.matchingSettings, genderPreference: event.target.value } })}><option value="none">不限</option><option value="mixed">優先混雙</option><option value="separate">優先男雙／女雙分開</option></select></label>
        </div>
        <div className="tts-settings"><label className="check-row primary-check-row"><input type="checkbox" checked={draft.ttsSettings.enabled} onChange={(event) => patch({ ttsSettings: { ...draft.ttsSettings, enabled: event.target.checked } })} /><span><strong>啟用語音叫號</strong><small>球場卡片會顯示叫號按鈕</small></span></label>{draft.ttsSettings.enabled && <div className="form-grid"><label>重複次數<select value={draft.ttsSettings.repeatCount} onChange={(event) => patch({ ttsSettings: { ...draft.ttsSettings, repeatCount: Number(event.target.value) } })}><option value="1">1 次</option><option value="2">2 次</option><option value="3">3 次</option></select></label><label>語音速度<select value={draft.ttsSettings.rate} onChange={(event) => patch({ ttsSettings: { ...draft.ttsSettings, rate: Number(event.target.value) } })}><option value="0.5">0.5（較慢）</option><option value="0.75">0.75</option><option value="1">1.0（正常）</option><option value="1.25">1.25</option><option value="1.5">1.5（較快）</option></select></label><div className="tts-test-action"><button type="button" className="secondary-button" onClick={testVoice}><MaterialIcon name="volumeUp" />測試語音</button></div></div>}</div>
      </div></details>}
    </section>}

    {step === 2 && <section className="wizard-section">
      <label className="finance-toggle"><span><strong>帳務功能</strong><em>記錄方案金額、付款狀態與付款方式</em></span><input type="checkbox" checked={draft.financeEnabled} onChange={(event) => patch({ financeEnabled: event.target.checked })} /></label>
      <div className="form-block plan-settings"><div className="form-block-heading"><div><h3><RequiredLabel>方案設定</RequiredLabel></h3><p>設定球友可排點的有效時段；至少一組，最多五組。</p></div><button type="button" className="secondary-button icon-text-button" disabled={draft.plans.length >= 5} onClick={addPlan}><MaterialIcon name="add" />新增方案</button></div><div className={`plan-table-head${draft.financeEnabled ? '' : ' finance-off'}`} aria-hidden="true"><span>方案</span><span>開始時間</span><span>結束時間</span>{draft.financeEnabled && <span>金額</span>}<span>操作</span></div><div className="plan-list">{draft.plans.map((plan, index) => <article className={draft.financeEnabled ? 'plan-row' : 'plan-row finance-off'} key={plan.code}><strong><small>PLAN</small>{plan.code}</strong><label><span className="field-label">開始時間</span><input aria-label={`方案 ${plan.code} 開始時間`} inputMode="numeric" pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" placeholder="例如：09:00" value={plan.startTime} onChange={(event) => updatePlan(index, { startTime: event.target.value })} /></label><label><span className="field-label">結束時間</span><input aria-label={`方案 ${plan.code} 結束時間`} inputMode="numeric" pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" placeholder="例如：12:00" value={plan.endTime} onChange={(event) => updatePlan(index, { endTime: event.target.value })} /></label>{draft.financeEnabled && <label><span className="field-label">金額</span><input aria-label={`方案 ${plan.code} 金額`} type="number" min="0" max="10000" value={plan.amount} onChange={(event) => updatePlan(index, { amount: event.target.value })} /></label>}<div className="plan-row-action">{draft.plans.length > 1 && <button type="button" className="text-button danger-text" onClick={() => patch({ plans: draft.plans.filter((_, planIndex) => planIndex !== index) })}>刪除</button>}</div></article>)}</div><label className="plan-time-toggle check-row"><input type="checkbox" checked={draft.autoTimeEligibilityEnabled} onChange={(event) => patch({ autoTimeEligibilityEnabled: event.target.checked })} /><span><strong>自動時間資格</strong><small>依方案時間自動判斷球友是否可排點</small></span></label></div>
      {draft.financeEnabled && <div className="form-block payment-settings"><div className="form-block-heading"><div><h3><RequiredLabel>付款方式設定</RequiredLabel></h3><p>至少啟用一種付款方式；預設付款方式可留空。</p></div></div><div className="check-grid payment-method-options">{paymentOptions.map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.paymentMethods.includes(value)} onChange={(event) => { const methods = event.target.checked ? [...draft.paymentMethods, value] : draft.paymentMethods.filter((method) => method !== value); patch({ paymentMethods: methods, defaultPaymentMethod: methods.includes(draft.defaultPaymentMethod) ? draft.defaultPaymentMethod : '' }) }} /><strong>{label}</strong></label>)}</div><label className="default-payment-field">預設付款方式（非必填）<select value={draft.defaultPaymentMethod} onChange={(event) => patch({ defaultPaymentMethod: event.target.value })}><option value="">不設定預設付款方式</option>{draft.paymentMethods.map((method) => <option key={method} value={method}>{paymentOptions.find(([value]) => value === method)?.[1]}</option>)}</select></label></div>}
    </section>}

    {step === 3 && <section className="wizard-section">
      <div className="review-sections"><article><header><h3>基本資料</h3><button type="button" className="text-button icon-text-button" onClick={() => goToStep(1)}><MaterialIcon name="edit" />返回編輯</button></header><dl><div><dt>活動</dt><dd>{draft.customTitle || '未設定活動標題'}</dd></div><div><dt>日期</dt><dd>{draft.activityDate}</dd></div><div><dt>球館</dt><dd>{draft.venue.name} · {draft.venue.region}{draft.venue.district}{draft.venue.address && ` · ${draft.venue.address}`}</dd></div><div><dt>招收</dt><dd>{draft.initialCourtCount} 面場地 · {draft.capacityMode === 'limited' ? `${draft.capacityLimit} 人` : '人數不限制'} · Lv.{draft.skillMin}–{draft.skillMax}</dd></div><div><dt>上場方式</dt><dd>{assignOptions.find(([value]) => value === draft.assignMode)?.[1]}</dd></div>{draft.assignMode === 'system_assign' && <div><dt>排點與叫號</dt><dd>{{ balanced: '均衡公平', waiting: '等待優先', games: '場數優先' }[draft.matchingSettings.priority]} · {draft.ttsSettings.enabled ? `語音 ${draft.ttsSettings.repeatCount} 次／${draft.ttsSettings.rate} 倍速` : '不啟用語音'}</dd></div>}{draft.shuttlecock && <div><dt>指定用球</dt><dd>{draft.shuttlecock}</dd></div>}{draft.contactInfo && <div><dt>聯絡資料</dt><dd>{draft.contactInfo}</dd></div>}{draft.description && <div><dt>注意事項</dt><dd>{draft.description}</dd></div>}</dl></article><article><header><h3>方案與帳務</h3><button type="button" className="text-button icon-text-button" onClick={() => goToStep(2)}><MaterialIcon name="edit" />返回編輯</button></header><dl>{draft.plans.map((plan) => <div key={plan.code}><dt>方案 {plan.code}</dt><dd>{planRange(plan.startTime, plan.endTime)}{draft.financeEnabled ? ` · $${plan.amount}` : ''}</dd></div>)}<div><dt>帳務</dt><dd>{draft.financeEnabled ? '已開啟' : '未啟用帳務與付款記錄'}</dd></div>{draft.financeEnabled && <div><dt>付款方式</dt><dd>{draft.paymentMethods.map((method) => paymentOptions.find(([value]) => value === method)?.[1]).join('、')}<br /><small>預設：{paymentOptions.find(([value]) => value === draft.defaultPaymentMethod)?.[1] ?? '不設定'}</small></dd></div>}</dl></article></div>
      {!editTemplateId && !editActivityId && <div className="template-setting"><label className="check-row"><input type="checkbox" checked={draft.saveAsTemplate} onChange={(event) => patch({ saveAsTemplate: event.target.checked })} />同時儲存為活動範本</label>{draft.saveAsTemplate && <label>範本名稱<input maxLength={50} value={draft.templateName} onChange={(event) => patch({ templateName: event.target.value })} placeholder={`例如：${draft.customTitle || draft.venue.name || '週三晚間團'}`} /></label>}</div>}
    </section>}
    {showVenueEditor && <VenueEditor state={{}} venues={venues.data ?? []} onClose={() => setShowVenueEditor(false)} onSaved={async (_message, input) => { setShowVenueEditor(false); const refreshed = await venues.refetch(); const saved = refreshed.data?.find((venue) => venue.name.trim().toLocaleLowerCase() === input.name.trim().toLocaleLowerCase() && venue.region === input.region && venue.district === input.district); if (saved) selectVenue(saved.id); else patch({ venueId: null, venue: { name: input.name, region: input.region, district: input.district, address: input.address ?? '', floorType: input.floor_type ?? '', note: input.note ?? '' }, saveVenue: false }) }} />}
    <footer className="wizard-actions">{step > 1 ? <button className="secondary-button" onClick={back}>上一步</button> : <span />}{step < 3 ? <button className="primary-button" onClick={next}>下一步</button> : <button className="primary-button" disabled={isSubmitting} onClick={submit}>{isSubmitting ? editActivityId || editTemplateId ? '儲存中…' : '建立中…' : editActivityId ? '儲存活動' : editTemplateId ? '儲存範本' : '建立活動'}</button>}</footer>
  </div>
}
