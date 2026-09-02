import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MaterialIcon } from '../../app/MaterialIcon'
import { type ActivityStatus, type ActivitySummary, useActivityCenter, useManageActivity } from './activityCenterApi'
import { ContentNavigation } from '../../app/ContentWorkspace'
import { useActivityTemplates } from '../settings/settingsApi'
import { UNARCHIVED_ACTIVITY_LIMIT } from './activityLimits'
import { ConfirmDialog } from '../../app/Feedback'
import { useFeedback } from '../../app/feedbackContext'

type Filter = 'all' | 'in_progress' | 'scheduled' | 'ended' | 'draft' | 'archived'

const statusLabels: Record<ActivityStatus, string> = {
  draft: '草稿', scheduled: '即將開始', in_progress: '進行中', ended: '已結束', archived: '已封存',
}

const emptyMessages: Record<Filter, [string, string]> = {
  all: ['還沒有活動', '建立第一個活動，開始管理零打。'],
  in_progress: ['目前沒有進行中活動', '活動開始後會顯示在這裡。'],
  scheduled: ['目前沒有即將開始活動', '已建立且尚未開始的活動會顯示在這裡。'],
  ended: ['目前沒有已結束活動', '結束後的活動會保留在這裡，方便複製或封存。'],
  draft: ['目前沒有活動草稿', '尚未完成的活動草稿會顯示在這裡。'],
  archived: ['目前沒有已封存活動', '封存後的活動不會占用活動名額。'],
}

function matchesFilter(activity: ActivitySummary, filter: Filter) {
  if (filter === 'all') return true
  return activity.status === filter
}

function sortActivities(activities: ActivitySummary[], filter: Filter) {
  const copy = [...activities]
  if (filter === 'ended') return copy.sort((a, b) => b.activityDate.localeCompare(a.activityDate))
  if (filter === 'archived') return copy.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
  if (filter === 'in_progress' || filter === 'scheduled' || filter === 'draft') return copy.sort((a, b) => a.activityDate.localeCompare(b.activityDate))
  const rank: Record<ActivityStatus, number> = { in_progress: 0, scheduled: 1, draft: 2, ended: 3, archived: 4 }
  return copy.sort((a, b) => rank[a.status] - rank[b.status] || (rank[a.status] <= 2 ? a.activityDate.localeCompare(b.activityDate) : b.activityDate.localeCompare(a.activityDate)))
}

function primaryAction(activity: ActivitySummary) {
  if (activity.status === 'draft') return '繼續編輯'
  if (activity.status === 'archived') return '查看活動'
  return '進入活動'
}

export function ActivityCenterPage() {
  const activityCenter = useActivityCenter()
  const activityTemplates = useActivityTemplates()
  const manageActivity = useManageActivity()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [actionError, setActionError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ActivitySummary | null>(null)
  const { notify } = useFeedback()

  const data = activityCenter.data
  const counts = useMemo(() => {
    const activities = data?.activities ?? []
    return {
      all: activities.length,
      in_progress: activities.filter((activity) => activity.status === 'in_progress').length,
      scheduled: activities.filter((activity) => activity.status === 'scheduled').length,
      ended: activities.filter((activity) => activity.status === 'ended').length,
      draft: activities.filter((activity) => activity.status === 'draft').length,
      archived: activities.filter((activity) => activity.status === 'archived').length,
    }
  }, [data?.activities])
  const visibleActivities = useMemo(() => sortActivities((data?.activities ?? []).filter((activity) => matchesFilter(activity, filter)), filter), [data?.activities, filter])

  if (activityCenter.isLoading) return <div className="centered-state">載入球團資料…</div>
  if (activityCenter.isError || !data) return <div className="centered-state"><p>目前無法載入球團資料。</p><button className="secondary-button" onClick={() => activityCenter.refetch()}>重新整理</button></div>

  const atLimit = data.unarchivedCount >= UNARCHIVED_ACTIVITY_LIMIT
  async function runAction(activity: ActivitySummary, action: 'archive' | 'unarchive' | 'delete') {
    setActionError('')
    try {
      await manageActivity.mutateAsync({ activityId: activity.id, action })
      notify({ message: action === 'delete' ? `已刪除「${activity.title || activity.venue}」。` : action === 'archive' ? `已封存「${activity.title || activity.venue}」。` : `已取消封存「${activity.title || activity.venue}」。`, tone: 'success' })
      if (action === 'delete') setPendingDelete(null)
    }
    catch { setActionError(action === 'unarchive' ? `無法取消封存；請確認未封存活動尚未達 ${UNARCHIVED_ACTIVITY_LIMIT} 筆。` : '活動操作失敗，請稍後再試。') }
  }

  return <div className="activity-center-page club-home-page">
    <ContentNavigation context="球團首頁" />
    <section className="club-home-hero">
      <div className="club-home-intro"><div className="club-home-hero-heading"><h1>{data.organizationName}</h1><button type="button" className="primary-button icon-text-button" disabled={atLimit} onClick={() => navigate('/activities/new')}><MaterialIcon name="add" />建立活動</button></div><p>{data.organizationDescription || '管理活動與近期開團安排。'}</p><div className={`club-home-usage${atLimit ? ' at-limit' : ''}`}><div><span>活動使用量</span><strong>{data.unarchivedCount} / {UNARCHIVED_ACTIVITY_LIMIT}</strong></div><div className="usage-track"><span style={{ width: `${Math.min(100, data.unarchivedCount / UNARCHIVED_ACTIVITY_LIMIT * 100)}%` }} /></div><p>{atLimit ? '已達活動上限，封存已結束活動或刪除草稿後即可建立新活動。' : `尚可建立 ${UNARCHIVED_ACTIVITY_LIMIT - data.unarchivedCount} 個活動。`}</p>{atLimit && counts.ended > 0 && <button type="button" className="text-button" onClick={() => setFilter('ended')}>查看可封存活動</button>}</div></div>
    </section>

    {(activityTemplates.data?.length ?? 0) > 0 && <section className="club-template-section" aria-labelledby="club-template-title"><header><div><h2 id="club-template-title">活動範本</h2><span>快速套用常用設定建立活動</span></div><Link to="/club-settings?section=templates">管理範本</Link></header><div className="club-template-list">{activityTemplates.data?.map((template) => <button type="button" disabled={atLimit} onClick={() => navigate(`/activities/new?template=${template.id}`)} key={template.id}><MaterialIcon name="copy" /><strong>{template.name}</strong></button>)}<button type="button" className="template-create-copy" disabled={atLimit} onClick={() => navigate('/activities/new')}><MaterialIcon name="add" /><strong>建立副本</strong></button></div></section>}

    <section className="club-activity-section">
      <header className="club-activity-heading"><div><h2>活動列表</h2><span>依狀態與活動日期排序</span></div></header>
      <div className="club-activity-filters" role="tablist" aria-label="活動狀態">
        {([['all', '全部'], ['in_progress', '進行中'], ['scheduled', '即將開始'], ['ended', '已結束'], ['draft', '草稿'], ['archived', '已封存']] as Array<[Filter, string]>).map(([value, label]) => <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{label} <span>{counts[value]}</span></button>)}
      </div>
      {actionError && <div className="validation-box" role="alert"><p>{actionError}</p></div>}

      {visibleActivities.length === 0 ? <div className="club-activity-empty"><h3>{emptyMessages[filter][0]}</h3><p>{emptyMessages[filter][1]}</p>{filter === 'all' && !atLimit && <Link className="activity-create-button" to="/activities/new">建立新活動</Link>}</div> : <div className="club-activity-list">{visibleActivities.map((activity) => <article className={`club-activity-row status-${activity.status}`} key={activity.id}>
        <div className="club-activity-main"><div className="club-activity-primary"><strong>{activity.date}({activity.weekday.replace('週', '')})</strong>{activity.title && <span className="club-activity-title">{activity.title}</span>}<span className={`status status-${activity.status}`}>{statusLabels[activity.status]}</span></div><p>{[activity.time, activity.venue, `${activity.initialCourtCount} 面場地`].join(' · ')}</p></div>
        <div className="club-activity-count"><span>名單</span><strong>{activity.members}{activity.capacity ? ` / ${activity.capacity}` : ''}</strong></div>
        <div className="club-activity-actions"><Link className="activity-enter-link" to={`/activities/${activity.id}`}>{primaryAction(activity)}</Link><details className="activity-more-menu"><summary aria-label="更多活動操作"><MaterialIcon name="moreVert" /></summary><div>
          {activity.status !== 'draft' && <Link to={`/activities/new?copy=${activity.id}`}>複製活動</Link>}
          {activity.status === 'ended' && <button type="button" onClick={() => runAction(activity, 'archive')}>封存活動</button>}
          {activity.status === 'archived' && <button type="button" disabled={atLimit} onClick={() => runAction(activity, 'unarchive')}>取消封存</button>}
          {(activity.status === 'draft' || activity.status === 'archived') && <button type="button" className="danger-text" onClick={() => setPendingDelete(activity)}>刪除活動</button>}
        </div></details></div>
      </article>)}</div>}
    </section>
    {pendingDelete && <ConfirmDialog title="刪除活動？" confirmLabel="刪除活動" pending={manageActivity.isPending} onCancel={() => setPendingDelete(null)} onConfirm={() => void runAction(pendingDelete, 'delete')}><p>「{pendingDelete.title || pendingDelete.venue}」及相關資料將永久刪除，此操作無法復原。</p></ConfirmDialog>}
  </div>
}
