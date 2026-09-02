import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { MaterialIcon } from './MaterialIcon'
import { FeedbackContext, type FeedbackTone, type ToastInput } from './feedbackContext'
type ToastItem = Required<ToastInput> & { id: number }

let toastId = 0

const iconNames = { info: 'info', success: 'checkCircle', warning: 'warning', error: 'error' } as const

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: number) => setToasts((items) => items.filter((item) => item.id !== id)), [])
  const notify = useCallback((input: ToastInput | string) => {
    const value = typeof input === 'string' ? { message: input } : input
    const tone = value.tone ?? 'success'
    const duration = value.duration ?? (tone === 'error' ? 7000 : 3500)
    const id = ++toastId
    setToasts((items) => [...items.filter((item) => item.message !== value.message), { id, message: value.message, tone, duration }].slice(-3))
    window.setTimeout(() => dismiss(id), duration)
  }, [dismiss])
  const context = useMemo(() => ({ notify }), [notify])

  return <FeedbackContext.Provider value={context}>{children}<div className="toast-region" aria-live="polite" aria-atomic="false">{toasts.map((toast) => <div className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'} key={toast.id}><MaterialIcon name={iconNames[toast.tone]} /><span>{toast.message}</span><button type="button" aria-label="關閉通知" onClick={() => dismiss(toast.id)}><MaterialIcon name="close" /></button></div>)}</div></FeedbackContext.Provider>
}

export function AlertBanner({ tone = 'info', title, children, action }: { tone?: FeedbackTone; title: string; children?: ReactNode; action?: ReactNode }) {
  return <section className={`alert-banner alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><MaterialIcon name={iconNames[tone]} /><div><strong>{title}</strong>{children && <div>{children}</div>}</div>{action && <div className="alert-banner-action">{action}</div>}</section>
}

export function ConfirmDialog({ title, children, confirmLabel, tone = 'danger', pending = false, onCancel, onConfirm }: { title: string; children: ReactNode; confirmLabel: string; tone?: 'danger' | 'primary'; pending?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="panel-backdrop" role="presentation"><section className="confirm-dialog feedback-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="feedback-confirm-title"><header><span className={`confirm-dialog-icon ${tone}`}><MaterialIcon name={tone === 'danger' ? 'warning' : 'info'} /></span><div><h2 id="feedback-confirm-title">{title}</h2><div>{children}</div></div></header><footer><button type="button" className="secondary-button" onClick={onCancel} disabled={pending}>返回</button><button type="button" className={tone === 'danger' ? 'danger-button' : 'primary-button'} onClick={onConfirm} disabled={pending}>{pending ? '處理中…' : confirmLabel}</button></footer></section></div>
}
