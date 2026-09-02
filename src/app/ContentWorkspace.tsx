import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MaterialIcon } from './MaterialIcon'

export type ContentTab = { id: string; label: string }

export function ContentNavigation({ backTo, context, tabs = [], activeTab, onTabChange, actions }: { backTo?: string; context: string; tabs?: ContentTab[]; activeTab?: string; onTabChange?: (id: string) => void; actions?: ReactNode }) {
  return <header className="content-navigation">
    <div className="content-navigation-context">{backTo && <Link to={backTo} aria-label={`返回${context}`}><MaterialIcon name="arrowBack" /></Link>}<strong>{context}</strong></div>
    <div className="content-navigation-end"><nav aria-label="內容導覽">{tabs.map((tab) => <button type="button" className={activeTab === tab.id ? 'active' : ''} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => onTabChange?.(tab.id)} key={tab.id}>{tab.label}</button>)}</nav>{actions && <div className="content-navigation-actions">{actions}</div>}</div>
  </header>
}

export function ContentSummary({ title, subtitle, status, meta, actions, children }: { title: string; subtitle?: ReactNode; status?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <><section className="content-summary"><header><div className="content-summary-main"><div className="content-summary-title"><h1>{title}</h1>{status}</div>{subtitle && <div className="content-summary-subtitle">{subtitle}</div>}{meta && <div className="content-summary-meta">{meta}</div>}</div>{actions && <div className="content-summary-actions">{actions}</div>}</header></section>{children}</>
}
