import type { CSSProperties } from 'react'
import type { MemberFilters } from './MemberFilterBar'
import type { ActivityWorkspace } from './activityWorkspaceApi'

const labels: Record<string, string> = { cash: '現金', line_pay: 'LINE Pay', transfer: '轉帳', voucher: '球券', other: '其他' }
const time = (value: string | number) => new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }).format(new Date(value))
const percent = (value: number, total: number) => total > 0 ? Math.min(100, Math.round(value / total * 100)) : 0

export function OverviewInsights({ workspace, onOpenMembers }: { workspace: ActivityWorkspace; onOpenMembers: (filters?: Partial<MemberFilters>) => void }) {
  const active = workspace.members.filter((member) => member.registration_status === 'active')
  const checkedIn = active.filter((member) => member.checkin_status === 'checked_in').length
  const notArrived = active.length - checkedIn
  const attendanceRate = percent(checkedIn, active.length)
  const capacity = workspace.activity.capacity_mode === 'limited' ? workspace.activity.capacity_limit : null
  const planStats = workspace.plans.map((plan) => {
    const members = active.filter((member) => member.plan_id === plan.id)
    const arrived = members.filter((member) => member.checkin_status === 'checked_in').length
    const collected = members.filter((member) => member.payment_status === 'paid').length * (plan.amount ?? 0)
    return { plan, members: members.length, arrived, collected }
  })
  const paymentStats = Object.entries(active.filter((member) => member.payment_status === 'paid' && member.payment_method).reduce<Record<string, { count: number; amount: number }>>((result, member) => {
    const amount = workspace.plans.find((plan) => plan.id === member.plan_id)?.amount ?? 0
    const current = result[member.payment_method!] ?? { count: 0, amount: 0 }
    result[member.payment_method!] = { count: current.count + 1, amount: current.amount + amount }
    return result
  }, {})).sort((a, b) => b[1].amount - a[1].amount)
  const started = active.filter((member) => Date.now() >= new Date(workspace.plans.find((plan) => plan.id === member.plan_id)?.start_at ?? '2999-01-01').getTime())
  const pendingCheckin = started.filter((member) => member.checkin_status === 'not_arrived').length
  const pendingPayment = workspace.activity.finance_enabled ? started.filter((member) => member.payment_status === 'unpaid' && member.no_show_status !== 'waived').length : 0
  const unpaidMembers = active.filter((member) => member.payment_status === 'unpaid' && member.no_show_status !== 'waived').length
  const segments: Array<{ start: number; end: number; count: number }> = []

  if (workspace.plans.length > 1) {
    const starts = workspace.plans.map((plan) => new Date(plan.start_at).getTime())
    const ends = workspace.plans.map((plan) => new Date(plan.end_at).getTime())
    for (let start = Math.min(...starts); start < Math.max(...ends); start += 1_800_000) {
      const end = Math.min(start + 1_800_000, Math.max(...ends))
      const count = active.filter((member) => { const plan = workspace.plans.find((item) => item.id === member.plan_id); return plan && new Date(plan.start_at).getTime() <= start && new Date(plan.end_at).getTime() >= end }).length
      const previous = segments.at(-1)
      if (previous?.count === count) previous.end = end
      else segments.push({ start, end, count })
    }
  }

  const maxPlanMembers = Math.max(1, ...planStats.map((item) => item.members))
  const maxSegmentMembers = Math.max(1, ...segments.map((item) => item.count))
  const collectedRate = percent(workspace.stats.collected_amount, workspace.stats.expected_amount)

  return <div className="overview-dashboard">
    <section className="dashboard-card attendance-card">
      <header><div><p className="dashboard-kicker">人員狀況</p><h2>報名與出席</h2></div>{capacity !== null && <span className="capacity-label">上限 {capacity} 人</span>}</header>
      <div className="attendance-visual">
        <button className="donut-chart" style={{ '--progress': `${attendanceRate * 3.6}deg` } as CSSProperties} onClick={() => onOpenMembers({ status: 'checked_in' })} aria-label={`報到率 ${attendanceRate}%`}><strong>{attendanceRate}%</strong><span>報到率</span></button>
        <div className="dashboard-metrics"><button onClick={() => onOpenMembers()}><span>有效報名</span><strong>{active.length}<small> 人</small></strong></button><button onClick={() => onOpenMembers({ status: 'checked_in' })}><span>已報到</span><strong>{checkedIn}<small> 人</small></strong></button><button onClick={() => onOpenMembers({ status: 'not_arrived' })}><span>未報到</span><strong>{notArrived}<small> 人</small></strong></button></div>
      </div>
      {capacity !== null && <div className="capacity-progress"><span style={{ width: `${percent(active.length, capacity)}%` }} /><small>名額使用 {active.length}／{capacity}</small></div>}
    </section>

    {workspace.activity.finance_enabled && <section className="dashboard-card finance-card">
      <header><div><p className="dashboard-kicker">帳務狀況</p><h2>收款與付款方式</h2></div><strong className="dashboard-rate">{collectedRate}%</strong></header>
      <div className="finance-totals"><div><span>應收金額</span><strong>${workspace.stats.expected_amount.toLocaleString()}</strong></div><div><span>已收金額</span><strong>${workspace.stats.collected_amount.toLocaleString()}</strong></div><button onClick={() => onOpenMembers({ payment: 'unpaid' })}><span>待收款</span><strong>${Math.max(0, workspace.stats.expected_amount - workspace.stats.collected_amount).toLocaleString()}</strong><small>{unpaidMembers} 人</small></button></div>
      <div className="collection-progress" aria-label={`收款進度 ${collectedRate}%`}><span style={{ width: `${collectedRate}%` }} /></div>
      <div className="payment-breakdown"><h3>付款方式</h3>{paymentStats.length ? paymentStats.map(([method, value]) => <div className="payment-row" key={method}><span>{labels[method] ?? method}{method === 'line_pay' ? '（Demo）' : ''}</span><div><i style={{ width: `${percent(value.amount, workspace.stats.collected_amount)}%` }} /></div><strong>${value.amount.toLocaleString()}</strong><small>{value.count} 人</small></div>) : <p className="muted">尚無已確認收款</p>}</div>
    </section>}

    <section className="dashboard-card plan-card">
      <header><div><p className="dashboard-kicker">活動配置</p><h2>方案與各時段人數</h2></div><span className="muted">點擊人數查看名單</span></header>
      <div className="plan-chart"><div className="plan-chart-head"><span>方案／時間</span><span>報名人數</span><span>已報到</span>{workspace.activity.finance_enabled && <span>已收</span>}</div>{planStats.map(({ plan, members, arrived, collected }) => <div className="plan-chart-row" key={plan.id}><div><strong>方案 {plan.code}</strong><small>{time(plan.start_at)}–{time(plan.end_at)}{workspace.activity.finance_enabled && ` · $${plan.amount ?? 0}`}</small></div><button onClick={() => onOpenMembers({ plan: plan.id })}><span><i style={{ width: `${percent(members, maxPlanMembers)}%` }} /></span><strong>{members} 人</strong></button><button onClick={() => onOpenMembers({ plan: plan.id, status: 'checked_in' })}>{arrived} 人</button>{workspace.activity.finance_enabled && <button onClick={() => onOpenMembers({ plan: plan.id, payment: 'paid' })}>${collected.toLocaleString()}</button>}</div>)}</div>
      {segments.length > 0 && <div className="time-distribution"><h3>各時段有效人數</h3><p className="muted">依方案有效時間計算</p>{segments.map((segment) => <div key={segment.start}><span>{time(segment.start)}–{time(segment.end)}</span><div><i style={{ width: `${percent(segment.count, maxSegmentMembers)}%` }} /></div><strong>{segment.count} 人</strong></div>)}</div>}
    </section>

    {(pendingCheckin > 0 || pendingPayment > 0) && <section className="dashboard-card attention-section"><header><div><p className="dashboard-kicker">需要處理</p><h2>待處理事項</h2></div></header>{pendingCheckin > 0 && <button onClick={() => onOpenMembers({ status: 'not_arrived', operational: 'pending_checkin' })}>尚未報到 <strong>{pendingCheckin} 人</strong></button>}{pendingPayment > 0 && <button onClick={() => onOpenMembers({ payment: 'unpaid', operational: 'pending_payment' })}>尚未付款 <strong>{pendingPayment} 人</strong></button>}</section>}
  </div>
}
