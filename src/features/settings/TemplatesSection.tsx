import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MaterialIcon } from '../../app/MaterialIcon'
import type { ActivityTemplate } from '../activities/activitySourcesApi'
import { useActivityTemplates, useManageTemplate } from './settingsApi'

const assignLabels: Record<string, string> = { system_assign: '系統排點', manual_assign: '人工排點', free_play: '自由上場' }

function planTime(value: string) {
  return new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }).format(new Date(value))
}

export function TemplatesSection({ onMessage }: { onMessage: (message: string) => void }) {
  const navigate = useNavigate()
  const templates = useActivityTemplates()
  const manage = useManageTemplate()
  const items = templates.data ?? []
  const [rename, setRename] = useState<ActivityTemplate | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ActivityTemplate | null>(null)

  async function action(id: string, type: 'rename' | 'copy' | 'delete', name?: string) {
    try {
      await manage.mutateAsync({ id, action: type, name })
      setRename(null); setPendingDelete(null)
      onMessage(type === 'rename' ? '範本名稱已更新。' : type === 'copy' ? '範本已複製。' : '範本已刪除。')
    } catch { onMessage('目前無法處理活動範本，請稍後再試。') }
  }

  return <section>
    <div className="section-heading settings-section-heading"><div><h2>活動範本</h2><p className="muted">重用球館、方案、場地與排點設定；建立時日期會改為今天。</p></div></div>
    {templates.isLoading ? <div className="centered-state compact">載入活動範本…</div> : templates.isError ? <div className="empty-state compact"><p>目前無法載入活動範本。</p><button className="secondary-button" onClick={() => void templates.refetch()}>重新整理</button></div> : items.length === 0 ? <div className="empty-state compact"><h3>尚未建立活動範本</h3><p>建立活動時勾選「同時儲存為活動範本」即可加入。</p></div> : <div className="template-list">{items.map((template) => {
      const config = template.config_snapshot
      return <article key={template.id}><div className="template-main"><div className="template-title-line"><strong>{template.name}</strong><button className="template-edit-icon" aria-label={`重新命名「${template.name}」`} title="重新命名" onClick={() => { setRename(template); setRenameValue(template.name) }}><MaterialIcon name="edit" /></button></div><span>{config.custom_title || '未設定活動標題'} · {config.venue.name}</span><small className="template-court-mode">{config.initial_court_count} 面場 · {assignLabels[config.assign_mode] ?? config.assign_mode}</small><div className="template-plan-list">{config.plans.map((plan) => <small key={plan.code}><b>方案 {plan.code}</b><span>{planTime(plan.start_at)}–{planTime(plan.end_at)}</span><span>{config.finance_enabled ? plan.amount === null ? '未設定金額' : `$${plan.amount}` : '不計費'}</span></small>)}</div><small className="template-updated">更新於 {new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(template.updated_at))}</small></div><button className="primary-button template-use-button" onClick={() => navigate(`/activities/new?template=${template.id}`)}>使用範本</button><div className="template-actions"><button className="text-button" onClick={() => navigate(`/activities/new?editTemplate=${template.id}`)}>編輯</button><button className="text-button" onClick={() => void action(template.id, 'copy')}>複製</button><button className="text-button danger-text" onClick={() => setPendingDelete(template)}>刪除</button></div></article>
    })}</div>}
    {rename && <div className="panel-backdrop" role="presentation"><section className="confirm-dialog template-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-template-title"><h2 id="rename-template-title">重新命名範本</h2><label>範本名稱<input autoFocus maxLength={50} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /></label><footer><button className="secondary-button" onClick={() => setRename(null)}>取消</button><button className="primary-button" disabled={!renameValue.trim() || manage.isPending} onClick={() => void action(rename.id, 'rename', renameValue.trim())}>儲存名稱</button></footer></section></div>}
    {pendingDelete && <div className="panel-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-template-title"><h2 id="delete-template-title">刪除「{pendingDelete.name}」？</h2><p>刪除後無法再從此範本建立活動；已建立的活動不受影響。</p><footer><button className="secondary-button" onClick={() => setPendingDelete(null)}>返回</button><button className="danger-button" disabled={manage.isPending} onClick={() => void action(pendingDelete.id, 'delete')}>刪除範本</button></footer></section></div>}
  </section>
}
