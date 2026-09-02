import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useActivityPaymentSettings, useActivityShareData, useActivityWorkspace, useAddActivityMember, useBatchCheckin, type ActivityShareData, type ActivityWorkspace } from './activityWorkspaceApi'
import { MemberDetailPanel } from './MemberDetailPanel'
import { ImportMembersPanel } from '../members/ImportMembersPanel'
import { DispatchBoard, EndActivityPanel } from '../dispatch/DispatchBoard'
import { useActivityEndReadiness, useEndActivity } from '../dispatch/dispatchApi'
import { OverviewInsights } from './OverviewInsights'
import { SelfCheckinAdmin } from '../checkin/SelfCheckinAdmin'
import { MemberFilterBar, type MemberFilterCounts, type MemberFilters } from './MemberFilterBar'
import { ActivitySecondaryActions } from './ActivitySecondaryActions'
import { ContentNavigation, ContentSummary } from '../../app/ContentWorkspace'
import { MaterialIcon } from '../../app/MaterialIcon'

const paymentLabels: Record<string, string> = { cash: '現金', line_pay: 'LINE Pay', transfer: '轉帳', voucher: '球券', other: '其他' }

function formatDateTime(value: string | null, options: Intl.DateTimeFormatOptions): string {
  if (!value) return '未設定'
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', ...options }).format(new Date(value))
}

function formatTimeRange(startAt: string, endAt: string) {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
  const start = formatDateTime(startAt, { hour: '2-digit', minute: '2-digit', hour12: false })
  const end = formatDateTime(endAt, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${start}–${dateFormatter.format(new Date(startAt)) === dateFormatter.format(new Date(endAt)) ? '' : '翌日 '}${end}`
}

function buildShareText(data: ActivityShareData, activeMembers: number) {
  const title = data.custom_title ? `${data.organization_name}｜${data.custom_title}` : data.organization_name
  const date = formatDateTime(data.scheduled_start_at, { month: 'numeric', day: 'numeric', weekday: 'short' })
  const time = formatTimeRange(data.scheduled_start_at, data.scheduled_end_at)
  const plans = data.plans.map((plan) => `方案 ${plan.code}｜${formatTimeRange(plan.start_at, plan.end_at)}${plan.amount === null ? '' : `｜$${plan.amount}`}`)
  const capacity = data.capacity_mode === 'limited' ? `名額｜${activeMembers}/${data.capacity_limit} 人` : '名額｜不限制'
  return [
    `【${title}】`, `${date} ${time}`, `地點｜${data.venue.region}${data.venue.district} ${data.venue.name}`,
    data.venue.address ? `地址｜${data.venue.address}` : '', `程度｜Lv.${data.skill_min}–${data.skill_max}`, capacity,
    ...plans, data.shuttlecock ? `用球｜${data.shuttlecock}` : '', data.description ?? '', data.contact_info ? `聯絡｜${data.contact_info}` : '',
  ].filter(Boolean).join('\n')
}

function ShareActivityPanel({ activityId, activeMembers, onClose }: { activityId: string; activeMembers: number; onClose: () => void }) {
  const share = useActivityShareData(activityId, true)
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { if (share.data) setText(buildShareText(share.data, activeMembers)) }, [share.data, activeMembers])
  async function copy() { try { await navigator.clipboard.writeText(text); setMessage('宣傳文字已複製，可直接貼到 LINE 或 Facebook。') } catch { setMessage('無法自動複製，請選取文字後手動複製。') } }
  return <div className="panel-backdrop" role="presentation"><section className="side-panel share-activity-panel" role="dialog" aria-modal="true" aria-labelledby="share-activity-title"><header><div><p className="eyebrow">活動概況</p><h2 id="share-activity-title">分享活動</h2><p className="muted">可先編輯內容，再複製到 LINE 或 Facebook。</p></div><button className="icon-button" onClick={onClose} aria-label="關閉">×</button></header>{share.isLoading ? <p className="muted">產生宣傳文字…</p> : share.isError ? <div className="validation-box"><p>目前無法載入分享資料。</p></div> : <><label className="share-text-label">宣傳文字<textarea value={text} onChange={(event) => { setText(event.target.value); setMessage('') }} /></label>{message && <p className="action-message" role="status">{message}</p>}<footer className="panel-actions"><button className="secondary-button" onClick={onClose}>關閉</button><button className="primary-button" disabled={!text.trim()} onClick={copy}>複製宣傳文字</button></footer></>}</section></div>
}

function AddMemberPanel({ workspace, onClose }: { workspace: ActivityWorkspace; onClose: () => void }) {
  const addMember = useAddActivityMember(workspace.activity.id)
  const [warningConfirmed, setWarningConfirmed] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const level = Number(form.get('level'))
    const localWarnings: string[] = []
    if (workspace.activity.capacity_mode === 'limited' && workspace.stats.active_members >= (workspace.activity.capacity_limit ?? 0)) localWarnings.push('目前有效名單已達招收上限，仍可由團主確認加入。')
    if (level < workspace.activity.skill_min || level > workspace.activity.skill_max) localWarnings.push(`此球友級數不在活動 ${workspace.activity.skill_min}–${workspace.activity.skill_max} 範圍內。`)
    if (localWarnings.length && !warningConfirmed) {
      setWarnings(localWarnings)
      setWarningConfirmed(true)
      return
    }
    try {
      await addMember.mutateAsync({
        displayName: String(form.get('displayName')),
        level,
        planId: String(form.get('planId')),
        gender: String(form.get('gender')) || null,
        note: String(form.get('note')),
      })
      onClose()
    } catch { setWarnings(['新增失敗，請確認資料後再試一次。']) }
  }

  return <div className="panel-backdrop" role="presentation"><section className="side-panel" role="dialog" aria-modal="true" aria-labelledby="add-member-title"><header><div><p className="eyebrow">活動名單</p><h2 id="add-member-title">新增單一球友</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉">×</button></header><form className="form-stack" onSubmit={submit}><label>姓名<input name="displayName" required autoFocus /></label><label>級數<input name="level" type="number" min="1" max="18" required defaultValue={workspace.activity.skill_min} /></label><label>方案<select name="planId" required defaultValue={workspace.plans[0]?.id}>{workspace.plans.map((plan) => <option value={plan.id} key={plan.id}>方案 {plan.code} · {formatDateTime(plan.start_at, { hour: '2-digit', minute: '2-digit', hour12: false })}–{formatDateTime(plan.end_at, { hour: '2-digit', minute: '2-digit', hour12: false })}</option>)}</select></label><label>性別（非必填）<select name="gender"><option value="">不填寫</option><option value="M">男</option><option value="F">女</option></select></label><label>備註（非必填）<textarea name="note" /></label>{warnings.length > 0 && <div className="validation-box">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}<footer className="panel-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={addMember.isPending}>{addMember.isPending ? '新增中…' : warningConfirmed ? '仍要加入' : '新增球友'}</button></footer></form></section></div>
}

export function ActivityWorkspacePage() {
  const { activityId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showAddMember, setShowAddMember] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [paymentMethod, setPaymentMethod] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null)
  const [showImportMembers, setShowImportMembers] = useState(false)
  const [showShareActivity, setShowShareActivity] = useState(false)
  const [showEndActivity, setShowEndActivity] = useState(false)
  const [searchMembers, setSearchMembers] = useState(false)
  const [memberFilters, setMemberFilters] = useState<MemberFilters>(() => ({ search: '', status: 'all', operational: '', plan: '', payment: '', gender: '', attendance: '', level: '', timeEligibility: '', binding: '', sort: 'source', view: typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 'card' : 'table' }))
  const workspaceQuery = useActivityWorkspace(activityId)
  const paymentSettings = useActivityPaymentSettings(activityId)
  const batchCheckin = useBatchCheckin(activityId)
  const endActivity = useEndActivity(activityId)
  const endReadiness = useActivityEndReadiness(activityId, showEndActivity)
  const tabParam = searchParams.get('tab')
  const tab = tabParam === 'members' || tabParam === 'dispatch' ? tabParam : 'overview'

  const memberCounts = useMemo<MemberFilterCounts>(() => {
    const members = workspaceQuery.data?.members ?? []
    const active = members.filter((member) => member.registration_status === 'active')
    const now = Date.now()
    const planHasStarted = (planId: string) => now >= new Date(workspaceQuery.data?.plans.find((plan) => plan.id === planId)?.start_at ?? '2999-01-01').getTime()
    return {
      all: members.length,
      notArrived: active.filter((member) => member.checkin_status === 'not_arrived').length,
      checkedIn: active.filter((member) => member.checkin_status === 'checked_in').length,
      cancelled: members.filter((member) => member.registration_status === 'cancelled').length,
      pendingCheckin: active.filter((member) => member.checkin_status === 'not_arrived' && planHasStarted(member.plan_id)).length,
      pendingPayment: active.filter((member) => member.payment_status === 'unpaid' && member.no_show_status !== 'waived' && planHasStarted(member.plan_id)).length,
      paid: active.filter((member) => member.payment_status === 'paid').length,
    }
  }, [workspaceQuery.data])

  const activeMembers = useMemo(() => {
    const now = Date.now()
    const items = workspaceQuery.data?.members.filter((member) => {
      const plan = workspaceQuery.data?.plans.find((item) => item.id === member.plan_id)
      const timeState = !plan ? '' : now < new Date(plan.start_at).getTime() ? 'not_started' : now >= new Date(plan.end_at).getTime() ? 'expired' : 'current'
      const matchesStatus = memberFilters.status === 'all' || memberFilters.status === 'cancelled' ? memberFilters.status === 'all' || member.registration_status === 'cancelled' : member.registration_status === 'active' && member.checkin_status === memberFilters.status
      const planStarted = !plan || now >= new Date(plan.start_at).getTime()
      const matchesOperational = memberFilters.operational === 'pending_checkin' ? member.registration_status === 'active' && member.checkin_status === 'not_arrived' && planStarted : memberFilters.operational === 'pending_payment' ? member.registration_status === 'active' && member.payment_status === 'unpaid' && member.no_show_status !== 'waived' && planStarted : true
      const matchesPayment = !memberFilters.payment || memberFilters.payment === 'waived' ? !memberFilters.payment || member.no_show_status === 'waived' : member.payment_status === memberFilters.payment && member.no_show_status !== 'waived'
      const matchesBinding = !memberFilters.binding || (memberFilters.binding === 'bound' ? member.has_binding : !member.has_binding)
      return matchesStatus && matchesOperational && member.display_name.toLocaleLowerCase().includes(memberFilters.search.trim().toLocaleLowerCase()) && (!memberFilters.plan || member.plan_id === memberFilters.plan) && matchesPayment && (!memberFilters.level || member.level === Number(memberFilters.level)) && (!memberFilters.attendance || member.attendance_state === memberFilters.attendance) && (!memberFilters.gender || (memberFilters.gender === 'unspecified' ? member.gender === null : member.gender === memberFilters.gender)) && (!memberFilters.timeEligibility || timeState === memberFilters.timeEligibility) && matchesBinding
    }) ?? []
    if (memberFilters.sort === 'name') return [...items].sort((a,b)=>a.display_name.localeCompare(b.display_name,'zh-TW'))
    if (memberFilters.sort === 'plan') return [...items].sort((a,b)=>a.plan_id.localeCompare(b.plan_id))
    if (memberFilters.sort === 'level') return [...items].sort((a,b)=>a.level-b.level)
    if (memberFilters.sort === 'checkin') return [...items].sort((a,b)=>a.checkin_status.localeCompare(b.checkin_status))
    if (memberFilters.sort === 'payment') return [...items].sort((a,b)=>a.payment_status.localeCompare(b.payment_status))
    return items
  }, [workspaceQuery.data, memberFilters])
  const longPressTimer = useRef<number | null>(null)
  useEffect(() => {
    if (tab !== 'members' || memberFilters.view !== 'card') return
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.member-table .member-row:not(.member-head)'))
    const cleanups = rows.map((row, index) => {
      const start = () => { longPressTimer.current = window.setTimeout(() => { const member = activeMembers[index]; if (member) setDetailMemberId(member.id) }, 550) }
      const stop = () => { if (longPressTimer.current) window.clearTimeout(longPressTimer.current); longPressTimer.current = null }
      row.addEventListener('pointerdown', start); row.addEventListener('pointerup', stop); row.addEventListener('pointercancel', stop); row.addEventListener('pointerleave', stop)
      return () => { row.removeEventListener('pointerdown', start); row.removeEventListener('pointerup', stop); row.removeEventListener('pointercancel', stop); row.removeEventListener('pointerleave', stop) }
    })
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [activeMembers, memberFilters.view, tab])
  if (workspaceQuery.isLoading) return <div className="centered-state">載入活動資料…</div>
  if (workspaceQuery.isError || !workspaceQuery.data) return <div className="centered-state"><h1>目前無法載入此活動</h1><p>可能是網路中斷或活動資料剛在其他裝置更新。</p><div className="centered-state-actions"><button className="primary-button" onClick={() => workspaceQuery.refetch()}>重新載入</button><Link className="secondary-button" to="/activities">返回活動中心</Link></div></div>
  const workspace = workspaceQuery.data
  const activity = workspace.activity
  const settings = paymentSettings.data
  const effectivePaymentMethod = paymentMethod || settings?.default_payment_method || settings?.enabled_payment_methods[0] || ''

  function toggleMember(memberId: string) {
    if (workspace.members.find((member) => member.id === memberId)?.registration_status === 'cancelled') return
    setActionMessage('')
    setSelectedIds((current) => current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId])
  }

  async function runBatchAction(collectPayment: boolean) {
    if (!selectedIds.length) return
    try {
      const result = await batchCheckin.mutateAsync({ memberIds: selectedIds, collectPayment, paymentMethod: collectPayment ? effectivePaymentMethod : null })
      setActionMessage(collectPayment ? `已處理 ${result.selected} 人：新增報到 ${result.newly_checked_in} 人、收款 ${result.newly_paid} 人。` : `已完成 ${result.selected} 人報到。`)
      setSelectedIds([])
    } catch { setActionMessage('操作失敗，名單可能已在其他裝置更新，請重新整理後再試。') }
  }

  async function confirmEndActivity() {
    try {
      const result = await endActivity.mutateAsync(Boolean(endReadiness.data?.queued_members))
      setShowEndActivity(false)
      setActionMessage(result.cleared_members ? `活動已結束，並清除 ${result.cleared_members} 位預排球友。` : '活動已結束。')
    } catch {
      await endReadiness.refetch()
      setActionMessage('目前無法結束活動；請確認場上對戰是否都已處理。')
    }
  }

  function openMemberList(filters: Partial<MemberFilters> = {}) {
    setMemberFilters((current) => ({ ...current, status: 'all', operational: '', search: '', ...filters }))
    setSelectedIds([])
    setSearchParams({ tab: 'members' })
  }

  const activityTitle = activity.custom_title || activity.venue_snapshot.name
  const statusText = activity.status === 'in_progress' ? '進行中' : activity.status === 'ended' ? '已結束' : activity.status === 'draft' ? '草稿' : '即將開始'
  const assignModeText = activity.assign_mode === 'system_assign' ? '系統排點' : activity.assign_mode === 'manual_assign' ? '人工排點' : '自由上場'
  const activityMeta = <><span><small>日期與時間</small><strong>{formatDateTime(`${activity.activity_date}T00:00:00+08:00`, { month: '2-digit', day: '2-digit', weekday: 'short' })} {activity.scheduled_start_at && activity.scheduled_end_at ? formatTimeRange(activity.scheduled_start_at, activity.scheduled_end_at) : '時間未設定'}</strong></span><span><small>初始場地</small><strong>{activity.initial_court_count} 面</strong></span><span><small>參加級數</small><strong>Lv. {activity.skill_min}–{activity.skill_max}</strong></span><span><small>上場方式</small><strong>{assignModeText}</strong></span></>
  const changeTab = (next: string) => setSearchParams(next === 'overview' ? {} : { tab: next })
  const navigationActions = tab === 'members' ? <div className={`content-navigation-actions member-navigation-actions ${searchMembers ? 'searching' : ''}`}>{searchMembers && <div className="member-navigation-search"><MaterialIcon name="search" /><input autoFocus aria-label="搜尋球友姓名" placeholder="輸入姓名" value={memberFilters.search} onChange={(event) => setMemberFilters((current) => ({ ...current, search: event.target.value }))} /><button className="icon-button" aria-label="關閉搜尋" onClick={() => { setSearchMembers(false); setMemberFilters((current) => ({ ...current, search: '' })) }}><MaterialIcon name="close" /></button></div>}<button className="secondary-button member-search-trigger" aria-label="搜尋球友" title="搜尋球友" onClick={() => setSearchMembers(true)}><MaterialIcon name="search" />{memberFilters.search && <span className="member-search-active" />}</button><button className="secondary-button member-import-trigger" onClick={() => setShowImportMembers(true)}>批次匯入</button><button className="primary-button" onClick={() => setShowAddMember(true)}><MaterialIcon name="add" />新增球友</button></div> : undefined
  const navigation = <ContentNavigation backTo="/activities" context={tab === 'overview' ? `${formatDateTime(`${activity.activity_date}T00:00:00+08:00`, { month: '2-digit', day: '2-digit' })} ${activityTitle}` : activityTitle} activeTab={tab} onTabChange={changeTab} tabs={[{ id: 'overview', label: '活動概況' }, { id: 'members', label: '名單與報到' }, { id: 'dispatch', label: '排點作業' }]} actions={navigationActions} />
  const summary = <ContentSummary title={activityTitle} subtitle={<><MaterialIcon name="place" /><span>{activity.venue_snapshot.name} · {activity.venue_snapshot.region}{activity.venue_snapshot.district}</span></>} status={<span className={`status status-${activity.status}`}>{statusText}</span>} meta={activityMeta} actions={tab === 'overview' ? <><Link className="secondary-button icon-text-button" to={`/activities/new?edit=${activityId}`}><MaterialIcon name="edit" />編輯活動</Link><button className="secondary-button icon-text-button" onClick={() => setShowShareActivity(true)}><MaterialIcon name="share" />分享活動</button><button className="primary-button" onClick={() => changeTab(activity.status === 'in_progress' || activity.status === 'ended' ? 'dispatch' : 'members')}>{activity.status === 'in_progress' ? '進入排點作業' : activity.status === 'ended' ? '查看排點紀錄' : '名單與報到'}</button></> : undefined} />

  if (tab === 'dispatch') return <div className="workspace-page workspace-dispatch">{navigation}<DispatchBoard activityId={activityId} /></div>

  return <><div className={`workspace-page workspace-${tab}`}>{navigation}{tab === 'overview' && summary}
  {tab === 'members' && <MemberFilterBar filters={memberFilters} plans={workspace.plans} counts={memberCounts} visibleCount={activeMembers.length} onChange={(next) => { setMemberFilters(next); setSelectedIds([]) }} />}

  {tab === 'overview' ? <>{actionMessage && <p className="action-message" role="status">{actionMessage}</p>}<section className="workspace-section"><div className="section-heading"><div><h2>活動資訊</h2><p className="muted">本次活動的時間、地點與參加條件</p></div></div><dl className="info-list"><div><dt>日期與時間</dt><dd>{formatDateTime(activity.scheduled_start_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}–{formatDateTime(activity.scheduled_end_at, { hour: '2-digit', minute: '2-digit', hour12: false })}</dd></div><div><dt>球館</dt><dd>{activity.venue_snapshot.region}{activity.venue_snapshot.district} · {activity.venue_snapshot.name}</dd></div><div><dt>初始場地數</dt><dd>{activity.initial_court_count} 面</dd></div><div><dt>級數範圍</dt><dd>{activity.skill_min}–{activity.skill_max}</dd></div><div><dt>招收人數</dt><dd>{activity.capacity_mode === 'limited' ? `${workspace.stats.active_members} / ${activity.capacity_limit} 人` : '不限制'}</dd></div><div><dt>上場方式</dt><dd>{activity.assign_mode === 'system_assign' ? '系統排點' : activity.assign_mode === 'manual_assign' ? '人工排點' : '自由上場'}</dd></div></dl></section><section className="workspace-section"><div className="section-heading"><div><h2>方案與帳務</h2><p className="muted">活動方案時間與付款設定</p></div></div><div className="plan-summary-list">{workspace.plans.map((plan) => <div key={plan.id}><strong>方案 {plan.code}</strong><span>{formatDateTime(plan.start_at, { hour: '2-digit', minute: '2-digit', hour12: false })}–{formatDateTime(plan.end_at, { hour: '2-digit', minute: '2-digit', hour12: false })}</span><span>{activity.finance_enabled ? plan.amount === null ? '未設定金額' : `$${plan.amount}` : '未開啟帳務'}</span></div>)}</div>{activity.finance_enabled && settings && <dl className="accounting-summary"><div><dt>付款方式</dt><dd>{settings.enabled_payment_methods.map((method) => paymentLabels[method] ?? method).join('、') || '未設定'}</dd></div><div><dt>預設付款方式</dt><dd>{settings.default_payment_method ? paymentLabels[settings.default_payment_method] ?? settings.default_payment_method : '不預設'}</dd></div></dl>}</section></> : <section className="workspace-section member-workspace-section"><div className="section-heading"><div><h2>名單與報到</h2><p className="muted">目前共 {activeMembers.length} 位球友</p></div></div>{memberFilters.view === 'card' && <p className="member-card-hint">點選球友可批次操作；長按約半秒可開啟詳細資料。</p>}{actionMessage && <p className="action-message" role="status">{actionMessage}</p>}{activeMembers.length === 0 ? <div className="empty-state"><h3>沒有符合條件的球友</h3><p>請調整上方狀態、搜尋或篩選條件。</p></div> : <div className="member-table selectable" role="table"><div className="member-row member-head" role="row"><span><input type="checkbox" aria-label="選取全部可操作球友" checked={activeMembers.filter((member) => member.registration_status === 'active').length > 0 && selectedIds.length === activeMembers.filter((member) => member.registration_status === 'active').length} onChange={(event) => setSelectedIds(event.target.checked ? activeMembers.filter((member) => member.registration_status === 'active').map((member) => member.id) : [])} /> 姓名</span><span>級數</span><span>方案</span><span>報到</span><span>付款</span></div>{activeMembers.map((member) => <label className={`${selectedIds.includes(member.id) ? 'member-row selected' : 'member-row'} ${member.registration_status === 'cancelled' ? 'cancelled' : ''}`} role="row" key={member.id}><strong><input type="checkbox" disabled={member.registration_status === 'cancelled'} checked={selectedIds.includes(member.id)} onChange={() => toggleMember(member.id)} /> {member.display_name}{member.has_binding && <small className="member-binding-indicator">已綁定</small>}</strong><span>Lv.{member.level}</span><span>方案 {workspace.plans.find((plan) => plan.id === member.plan_id)?.code}</span><span>{member.registration_status === 'cancelled' ? '已取消' : member.checkin_status === 'checked_in' ? '已報到' : '未報到'}</span><span>{activity.finance_enabled ? member.payment_status === 'paid' ? '已付款' : member.no_show_status === 'waived' ? '不予追究' : '未付款' : '—'}</span></label>)}</div>}</section>}
  {tab === 'overview' && <SelfCheckinAdmin activityId={activityId} />}
  {tab === 'overview' && <OverviewInsights workspace={workspace} onOpenMembers={openMemberList} />}
  {tab === 'overview' && <section className="overview-management"><div><strong>活動管理</strong><span>範本可用於快速建立相同設定的活動</span></div><div className="overview-management-actions"><ActivitySecondaryActions activityId={activityId} status={activity.status} suggestedName={activity.custom_title || activity.venue_snapshot.name} />{activity.status === 'in_progress' && <button className="danger-button" onClick={() => setShowEndActivity(true)}>結束活動</button>}</div></section>}
  {tab === 'members' && selectedIds.length > 0 && <aside className="member-batch-dock" aria-label="批次報到工具列"><strong>已選 {selectedIds.length} 人</strong><div className="member-batch-dock-actions">{selectedIds.length === 1 && <button className="text-button member-detail-shortcut" onClick={() => setDetailMemberId(selectedIds[0])}>球友詳情</button>}{settings?.finance_enabled && <label><span>付款方式</span><select aria-label="批次收款付款方式" value={effectivePaymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{settings.enabled_payment_methods.map((method) => <option value={method} key={method}>{paymentLabels[method] ?? method}</option>)}</select></label>}<button className="secondary-button" disabled={batchCheckin.isPending} onClick={() => runBatchAction(false)}>僅報到</button>{settings?.finance_enabled && <button className="primary-button" disabled={batchCheckin.isPending || !effectivePaymentMethod} onClick={() => runBatchAction(true)}>報到並收款</button>}</div><button className="icon-button" aria-label="取消選取" onClick={() => setSelectedIds([])}><MaterialIcon name="close" /></button></aside>}
  {showAddMember && <AddMemberPanel workspace={workspace} onClose={() => setShowAddMember(false)} />}
  {detailMemberId && <MemberDetailPanel workspace={workspace} memberId={detailMemberId} onClose={() => { setDetailMemberId(null); setSelectedIds([]) }} />}
  {showImportMembers && <ImportMembersPanel workspace={workspace} onClose={() => setShowImportMembers(false)} />}
  {showShareActivity && <ShareActivityPanel activityId={activityId} activeMembers={workspace.stats.active_members} onClose={() => setShowShareActivity(false)} />}</div>
  {showEndActivity && (endReadiness.isLoading ? <div className="panel-backdrop"><div className="centered-state modal-loading">檢查活動狀態…</div></div> : endReadiness.data ? <EndActivityPanel readiness={endReadiness.data} pending={endActivity.isPending} onClose={() => setShowEndActivity(false)} onConfirm={confirmEndActivity} /> : <div className="panel-backdrop"><div className="centered-state modal-loading"><p>目前無法檢查活動狀態。</p><button className="secondary-button" onClick={() => setShowEndActivity(false)}>關閉</button></div></div>)}</>
}
