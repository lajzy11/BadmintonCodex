import { type FormEvent, useEffect, useState } from 'react'
import { useActivityMemberDetail, useActivityPaymentSettings, useCancelActivityMember, useCorrectMemberCheckinPayment, useMemberRelationships, useSetMemberPaymentWaiver, useSetMemberRelationships, useUpdateActivityMember, type ActivityWorkspace } from './activityWorkspaceApi'

type Props = { workspace: ActivityWorkspace; memberId: string; onClose: () => void }
const paymentLabels: Record<string, string> = { cash: '現金', line_pay: 'LINE Pay Demo', transfer: '轉帳', voucher: '球券', other: '其他' }

export function MemberDetailPanel({ workspace, memberId, onClose }: Props) {
  const detail = useActivityMemberDetail(memberId)
  const relationships = useMemberRelationships(memberId)
  const paymentSettings = useActivityPaymentSettings(workspace.activity.id)
  const updateMember = useUpdateActivityMember(workspace.activity.id)
  const correctStatus = useCorrectMemberCheckinPayment(workspace.activity.id)
  const setWaiver = useSetMemberPaymentWaiver(workspace.activity.id)
  const cancelMember = useCancelActivityMember(workspace.activity.id)
  const setRelationships = useSetMemberRelationships(workspace.activity.id)
  const [avoidIds, setAvoidIds] = useState<string[]>([])
  const [persistentBindId, setPersistentBindId] = useState('')
  const [oneMatchBindId, setOneMatchBindId] = useState('')
  const [oneMatchOpposeId, setOneMatchOpposeId] = useState('')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [confirmLevelWarning, setConfirmLevelWarning] = useState(false)
  const [checkinStatus, setCheckinStatus] = useState<'not_arrived' | 'checked_in'>('not_arrived')
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'paid'>('unpaid')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentWaived, setPaymentWaived] = useState(false)

  useEffect(() => {
    if (!detail.data) return
    setAvoidIds(detail.data.avoid_member_ids)
    setCheckinStatus(detail.data.checkin_status as 'not_arrived' | 'checked_in')
    setPaymentStatus(detail.data.payment_status as 'unpaid' | 'paid')
    setPaymentMethod(detail.data.payment_method ?? '')
    setPaymentWaived(detail.data.no_show_status === 'waived')
  }, [detail.data])

  useEffect(() => {
    if (!relationships.data) return
    setPersistentBindId(relationships.data.persistent_bind_member_id ?? '')
    setOneMatchBindId(relationships.data.one_match_bind_member_id ?? '')
    setOneMatchOpposeId(relationships.data.one_match_oppose_member_id ?? '')
    setAvoidIds(relationships.data.avoid_same_match_member_ids)
  }, [relationships.data])

  if (detail.isLoading || relationships.isLoading) return <div className="panel-backdrop"><section className="side-panel"><p>載入球友資料…</p></section></div>
  if (detail.isError || relationships.isError || !detail.data) return <div className="panel-backdrop"><section className="side-panel"><p>目前無法載入球友資料。</p><button className="secondary-button" onClick={onClose}>關閉</button></section></div>
  const member = detail.data
  const avoidCandidates = workspace.members.filter((candidate) => candidate.id !== memberId && candidate.registration_status === 'active' && candidate.display_name.toLowerCase().includes(search.toLowerCase()))
  const relationshipCandidates = workspace.members.filter((candidate) => candidate.id !== memberId && candidate.registration_status === 'active')
  const enabledMethods = paymentSettings.data?.enabled_payment_methods ?? []

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const level = Number(form.get('level'))
    if ((level < workspace.activity.skill_min || level > workspace.activity.skill_max) && !confirmLevelWarning) {
      setConfirmLevelWarning(true)
      setMessage(`級數不在活動 ${workspace.activity.skill_min}–${workspace.activity.skill_max} 範圍內；仍可儲存。`)
      return
    }
    if (paymentStatus === 'paid' && !paymentMethod) { setMessage('請選擇付款方式。'); return }
    const exclusiveIds = [persistentBindId, oneMatchBindId, oneMatchOpposeId, ...avoidIds].filter(Boolean)
    if (new Set(exclusiveIds).size !== exclusiveIds.length) { setMessage('同一位球友不能同時設定兩種關係，請調整後再儲存。'); return }
    try {
      await updateMember.mutateAsync({ memberId, displayName: String(form.get('displayName')), level, planId: String(form.get('planId')), gender: String(form.get('gender')) || null, note: String(form.get('note')), avoidMemberIds: avoidIds })
      await setRelationships.mutateAsync({ memberId, persistentBindMemberId: persistentBindId || null, oneMatchBindMemberId: oneMatchBindId || null, oneMatchOpposeMemberId: oneMatchOpposeId || null, avoidSameMatchMemberIds: avoidIds })
      if (checkinStatus !== member.checkin_status || paymentStatus !== member.payment_status || (paymentStatus === 'paid' && paymentMethod !== member.payment_method)) {
        await correctStatus.mutateAsync({ memberId, checkinStatus, paymentStatus, paymentMethod: paymentStatus === 'paid' ? paymentMethod : null })
      }
      if (paymentWaived !== (member.no_show_status === 'waived')) await setWaiver.mutateAsync({ memberId, waived: paymentWaived })
      onClose()
    } catch (error) { const code = error instanceof Error ? error.message : String(error); setMessage(code.includes('RELATIONSHIP_MEMBER_ALREADY_ASSIGNED') ? '所選球友已有相同類型的關係，請先解除原關係。' : code.includes('RELATIONSHIP') ? '球友關係互相衝突，請確認每位球友只設定一種關係。' : checkinStatus === 'not_arrived' && member.attendance_state !== 'idle' ? '球友仍在比賽或預排中，無法取消報到。' : '儲存失敗，請重新整理後再試。') }
  }

  async function cancel() {
    if (!window.confirm(`確定取消「${member.display_name}」？取消後會從有效名單與應收金額排除。`)) return
    try { await cancelMember.mutateAsync(memberId); onClose() } catch { setMessage(member.attendance_state === 'playing' ? '球友正在比賽中，結束比賽後才能取消。' : '取消失敗，請重新整理後再試。') }
  }

  return <div className="panel-backdrop" role="presentation"><section className="side-panel member-detail-panel" role="dialog" aria-modal="true" aria-labelledby="member-detail-title">
    <header><div><p className="eyebrow">球友資料</p><h2 id="member-detail-title">{member.display_name}</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉">×</button></header>
    <form className="form-stack" onSubmit={submit}>
      <label>姓名<input name="displayName" required defaultValue={member.display_name} /></label>
      <label>級數<input name="level" type="number" min="1" max="18" required defaultValue={member.level} onChange={() => { setConfirmLevelWarning(false); setMessage('') }} /></label>
      <label>方案<select name="planId" required defaultValue={member.plan_id}>{workspace.plans.map((plan) => <option key={plan.id} value={plan.id}>方案 {plan.code}</option>)}</select></label>
      <label>性別（非必填）<select name="gender" defaultValue={member.gender ?? ''}><option value="">不填寫</option><option value="M">男</option><option value="F">女</option></select></label>
      <fieldset className="member-operation-fieldset"><legend>報到與付款</legend><div className="form-grid"><label>報到狀態<select value={checkinStatus} onChange={(event) => setCheckinStatus(event.target.value as typeof checkinStatus)}><option value="not_arrived">尚未報到</option><option value="checked_in">已報到</option></select></label>{workspace.activity.finance_enabled && <label>付款狀態<select value={paymentStatus} onChange={(event) => { const next=event.target.value as typeof paymentStatus; setPaymentStatus(next); if(next==='paid')setPaymentWaived(false) }}><option value="unpaid">尚未付款</option><option value="paid">已付款</option></select></label>}{workspace.activity.finance_enabled && paymentStatus === 'paid' && <label>付款方式<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="">請選擇</option>{enabledMethods.map((method) => <option key={method} value={method}>{paymentLabels[method] ?? method}</option>)}</select></label>}</div>{workspace.activity.finance_enabled && paymentStatus === 'unpaid' && <label className="check-row"><input type="checkbox" checked={paymentWaived} onChange={(event)=>setPaymentWaived(event.target.checked)} />帳款不予追究（排除應收與待收提醒）</label>}<p className="muted">取消付款會保留原交易稽核紀錄；取消報到前需先移出預排並結束場上比賽。</p></fieldset>
      <label>備註（非必填）<textarea name="note" defaultValue={member.note ?? ''} /></label>
      <fieldset className="relationship-fieldset"><legend>排點關係</legend><p className="muted">單場關係會在兩人共同完成一次安排後自動解除。避免同場的優先權最高。</p><div className="form-stack relationship-selects"><label>長期同隊<select value={persistentBindId} onChange={(event) => setPersistentBindId(event.target.value)}><option value="">不設定</option>{relationshipCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.display_name} · Lv.{candidate.level}</option>)}</select></label><label>僅綁一場<select value={oneMatchBindId} onChange={(event) => setOneMatchBindId(event.target.value)}><option value="">不設定</option>{relationshipCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.display_name} · Lv.{candidate.level}</option>)}</select></label><label>指定對戰一場<select value={oneMatchOpposeId} onChange={(event) => setOneMatchOpposeId(event.target.value)}><option value="">不設定</option>{relationshipCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.display_name} · Lv.{candidate.level}</option>)}</select></label></div><div className="relationship-avoid"><label className="field-label" htmlFor="avoid-member-search">避免同場</label><input id="avoid-member-search" placeholder="輸入姓名搜尋" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="avoid-list">{avoidCandidates.map((candidate) => <label key={candidate.id}><input type="checkbox" checked={avoidIds.includes(candidate.id)} onChange={(event) => setAvoidIds((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} />{candidate.display_name}<small>Lv.{candidate.level}</small></label>)}{avoidCandidates.length === 0 && <span className="muted">沒有符合的球友</span>}</div></div></fieldset>
      {message && <div className="validation-box"><p>{message}</p></div>}
      <footer className="panel-actions split"><button type="button" className="danger-button" disabled={cancelMember.isPending} onClick={cancel}>取消此球友</button><span /><button type="button" className="secondary-button" onClick={onClose}>關閉</button><button className="primary-button" disabled={updateMember.isPending || setRelationships.isPending || correctStatus.isPending || setWaiver.isPending}>{updateMember.isPending || setRelationships.isPending || correctStatus.isPending || setWaiver.isPending ? '儲存中…' : confirmLevelWarning ? '仍要儲存' : '儲存變更'}</button></footer>
    </form>
  </section></div>
}
