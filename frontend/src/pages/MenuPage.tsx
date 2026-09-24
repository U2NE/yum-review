import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getMenu, getMenuReviews } from '../api/catalog'
import { createReview, deleteReview, getMyReviews, reviewErrorMessage, updateReview, type MyReview, type ReviewInput } from '../api/reviews'
import ReviewForm from '../components/ReviewForm'
import { useAuth } from '../auth/AuthContext'
import { ApiError, type MenuDetail, type PublicReview } from '../types'
import { formatPrice } from '../utils/format'
import { DishIllustration, Rating } from './HomePage'
import { PageState } from './RestaurantPage'

const scoreLabels = [
  { key: 'tasteScore', label: '맛' },
  { key: 'valueScore', label: '가성비' },
  { key: 'portionScore', label: '양' },
] as const

export default function MenuPage() {
  const { id = '' } = useParams()
  const { user, loading: authLoading, refreshUser } = useAuth()
  const [menu, setMenu] = useState<MenuDetail | null>(null)
  const [reviews, setReviews] = useState<PublicReview[]>([])
  const [myReview, setMyReview] = useState<MyReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [editor, setEditor] = useState<'new' | number | null>(null)
  const [deletePrompt, setDeletePrompt] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  const refreshMenuData = useCallback(async () => {
    const [menuValue, reviewValue] = await Promise.all([getMenu(id), getMenuReviews(id)])
    setMenu(menuValue)
    setReviews(reviewValue)
    if (user) {
      try {
        const myReviews = await getMyReviews()
        setMyReview(myReviews.find((review) => review.menuId === menuValue.id) ?? null)
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) {
          setMyReview(null)
          setNotice('로그인 상태가 만료됐어요. 다시 로그인하면 내 리뷰를 관리할 수 있어요.')
          void refreshUser()
        } else {
          setNotice('공개 리뷰는 갱신했지만 내 리뷰 상태를 확인하지 못했어요. 내 리뷰 화면에서 다시 확인해 주세요.')
        }
      }
    } else {
      setMyReview(null)
    }
  }, [id, refreshUser, user])

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    setNotice('')
    Promise.all([getMenu(id), getMenuReviews(id)])
      .then(async ([menuValue, reviewValue]) => {
        if (!current) return
        setMenu(menuValue)
        setReviews(reviewValue)
        if (user) {
          try {
            const myReviews = await getMyReviews()
            if (current) setMyReview(myReviews.find((review) => review.menuId === menuValue.id) ?? null)
          } catch (reason) {
            if (!current) return
            if (reason instanceof ApiError && reason.status === 401) {
              setMyReview(null)
              setNotice('로그인 상태가 만료됐어요. 다시 로그인해 주세요.')
              void refreshUser()
            } else {
              setNotice('내 리뷰 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
            }
          }
        } else {
          setMyReview(null)
        }
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof ApiError && reason.status === 404 ? '이 메뉴는 찾을 수 없어요.' : '메뉴 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [id, refreshUser, user])

  async function saveReview(input: ReviewInput) {
    setReviewError('')
    if (editor === 'new') await createReview(id, input)
    else if (typeof editor === 'number') await updateReview(editor, input)
    else return

    setEditor(null)
    setNotice('리뷰를 저장했어요. 메뉴의 평균과 리뷰 수도 최신 상태예요.')
    try {
      await refreshMenuData()
    } catch {
      setNotice('리뷰는 저장했지만 최신 목록을 불러오지 못했어요. 페이지를 새로고침해 주세요.')
    }
  }

  async function removeReview(reviewId: number) {
    setDeleting(true)
    setReviewError('')
    try {
      await deleteReview(reviewId)
      setDeletePrompt(null)
      setEditor(null)
      setNotice('리뷰를 삭제했어요. 메뉴의 평균과 리뷰 수를 갱신했어요.')
      try {
        await refreshMenuData()
      } catch {
        setNotice('리뷰는 삭제했지만 최신 목록을 불러오지 못했어요. 페이지를 새로고침해 주세요.')
      }
    } catch (reason) {
      setReviewError(reviewErrorMessage(reason))
      if (reason instanceof ApiError && reason.status === 401) void refreshUser()
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <PageState kind="loading" />
  if (error || !menu) return <PageState kind="error" message={error || '메뉴 정보를 찾을 수 없어요.'} />

  const loginPath = `/login?next=${encodeURIComponent(`/menus/${id}`)}`
  const ownReviewId = myReview?.id

  return (
    <>
      <div className="breadcrumb"><Link to="/">메뉴 둘러보기</Link><span>／</span><Link to={`/restaurants/${menu.restaurantId}`}>{menu.restaurantName}</Link><span>／</span><span>{menu.name}</span></div>
      <section className="menu-detail-hero">
        <div className="detail-art-wrap"><DishIllustration variant={menu.id % 4} /><span className="artwork-label">한입 메뉴 카드 <span>✳</span></span></div>
        <div className="menu-detail-copy">
          <Link className="restaurant-link" to={`/restaurants/${menu.restaurantId}`}>{menu.restaurantName}<span aria-hidden="true">↗</span></Link>
          <span className="eyebrow">ONE DISH, MANY STORIES</span>
          <h1>{menu.name}</h1>
          <p className="menu-detail-description">{menu.description}</p>
          <div className="detail-price-row"><span className="menu-price">{formatPrice(menu.priceKrw)}</span><span className="price-separator">·</span><span className="restaurant-address compact-address">{menu.restaurantAddress}</span></div>
          <div className="overall-rating-card"><Rating value={menu.overallAverage} count={menu.reviewCount} /><span>{menu.reviewCount ? '이 메뉴를 먹어본 사람들의 평균이에요.' : '아직 평가가 없어요. 첫 리뷰를 기다리고 있어요.'}</span></div>
          {user ? (
            <button className="button button-dark review-cta" type="button" disabled={authLoading} onClick={() => { setReviewError(''); setEditor(ownReviewId ?? 'new') }}>
              {ownReviewId ? '내 리뷰 수정하기' : '이 메뉴 리뷰 남기기'} <span aria-hidden="true">↗</span>
            </button>
          ) : (
            <Link to={loginPath} className="button button-dark review-cta">이 메뉴 리뷰 남기기 <span aria-hidden="true">↗</span></Link>
          )}
          <small className="demo-note">별점과 리뷰는 메뉴 단위로만 모아요.</small>
        </div>
      </section>

      <section className="detail-scores" aria-labelledby="score-heading">
        <div className="scores-intro"><span className="eyebrow">THE LITTLE DETAILS</span><h2 id="score-heading">어떤 점이 궁금한가요?</h2><p>한입은 네 가지 기준으로 메뉴를 살펴봐요.</p></div>
        <div className="score-grid">
          <ScoreTile label="전체" value={menu.overallAverage} description="한 접시의 만족도" featured />
          {scoreLabels.map((item) => <ScoreTile key={item.key} label={item.label} value={menu[item.key === 'tasteScore' ? 'tasteAverage' : item.key === 'valueScore' ? 'valueAverage' : 'portionAverage']} description={item.label === '가성비' ? '가격만큼 만족스러운지' : `${item.label}은 어땠는지`} />)}
        </div>
      </section>

      <section className="reviews-section" aria-labelledby="reviews-heading">
        <div className="section-heading catalog-heading"><div><span className="eyebrow">NOTES FROM THE TABLE</span><h2 id="reviews-heading">먹어본 사람들의 한마디</h2><p>메뉴에 남긴 솔직한 기록이에요.</p></div><span className="menu-total">리뷰 <b>{reviews.length}</b></span></div>
        {notice && <p className="review-notice" role="status">{notice}</p>}
        {reviewError && <p className="review-form-error review-page-error" role="alert">{reviewError}</p>}
        {editor === 'new' && <ReviewForm onSubmit={saveReview} onCancel={() => setEditor(null)} />}
        {reviews.length ? <div className="review-list">{reviews.map((review) => (
          <div className="review-entry" key={review.id}>
            <ReviewCard review={review} />
            {review.id === ownReviewId && <div className="review-owner-actions">
              <button type="button" className="text-button" onClick={() => { setReviewError(''); setEditor(review.id) }}>내 리뷰 수정</button>
              <button type="button" className="text-button review-delete-link" onClick={() => setDeletePrompt(deletePrompt === review.id ? null : review.id)}>삭제</button>
            </div>}
            {editor === review.id && <ReviewForm initialValue={myReview ?? undefined} onSubmit={saveReview} onCancel={() => setEditor(null)} />}
            {deletePrompt === review.id && <div className="delete-review-confirm" role="group" aria-label="리뷰 삭제 확인"><span>이 리뷰를 삭제할까요? 별점 평균과 리뷰 수가 다시 계산돼요.</span><button type="button" className="button button-outline" onClick={() => setDeletePrompt(null)} disabled={deleting}>취소</button><button type="button" className="button button-dark" onClick={() => void removeReview(review.id)} disabled={deleting}>{deleting ? '삭제 중…' : '삭제하기'}</button></div>}
          </div>
        ))}</div>
          : <div className="state-panel empty-review-state"><span className="review-quote-mark">“</span><h3>아직 첫 리뷰를 기다리고 있어요.</h3><p>이 메뉴를 먹어봤다면, 다른 사람의 다음 한 끼를 도와주세요.</p>{user ? <button type="button" className="text-button" onClick={() => setEditor('new')}>첫 리뷰 남기기 <span aria-hidden="true">↗</span></button> : <Link to={loginPath} className="text-button">로그인하고 첫 리뷰 남기기 <span aria-hidden="true">↗</span></Link>}</div>}
      </section>
    </>
  )
}

function ScoreTile({ label, value, description, featured = false }: { label: string; value: number | null; description: string; featured?: boolean }) {
  return <div className={`score-tile ${featured ? 'score-featured' : ''}`}><span className="score-label">{label}{featured && <span className="score-star">★</span>}</span><strong>{value === null ? '—' : value.toFixed(1)}</strong><span className="score-scale">{value === null ? '평가 전' : '5점 만점'}</span><p>{description}</p></div>
}

function ReviewCard({ review }: { review: PublicReview }) {
  const date = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(review.createdAt))
  return <article className="review-card"><div className="review-card-head"><span className="review-avatar" aria-hidden="true">{review.authorLabel.slice(0, 1) || '한'}</span><div className="review-author"><strong>{review.authorLabel}</strong><span>{date}</span></div><Rating value={review.overallScore} /></div><div className="review-scores">{scoreLabels.map(({ key, label }) => <span key={key}>{label}<b>{review[key]}</b></span>)}</div>{review.comment && <p className="review-comment">{review.comment}</p>}</article>
}
