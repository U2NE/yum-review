import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { changePassword } from '../api/auth'
import { useAuth } from '../auth/AuthContext'

export default function PasswordChangePage() {
  const { user, loading, refreshUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const requested = (location.state as { from?: string } | null)?.from
  const destination = user?.systemRole === 'SERVER_ADMIN'
    ? '/admin'
    : requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/'
  if (!loading && !user) return <Navigate to="/login" replace />
  if (!loading && user && !user.mustChangePassword) return <Navigate to={destination} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    if (new TextEncoder().encode(next).length < 12 || new TextEncoder().encode(next).length > 72) { setError('새 비밀번호는 UTF-8 기준 12~72바이트여야 해요.'); return }
    if (next !== again) { setError('새 비밀번호가 서로 달라요.'); return }
    setBusy(true)
    try {
      await changePassword(current, next)
      const updated = await refreshUser()
      const nextPage = updated?.systemRole === 'SERVER_ADMIN'
        ? '/admin'
        : requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/'
      navigate(nextPage, { replace: true })
    } catch (reason) { setError(reason instanceof Error ? reason.message : '비밀번호를 바꾸지 못했어요.') }
    finally { setBusy(false) }
  }

  return <section className="auth-page password-page"><div className="auth-panel password-panel">
    <span className="eyebrow">계정 보안</span><h1>비밀번호를<br />새로 설정해 주세요.</h1><p className="auth-intro">첫 로그인 뒤에는 임시 비밀번호 대신 새 비밀번호를 저장해야 서비스를 이용할 수 있어요.</p>
    <form className="auth-form" onSubmit={(event) => void submit(event)}><label htmlFor="current-password">현재 비밀번호</label><input id="current-password" type="password" autoComplete="current-password" maxLength={72} required value={current} onChange={(event) => setCurrent(event.target.value)} /><label htmlFor="new-password">새 비밀번호</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={next} onChange={(event) => setNext(event.target.value)} /><span className="auth-field-hint">12자 이상, UTF-8 기준 72바이트 이내</span><label htmlFor="new-password-again">새 비밀번호 확인</label><input id="new-password-again" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={again} onChange={(event) => setAgain(event.target.value)} />{error && <p role="alert" className="auth-error">{error}</p>}<button className="button button-dark auth-submit" disabled={busy}>{busy ? '저장 중…' : '새 비밀번호 저장'}</button></form>
    <Link className="auth-back-link" to="/">한입 홈</Link>
  </div></section>
}
