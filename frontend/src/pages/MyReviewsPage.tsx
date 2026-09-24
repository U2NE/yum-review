import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { getMenu, getMenuReviews } from '../api/catalog'
import { deleteReview, getMyReviews, reviewErrorMessage, updateReview, type MyReview, type ReviewInput } from '../api/reviews'
import ReviewForm from '../components/ReviewForm'
import { ApiError } from '../types'
import { PageState } from './RestaurantPage'

export default function MyReviewsPage() {
  const { user, loading: authLoading, refreshUser } = useAuth()
  const [reviews, setReviews] = useState<MyReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deletePrompt, setDeletePrompt] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const reload = useCallback(async () => {
    const values = await getMyReviews()
    setReviews(values)
  }, [])

  useEffect(() => {
    let current = true
    if (authLoading) return () => { current = false }
    if (!user) {
      setReviews([])
      setLoading(false)
      setError('')
      return () => { current = false }
    }
    setLoading(true)
    setError('')
    getMyReviews()
      .then((values) => { if (current) setReviews(values) })
      .catch((reason: unknown) => {
        if (!current) return
        if (reason instanceof ApiError && reason.status === 401) {
          setError('로그인 상태가 만료됐어요. 다시 로그인해 주세요.')
          void refreshUser()
        } else {
          setError(reviewErrorMessage(reason))
        }
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [authLoading, refreshUser, user])

  async function saveReview(reviewId: number, input: ReviewInput) {
    setNotice('')
    const updated = await updateReview(reviewId, input)
    setEditingId(null)
    setReviews((current) => current.map((review) => review.id === reviewId ? { ...review, ...updated } : review))
    await refreshAfterMutation(updated.menuId, '수정')
  }

  async function removeReview(reviewId: number) {
    setDeletingId(reviewId)
    setError('')
    try {
      await deleteReview(reviewId)
      const affectedReview = reviews.find((review) => review.id === reviewId)
      setDeletePrompt(null)
      setEditingId(null)
      setReviews((current) => current.filter((review) => review.id !== reviewId))
      if (affectedReview) await refreshAfterMutation(affectedReview.menuId, '삭제')
      else setNotice('리뷰를 삭제했어요.')
    } catch (reason) {
      setError(reviewErrorMessage(reason))
      if (reason instanceof ApiError && reason.status === 401) void refreshUser()
    } finally {
      setDeletingId(null)
    }
  }

  async function refreshAfterMutation(menuId: number, action: '수정' | '삭제') {
    const [catalogRefresh, listRefresh] = await Promise.allSettled([
      Promise.all([getMenu(menuId), getMenuReviews(menuId)]),
      reload(),
    ])
    const catalogReady = catalogRefresh.status === 'fulfilled'
    const listReady = listRefresh.status === 'fulfilled'
    if (catalogRefresh.status === 'rejected') setNotice(`리뷰는 ${action}했지만 메뉴 평균과 리뷰 목록을 갱신하지 못했어요. 메뉴 화면을 새로고침해 주세요.`)
    else if (!listReady) setNotice(`리뷰는 ${action}했지만 내 리뷰 목록을 갱신하지 못했어요. 새로고침해 주세요.`)
    else setNotice(`리뷰를 ${action}했어요.${catalogReady ? ' 메뉴 평균과 리뷰 수도 최신 상태예요.' : ''}`)
  }

  if (authLoading || loading) return <PageState kind="loading" />
  if (!user) {
    return <Navigate to="/login?next=%2Fmy-reviews" replace />
  }

  return (
    <section className="my-reviews-page" aria-labelledby="my-reviews-title">
      <div className="my-reviews-heading"><span className="eyebrow">YOUR TASTE JOURNAL</span><h1 id="my-reviews-title">내가 남긴 한입 기록</h1><p>메뉴마다 하나의 리뷰를 남기고, 언제든 다시 다듬을 수 있어요.</p></div>
      {notice && <p className="review-notice" role="status">{notice}</p>}
      {error && <p className="review-form-error review-page-error" role="alert">{error}</p>}
      {reviews.length ? <div className="my-review-list">{reviews.map((review) => (
        <article className="my-review-card" key={review.id}>
          <div className="my-review-topline"><span className="eyebrow">{review.restaurantName}</span><time dateTime={review.updatedAt}>{formatReviewDate(review.updatedAt)}</time></div>
          <div className="my-review-title-row"><div><h2>{review.menuName}</h2><span className="my-review-scores">전체 <b>{review.overallScore}</b><i>·</i> 맛 <b>{review.tasteScore}</b><i>·</i> 가성비 <b>{review.valueScore}</b><i>·</i> 양 <b>{review.portionScore}</b></span></div><Link className="text-button my-review-menu-link" to={`/menus/${review.menuId}`}>메뉴 보기 <span aria-hidden="true">↗</span></Link></div>
          {review.comment ? <p className="my-review-comment">{review.comment}</p> : <p className="my-review-no-comment">아직 코멘트를 남기지 않았어요.</p>}
          <div className="my-review-actions"><button className="text-button" type="button" onClick={() => { setError(''); setEditingId(editingId === review.id ? null : review.id) }}>{editingId === review.id ? '수정 닫기' : '수정하기'}</button><button className="text-button review-delete-link" type="button" onClick={() => setDeletePrompt(deletePrompt === review.id ? null : review.id)}>삭제하기</button></div>
          {editingId === review.id && <ReviewForm initialValue={review} onSubmit={(input) => saveReview(review.id, input)} onCancel={() => setEditingId(null)} />}
          {deletePrompt === review.id && <div className="delete-review-confirm" role="group" aria-label={`${review.menuName} 리뷰 삭제 확인`}><span>이 리뷰를 삭제할까요? 메뉴 상세의 평균과 리뷰 수가 다시 계산돼요.</span><button type="button" className="button button-outline" onClick={() => setDeletePrompt(null)} disabled={deletingId === review.id}>취소</button><button type="button" className="button button-dark" onClick={() => void removeReview(review.id)} disabled={deletingId === review.id}>{deletingId === review.id ? '삭제 중…' : '삭제하기'}</button></div>}
        </article>
      ))}</div> : <div className="state-panel my-review-empty"><span className="empty-plate">✳</span><h3>아직 남긴 리뷰가 없어요.</h3><p>먹어본 메뉴를 하나 골라 첫 기록을 시작해 보세요.</p><Link className="button button-dark" to="/">메뉴 둘러보기 <span aria-hidden="true">↗</span></Link></div>}
    </section>
  )
}

function formatReviewDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value))
}
