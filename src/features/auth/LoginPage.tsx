import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { appConfig } from '../../lib/config'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthProvider'
import { loginWithUsername } from './authApi'

export function LoginPage() {
  const navigate = useNavigate()
  const auth = useAuth()
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    if (appConfig.isDemo) {
      navigate('/activities')
      return
    }
    setIsSubmitting(true)
    try {
      await loginWithUsername(String(form.get('username')), String(form.get('password')))
      navigate('/activities')
    } catch {
      setError('帳號或密碼錯誤，請再試一次。')
    } finally {
      setIsSubmitting(false)
    }
  }

  function enterGuestMode() {
    auth.enterGuestMode()
    navigate('/activities')
  }

  return (
    <AuthLayout
      eyebrow="歡迎回來"
      title="登入團主帳號"
      footer={<>還沒有帳號？ <Link to="/register">建立帳號</Link></>}
    >
      <form className="form-stack" onSubmit={handleSubmit}>
        <label>
          <span className="field-label">帳號<span className="required-mark" aria-hidden="true">*</span></span>
          <input name="username" autoComplete="username" required pattern="[A-Za-z0-9_]{4,30}" minLength={4} maxLength={30} placeholder="輸入帳號名稱" />
        </label>
        <label>
          <span className="field-label">密碼<span className="required-mark" aria-hidden="true">*</span></span>
          <input name="password" type="password" autoComplete="current-password" required minLength={8} maxLength={64} placeholder="輸入密碼" />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-width" type="submit" disabled={isSubmitting}>{isSubmitting ? '登入中…' : '登入'}</button>
        <div className="auth-separator"><span>或</span></div>
        <button className="secondary-button full-width guest-entry-button" type="button" onClick={enterGuestMode}>以訪客身分體驗</button>
      </form>
    </AuthLayout>
  )
}
