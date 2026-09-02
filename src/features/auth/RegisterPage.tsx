import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { appConfig } from '../../lib/config'
import { AuthLayout } from './AuthLayout'
import { registerAccount } from './authApi'

export function RegisterPage() {
  const navigate = useNavigate()
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
      const displayName = String(form.get('displayName')).trim()
      await registerAccount({
        username: String(form.get('username')),
        displayName,
        organizationName: `${displayName}的球團`,
        password: String(form.get('password')),
      })
      navigate('/activities')
    } catch {
      setError('無法建立帳號；請確認帳號名稱尚未使用，稍後再試。')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout
      eyebrow="開始使用"
      title="建立團主帳號"
      footer={<>已經有帳號？ <Link to="/login">返回登入</Link></>}
    >
      <form className="form-stack" onSubmit={handleSubmit}>
        <label><span className="field-label">暱稱<span className="required-mark" aria-hidden="true">*</span></span><input name="displayName" required minLength={2} maxLength={20} pattern="[A-Za-z0-9\u4E00-\u9FFF]{2,20}" placeholder="2–20 個中文字、英文字母或數字" /></label>
        <label><span className="field-label">帳號<span className="required-mark" aria-hidden="true">*</span></span><input name="username" required pattern="[A-Za-z0-9_]{4,20}" minLength={4} maxLength={20} autoComplete="username" placeholder="4–20 個字元，限英文、數字與底線" /></label>
        <label><span className="field-label">密碼<span className="required-mark" aria-hidden="true">*</span></span><input name="password" type="password" required minLength={8} maxLength={64} pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,64}" autoComplete="new-password" placeholder="8–64 個字元，至少一個英文字母與數字" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-width" type="submit" disabled={isSubmitting}>{isSubmitting ? '建立中…' : '建立帳號'}</button>
      </form>
    </AuthLayout>
  )
}
