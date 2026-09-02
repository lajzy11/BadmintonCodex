import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FeatherLogo } from '../../app/FeatherLogo'

type AuthLayoutProps = {
  eyebrow: string
  title: string
  footer: ReactNode
  children: ReactNode
}

export function AuthLayout({ eyebrow, title, footer, children }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <section className="auth-intro">
        <Link className="auth-brand" to="/activities">
          <span className="sidebar-logo"><FeatherLogo /></span>
          <strong>羽點通</strong>
        </Link>
        <div>
          <p className="eyebrow">羽球零打活動管理</p>
          <h2>少一點手忙腳亂，<br />多一點好球。</h2>
          <p>為零打團主設計的活動、收款與排點工作台。</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {children}
          <div className="auth-footer">{footer}</div>
        </div>
      </section>
    </main>
  )
}
