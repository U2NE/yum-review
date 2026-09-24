import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function SignupPage() {
  const { user, loading: authLoading, signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordAgain, setPasswordAgain] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState(false)

  if (!authLoading && user) return <Navigate to="/my-reviews" replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (password !== passwordAgain) {
      setError('비밀번호가 서로 달라요. 다시 확인해 주세요.')
      return
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError('비밀번호는 UTF-8 기준 72바이트 이내로 입력해 주세요.')
      return
    }
    setSubmitting(true)
    try {
      await signUp(email, password)
      setCreated(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '가입을 완료하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="auth-page" aria-labelledby="signup-title">
      <div className="auth-art signup-art" aria-hidden="true">
        <span className="auth-art-orbit" />
        <span className="auth-art-plate"><span>오늘<br />뭐 먹지?</span></span>
        <span className="auth-art-spark auth-spark-one">✳</span>
        <span className="auth-art-spark auth-spark-two">✦</span>
        <p>한 메뉴씩 쌓이는<br />나만의 맛 기록.</p>
      </div>
      <div className="auth-panel">
        {created ? (
          <div className="auth-success" role="status">
            <span className="auth-success-mark" aria-hidden="true">✓</span>
            <span className="eyebrow">가입이 완료됐어요</span>
            <h1 id="signup-title">한입 기록을<br />시작해 볼까요?</h1>
            <p className="auth-intro">이메일로 로그인하면 메뉴 리뷰를 남길 수 있어요.</p>
            <Link className="button button-dark auth-submit auth-link-button" to="/login">로그인하기 <span aria-hidden="true">↗</span></Link>
          </div>
        ) : (
          <>
            <span className="eyebrow">한 메뉴부터 차곡차곡</span>
            <h1 id="signup-title">한입 시작하기</h1>
            <p className="auth-intro">이메일 계정을 만들고 메뉴 리뷰를 기록해요.</p>
            <form className="auth-form" onSubmit={submit}>
              <label htmlFor="signup-email">이메일</label>
              <input id="signup-email" type="email" name="email" autoComplete="email" inputMode="email" maxLength={320} required value={email} onChange={(event) => setEmail(event.target.value)} />
              <label htmlFor="signup-password">비밀번호</label>
              <input id="signup-password" type="password" name="new-password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="password-hint" />
              <span className="auth-field-hint" id="password-hint">8자 이상, UTF-8 기준 72바이트 이내로 입력해 주세요.</span>
              <label htmlFor="signup-password-again">비밀번호 확인</label>
              <input id="signup-password-again" type="password" name="new-password-again" autoComplete="new-password" minLength={8} maxLength={72} required value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} />
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="button button-dark auth-submit" type="submit" disabled={submitting || authLoading}>
                {submitting ? '가입 중…' : '이메일로 가입하기'} <span aria-hidden="true">↗</span>
              </button>
            </form>
            <p className="auth-switch">이미 계정이 있으신가요? <Link to="/login">로그인</Link></p>
            <Link className="auth-back-link" to="/">메뉴 먼저 둘러보기</Link>
          </>
        )}
      </div>
    </section>
  )
}
