import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { assignOwner, listOwnerAssignments, revokeOwner, searchUsers, type OwnerAssignment, type UserOption } from '../api/admin'
import { discoverRestaurants } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { PageState } from './RestaurantPage'

type RestaurantOption = { id: number; name: string }

export default function AdminPage() {
  const { user, loading } = useAuth()
  const [restaurants, setRestaurants] = useState<RestaurantOption[]>([])
  const [owners, setOwners] = useState<OwnerAssignment[]>([])
  const [selectedRestaurant, setSelectedRestaurant] = useState<number | ''>('')
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserOption[]>([])
  const [selectedUser, setSelectedUser] = useState<number | ''>('')
  const [loadingPage, setLoadingPage] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const reload = useCallback(async () => {
    const [restaurantList, ownerList] = await Promise.all([discoverRestaurants(), listOwnerAssignments()])
    setRestaurants(restaurantList); setOwners(ownerList)
    setSelectedRestaurant((current) => current || restaurantList[0]?.id || '')
  }, [])

  useEffect(() => {
    if (loading || !user) return
    if (user.systemRole !== 'SERVER_ADMIN') { setLoadingPage(false); return }
    let active = true
    Promise.all([discoverRestaurants(), listOwnerAssignments()]).then(([restaurantList, ownerList]) => {
      if (!active) return
      setRestaurants(restaurantList); setOwners(ownerList); setSelectedRestaurant(restaurantList[0]?.id ?? '')
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '관리 정보를 불러오지 못했어요.') }).finally(() => { if (active) setLoadingPage(false) })
    return () => { active = false }
  }, [loading, user])

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('')
    if (query.trim().length < 3) { setError('이메일의 일부를 3자 이상 입력해 주세요.'); return }
    setBusy(true)
    try { const matches = await searchUsers(query.trim()); setUsers(matches); setSelectedUser(matches[0]?.userId ?? ''); if (!matches.length) setNotice('일치하는 가입 계정을 찾지 못했어요.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '계정을 찾지 못했어요.') }
    finally { setBusy(false) }
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedRestaurant || !selectedUser) { setError('가게와 가입 계정을 선택해 주세요.'); return }
    setBusy(true); setError(''); setNotice('')
    try { const result = await assignOwner(Number(selectedRestaurant), Number(selectedUser)); setNotice(`${result.email} 계정에 업주 권한을 연결했어요.`); await reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '업주 권한을 연결하지 못했어요.') }
    finally { setBusy(false) }
  }

  async function revoke(row: OwnerAssignment) {
    setBusy(true); setError(''); setNotice('')
    try { const result = await revokeOwner(row.restaurantId, row.userId); setNotice(result.message); await reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '업주 권한을 해제하지 못했어요.') }
    finally { setBusy(false) }
  }

  if (loading || loadingPage) return <PageState kind="loading" />
  if (!user) return <Navigate to="/login?next=%2Fadmin" replace />
  if (user.systemRole !== 'SERVER_ADMIN') return <PageState kind="error" message="서버 관리자만 볼 수 있는 화면이에요." />

  return <section className="admin-page"><header className="admin-page-heading"><span className="eyebrow">서버 관리</span><h1>가게와 권한을<br />한곳에서 관리합니다.</h1><p>서버 관리자 계정은 모든 메뉴를 수정하고, 리뷰를 관리할 수 있어요.</p></header>
    {error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="catalog-notice" role="status">{notice}</p>}
    <div className="admin-grid"><section className="admin-panel"><span className="eyebrow">업주 권한</span><h2>가게 담당자 연결</h2><p>가입한 사용자를 검색한 뒤 관리할 가게에 연결합니다.</p>
      <form className="admin-search-form" onSubmit={(event) => void search(event)}><label htmlFor="owner-user-search">사용자 이메일 검색</label><div><input id="owner-user-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이메일 일부 3자 이상" /><button className="button button-outline" type="submit" disabled={busy}>찾기</button></div></form>
      {users.length > 0 && <form className="admin-assign-form" onSubmit={(event) => void assign(event)}><label htmlFor="owner-user-select">가입 계정</label><select id="owner-user-select" value={selectedUser} onChange={(event) => setSelectedUser(Number(event.target.value))}>{users.map((result) => <option value={result.userId} key={result.userId}>{result.email}</option>)}</select><label htmlFor="owner-restaurant-select">담당 가게</label><select id="owner-restaurant-select" value={selectedRestaurant} onChange={(event) => setSelectedRestaurant(Number(event.target.value))}>{restaurants.map((restaurant) => <option value={restaurant.id} key={restaurant.id}>{restaurant.name}</option>)}</select><button className="button button-dark" disabled={busy || !restaurants.length}>업주 권한 연결</button></form>}
      {!restaurants.length && <p className="admin-empty">먼저 식당과 메뉴를 등록해야 담당자를 연결할 수 있어요.</p>}
    </section>
    <section className="admin-panel"><span className="eyebrow">현재 연결</span><h2>업주 목록</h2><p>업주 권한을 해제해도 리뷰와 계정은 유지됩니다.</p>{owners.length ? <div className="owner-assignment-list">{owners.map((row) => <article key={`${row.userId}-${row.restaurantId}`}><div><strong>{restaurants.find((restaurant) => restaurant.id === row.restaurantId)?.name ?? `가게 ${row.restaurantId}`}</strong><span>{row.email}</span></div><button className="text-button review-delete-link" type="button" disabled={busy} onClick={() => void revoke(row)}>권한 해제</button></article>)}</div> : <p className="admin-empty">아직 연결된 업주가 없습니다.</p>}</section></div>
    <section className="admin-restaurants"><div className="catalog-toolbar"><div><span className="eyebrow">전체 매장</span><h2>메뉴 관리</h2></div></div>{restaurants.length ? <div className="restaurant-admin-links">{restaurants.map((restaurant) => <Link key={restaurant.id} to={`/restaurants/${restaurant.id}`}><span>{restaurant.name}</span><small>메뉴 관리 열기 ↗</small></Link>)}</div> : <p className="admin-empty">공개된 식당이 아직 없어요.</p>}</section>
  </section>
}
