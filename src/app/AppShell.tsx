import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useActivityCenter } from '../features/activities/activityCenterApi'
import { useAuth } from '../features/auth/AuthProvider'
import { FeatherLogo } from './FeatherLogo'
import { MaterialIcon } from './MaterialIcon'

export function AppShell() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const activityCenter = useActivityCenter()
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1024px)').matches)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const organizationName = activityCenter.data?.organizationName ?? '我的球團'
  const accountName = activityCenter.data?.accountName ?? '帳號'
  const displayName = activityCenter.data?.displayName ?? '使用者'
  const recentActivities = activityCenter.data?.activities.filter((activity) => activity.status !== 'archived').slice(0, 4) ?? []
  const activityMatch = location.pathname.match(/^\/activities\/([^/]+)$/)
  const activeActivityId = activityMatch?.[1] && activityMatch[1] !== 'new' ? activityMatch[1] : null

  useEffect(() => { setMobileOpen(false); setAccountOpen(false) }, [location.pathname, location.search])

  async function handleSignOut() {
    await auth.signOut()
    navigate('/login', { replace: true })
  }

  return <div className={`shell-layout${collapsed ? ' shell-collapsed' : ''}${mobileOpen ? ' shell-mobile-open' : ''}`}>
    <button className="shell-scrim" aria-label="關閉選單" onClick={() => setMobileOpen(false)} />
    <aside className="global-sidebar" aria-label="主要導覽">
      <header className="sidebar-brand"><button type="button" aria-label={mobileOpen ? '關閉選單' : collapsed ? '展開選單' : '收合選單'} onClick={() => mobileOpen ? setMobileOpen(false) : setCollapsed((value) => !value)}><MaterialIcon name={collapsed ? 'panelClose' : 'panelOpen'} /></button><Link to="/activities" aria-label="羽點通首頁"><span className="sidebar-logo"><FeatherLogo /></span><strong className="sidebar-product-name">羽點通</strong></Link></header>

      <div className="sidebar-body">
        <section className="sidebar-club"><p>目前球團</p><Link className="club-identity" to="/activities"><span>{organizationName.slice(0, 1)}</span><strong>{organizationName}</strong></Link></section>
        <nav className="sidebar-primary-nav" aria-label="主要功能"><p>主要功能</p><NavLink end to="/activities"><MaterialIcon name="home" /><strong>球團首頁</strong></NavLink><NavLink to="/club-settings"><MaterialIcon name="settings" /><strong>球團設定</strong></NavLink><NavLink to="/activities/new"><MaterialIcon name="add" /><strong>建立活動</strong></NavLink></nav>
        <nav className="sidebar-activities" aria-label="近期活動"><p>近期活動</p>{recentActivities.map((activity) => <NavLink className={activeActivityId === activity.id ? 'active' : ''} to={`/activities/${activity.id}`} key={activity.id}><span>{activity.date.slice(0, 5)}</span><div><strong>{activity.title || activity.venue}</strong><small>{{ draft: '草稿', scheduled: '即將開始', in_progress: '進行中', ended: '已結束', archived: '已封存' }[activity.status]}</small></div></NavLink>)}</nav>
      </div>

      <footer className="sidebar-account"><button className="account-trigger" type="button" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}><span>{displayName.slice(0, 1)}</span><div><strong>{displayName}</strong><small>{auth.isGuest ? '訪客展示模式' : accountName}</small></div><MaterialIcon name="moreHoriz" /></button>{accountOpen && <div className="sidebar-account-menu"><Link to="/account-settings">帳號設定</Link><button type="button" onClick={handleSignOut}>{auth.isGuest ? '離開訪客模式' : '登出'}</button></div>}</footer>
    </aside>

    <header className="mobile-shell-bar"><button type="button" aria-label="開啟選單" onClick={() => setMobileOpen(true)}>☰</button><Link to="/activities"><strong>{activeActivityId ? recentActivities.find((activity) => activity.id === activeActivityId)?.venue ?? '活動管理' : organizationName}</strong></Link></header>
    <main className="shell-content"><Outlet /></main>
  </div>
}
