import { useMemo, useState } from 'react'
import { useImportActivityMembers, type ActivityWorkspace } from '../activities/activityWorkspaceApi'
import { parseImportText, type ImportPreviewRow } from './importParser'

type Props = { workspace: ActivityWorkspace; onClose: () => void }
type PreviewFilter = 'all' | 'warning' | 'error'

export function ImportMembersPanel({ workspace, onClose }: Props) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ImportPreviewRow[]>([])
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [message, setMessage] = useState('')
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('all')
  const importMembers = useImportActivityMembers(workspace.activity.id)

  const reviewedRows = useMemo(() => {
    const existing = new Set(workspace.members.filter((member) => member.registration_status === 'active').map((member) => member.display_name.trim().toLowerCase()))
    const batchSeen = new Set<string>()
    return rows.map((row) => {
      const errors: string[] = []
      const warnings: string[] = []
      const name = row.displayName.trim()
      const normalizedName = name.toLowerCase()
      if (!name) errors.push('缺少姓名')
      if (row.level === null || row.level < 1 || row.level > 18) errors.push('級數需為 1–18')
      if (!row.planId) errors.push('無法判斷方案')
      if (normalizedName && (existing.has(normalizedName) || batchSeen.has(normalizedName))) warnings.push('疑似重名')
      if (normalizedName) batchSeen.add(normalizedName)
      if (row.level !== null && (row.level < workspace.activity.skill_min || row.level > workspace.activity.skill_max)) warnings.push(`級數超出活動 ${workspace.activity.skill_min}–${workspace.activity.skill_max}`)
      return { ...row, issues: [...errors, ...warnings], status: errors.length ? 'error' as const : warnings.length ? 'warning' as const : 'ready' as const }
    })
  }, [rows, workspace])

  const errorCount = reviewedRows.filter((row) => row.status === 'error').length
  const warningCount = reviewedRows.filter((row) => row.status === 'warning').length
  const outOfRangeCount = reviewedRows.filter((row) => row.issues.some((issue) => issue.startsWith('級數超出活動'))).length
  const duplicateCount = reviewedRows.filter((row) => row.issues.includes('疑似重名')).length
  const capacityExceeded = workspace.activity.capacity_mode === 'limited' && workspace.stats.active_members + reviewedRows.length > (workspace.activity.capacity_limit ?? 0)
  const visibleRows = reviewedRows.map((row, index) => ({ row, index })).filter(({ row }) => previewFilter === 'all' || row.status === previewFilter)

  function parse(value = text) {
    setRows(parseImportText(value, workspace.plans, workspace.members.map((member) => member.display_name), [workspace.activity.skill_min, workspace.activity.skill_max]))
    setShowConfirmation(false); setPreviewFilter('all'); setMessage('')
  }
  function patchRow(index: number, values: Partial<ImportPreviewRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...values } : row))
    setShowConfirmation(false)
  }
  async function confirmImport() {
    try {
      await importMembers.mutateAsync(reviewedRows.map((row) => ({ display_name: row.displayName, level: row.level!, plan_id: row.planId!, gender: row.gender, note: row.note })))
      onClose()
    } catch { setShowConfirmation(false); setMessage('匯入失敗，請確認活動與方案仍有效後再試。') }
  }
  async function importRows() {
    if (errorCount || !reviewedRows.length) return
    if (warningCount || capacityExceeded) { setShowConfirmation(true); return }
    await confirmImport()
  }
  async function readFile(file: File | undefined) {
    if (!file) return
    const value = await file.text(); setText(value); parse(value)
  }

  return <div className="panel-backdrop"><section className="import-panel" role="dialog" aria-modal="true" aria-labelledby="import-title">
    <header><div><p className="eyebrow">活動名單</p><h2 id="import-title">匯入名單</h2><p className="muted">貼上 LINE 接龍、CSV 或試算表欄位，解析後再確認匯入。</p></div><button className="icon-button" onClick={onClose} aria-label="關閉">×</button></header>
    {rows.length === 0 ? <div className="import-input"><label>貼上名單<textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={'12.Hugo/7 (21-23)\n13.Adam/4/A\n14.明福/7/男/B'} /></label><div className="import-source-actions"><label className="secondary-button file-button">選擇 CSV／TXT<input type="file" accept=".csv,.tsv,.txt,text/plain,text/csv" onChange={(event) => readFile(event.target.files?.[0])} /></label><button className="primary-button" disabled={!text.trim()} onClick={() => parse()}>解析預覽</button></div></div> : <>
      <div className="import-summary" role="group" aria-label="預覽名單篩選"><button className={previewFilter === 'all' ? 'active' : ''} aria-pressed={previewFilter === 'all'} onClick={() => setPreviewFilter('all')}>全部 {reviewedRows.length}</button><button className={`warning ${previewFilter === 'warning' ? 'active' : ''}`} aria-pressed={previewFilter === 'warning'} onClick={() => setPreviewFilter('warning')}>需確認 {warningCount}</button><button className={`error ${previewFilter === 'error' ? 'active' : ''}`} aria-pressed={previewFilter === 'error'} onClick={() => setPreviewFilter('error')}>無法匯入 {errorCount}</button><span className="ready">可直接匯入 {reviewedRows.length - warningCount - errorCount}</span></div>
      {capacityExceeded && <div className="import-capacity-notice">匯入後將超過活動招收上限，請確認是否仍要繼續。</div>}
      <div className="import-table"><div className="import-row import-head"><span>行</span><span>姓名</span><span>級數</span><span>方案</span><span>性別</span><span>備註／狀態</span></div>{visibleRows.map(({ row, index }) => <div className={`import-row ${row.status}`} key={`${row.line}-${index}`}>
        <span className="import-line-number">第 {row.line} 行</span>
        <label className="import-cell"><span>姓名</span><input aria-label={`第 ${row.line} 行姓名`} value={row.displayName} onChange={(event) => patchRow(index, { displayName: event.target.value })} /></label>
        <label className="import-cell"><span>級數</span><input aria-label={`第 ${row.line} 行級數`} type="number" min="1" max="18" value={row.level ?? ''} onChange={(event) => patchRow(index, { level: event.target.value ? Number(event.target.value) : null })} /></label>
        <label className="import-cell"><span>方案</span><select aria-label={`第 ${row.line} 行方案`} value={row.planId ?? ''} onChange={(event) => { const plan = workspace.plans.find((item) => item.id === event.target.value); patchRow(index, { planId: plan?.id ?? null, planCode: plan?.code ?? null }) }}><option value="">請選擇</option>{workspace.plans.map((plan) => <option key={plan.id} value={plan.id}>方案 {plan.code}</option>)}</select></label>
        <label className="import-cell"><span>性別</span><select aria-label={`第 ${row.line} 行性別`} value={row.gender ?? ''} onChange={(event) => patchRow(index, { gender: (event.target.value || null) as 'M' | 'F' | null })}><option value="">—</option><option value="M">男</option><option value="F">女</option></select></label>
        <label className="import-cell import-note-cell"><span>備註／狀態</span><input aria-label={`第 ${row.line} 行備註`} value={row.note} onChange={(event) => patchRow(index, { note: event.target.value })} />{row.issues.map((issue) => <small key={issue}>{issue}</small>)}</label>
      </div>)}{visibleRows.length === 0 && <div className="import-filter-empty">此分類目前沒有名單。</div>}</div>
      {message && <div className="validation-box"><p>{message}</p></div>}
      <footer className="import-actions"><button className="secondary-button" onClick={() => { setRows([]); setMessage(''); setPreviewFilter('all') }}>重新輸入</button><span /><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={Boolean(errorCount) || importMembers.isPending} onClick={importRows}>{importMembers.isPending ? '匯入中…' : `匯入 ${reviewedRows.length} 人`}</button></footer>
    </>}
    {showConfirmation && <div className="import-confirm-backdrop"><section className="confirm-dialog import-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-import-title"><h2 id="confirm-import-title">確認匯入 {reviewedRows.length} 人？</h2><p>名單可以匯入，但仍有以下項目需要留意：</p><ul>{outOfRangeCount > 0 && <li><strong>{outOfRangeCount} 人</strong>的級數不在本活動限制（Lv.{workspace.activity.skill_min}–{workspace.activity.skill_max}）內</li>}{duplicateCount > 0 && <li><strong>{duplicateCount} 人</strong>疑似與現有名單或本次名單重名</li>}{capacityExceeded && <li>匯入後共 <strong>{workspace.stats.active_members + reviewedRows.length} 人</strong>，將超過招收上限 {workspace.activity.capacity_limit} 人</li>}</ul><p className="import-confirm-note">以上項目不會阻止加入；確認後將直接匯入全部名單。</p><footer><button className="secondary-button" onClick={() => setShowConfirmation(false)}>返回檢查</button><button className="primary-button" disabled={importMembers.isPending} onClick={() => void confirmImport()}>{importMembers.isPending ? '匯入中…' : `仍要匯入 ${reviewedRows.length} 人`}</button></footer></section></div>}
  </section></div>
}
