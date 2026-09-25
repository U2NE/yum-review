import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { searchMenus, searchPlaces, type MenuSort, type PlaceSuggestion } from '../api/catalog'
import { ApiError, type CuisineCategory, type MenuCard } from '../types'
import { formatDistance, formatPrice, cuisineLabels } from '../utils/format'

const campus = { latitude: 37.3217, longitude: 127.1269 }
const categories: Array<{ id: CuisineCategory | ''; label: string }> = [
  { id: '', label: '전체' }, { id: 'KOREAN', label: '한식' }, { id: 'WESTERN', label: '양식' },
  { id: 'CHINESE', label: '중식' }, { id: 'JAPANESE', label: '일식' }, { id: 'SNACK', label: '분식' },
  { id: 'PUB', label: '주점' }, { id: 'CAFE', label: '카페' },
]
const sorts: Array<{ id: MenuSort; label: string }> = [
  { id: 'overall', label: '전체 별점' }, { id: 'taste', label: '맛' }, { id: 'value', label: '가성비' },
  { id: 'portion', label: '양' }, { id: 'reviewCount', label: '리뷰 많은 순' },
]

export default function HomePage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const category = (params.get('category') ?? '') as CuisineCategory | ''
  const region = params.get('region') ?? ''
  const radius = Number(params.get('radius') ?? 0)
  const sort = (sorts.some((item) => item.id === params.get('sort')) ? params.get('sort') : 'overall') as MenuSort
  const [draft, setDraft] = useState(query)
  const [regionDraft, setRegionDraft] = useState(region)
  const [menus, setMenus] = useState<MenuCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [origin, setOrigin] = useState(campus)
  const [originLabel, setOriginLabel] = useState('단국대 죽전캠퍼스')
  const [placeQuery, setPlaceQuery] = useState('')
  const [places, setPlaces] = useState<PlaceSuggestion[]>([])
  const [placeMessage, setPlaceMessage] = useState('')
  const [placeLoading, setPlaceLoading] = useState(false)

  useEffect(() => setDraft(query), [query])
  useEffect(() => setRegionDraft(region), [region])
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    setNotice('')
    searchMenus({ q: query, category, region, sort, latitude: radius ? origin.latitude : null,
      longitude: radius ? origin.longitude : null, radiusMeters: radius || null })
      .then((result) => {
        if (!current) return
        setMenus(result.menus)
        setNotice(result.notice ?? (result.unlocatedExcludedCount ? `위치가 등록되지 않은 식당 ${result.unlocatedExcludedCount}곳은 거리 계산에서 제외했어요.` : ''))
      })
      .catch((reason: unknown) => { if (current) setError(reason instanceof ApiError ? reason.message : '메뉴를 불러오지 못했어요.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [query, category, region, radius, sort, origin, reloadKey])

  function patchParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
    setParams(next)
  }
  function submitSearch(event: FormEvent<HTMLFormElement>) { event.preventDefault(); patchParams({ q: draft.trim() || null }) }
  function submitRegion(event: FormEvent<HTMLFormElement>) { event.preventDefault(); patchParams({ region: regionDraft.trim() || null }) }
  function setRadius(value: number) { patchParams({ radius: value ? String(value) : null }) }

  async function findCurrentLocation() {
    setPlaceMessage('')
    if (!navigator.geolocation) { setPlaceMessage('이 브라우저에서는 현재 위치를 확인할 수 없어요. 장소를 검색해 주세요.'); return }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setOrigin({ latitude: coords.latitude, longitude: coords.longitude }); setOriginLabel('현재 위치'); if (!radius) setRadius(500) },
      () => setPlaceMessage('위치 권한을 확인하지 못했어요. 브라우저에서 허용하거나 장소를 검색해 주세요.'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    )
  }

  async function findPlaces(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!placeQuery.trim()) { setPlaceMessage('장소 이름이나 주소를 입력해 주세요.'); return }
    setPlaceLoading(true); setPlaceMessage(''); setPlaces([])
    try {
      const result = await searchPlaces(placeQuery.trim())
      setPlaces(result.results)
      setPlaceMessage(result.message ?? '')
    } catch (reason) { setPlaceMessage(reason instanceof Error ? reason.message : '장소를 검색하지 못했어요.') }
    finally { setPlaceLoading(false) }
  }

  function selectPlace(place: PlaceSuggestion) {
    if (place.latitude == null || place.longitude == null) { setPlaceMessage('선택한 장소의 위치 좌표가 없어 거리 검색에 사용할 수 없어요.'); return }
    setOrigin({ latitude: place.latitude, longitude: place.longitude })
    setOriginLabel(place.name)
    setPlaces([])
    setPlaceMessage('')
    if (!radius) setRadius(500)
  }

  const selectedSortLabel = useMemo(() => sorts.find((item) => item.id === sort)?.label ?? '전체 별점', [sort])

  return (
    <div className="discovery-page">
      <section className="discovery-intro">
        <div className="intro-kicker"><span>단국대 죽전 · 메뉴 아카이브</span><span>제1호 / 2026</span></div>
        <h1>다음 한 끼를<br /><em>메뉴부터</em> 고릅니다.</h1>
        <p>가게의 인상보다 한 접시의 기록을 모읍니다.<br className="desktop-break" /> 먹어본 사람의 별점과 메모가 선택의 기준이 돼요.</p>
        <div className="intro-rule"><span>한입은 메뉴별 리뷰를 모아요</span><span>2.5점은 보통이라고 생각하고 평가해요</span></div>
      </section>

      <section className="discovery-tools" aria-label="메뉴 찾기">
        <form className="discovery-search" onSubmit={submitSearch} role="search">
          <label className="sr-only" htmlFor="menu-search">메뉴 또는 식당 검색</label>
          <input id="menu-search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="메뉴나 식당 이름" />
          {draft && <button className="clear-search" type="button" aria-label="검색어 지우기" onClick={() => { setDraft(''); patchParams({ q: null }) }}>×</button>}
          <button className="button button-dark" type="submit">검색 <span aria-hidden="true">↗</span></button>
        </form>
        <form className="location-search" onSubmit={findPlaces}>
          <label className="sr-only" htmlFor="place-search">장소 검색</label>
          <input id="place-search" value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} placeholder="거리 기준 장소 검색" />
          <button className="button button-outline" type="submit" disabled={placeLoading}>{placeLoading ? '검색 중' : '장소 찾기'}</button>
          <button className="text-button current-location" type="button" onClick={() => void findCurrentLocation()}>현재 위치로</button>
        </form>
        {placeMessage && <p className="place-message" role="status">{placeMessage}</p>}
        {places.length > 0 && <div className="place-results" role="listbox" aria-label="장소 검색 결과">{places.map((place, index) => <button key={`${place.name}-${index}`} type="button" role="option" onClick={() => selectPlace(place)}><strong>{place.name}</strong><span>{place.roadAddress || place.address}</span></button>)}</div>}

        <div className="filter-row">
          <label className="filter-label" htmlFor="category-filter">음식 종류</label>
          <select id="category-filter" value={category} onChange={(event) => patchParams({ category: event.target.value || null })}>
            {categories.map((item) => <option value={item.id} key={item.id || 'all'}>{item.label}</option>)}
          </select>
          <form className="region-filter" onSubmit={submitRegion}><label className="filter-label" htmlFor="region-filter">지역</label><input id="region-filter" value={regionDraft} onChange={(event) => setRegionDraft(event.target.value)} placeholder="예: 죽전동" /><button type="submit" className="text-button">적용</button></form>
        </div>
        <div className="distance-row"><span>거리 기준 <b>{radius ? `${radius >= 1000 ? `${radius / 1000}km` : `${radius}m`} 안 · ${originLabel}` : `선택한 장소 · ${originLabel}`}</b></span><div role="group" aria-label="검색 반경">{[0, 300, 500, 1000].map((value) => <button type="button" key={value} aria-pressed={radius === value} className={radius === value ? 'is-selected' : ''} onClick={() => setRadius(value)}>{value ? (value >= 1000 ? '1km' : `${value}m`) : '전체'}</button>)}</div></div>
      </section>

      <section className="catalog-section" aria-labelledby="catalog-heading">
        <div className="catalog-toolbar"><div><span className="eyebrow">메뉴 기록 / 죽전</span><h2 id="catalog-heading">먹어본 메뉴</h2><p>{menus.length ? `${menus.length}개의 메뉴 · ${selectedSortLabel} 기준` : '메뉴별로 쌓이는 별점과 기록'}</p></div><label className="sort-select-label" htmlFor="menu-sort">정렬<select id="menu-sort" value={sort} onChange={(event) => patchParams({ sort: event.target.value === 'overall' ? null : event.target.value })}>{sorts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
        {notice && <p className="catalog-notice" role="status">{notice}</p>}
        {loading ? <div className="catalog-state">메뉴 정보를 가져오고 있어요…</div>
          : error ? <div className="catalog-state error-state"><h3>메뉴를 불러오지 못했어요</h3><p>{error}</p><button className="button button-outline" onClick={() => setReloadKey((key) => key + 1)}>다시 시도</button></div>
            : menus.length === 0 ? <div className="catalog-state empty-state"><span className="empty-index">현재 수록 / 00</span><h3>조건에 맞는 메뉴가 아직 없어요.</h3><p>메뉴 등록이 이어지는 중이에요. 다른 음식 종류나 지역을 선택해 보세요.</p>{(query || category || region || radius) && <button type="button" className="text-button" onClick={() => { setDraft(''); setRegionDraft(''); setParams(new URLSearchParams()) }}>필터 모두 지우기</button>}</div>
              : <div className="menu-list">{menus.map((menu, index) => <MenuCardView key={menu.id} menu={menu} index={index} />)}</div>}
      </section>

      <section className="closing-note"><span>기록의 기준</span><p>리뷰 이벤트를 위한 평점은 받지 않아요.<br />각 메뉴를 직접 먹고 남긴 기록만 모읍니다.</p></section>
    </div>
  )
}

export function MenuCardView({ menu, index = 0 }: { menu: MenuCard; index?: number }) {
  return <article className="menu-row">
    <Link to={`/menus/${menu.id}`} className={`menu-photo ${menu.imageUrl ? 'has-photo' : 'no-photo'}`} aria-label={`${menu.name} 메뉴 상세 보기`}>
      {menu.imageUrl ? <img src={menu.imageUrl} alt={`${menu.name} 사진`} loading="lazy" /> : <span className="photo-placeholder"><small>한입 메뉴</small><b>{String(index + 1).padStart(2, '0')}</b></span>}
    </Link>
    <div className="menu-row-copy"><div className="menu-row-overline"><Link to={`/restaurants/${menu.restaurantId}`}>{menu.restaurantName}</Link><span>{menu.region || '지역 미등록'}</span></div><Link to={`/menus/${menu.id}`} className="menu-row-title">{menu.name}</Link><p>{menu.description || '메뉴 설명이 아직 등록되지 않았어요.'}</p><div className="menu-row-tags"><span>{cuisineLabels[menu.cuisineCategory] || '기타'}</span><span>{formatPrice(menu.priceKrw)}</span>{menu.distanceMeters != null && <span>{formatDistance(menu.distanceMeters)}</span>}</div></div>
    <div className="menu-row-score"><span>전체</span><strong>{menu.overallAverage == null ? '—' : menu.overallAverage.toFixed(1)}</strong><small>{menu.reviewCount ? `리뷰 ${menu.reviewCount}` : '리뷰 대기'}</small><Link to={`/menus/${menu.id}`} aria-label={`${menu.name} 리뷰 보기`}>↗</Link></div>
  </article>
}

export function Rating({ value, count }: { value: number | null; count?: number }) {
  return <span className={`rating ${value === null ? 'rating-empty' : ''}`}><span className="rating-star">★</span><strong>{value === null ? '—' : value.toFixed(1)}</strong>{count !== undefined && <span className="rating-count">({count})</span>}</span>
}

export function DishIllustration({ variant = 0 }: { variant?: number }) {
  return <span className={`dish-illustration dish-illustration-${variant}`} aria-hidden="true"><span /><span /><span /></span>
}
