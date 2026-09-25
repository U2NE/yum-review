import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createMenu, deactivateMenu, getManagedMenus, getRestaurant, updateMenu, type MenuWriteInput } from '../api/catalog'
import { imageSrc, uploadImage, imageUploadMessage } from '../api/media'
import { useAuth } from '../auth/AuthContext'
import { ApiError, type CuisineCategory, type MenuManagementItem, type RestaurantDetail } from '../types'
import { cuisineLabels, formatPrice } from '../utils/format'
import { MenuCardView } from './HomePage'

const cuisineOptions: CuisineCategory[] = ['KOREAN', 'WESTERN', 'CHINESE', 'JAPANESE', 'SNACK', 'PUB', 'CAFE', 'OTHER']

export default function RestaurantPage() {
  const { id = '' } = useParams()
  const restaurantId = Number(id)
  const { user } = useAuth()
  const canManage = !!user && (user.systemRole === 'SERVER_ADMIN' || user.ownerRestaurantIds.includes(restaurantId))
  const [restaurant, setRestaurant] = useState<RestaurantDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let current = true
    setLoading(true); setError('')
    getRestaurant(id).then((value) => { if (current) setRestaurant(value) })
      .catch((reason: unknown) => { if (current) setError(reason instanceof ApiError && reason.status === 404 ? '이 식당은 찾을 수 없어요.' : '식당 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [id, reloadKey])

  if (loading) return <PageState kind="loading" />
  if (error || !restaurant) return <PageState kind="error" message={error || '식당 정보를 찾을 수 없어요.'} />
  const mapQuery = encodeURIComponent(`${restaurant.name} ${restaurant.address ?? ''}`.trim())
  const naverMapUrl = `https://map.naver.com/p/search/${mapQuery}`

  return <>
    <div className="breadcrumb"><Link to="/">메뉴 둘러보기</Link><span>／</span><span>{restaurant.name}</span></div>
    <section className="restaurant-detail-head"><div><span className="eyebrow">매장 / 메뉴 목록</span><h1>{restaurant.name}</h1><p>{restaurant.description || '메뉴별 리뷰를 기록하는 매장 페이지입니다.'}</p><span className="restaurant-address">{restaurant.address || '주소 미등록'}{restaurant.region ? ` · ${restaurant.region}` : ''}</span><a className="restaurant-map-link" href={naverMapUrl} target="_blank" rel="noreferrer">네이버 지도에서 보기 ↗</a></div><span className="restaurant-menu-index">MENU<br /><b>{restaurant.menus.length.toString().padStart(2, '0')}</b></span></section>
    <section className="restaurant-menu-section">
      <div className="catalog-toolbar"><div><span className="eyebrow">이곳의 메뉴</span><h2>무엇을 먹을까요</h2><p>별점은 메뉴 하나씩 계산합니다.</p></div><span className="menu-total">메뉴 <b>{restaurant.menus.length}</b></span></div>
      {restaurant.menus.length ? <div className="menu-list">{restaurant.menus.map((menu, index) => <MenuCardView key={menu.id} menu={menu} index={index} />)}</div>
        : <div className="catalog-state empty-state"><h3>아직 공개된 메뉴가 없어요.</h3><p>업주 또는 서버 관리자가 메뉴를 등록하면 이곳에 표시됩니다.</p></div>}
    </section>
    {canManage && <MenuManagementPanel restaurantId={restaurant.id} serverAdmin={user?.systemRole === 'SERVER_ADMIN'} onSaved={() => setReloadKey((key) => key + 1)} />}
    <div className="closing-note"><span>한입의 기준</span><p>같은 식당이어도 메뉴마다 다른 이야기.<br />리뷰 이벤트와 관계 없는 실제 경험을 기록해요.</p></div>
  </>
}

function MenuManagementPanel({ restaurantId, serverAdmin, onSaved }: { restaurantId: number; serverAdmin: boolean; onSaved: () => void }) {
  const [items, setItems] = useState<MenuManagementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<MenuManagementItem | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingDeactivate, setPendingDeactivate] = useState<number | null>(null)

  const reload = useCallback(async () => { const result = await getManagedMenus(restaurantId); setItems(result) }, [restaurantId])
  useEffect(() => { let active = true; getManagedMenus(restaurantId).then((result) => { if (active) setItems(result) }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '관리 메뉴를 불러오지 못했어요.') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [restaurantId])

  async function deactivate(menuId: number) {
    setBusy(true); setError('')
    try { const response = await deactivateMenu(menuId); setNotice(response.message); setPendingDeactivate(null); await reload(); onSaved() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '메뉴를 내리지 못했어요.') }
    finally { setBusy(false) }
  }

  return <section className="menu-management" aria-labelledby="manage-heading">
    <div className="catalog-toolbar"><div><span className="eyebrow">메뉴 관리</span><h2 id="manage-heading">가게의 메뉴를 직접 정리해요</h2><p>{serverAdmin ? '서버 관리자 권한으로 전체 메뉴를 관리합니다.' : '연결된 내 가게의 메뉴만 관리할 수 있어요.'}</p></div><button type="button" className="button button-dark" onClick={() => setEditing({ id: 0, restaurantId, name: '', description: '', priceKrw: null, cuisineCategory: 'KOREAN', imageUrl: null, active: true, overallAverage: null, tasteAverage: null, valueAverage: null, portionAverage: null, reviewCount: 0 })}>메뉴 추가</button></div>
    {notice && <p className="catalog-notice" role="status">{notice}</p>}{error && <p className="auth-error" role="alert">{error}</p>}
    {editing && <MenuEditor key={editing.id || 'new'} item={editing} serverAdmin={serverAdmin} onCancel={() => setEditing(null)} onSave={async (input) => {
      setBusy(true); setError(''); setNotice('')
      try { if (editing.id) await updateMenu(editing.id, input); else await createMenu(restaurantId, input); setEditing(null); setNotice('메뉴를 저장했어요.'); await reload(); onSaved() }
      catch (reason) { setError(reason instanceof Error ? reason.message : '메뉴를 저장하지 못했어요.') }
      finally { setBusy(false) }
    }} busy={busy} />}
    {loading ? <p className="management-empty">관리 목록을 불러오는 중이에요.</p> : <div className="managed-menu-list">{items.map((item) => <article className={`managed-menu ${item.active ? '' : 'is-inactive'}`} key={item.id}>
      <div className="managed-menu-photo">{item.imageUrl ? <img src={item.imageUrl} alt={`${item.name} 사진`} /> : <span>사진 없음</span>}</div><div className="managed-menu-copy"><span>{cuisineLabels[item.cuisineCategory]} · {item.active ? '공개 중' : '목록에서 내림'}</span><strong>{item.name}</strong><small>{formatPrice(item.priceKrw)}</small></div><div className="managed-menu-actions"><button className="text-button" type="button" onClick={() => setEditing(item)}>수정</button>{item.active && <button className="text-button review-delete-link" type="button" onClick={() => setPendingDeactivate(item.id)}>메뉴 내리기</button>}</div>
      {pendingDeactivate === item.id && <div className="delete-review-confirm"><span>이 메뉴를 목록에서 내릴까요? 기존 리뷰와 평점 기록은 보존됩니다.</span><button type="button" className="button button-outline" onClick={() => setPendingDeactivate(null)}>취소</button><button type="button" className="button button-dark" disabled={busy} onClick={() => void deactivate(item.id)}>{busy ? '처리 중…' : '목록에서 내리기'}</button></div>}
    </article>)}</div>}
  </section>
}

function MenuEditor({ item, busy, serverAdmin, onCancel, onSave }: { item: MenuManagementItem; busy: boolean; serverAdmin: boolean; onCancel: () => void; onSave: (input: MenuWriteInput) => Promise<void> }) {
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description ?? '')
  const [price, setPrice] = useState(item.priceKrw == null ? '' : String(item.priceKrw))
  const [category, setCategory] = useState<CuisineCategory>(item.cuisineCategory)
  const [photoMediaId, setPhotoMediaId] = useState(item.imageUrl?.split('/').pop() ?? '')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [rights, setRights] = useState(false)
  const [localError, setLocalError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLocalError('')
    if (saving || busy) return
    if (photoFile && !rights) { setLocalError('사진을 촬영했거나 업로드 권한이 있는지 확인해 주세요.'); return }
    if (price && (!/^\d+$/.test(price) || Number(price) < 0)) { setLocalError('가격은 0원 이상의 숫자로 입력해 주세요.'); return }
    setSaving(true)
    try {
      let mediaId = photoMediaId || null
      if (photoFile) {
        try { const uploaded = await uploadImage(photoFile, 'MENU', serverAdmin ? 'ADMIN_UPLOAD' : 'OWNER_UPLOAD', '업주 또는 관리자가 촬영했거나 게시 권한을 확인한 메뉴 사진'); mediaId = uploaded.mediaId }
        catch (reason) { setLocalError(imageUploadMessage(reason)); return }
      }
      await onSave({ name: name.trim(), description: description.trim(), priceKrw: price ? Number(price) : null, cuisineCategory: category, photoMediaId: mediaId, active: item.active })
    } finally { setSaving(false) }
  }

  return <form className="menu-editor" onSubmit={(event) => void submit(event)}>
    <div className="menu-editor-heading"><h3>{item.id ? '메뉴 수정' : '새 메뉴 등록'}</h3><span>식당 정보는 메뉴 카드에 함께 표시됩니다.</span></div>
    <div className="menu-editor-grid"><label>메뉴 이름<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} /></label><label>음식 종류<select value={category} onChange={(event) => setCategory(event.target.value as CuisineCategory)}>{cuisineOptions.map((option) => <option value={option} key={option}>{cuisineLabels[option]}</option>)}</select></label><label>가격 (원)<input inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="모르면 비워두기" /></label><label className="editor-wide">메뉴 설명<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} /></label></div>
    <div className="menu-photo-upload"><div>{photoMediaId && !photoFile ? <img src={imageSrc(photoMediaId)} alt="현재 메뉴 사진" /> : <span>메뉴 사진</span>}{photoFile && <span>{photoFile.name}</span>}</div><label className="button button-outline">{photoFile || photoMediaId ? '사진 바꾸기' : '사진 추가'}<input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ''; if (file && file.size >= 100_000_000) { setLocalError('100MB 이상인 사진은 올릴 수 없어요.'); return } setPhotoFile(file); setLocalError('') }} /></label>{(photoFile || photoMediaId) && <button className="text-button" type="button" onClick={() => { setPhotoFile(null); setPhotoMediaId('') }}>사진 제거</button>}</div>
    {photoFile && <label className="photo-rights-check"><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} /><span>이 사진은 제가 촬영했거나 게시 권한을 확인한 사진입니다.</span></label>}
    {localError && <p className="auth-error" role="alert">{localError}</p>}
    <div className="menu-editor-actions"><button className="button button-outline" type="button" onClick={onCancel} disabled={busy || saving}>취소</button><button className="button button-dark" type="submit" disabled={busy || saving || !name.trim()}>{busy || saving ? '저장 중…' : '메뉴 저장'}</button></div>
  </form>
}

export function PageState({ kind, message }: { kind: 'loading' | 'error'; message?: string }) {
  return <div className={`catalog-state page-state ${kind === 'error' ? 'error-state' : ''}`}>{kind === 'loading' ? <p>정보를 불러오는 중이에요…</p> : <><h3>{message ?? '정보를 불러오지 못했어요.'}</h3><p>잠시 후 다시 시도해 주세요.</p><Link className="button button-outline" to="/">메뉴 둘러보기</Link></>}</div>
}
