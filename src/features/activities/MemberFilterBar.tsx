import { MaterialIcon } from '../../app/MaterialIcon'
import type { WorkspacePlan } from './activityWorkspaceApi'

export type MemberStatusFilter = 'all' | 'not_arrived' | 'checked_in' | 'cancelled'
export type MemberOperationalFilter = '' | 'pending_checkin' | 'pending_payment'

export type MemberFilters = {
  search: string
  status: MemberStatusFilter
  operational: MemberOperationalFilter
  plan: string
  payment: string
  gender: string
  attendance: string
  level: string
  timeEligibility: string
  binding: string
  sort: string
  view: 'card' | 'table'
}

export type MemberFilterCounts = {
  all: number
  notArrived: number
  checkedIn: number
  cancelled: number
  pendingCheckin: number
  pendingPayment: number
  paid: number
}

type Props = {
  filters: MemberFilters
  plans: WorkspacePlan[]
  counts: MemberFilterCounts
  visibleCount: number
  onChange: (next: MemberFilters) => void
}

function SelectFilters({ filters, plans, patch }: { filters: MemberFilters; plans: WorkspacePlan[]; patch: (values: Partial<MemberFilters>) => void; mobile?: boolean }) {
  return <>
    <label className="member-filter-primary"><span>方案</span><select aria-label="篩選方案" value={filters.plan} onChange={(event) => patch({ plan: event.target.value })}><option value="">全部方案</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>方案 {plan.code}</option>)}</select></label>
    <label className="member-filter-primary"><span>付款狀態</span><select aria-label="篩選付款狀態" value={filters.payment} onChange={(event) => patch({ payment: event.target.value, operational: '' })}><option value="">全部付款</option><option value="unpaid">未付款</option><option value="paid">已付款</option><option value="waived">不予追究</option></select></label>
    <label className="member-filter-primary"><span>在場狀態</span><select aria-label="篩選在場狀態" value={filters.attendance} onChange={(event) => patch({ attendance: event.target.value })}><option value="">全部在場狀態</option><option value="idle">等待</option><option value="playing">比賽中</option><option value="rest">休息</option></select></label>
    <label className="member-filter-secondary"><span>級數</span><select aria-label="篩選級數" value={filters.level} onChange={(event) => patch({ level: event.target.value })}><option value="">全部級數</option>{Array.from({ length: 18 }, (_, index) => index + 1).map((level) => <option key={level} value={level}>Lv.{level}</option>)}</select></label>
    <label className="member-filter-secondary"><span>性別</span><select aria-label="篩選性別" value={filters.gender} onChange={(event) => patch({ gender: event.target.value })}><option value="">全部性別</option><option value="M">男</option><option value="F">女</option><option value="unspecified">未填寫</option></select></label>
    <label className="member-filter-secondary"><span>方案時間</span><select aria-label="篩選方案時間狀態" value={filters.timeEligibility} onChange={(event) => patch({ timeEligibility: event.target.value })}><option value="">全部方案時間</option><option value="not_started">尚未開始</option><option value="current">目前有效</option><option value="expired">時間已到</option></select></label>
    <label className="member-filter-secondary"><span>綁定狀態</span><select aria-label="篩選綁定狀態" value={filters.binding} onChange={(event) => patch({ binding: event.target.value })}><option value="">全部綁定</option><option value="bound">有綁定</option><option value="unbound">未綁定</option></select></label>
  </>
}

export function MemberFilterBar({ filters, plans, counts, visibleCount, onChange }: Props) {
  const patch = (values: Partial<MemberFilters>) => onChange({ ...filters, ...values })
  const advancedCount = [filters.level, filters.gender, filters.timeEligibility, filters.binding].filter(Boolean).length
  const allFilterCount = [filters.plan, filters.payment, filters.attendance, filters.level, filters.gender, filters.timeEligibility, filters.binding].filter(Boolean).length
  const hasFilters = allFilterCount > 0 || Boolean(filters.operational)

  function chooseStatus(status: MemberStatusFilter) {
    patch({ status, operational: '', payment: '' })
  }

  return <div className={`member-filter-bar ${filters.view}`}>
    <div className="member-status-tabs" role="tablist" aria-label="名單狀態">
      <button role="tab" aria-selected={filters.status === 'all'} className={filters.status === 'all' ? 'active' : ''} onClick={() => chooseStatus('all')}>全部 <span>{counts.all}</span></button>
      <button role="tab" aria-selected={filters.status === 'not_arrived'} className={filters.status === 'not_arrived' ? 'active' : ''} onClick={() => chooseStatus('not_arrived')}>未報到 <span>{counts.notArrived}</span></button>
      <button role="tab" aria-selected={filters.status === 'checked_in'} className={filters.status === 'checked_in' ? 'active' : ''} onClick={() => chooseStatus('checked_in')}>已報到 <span>{counts.checkedIn}</span></button>
      <button role="tab" aria-selected={filters.status === 'cancelled'} className={filters.status === 'cancelled' ? 'active' : ''} onClick={() => chooseStatus('cancelled')}>已取消 <span>{counts.cancelled}</span></button>
    </div>

    <div className="member-filter-row">
      <div className="member-filter-controls" aria-label="名單篩選"><SelectFilters filters={filters} plans={plans} patch={patch} /></div>
      <details className="member-filter-more">
        <summary><MaterialIcon name="filterList" /><span className="member-more-label">更多篩選</span>{advancedCount > 0 && <b className="member-advanced-count">{advancedCount}</b>}{allFilterCount > 0 && <b className="member-all-filter-count">{allFilterCount}</b>}</summary>
        <div className="member-filter-popover"><header className="member-filter-popover-header"><strong>篩選名單</strong><button type="button" className="icon-button" aria-label="關閉篩選" onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}><MaterialIcon name="close" /></button></header><SelectFilters filters={filters} plans={plans} patch={patch} mobile />{hasFilters && <button type="button" className="text-button" onClick={() => patch({ operational: '', plan: '', payment: '', attendance: '', level: '', gender: '', timeEligibility: '', binding: '' })}>清除所有篩選</button>}</div>
      </details>
      {hasFilters && <button type="button" className="text-button member-filter-clear" onClick={() => patch({ operational: '', plan: '', payment: '', attendance: '', level: '', gender: '', timeEligibility: '', binding: '' })}>清除篩選</button>}
    </div>

    <div className="member-list-controls">
      <strong>共顯示 {visibleCount} 位</strong>
      <div><label><span className="sr-only">排序方式</span><select aria-label="名單排序" value={filters.sort} onChange={(event) => patch({ sort: event.target.value })}><option value="source">原始順序</option><option value="name">姓名</option><option value="plan">方案</option><option value="level">級數</option><option value="checkin">報到狀態</option><option value="payment">付款狀態</option></select></label><div className="member-view-switch" aria-label="名單顯示模式"><button aria-label="卡片模式" title="卡片模式" className={filters.view === 'card' ? 'active' : ''} onClick={() => patch({ view: 'card' })}><MaterialIcon name="viewModule" /></button><button aria-label="表格模式" title="表格模式" className={filters.view === 'table' ? 'active' : ''} onClick={() => patch({ view: 'table' })}><MaterialIcon name="tableRows" /></button></div></div>
    </div>
  </div>
}
