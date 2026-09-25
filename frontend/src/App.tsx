import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import RestaurantPage from './pages/RestaurantPage'
import MenuPage from './pages/MenuPage'
import MyReviewsPage from './pages/MyReviewsPage'
import SignupPage from './pages/SignupPage'
import AdminPage from './pages/AdminPage'
import PasswordChangePage from './pages/PasswordChangePage'

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
}

export default function App() {
  return <AuthProvider><AppContent /></AuthProvider>
}

function AppContent() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, loading: authLoading, logOut } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [authNotice, setAuthNotice] = useState('')

  async function signOut() {
    setAuthNotice('')
    try {
      await logOut()
      navigate('/', { replace: true })
    } catch {
      setAuthNotice('로그아웃 요청을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" to="/" aria-label="한입 홈" onClick={() => setMobileMenuOpen(false)}>
            <BrandMark /><span>한입</span>
          </Link>
          <button className="mobile-menu-button" aria-expanded={mobileMenuOpen} aria-label="메뉴 열기" onClick={() => setMobileMenuOpen((open) => !open)}>
            <span /><span />
          </button>
          <nav className={`main-nav ${mobileMenuOpen ? 'is-open' : ''}`} aria-label="주 메뉴">
            <Link className={location.pathname === '/' ? 'active' : ''} to="/" onClick={() => setMobileMenuOpen(false)}>메뉴 둘러보기</Link>
            <a href="/" onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); document.getElementById('about-yum-review')?.scrollIntoView({ behavior: 'smooth' }) }}>기록 기준</a>
            <Link className="mobile-account-nav" to={user ? '/my-reviews' : '/login?next=review'} onClick={() => setMobileMenuOpen(false)}>{user ? '내 리뷰' : '로그인하고 리뷰 쓰기'}</Link>
            {user?.systemRole === 'SERVER_ADMIN' && <Link className="mobile-account-nav" to="/admin" onClick={() => setMobileMenuOpen(false)}>서버 관리</Link>}
            {user?.ownerRestaurantIds.map((restaurantId) => <Link className="mobile-account-nav" key={`mobile-${restaurantId}`} to={`/restaurants/${restaurantId}`} onClick={() => setMobileMenuOpen(false)}>내 가게 관리</Link>)}
          </nav>
          <div className="header-actions">
            {user ? (
              <>
                <Link className="account-nav-link" to="/my-reviews" onClick={() => setMobileMenuOpen(false)}>내 리뷰</Link>
                {user.systemRole === 'SERVER_ADMIN' && <Link className="account-nav-link" to="/admin" onClick={() => setMobileMenuOpen(false)}>관리</Link>}
                {user.ownerRestaurantIds.slice(0, 1).map((restaurantId) => <Link className="account-nav-link" key={restaurantId} to={`/restaurants/${restaurantId}`}>내 가게</Link>)}
                <span className="account-email" title={user.email}>{user.email}</span>
                <button className="account-action" type="button" onClick={signOut}>로그아웃</button>
              </>
            ) : (
              <>
                <Link className="account-action account-login" to="/login">{authLoading ? '계정 확인 중' : '로그인'}</Link>
                <Link className="avatar-button account-signup" to="/signup" aria-label="회원가입">가입</Link>
              </>
            )}
          </div>
        </div>
        {authNotice && <p className="header-notice" role="status">{authNotice}</p>}
      </header>

      <main className="page-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/restaurants/:id" element={<RestaurantPage />} />
          <Route path="/menus/:id" element={<MenuPage />} />
          <Route path="/my-reviews" element={<MyReviewsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/password-change" element={<PasswordChangePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer id="about-yum-review" className="site-footer">
        <div className="footer-inner">
          <Link className="brand footer-brand" to="/"><BrandMark /><span>한입</span></Link>
          <p>식당이 아니라, 먹어본 메뉴를 기록해요.</p>
          <span className="footer-note">확인된 정보만 싣고, 모르는 가격과 사진은 비워둡니다.</span>
        </div>
      </footer>
    </div>
  )
}

function NotFound() {
  return <section className="not-found"><span className="eyebrow">페이지를 찾을 수 없어요</span><h1>길을 잠깐<br />잃었나 봐요.</h1><Link className="button button-dark" to="/">홈으로 돌아가기</Link></section>
}
