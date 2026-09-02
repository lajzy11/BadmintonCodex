import { type FormEvent, useEffect, useRef, useState } from 'react'
import { MaterialIcon } from '../../app/MaterialIcon'
import { type ActivityEndReadiness, type DispatchRosterMember, type MatchingSettings, type MatchHistoryItem, type MatchResult, type TtsSettings, useAdjustDispatchResource, useAssignPreview, useAutoDispatchStatus, useCancelActiveMatch, useCancelCompletedMatch, useDispatchRoster, useDispatchState, useFillAutoPreviews, useFinishMatch, useManageCourt, useManagePreviewMember, useMatchHistory, usePreviewIssues, useRunAutoDispatchCycle, useSetAutoDispatchMode, useStartDirectMatch, useStartPreviewMatch, useUpdateMatchingSettings, useUpdateMatchResult, useUpdateTtsSettings } from './dispatchApi'

const resultLabels: Record<MatchResult, string> = { team_a_win: 'A 隊勝', team_b_win: 'B 隊勝', no_result: '未分勝負', unrecorded: '尚未記錄' }

function elapsedTime(startedAt: string | null, now: number) {
  if (!startedAt) return ''
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function eligibilityLabel(member: DispatchRosterMember) {
  if (member.eligibility_reason === 'not_arrived') return '尚未報到'
  if (member.eligibility_reason === 'playing') return '比賽中'
  if (member.eligibility_reason === 'rest') return '休息中'
  if (member.eligibility_reason === 'queued') return '已在預排'
  if (member.eligibility_reason === 'expired') return '時間已到'
  if (member.eligibility_reason === 'not_started') return `${new Date(member.plan_start_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })} 開始`
  return '可排點'
}

function MatchHistoryPanel({ activityId, onClose }: { activityId: string; onClose: () => void }) {
  const history = useMatchHistory(activityId)
  const updateResult = useUpdateMatchResult(activityId)
  const cancelCompleted = useCancelCompletedMatch(activityId)
  const [editing, setEditing] = useState<MatchHistoryItem | null>(null)
  const [message, setMessage] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)
    const scoreAText = String(form.get('scoreA')).trim()
    const scoreBText = String(form.get('scoreB')).trim()
    try {
      await updateResult.mutateAsync({ matchId: editing.id, scoreA: scoreAText === '' ? null : Number(scoreAText), scoreB: scoreBText === '' ? null : Number(scoreBText), result: String(form.get('result')) as MatchResult, note: String(form.get('note')) })
      setEditing(null)
      setMessage('對戰結果已更新。')
    } catch { setMessage('儲存失敗；請確認兩隊比分皆有填寫，且介於 0–99。') }
  }

  async function cancelRecord(match: MatchHistoryItem) {
    if (!window.confirm(`確定取消「${match.court_name}」這筆已完成紀錄？此操作不可復原，場次與排點統計會重新計算。`)) return
    try { await cancelCompleted.mutateAsync(match.id); if (editing?.id === match.id) setEditing(null); setMessage('對戰紀錄已取消，相關統計已更新。') }
    catch { setMessage('取消失敗，紀錄可能已在其他裝置更新。') }
  }

  return <div className="panel-backdrop" role="presentation"><section className="match-history-panel" role="dialog" aria-modal="true" aria-labelledby="match-history-title">
    <header><div><p className="eyebrow">排點作業</p><h2 id="match-history-title">對戰紀錄</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉">×</button></header>
    {message && <p className="action-message">{message}</p>}
    {history.isLoading ? <p className="muted">載入紀錄…</p> : history.isError ? <p>目前無法載入對戰紀錄。</p> : <div className="match-history-list">{history.data?.map((match) => <article className={match.status === 'cancelled' ? 'match-record cancelled' : 'match-record'} key={match.id}>
      <div><strong>{match.court_name}</strong><small>{new Date(match.started_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}–{match.ended_at ? new Date(match.ended_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : ''}</small></div>
      <div className="record-teams"><span>{match.players.filter((player) => player.team === 'A').map((player) => player.display_name).join('、')}</span><strong>{match.score_a === null ? resultLabels[match.result] : `${match.score_a}：${match.score_b}`}</strong><span>{match.players.filter((player) => player.team === 'B').map((player) => player.display_name).join('、')}</span></div>
      <div>{match.status === 'cancelled' ? <span className="muted">已取消</span> : <><button className="secondary-button" onClick={() => setEditing(match)}>補登／修改</button><button className="text-button danger-text" disabled={cancelCompleted.isPending} onClick={() => cancelRecord(match)}>取消紀錄</button></>}</div>
    </article>)}{history.data?.length === 0 && <div className="empty-state"><h3>尚無對戰紀錄</h3><p>球場結束第一場對戰後，紀錄會顯示在這裡。</p></div>}</div>}
    {editing && <form className="result-editor" onSubmit={save}><header><strong>編輯 {editing.court_name} 結果</strong><button type="button" className="icon-button" onClick={() => setEditing(null)}>×</button></header><div className="score-inputs"><label>A 隊比分<input name="scoreA" type="number" min="0" max="99" defaultValue={editing.score_a ?? ''} /></label><span>：</span><label>B 隊比分<input name="scoreB" type="number" min="0" max="99" defaultValue={editing.score_b ?? ''} /></label></div><label>無比分時的結果<select name="result" defaultValue={editing.result}><option value="unrecorded">尚未記錄</option><option value="team_a_win">A 隊勝</option><option value="team_b_win">B 隊勝</option><option value="no_result">未分勝負</option></select></label><label>備註（非必填）<textarea name="note" defaultValue={editing.note ?? ''} /></label><footer><button type="button" className="secondary-button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" disabled={updateResult.isPending}>儲存</button></footer></form>}
  </section></div>
}

function MatchingSettingsPanel({ activityId, initial, initialTts, onClose }: { activityId: string; initial: Partial<MatchingSettings>; initialTts: Partial<TtsSettings>; onClose: () => void }) {
  const updateSettings = useUpdateMatchingSettings(activityId)
  const updateTts = useUpdateTtsSettings(activityId)
  const [error, setError] = useState('')
  const [ttsEnabled, setTtsEnabled] = useState(initialTts.enabled ?? true)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await Promise.all([
        updateSettings.mutateAsync({ priority: String(form.get('priority')), levelMatch: String(form.get('levelMatch')), repeatAvoidance: String(form.get('repeatAvoidance')), genderPreference: String(form.get('genderPreference')) }),
        updateTts.mutateAsync({ enabled: ttsEnabled, repeatCount: Number(form.get('repeatCount')), rate: Number(form.get('rate')) }),
      ])
      onClose()
    } catch { setError('無法儲存排點設定，請稍後再試。') }
  }
  function testVoice() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return setError('此瀏覽器不支援語音叫號。')
    const form = document.querySelector<HTMLFormElement>('.matching-settings-panel form')
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance('球場一，請王小明、林小美、陳大華、李小羽上場。')
    utterance.lang = 'zh-TW'; utterance.rate = Number(new FormData(form ?? undefined).get('rate') ?? 1); window.speechSynthesis.speak(utterance)
  }

  return <div className="panel-backdrop" role="presentation"><section className="side-panel matching-settings-panel" role="dialog" aria-modal="true" aria-labelledby="matching-settings-title"><header><div><p className="eyebrow">排點作業</p><h2 id="matching-settings-title">排點設定</h2><p className="muted">設定會套用到下一次智慧排點，不改動現有預排。</p></div><button className="icon-button" onClick={onClose} aria-label="關閉">×</button></header><form className="form-stack" onSubmit={save}>
    <label>排點優先原則<select name="priority" defaultValue={initial.priority ?? 'balanced'}><option value="balanced">均衡公平</option><option value="waiting">等待優先</option><option value="games">場數優先</option></select></label>
    <label>實力接近程度<select name="levelMatch" defaultValue={initial.levelMatch ?? 'balanced'}><option value="loose">寬鬆</option><option value="balanced">均衡</option><option value="strict">嚴格</option></select></label>
    <label>避免重複同場<select name="repeatAvoidance" defaultValue={initial.repeatAvoidance ?? 'moderate'}><option value="none">不特別避免</option><option value="moderate">適度避免</option><option value="strong">強烈避免</option></select></label>
    <label>雙打組合偏好<select name="genderPreference" defaultValue={initial.genderPreference ?? 'none'}><option value="none">不限</option><option value="mixed">優先混雙</option><option value="separate">優先男雙／女雙分開</option></select></label>
    <fieldset className="settings-fieldset"><legend>語音叫號</legend><label className="check-row"><input type="checkbox" checked={ttsEnabled} onChange={(event) => setTtsEnabled(event.target.checked)} />啟用球場叫號按鈕</label>{ttsEnabled && <div className="form-grid"><label>重複次數<select name="repeatCount" defaultValue={initialTts.repeatCount ?? 2}><option value="1">1 次</option><option value="2">2 次</option><option value="3">3 次</option></select></label><label>語音速度<select name="rate" defaultValue={initialTts.rate ?? 1}><option value="0.5">0.5</option><option value="0.75">0.75</option><option value="1">1.0</option><option value="1.25">1.25</option><option value="1.5">1.5</option></select></label><button type="button" className="secondary-button tts-test-button" onClick={testVoice}>🔊 測試語音</button></div>}</fieldset>
    {error && <p className="form-error">{error}</p>}<footer className="panel-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={updateSettings.isPending}>儲存排點設定</button></footer>
  </form></section></div>
}

export function EndActivityPanel({ readiness, pending, onClose, onConfirm }: { readiness: ActivityEndReadiness; pending: boolean; onClose: () => void; onConfirm: () => void }) {
  const blocked = readiness.active_matches > 0
  return <div className="panel-backdrop" role="presentation"><section className="side-panel end-activity-panel" role="dialog" aria-modal="true" aria-labelledby="end-activity-title"><header><div><p className="eyebrow">活動收尾</p><h2 id="end-activity-title">結束活動</h2><p className="muted">結束後會關閉自助報到與自動模式，仍可補登比分及修正帳務。</p></div><button className="icon-button" onClick={onClose} aria-label="關閉">×</button></header><div className="end-readiness-list">
    <div className={blocked ? 'blocking' : 'ready'}><strong>進行中對戰</strong><span>{readiness.active_matches} 場</span><small>{blocked ? '請先結束或取消場上所有對戰。' : '目前沒有進行中的對戰。'}</small></div>
    <div className={readiness.queued_members ? 'warning' : 'ready'}><strong>預排球友</strong><span>{readiness.queued_members} 人</span><small>{readiness.queued_members ? '確認結束時，系統會一次清空預排。' : '預排已清空。'}</small></div>
    <div className={readiness.unpaid_members ? 'warning' : 'ready'}><strong>尚未付款</strong><span>{readiness.unpaid_members} 人</span><small>不阻擋結束，之後仍可修正帳務。</small></div>
    <div className={readiness.not_arrived_members ? 'warning' : 'ready'}><strong>尚未報到</strong><span>{readiness.not_arrived_members} 人</span><small>不阻擋結束，名單紀錄會保留。</small></div>
  </div><footer className="panel-actions"><button className="secondary-button" onClick={onClose}>返回處理</button><button className="danger-button" disabled={blocked || pending} onClick={onConfirm}>{pending ? '結束中…' : readiness.queued_members ? '清空預排並結束' : '確認結束活動'}</button></footer></section></div>
}

function RenameCourtPanel({ name, pending, onClose, onSave }: { name: string; pending: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [error, setError] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const nextName = String(new FormData(event.currentTarget).get('name')).trim(); if (!nextName) return setError('請輸入球場名稱。'); onSave(nextName) }
  return <div className="panel-backdrop" role="presentation"><section className="side-panel rename-court-panel" role="dialog" aria-modal="true" aria-labelledby="rename-court-title"><header><div><p className="eyebrow">球場管理</p><h2 id="rename-court-title">編輯球場名稱</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉">×</button></header><form className="form-stack" onSubmit={submit}><label>球場名稱<input name="name" required maxLength={30} defaultValue={name} placeholder="例如：A 場" autoFocus /></label>{error && <p className="form-error">{error}</p>}<footer className="panel-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={pending}>{pending ? '儲存中…' : '儲存名稱'}</button></footer></form></section></div>
}

export function DispatchBoard({ activityId }: { activityId: string }) {
  const dispatch = useDispatchState(activityId)
  const adjust = useAdjustDispatchResource(activityId)
  const assign = useAssignPreview(activityId)
  const startMatch = useStartPreviewMatch(activityId)
  const startDirectMatch = useStartDirectMatch(activityId)
  const finishMatch = useFinishMatch(activityId)
  const cancelMatch = useCancelActiveMatch(activityId)
  const previewIssues = usePreviewIssues(activityId)
  const managePreviewMember = useManagePreviewMember(activityId)
  const manageCourt = useManageCourt(activityId)
  const autoStatus = useAutoDispatchStatus(activityId)
  const setAutoMode = useSetAutoDispatchMode(activityId)
  const runAutoCycle = useRunAutoDispatchCycle(activityId)
  const fillAutoPreviews = useFillAutoPreviews(activityId)
  const lastAutoCycleKey = useRef('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [targetQueueId, setTargetQueueId] = useState('')
  const [courtSelections, setCourtSelections] = useState<Record<string, string>>({})
  const [directCourtId, setDirectCourtId] = useState('')
  const [pendingSkip, setPendingSkip] = useState<{ queueId: string; courtId: string } | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAllMembers, setShowAllMembers] = useState(false)
  const roster = useDispatchRoster(activityId, showAllMembers)
  const [renameCourt, setRenameCourt] = useState<{ id: string; name: string } | null>(null)
  const [deleteCourt, setDeleteCourt] = useState<{ id: string; name: string } | null>(null)
  const [mobileSection, setMobileSection] = useState<'venues' | 'players'>('venues')
  const [message, setMessage] = useState('')
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1_000); return () => window.clearInterval(timer) }, [])

  useEffect(() => {
    if (!autoStatus.data?.auto_mode_enabled || runAutoCycle.isPending || !dispatch.data) return
    const cycleKey = JSON.stringify({ eligible: dispatch.data.eligible_members.map((member) => member.id), courts: dispatch.data.courts.map((court) => [court.id, court.status]), queues: dispatch.data.queues.map((queue) => [queue.id, queue.manually_edited, queue.members.map((member) => member.member_id)]), expired: previewIssues.data?.filter((issue) => issue.expired && !issue.one_time_expired_override).map((issue) => issue.member_id) ?? [] })
    if (cycleKey === lastAutoCycleKey.current) return
    lastAutoCycleKey.current = cycleKey
    runAutoCycle.mutate()
  }, [autoStatus.data?.auto_mode_enabled, dispatch.data, previewIssues.data, runAutoCycle])

  if (dispatch.isLoading) return <div className="centered-state">載入排點資料…</div>
  if (dispatch.isError || !dispatch.data) return <div className="centered-state"><p>目前無法載入排點資料。</p><button className="secondary-button" onClick={() => dispatch.refetch()}>重新整理</button></div>
  const state = dispatch.data
  const idleCourts = state.courts.filter((court) => court.status === 'idle')
  const defaultQueue = state.queues.find((queue) => queue.members.length + selectedIds.length <= 4)
  const effectiveQueueId = targetQueueId || defaultQueue?.id || ''
  const displayedMembers: DispatchRosterMember[] = showAllMembers
    ? roster.data ?? []
    : state.eligible_members.map((member) => ({ ...member, eligibility_reason: null }))

  function toggleMember(memberId: string) { setSelectedIds((current) => current.includes(memberId) ? current.filter((id) => id !== memberId) : current.length < 4 ? [...current, memberId] : current) }
  async function changeResource(resourceType: 'court' | 'queue', adjustment: 'add' | 'remove') { try { await adjust.mutateAsync({ resourceType, adjustment }) } catch { setMessage('無法調整數量；請確認最後一個項目是否仍在使用。') } }
  async function addToPreview() { if (!effectiveQueueId || !selectedIds.length) return; try { await assign.mutateAsync({ queueId: effectiveQueueId, memberIds: selectedIds }); setSelectedIds([]); setMessage('已加入預排。') } catch { setMessage('加入預排失敗；資格或預排內容可能已更新。') } }
  async function smartFill() { try { await fillAutoPreviews.mutateAsync(true); setMessage('預排已更新。') } catch { setMessage('目前無法更新預排。') } }
  async function performDeploy(queueId: string, courtId: string) { try { await startMatch.mutateAsync({ queueId, courtId }); setPendingSkip(null); setMessage('已安排上場。') } catch { setMessage('安排上場失敗；請確認球場、預排與球友資格。') } }
  async function deploy(queueId: string) { const courtId = courtSelections[queueId] || idleCourts[0]?.id; if (!courtId) return setMessage('目前沒有空閒球場。'); const queue = state.queues.find((item) => item.id === queueId); const skipsQueue = state.queues.some((item) => item.sort_order < (queue?.sort_order ?? 0) && item.members.length > 0); if (skipsQueue) return setPendingSkip({ queueId, courtId }); await performDeploy(queueId, courtId) }
  async function deployDirect() { const courtId = directCourtId || idleCourts[0]?.id; if (selectedIds.length !== 4 || !courtId) return; try { await startDirectMatch.mutateAsync({ courtId, memberIds: selectedIds }); setSelectedIds([]); setDirectCourtId(''); setMessage('四位球友已直接安排上場。') } catch { setMessage('直接安排失敗；請確認球場與球友資格是否仍有效。') } }
  async function finish(matchId: string) { try { await finishMatch.mutateAsync(matchId); setMessage('本場已結束，球員已回到可排點狀態。') } catch { setMessage('結束本場失敗，資料可能已在其他裝置更新。') } }
  async function cancel(matchId: string) { if (!window.confirm('確定取消這場進行中的對戰？球員會回到可排點狀態，且不列入有效紀錄。')) return; try { await cancelMatch.mutateAsync(matchId); setMessage('本場已取消。') } catch { setMessage('取消失敗，資料可能已更新。') } }
  async function manageQueuedMember(queueId: string, memberId: string, action: 'remove' | 'allow_expired_once') { try { await managePreviewMember.mutateAsync({ queueId, memberId, action }); setMessage(action === 'remove' ? '已移出預排，可重新選人補入。' : '已允許此球友本次上場。') } catch { setMessage('預排調整失敗，資料可能已在其他裝置更新。') } }
  async function toggleAutoMode() { const enabled = !autoStatus.data?.auto_mode_enabled; try { await setAutoMode.mutateAsync(enabled); lastAutoCycleKey.current = ''; if (enabled) await runAutoCycle.mutateAsync(); setMessage(enabled ? '自動模式已開啟，系統會依序補入預排並派往第一個空場。' : '自動模式已關閉，現有預排不受影響。') } catch { setMessage('目前無法切換自動模式；請確認活動採系統排點且已進行中。') } }
  async function saveCourtName(name: string) { if (!renameCourt) return; try { await manageCourt.mutateAsync({ courtId: renameCourt.id, action: 'rename', name }); setRenameCourt(null); setMessage(`球場已重新命名為「${name}」。`) } catch { setRenameCourt(null); setMessage('無法重新命名；請確認名稱未重複且不超過 30 個字元。') } }
  async function confirmDeleteCourt() { if (!deleteCourt) return; try { await manageCourt.mutateAsync({ courtId: deleteCourt.id, action: 'delete' }); setDeleteCourt(null); setMessage(`已移除「${deleteCourt.name}」。`) } catch { setDeleteCourt(null); setMessage('無法移除球場；比賽中的球場不可刪除，且至少需保留一面。') } }
  function callCourt(courtName: string, players: typeof state.courts[number]['players']) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return setMessage('此瀏覽器不支援語音叫號。')
    const settings = autoStatus.data?.tts_settings
    if (settings?.enabled === false || players.length !== 4) return
    const text = `${courtName}，請 ${[...players].sort((a, b) => a.slot - b.slot).map((player) => player.display_name).join('、')} 上場。`
    const repeatCount = Math.min(3, Math.max(1, Number(settings?.repeatCount ?? 2)))
    const rate = Math.min(1.5, Math.max(0.5, Number(settings?.rate ?? 1)))
    for (let index = 0; index < repeatCount; index += 1) { const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'zh-TW'; utterance.rate = rate; window.speechSynthesis.speak(utterance) }
    setMessage(`已加入叫號佇列：${text}`)
  }

  return <div className="dispatch-board" data-mobile-section={mobileSection}><div className="dispatch-control-bar">{state.assign_mode === 'system_assign' && <button type="button" role="switch" aria-checked={autoStatus.data?.auto_mode_enabled ?? false} className={`auto-mode-switch ${autoStatus.data?.auto_mode_enabled ? 'active' : ''}`} disabled={setAutoMode.isPending || state.status !== 'in_progress'} onClick={toggleAutoMode}><span aria-hidden="true"><i /></span>自動模式</button>}<button className="text-button" disabled={state.assign_mode !== 'system_assign'} onClick={() => setShowSettings(true)}>排點設定</button><button className="text-button" onClick={() => setShowHistory(true)}>對戰紀錄</button></div><nav className="dispatch-mobile-tabs" aria-label="排點內容"><button className={mobileSection === 'venues' ? 'active' : ''} onClick={() => setMobileSection('venues')}>場地</button><button className={mobileSection === 'players' ? 'active' : ''} onClick={() => setMobileSection('players')}>球友</button></nav>{state.status !== 'in_progress' && <div className="validation-box"><p>{state.status === 'ended' ? '活動已結束；可查看對戰紀錄，但不能再新增預排或開始新比賽。' : '活動尚未到最早方案時間；目前可以檢視配置，但不能加入預排或安排上場。'}</p></div>}{message && <p className="action-message" role="status">{message}</p>}
    <header className="dispatch-venue-heading"><div><h2>球場與預排</h2><p className="muted">依現場順序查看比賽與下一組預排。</p></div><div className="dispatch-resource-groups"><div className="resource-controls"><span>球場</span><button aria-label="減少球場" onClick={() => changeResource('court', 'remove')}>−</button><strong>{state.courts.length}</strong><button aria-label="新增球場" onClick={() => changeResource('court', 'add')}>＋</button></div><div className="resource-controls"><span>預排</span><button aria-label="減少預排" onClick={() => changeResource('queue', 'remove')}>−</button><strong>{state.queues.length}</strong><button aria-label="新增預排" onClick={() => changeResource('queue', 'add')}>＋</button></div></div></header>
    <section className="dispatch-section court-console-section"><header><div><h2>球場與預排</h2><p className="muted">結束本場後可到對戰紀錄補登比分。</p></div><div className="resource-controls"><strong>管理球場 · {state.courts.length} 面</strong><button aria-label="新增球場" onClick={() => changeResource('court', 'add')}>＋</button></div></header><div className="dispatch-card-grid">{state.courts.map((court, courtIndex) => { const teamA = court.players.filter((player) => player.team === 'A'); const teamB = court.players.filter((player) => player.team === 'B'); return <article className={`court-card court-console ${court.status}`} key={court.id}><header className="court-console-header"><strong>{String(courtIndex + 1).padStart(2, '0')}</strong>{court.status === 'playing' ? <time>{elapsedTime(court.started_at, clock)}</time> : <time>—</time>}<span>{court.status === 'playing' ? '比賽中' : '空場'}</span></header><div className={`court-player-layout ${court.status === 'idle' ? 'empty' : ''}`}><div className="court-team-row">{[0,1].map((position) => { const player = teamA[position]; return <div className="court-player" key={`A-${position}`}>{player ? <><strong>{player.display_name}</strong><small>Lv.{player.level}</small></> : <><strong>空位</strong><small>尚未安排</small></>}</div> })}</div><div className="court-versus"><span>VS</span></div><div className="court-team-row">{[0,1].map((position) => { const player = teamB[position]; return <div className="court-player" key={`B-${position}`}>{player ? <><strong>{player.display_name}</strong><small>Lv.{player.level}</small></> : <><strong>空位</strong><small>尚未安排</small></>}</div> })}</div></div><footer className="court-console-actions"><details className="court-more-menu"><summary aria-label={`${court.name}更多操作`}><MaterialIcon name="moreVert" /></summary><div><button onClick={() => setRenameCourt({ id: court.id, name: court.name })}>編輯名稱</button>{court.status === 'playing' && <button onClick={() => cancel(court.active_match_id!)}>取消本場</button>}<button className="danger-text" disabled={court.status !== 'idle' || state.courts.length <= 1} onClick={() => setDeleteCourt({ id: court.id, name: court.name })}>刪除空場</button></div></details>{court.status === 'playing' && <><button className="voice-call-button" disabled={autoStatus.data?.tts_settings?.enabled === false} onClick={() => callCourt(court.name, court.players)}>🔊 再次叫號</button><button className="primary-button" onClick={() => finish(court.active_match_id!)}>結束本場</button></>}</footer></article> })}</div></section>
    <section className="dispatch-section preview-console-section"><header><div><h2>預排順序</h2><p className="muted">預排接續場地工作流；可移出球友或處理時間到期。</p></div><div className="resource-controls"><button onClick={() => changeResource('queue', 'remove')}>−</button><strong>{state.queues.length}</strong><button onClick={() => changeResource('queue', 'add')}>＋ 新增預排</button></div></header><div className="dispatch-card-grid">{state.queues.map((queue) => <article className="queue-card" key={queue.id}><div className="dispatch-card-title"><h3><small className="queue-next">NEXT</small> 預排 {queue.sort_order + 1}</h3><span>{queue.members.length} / 4 人</span></div><div className="preview-slots">{[1,2,3,4].map((slot) => { const member = queue.members.find((item) => item.slot === slot); const issue = member ? previewIssues.data?.find((item) => item.queue_id === queue.id && item.member_id === member.member_id) : undefined; return <div className={member ? issue?.expired ? 'filled expired' : 'filled' : ''} key={slot}>{member ? <><strong>{member.display_name}</strong><small>Lv.{member.level} · {member.team} 隊</small>{issue?.expired && <small className="expiry-label">時間已到{issue.one_time_expired_override ? '・本次允許' : ''}</small>}<div className="preview-slot-actions">{issue?.expired && !issue.one_time_expired_override && <button onClick={() => manageQueuedMember(queue.id, member.member_id, 'allow_expired_once')}>本次允許</button>}<button onClick={() => manageQueuedMember(queue.id, member.member_id, 'remove')}>移出</button></div></> : <span>空位</span>}</div> })}</div>{queue.members.length === 4 && <div className="deploy-row">{idleCourts.length > 1 && <select aria-label="指定上場球場" value={courtSelections[queue.id] || idleCourts[0]?.id || ''} onChange={(e) => setCourtSelections((current) => ({ ...current, [queue.id]: e.target.value }))}><option value="">選擇空場</option>{idleCourts.map((court) => <option value={court.id} key={court.id}>{court.name}</option>)}</select>}<button className="secondary-button" disabled={fillAutoPreviews.isPending || state.assign_mode !== 'system_assign'} onClick={smartFill}>重算預排</button><button className="primary-button" disabled={idleCourts.length === 0} onClick={() => deploy(queue.id)}>一鍵上場</button></div>}</article>)}</div></section>
    <section className="dispatch-section member-pool"><header><div><h2>{showAllMembers ? '全部球友' : '可排點球友'}</h2><p className="muted">{showAllMembers ? '不可排點者會顯示目前原因。' : '已報到、未上場、未在預排且方案時間有效。'}</p></div><div className="member-pool-controls"><strong>{showAllMembers ? displayedMembers.length : state.eligible_members.length} 人</strong><div className="view-toggle" role="group" aria-label="球友顯示範圍"><button className={!showAllMembers ? 'active' : ''} onClick={() => setShowAllMembers(false)}>可排點</button><button className={showAllMembers ? 'active' : ''} onClick={() => setShowAllMembers(true)}>顯示全部</button></div></div></header>{selectedIds.length > 0 && <div className="dispatch-selection"><strong>已選 {selectedIds.length}/4</strong><div className="dispatch-selection-target"><select value={effectiveQueueId} onChange={(e) => setTargetQueueId(e.target.value)}>{state.queues.filter((q) => q.members.length + selectedIds.length <= 4).map((q) => <option key={q.id} value={q.id}>加入預排 {q.sort_order + 1}（已有 {q.members.length} 人）</option>)}</select><button className="primary-button" disabled={!effectiveQueueId || assign.isPending || state.status !== 'in_progress'} onClick={addToPreview}>加入預排</button></div>{selectedIds.length === 4 && idleCourts.length > 0 && <div className="dispatch-selection-target direct-target">{idleCourts.length > 1 && <select aria-label="直接安排球場" value={directCourtId || idleCourts[0].id} onChange={(event) => setDirectCourtId(event.target.value)}>{idleCourts.map((court) => <option value={court.id} key={court.id}>{court.name}</option>)}</select>}<button className="secondary-button" disabled={startDirectMatch.isPending || state.status !== 'in_progress'} onClick={deployDirect}>直接安排至{idleCourts.length === 1 ? ` ${idleCourts[0].name}` : '球場'}</button></div>}<button className="clear-selection" onClick={() => setSelectedIds([])}>取消選取</button></div>}{showAllMembers && roster.isLoading ? <p className="muted">載入完整名單…</p> : showAllMembers && roster.isError ? <div className="validation-box"><p>目前無法載入完整排點名單。</p></div> : <div className="eligible-grid">{displayedMembers.map((member) => member.eligibility_reason === null ? <label className={selectedIds.includes(member.id) ? 'eligible-card selected' : 'eligible-card'} key={member.id}><input type="checkbox" checked={selectedIds.includes(member.id)} onChange={() => toggleMember(member.id)} /><span><strong>{member.display_name}</strong><small>Lv.{member.level} · 方案 {member.plan_code}</small><em className="eligibility-status available">可排點</em></span></label> : <div className={`eligible-card unavailable reason-${member.eligibility_reason}`} key={member.id}><span><strong>{member.display_name}</strong><small>Lv.{member.level} · 方案 {member.plan_code}</small><em className="eligibility-status">{eligibilityLabel(member)}</em></span></div>)}{displayedMembers.length === 0 && <p className="muted">目前沒有符合的球友。</p>}</div>}</section>
    {showHistory && <MatchHistoryPanel activityId={activityId} onClose={() => setShowHistory(false)} />}
    {showSettings && <MatchingSettingsPanel activityId={activityId} initial={autoStatus.data?.matching_settings ?? {}} initialTts={autoStatus.data?.tts_settings ?? {}} onClose={() => setShowSettings(false)} />}
    {pendingSkip && <div className="panel-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="skip-preview-title"><h2 id="skip-preview-title">跳過前方預排？</h2><p>前面仍有等待上場的預排。這次安排會打亂順序，但前方預排內容會保持不動。</p><footer><button className="secondary-button" onClick={() => setPendingSkip(null)}>返回</button><button className="primary-button" disabled={startMatch.isPending} onClick={() => performDeploy(pendingSkip.queueId, pendingSkip.courtId)}>仍要安排上場</button></footer></section></div>}
    {renameCourt && <RenameCourtPanel name={renameCourt.name} pending={manageCourt.isPending} onClose={() => setRenameCourt(null)} onSave={saveCourtName} />}
    {deleteCourt && <div className="panel-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-court-title"><h2 id="delete-court-title">刪除「{deleteCourt.name}」？</h2><p>這面空場會從目前活動移除；既有對戰紀錄仍會保留當時的球場名稱。</p><footer><button className="secondary-button" onClick={() => setDeleteCourt(null)}>返回</button><button className="danger-button" disabled={manageCourt.isPending} onClick={confirmDeleteCourt}>刪除空場</button></footer></section></div>}
  </div>
}
