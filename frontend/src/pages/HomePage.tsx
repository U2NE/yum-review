import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { searchMenus, type MenuSort } from '../api/catalog'
import { ApiError, type MenuCard } from '../types'
import { formatPrice } from '../utils/format'

const suggestions = ['구름버섯 덮밥', '떡볶이', '달빛면관']

export default function HomePage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const sort = (params.get('sort') === 'rating' ? 'rating' : 'popular') as MenuSort
  const [draft, setDraft] = useState(query)
  const [menus, setMenus] = useState<MenuCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => setDraft(query), [query])
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    searchMenus(query, sort)
      .then((result) => { if (current) setMenus(result) })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof ApiError ? reason.message : '메뉴를 불러오지 못했어요.')
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [query, sort, reloadKey])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = new URLSearchParams(params)
    if (draft.trim()) next.set('q', draft.trim())
    else next.delete('q')
    setParams(next)
  }

  function chooseSuggestion(value: string) {
    setDraft(value)
    const next = new URLSearchParams(params)
    next.set('q', value)
    setParams(next)
  }

  function changeSort(value: MenuSort) {
    const next = new URLSearchParams(params)
    if (value === 'popular') next.delete('sort')
    else next.set('sort', value)
    setParams(next)
  }

  function clearSearch() {
    setDraft('')
    const next = new URLSearchParams(params)
    next.delete('q')
    setParams(next)
  }

  return (
    <>
      <section className="home-hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-line" />오늘의 한입</span>
          <h1>식당 말고,<br /><em>메뉴</em>를 리뷰해요.</h1>
          <p>어디서 먹었는지보다, 무엇을 먹었는지.<br className="desktop-break" /> 다음 한 끼를 고르는 작은 힌트를 모아요.</p>
          <div className="hero-footnote"><span className="sparkle">✳</span> 지금은 메뉴 리뷰를 차곡차곡 모으는 중</div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-art-note note-top"><span>오늘의 추천</span><b>한 메뉴에 집중</b></div>
          <div className="plate plate-back" />
          <div className="plate plate-front">
            <div className="plate-rim" />
            <div className="dish-rice" />
            <div className="dish-mushroom mushroom-one" />
            <div className="dish-mushroom mushroom-two" />
            <div className="dish-leaf leaf-one" />
            <div className="dish-leaf leaf-two" />
            <div className="dish-sauce" />
          </div>
          <div className="hero-art-note note-bottom"><span>작은 기준들</span><b>맛 · 가성비 · 양</b></div>
          <span className="art-star art-star-one">✳</span><span className="art-star art-star-two">✦</span>
        </div>
      </section>

      <section className="search-section" aria-labelledby="search-heading">
        <div className="search-heading-row">
          <div><span className="eyebrow">FIND YOUR NEXT BITE</span><h2 id="search-heading">지금 당기는 메뉴가 있나요?</h2></div>
          <span className="search-side-note">메뉴명이나 식당 이름으로 찾아보세요</span>
        </div>
        <form className="search-box" onSubmit={submitSearch} role="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.7" /><path d="m16 16 4.5 4.5" /></svg>
          <label className="sr-only" htmlFor="menu-search">메뉴 또는 식당 검색</label>
          <input id="menu-search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="예: 들깨칼국수, 온기…" />
          {draft && <button className="clear-search" type="button" aria-label="검색어 지우기" onClick={clearSearch}>×</button>}
          <button className="button button-dark search-submit" type="submit">찾아보기 <span aria-hidden="true">↗</span></button>
        </form>
        <div className="suggestion-row"><span>요즘 궁금한 메뉴</span>{suggestions.map((item) => <button key={item} type="button" className="suggestion-chip" onClick={() => chooseSuggestion(item)}>{item}<span aria-hidden="true">↗</span></button>)}</div>
      </section>

      <section className="catalog-section" aria-labelledby="catalog-heading">
        <div className="section-heading catalog-heading">
          <div><span className="eyebrow">THE MENU EDIT</span><h2 id="catalog-heading">한입이 모은 메뉴</h2><p>{query ? <><b>“{query}”</b> 검색 결과</> : '한 메뉴씩 살펴보고, 다음 한 끼를 골라보세요.'}</p></div>
          <div className="sort-control" role="group" aria-label="메뉴 정렬">
            <button type="button" className={sort === 'popular' ? 'selected' : ''} aria-pressed={sort === 'popular'} onClick={() => changeSort('popular')}>추천순</button>
            <button type="button" className={sort === 'rating' ? 'selected' : ''} aria-pressed={sort === 'rating'} onClick={() => changeSort('rating')}>평점순</button>
          </div>
        </div>

        {loading ? <div className="state-panel loading-state"><span className="loader" /><p>메뉴를 천천히 살펴보는 중이에요…</p></div>
            : error ? <div className="state-panel error-state"><span className="state-icon">!</span><h3>메뉴를 불러오지 못했어요</h3><p>{error}</p><button className="button button-outline" onClick={() => setReloadKey((key) => key + 1)}>다시 시도</button></div>
            : menus.length === 0 ? <div className="state-panel empty-state"><span className="empty-plate">⌕</span><h3>{query ? '아직 이 메뉴는 찾지 못했어요.' : '아직 등록된 메뉴가 없어요.'}</h3><p>다른 이름으로 검색하거나, 잠시 후 다시 둘러봐 주세요.</p>{query && <button className="text-button" onClick={clearSearch}>검색어 지우기 <span aria-hidden="true">↗</span></button>}</div>
              : <div className="menu-grid">{menus.map((menu, index) => <MenuCardView key={menu.id} menu={menu} index={index} />)}</div>}
      </section>

      <section className="note-banner"><span className="note-stamp">한입<br />NOTE</span><p>별점 하나로는 다 말할 수 없으니까.<br /><strong>맛, 가성비, 양</strong>도 함께 살펴봐요.</p><span className="note-doodle" aria-hidden="true">↗</span></section>
    </>
  )
}

export function MenuCardView({ menu, index = 0 }: { menu: MenuCard; index?: number }) {
  return (
    <article className="menu-card">
      <Link to={`/menus/${menu.id}`} className={`menu-artwork artwork-${index % 4}`} aria-label={`${menu.name} 메뉴 상세 보기`}>
        <DishIllustration variant={index % 4} />
        <span className="artwork-label">한입 메뉴 카드 <span>0{(index % 6) + 1}</span></span>
      </Link>
      <div className="menu-card-body">
        <Link className="restaurant-link" to={`/restaurants/${menu.restaurantId}`}>{menu.restaurantName}<span aria-hidden="true">↗</span></Link>
        <Link to={`/menus/${menu.id}`} className="menu-card-title">{menu.name}</Link>
        <p className="menu-description">{menu.description}</p>
        <div className="menu-card-meta"><Rating value={menu.overallAverage} /><span className="review-count">{menu.reviewCount ? `리뷰 ${menu.reviewCount}` : '첫 리뷰를 기다려요'}</span></div>
        <div className="menu-card-bottom"><span className="menu-price">{formatPrice(menu.priceKrw)}</span><Link to={`/menus/${menu.id}`} className="round-arrow" aria-label={`${menu.name} 자세히 보기`}>↗</Link></div>
      </div>
    </article>
  )
}

export function Rating({ value, count }: { value: number | null; count?: number }) {
  return <span className={`rating ${value === null ? 'rating-empty' : ''}`}><span className="rating-star">★</span><strong>{value === null ? '—' : value.toFixed(1)}</strong>{count !== undefined && <span className="rating-count">({count})</span>}</span>
}

export function DishIllustration({ variant = 0 }: { variant?: number }) {
  return <span className={`dish-illustration dish-illustration-${variant}`} aria-hidden="true"><span className="illustration-plate"><i /><i /><i /><b /><b /></span><span className="illustration-spark spark-a">✳</span><span className="illustration-spark spark-b">✦</span></span>
}
