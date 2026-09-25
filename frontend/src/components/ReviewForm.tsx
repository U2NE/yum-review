import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { imageSrc } from '../api/media'
import { reviewErrorMessage, type ReviewInput } from '../api/reviews'

const scoreFields = [
  { key: 'overallScore', label: '전체 만족도', helper: '한 접시의 만족도' },
  { key: 'tasteScore', label: '맛', helper: '맛은 어땠나요?' },
  { key: 'valueScore', label: '가성비', helper: '가격만큼 만족스러웠나요?' },
  { key: 'portionScore', label: '양', helper: '양은 적당했나요?' },
] as const
type ScoreKey = typeof scoreFields[number]['key']
type ReviewInitial = Omit<Partial<ReviewInput>, 'nonEventReviewConsent'> & { photoMediaIds?: string[]; nonEventReviewConsent?: boolean | null }

type ReviewFormProps = {
  initialValue?: ReviewInitial
  onSubmit: (review: ReviewInput, newPhotos: File[], removePhotoIds: string[]) => Promise<void>
  onCancel: () => void
  submitLabel?: string
}

export default function ReviewForm({ initialValue, onSubmit, onCancel, submitLabel }: ReviewFormProps) {
  const [scores, setScores] = useState<Record<ScoreKey, number>>({
    overallScore: initialValue?.overallScore ?? 0,
    tasteScore: initialValue?.tasteScore ?? 0,
    valueScore: initialValue?.valueScore ?? 0,
    portionScore: initialValue?.portionScore ?? 0,
  })
  const [comment, setComment] = useState(initialValue?.comment ?? '')
  const [consent, setConsent] = useState(initialValue?.nonEventReviewConsent === true)
  const [rightsAttested, setRightsAttested] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const existing = initialValue?.photoMediaIds ?? []
  const retainedCount = existing.filter((id) => !removed.includes(id)).length

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? [])
    event.target.value = ''
    const invalid = chosen.find((file) => file.size >= 100_000_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    if (invalid) { setError(invalid.size >= 100_000_000 ? '100MB 이상인 사진은 첨부할 수 없어요.' : 'JPEG, PNG, WebP 사진만 첨부할 수 있어요.'); return }
    if (retainedCount + files.length + chosen.length > 5) { setError('리뷰 사진은 최대 5장까지 첨부할 수 있어요.'); return }
    setError('')
    setFiles((current) => [...current, ...chosen])
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (Object.values(scores).some((score) => score < 0.5 || score > 5)) { setError('네 가지 항목의 별점을 모두 선택해 주세요.'); return }
    if (!consent) { setError('리뷰 이벤트 참여가 아닌 솔직한 리뷰라는 점에 동의해 주세요.'); return }
    if (files.length > 0 && !rightsAttested) { setError('첨부 사진의 촬영자이거나 게시 권한이 있는지 확인해 주세요.'); return }
    if (comment.length > 1000) { setError('코멘트는 1,000자 이내로 작성해 주세요.'); return }
    setSaving(true)
    try { await onSubmit({ ...scores, comment: comment.trim() || null, nonEventReviewConsent: true }, files, removed) }
    catch (reason) { setError(reviewErrorMessage(reason)) }
    finally { setSaving(false) }
  }

  return <form className="review-form" onSubmit={submit} noValidate>
    <div className="review-form-heading"><div><span className="eyebrow">먹어본 기록</span><h3>{initialValue ? '리뷰를 고쳐 적어요' : '이 메뉴를 기록해요'}</h3></div><span className="review-form-hint">0.5점 단위</span></div>
    <p className="average-guidance">2.5점을 보통이라고 생각하고, 실제로 느낀 만큼 평가해 주세요.</p>
    <div className="review-form-scores">{scoreFields.map(({ key, label, helper }) => <fieldset className="score-picker" key={key}>
      <legend>{label}<span>{helper}</span></legend>
      <div className="score-options" role="radiogroup" aria-label={label}>
        {Array.from({ length: 10 }, (_, index) => (index + 1) / 2).map((score) => <label className={`score-option half-score-option ${scores[key] === score ? 'is-selected' : ''}`} key={score} title={`${score}점`}>
          <input type="radio" name={key} value={score} checked={scores[key] === score} onChange={() => setScores((current) => ({ ...current, [key]: score }))} />
          <span aria-hidden="true">{Number.isInteger(score) ? '★' : '◐'}</span><span className="sr-only">{score}점</span>
        </label>)}
        <span className="score-choice-value" aria-live="polite">{scores[key] ? `${scores[key].toFixed(1)}점` : '선택'}</span>
      </div>
    </fieldset>)}</div>
    <label className="review-comment-label" htmlFor="review-comment">한마디 <span>선택 · 최대 1,000자</span></label>
    <textarea id="review-comment" value={comment} maxLength={1000} rows={4} placeholder="다음 한 끼를 고르는 사람에게 들려주고 싶은 이야기를 적어주세요." onChange={(event) => setComment(event.target.value)} />

    <div className="review-photo-editor"><div><strong>먹은 순간 사진</strong><p>한 번에 한 장씩 안전하게 올려요. 10MB를 넘으면 저장 과정에서 압축을 시도합니다. 100MB 이상은 받을 수 없어요.</p></div>
      <label className="button button-outline photo-picker">사진 추가<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addFiles} disabled={saving || retainedCount + files.length >= 5} /></label>
      {existing.length > 0 && <div className="attached-photo-list">{existing.map((id) => <label key={id} className={`attached-photo ${removed.includes(id) ? 'is-removing' : ''}`}><img src={imageSrc(id)} alt="첨부된 리뷰 사진" /><input type="checkbox" checked={removed.includes(id)} onChange={(event) => setRemoved((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} /><span>{removed.includes(id) ? '삭제 예정' : '저장된 사진'}</span></label>)}</div>}
      {files.length > 0 && <ul className="pending-photo-list">{files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name}<button type="button" className="text-button" aria-label={`${file.name} 첨부 취소`} onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>제거</button></li>)}</ul>}
      <label className="photo-rights-check"><input type="checkbox" checked={rightsAttested} onChange={(event) => setRightsAttested(event.target.checked)} /><span>이 사진은 제가 촬영했거나, 게시 권한을 확인한 사진입니다.</span></label>
    </div>

    <label className="review-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span><b>리뷰 이벤트 참여가 아닌 솔직한 리뷰입니다.</b><small>이 항목에 동의해야 리뷰를 등록할 수 있어요.</small></span></label>
    <div className="review-form-footer"><span className="review-character-count">{comment.length.toLocaleString('ko-KR')} / 1,000자</span>{error && <p className="review-form-error" role="alert">{error}</p>}<div className="review-form-actions"><button type="button" className="button button-outline" onClick={onCancel} disabled={saving}>취소</button><button type="submit" className="button button-dark" disabled={saving}>{saving ? '저장 중…' : submitLabel ?? (initialValue ? '수정 저장' : '리뷰 저장')} <span aria-hidden="true">↗</span></button></div></div>
  </form>
}
