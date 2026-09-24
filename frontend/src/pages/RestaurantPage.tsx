import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getRestaurant } from '../api/catalog'
import { ApiError, type RestaurantDetail } from '../types'
import { MenuCardView } from './HomePage'

export default function RestaurantPage() {
  const { id = '' } = useParams()
  const [restaurant, setRestaurant] = useState<RestaurantDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    getRestaurant(id)
      .then((value) => { if (current) setRestaurant(value) })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof ApiError && reason.status === 404 ? '이 식당은 찾을 수 없어요.' : '식당 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [id])

  if (loading) return <PageState kind="loading" />
  if (error || !restaurant) return <PageState kind="error" message={error || '식당 정보를 찾을 수 없어요.'} />

  return (
    <>
      <div className="breadcrumb"><Link to="/">메뉴 둘러보기</Link><span>／</span><span>{restaurant.name}</span></div>
      <section className="restaurant-hero">
        <div className="restaurant-hero-copy"><span className="eyebrow"><span className="eyebrow-line" />식당 이야기</span><h1>{restaurant.name}</h1><p>{restaurant.description}</p><span className="restaurant-address"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.2" /></svg>{restaurant.address}</span></div>
        <div className="restaurant-hero-art" aria-hidden="true"><span className="restaurant-art-ring" /><span className="restaurant-art-number">MENU<br />COLLECTION</span><span className="restaurant-art-spark">✳</span><span className="restaurant-art-leaf" /></div>
        <span className="restaurant-demo-tag"><span className="demo-dot" /> 가상 식당</span>
      </section>

      <section className="restaurant-menu-section">
        <div className="section-heading catalog-heading"><div><span className="eyebrow">A TABLE OF ITS OWN</span><h2>이곳의 메뉴</h2><p>식당 점수 대신, 메뉴 하나하나를 살펴봐요.</p></div><span className="menu-total">메뉴 <b>{restaurant.menus.length}</b></span></div>
        {restaurant.menus.length ? <div className="menu-grid">{restaurant.menus.map((menu, index) => <MenuCardView key={menu.id} menu={menu} index={index} />)}</div>
          : <div className="state-panel empty-state"><span className="empty-plate">⌕</span><h3>아직 메뉴가 등록되지 않았어요.</h3><p>새로운 메뉴가 준비되면 이곳에서 소개할게요.</p></div>}
      </section>
      <div className="quiet-callout"><span>한입의 기준</span><p>같은 식당이어도 메뉴마다 다른 이야기.<br />평점은 메뉴별 리뷰를 바탕으로 계산해요.</p></div>
    </>
  )
}

export function PageState({ kind, message }: { kind: 'loading' | 'error'; message?: string }) {
  return <div className={`state-panel page-state ${kind === 'error' ? 'error-state' : 'loading-state'}`}>
    {kind === 'loading' ? <><span className="loader" /><p>정보를 불러오는 중이에요…</p></> : <><span className="state-icon">!</span><h3>{message ?? '정보를 불러오지 못했어요.'}</h3><p>잠시 후 다시 시도해 주세요.</p><Link className="button button-outline" to="/">메뉴 둘러보기</Link></>}
  </div>
}
