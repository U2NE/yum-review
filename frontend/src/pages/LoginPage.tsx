import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

function safeReturnPath(value: string | null): string {
  if (!value || value === 'review') return '/my-reviews'
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}

export default function LoginPage() {
  const { user, loading: authLoading, logIn } = useAuth()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const next = safeReturnPath(searchParams.get('next'))

  if (!authLoading && user) return <Navigate to={next} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (new TextEncoder().encode(password).length > 72) {
      setError('비밀번호를 확인해 주세요.')
      return
    }
    setSubmitting(true)
    try {
      const current = await logIn(email, password)
      const stateNext = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
      navigate(current?.mustChangePassword ? '/password-change' : stateNext?.startsWith('/') && !stateNext.startsWith('//') ? stateNext : next, { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '로그인하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="auth-page" aria-labelledby="login-title">
      <div className="auth-art" aria-hidden="true">
        <span className="auth-art-orbit" />
        <span className="auth-art-plate"><span>한입</span></span>
        <span className="auth-art-spark auth-spark-one">✳</span>
        <span className="auth-art-spark auth-spark-two">✦</span>
        <p>오늘의 한 끼,<br />다음 사람의 발견.</p>
      </div>
      <div className="auth-panel">
        <span className="eyebrow">다시 만나 반가워요</span>
        <h1 id="login-title">한입에 로그인</h1>
        <p className="auth-intro">먹어본 메뉴의 기록을 이어가 볼까요?</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="login-email">이메일</label>
          <input id="login-email" type="email" name="email" autoComplete="email" inputMode="email" maxLength={320} required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="login-password">비밀번호</label>
          <input id="login-password" type="password" name="password" autoComplete="current-password" maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button-dark auth-submit" type="submit" disabled={submitting || authLoading}>
            {submitting ? '로그인 중…' : '로그인'} <span aria-hidden="true">↗</span>
          </button>
        </form>
        <p className="auth-switch">아직 계정이 없으신가요? <Link to="/signup">이메일로 가입하기</Link></p>
        <Link className="auth-back-link" to="/">메뉴 먼저 둘러보기</Link>
      </div>
    </section>
  )
}
