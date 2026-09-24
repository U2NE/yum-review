import { useState } from 'react'
import type { FormEvent } from 'react'
import { reviewErrorMessage, type ReviewInput } from '../api/reviews'

const scoreFields = [
  { key: 'overallScore', label: '전체 만족도', helper: '한 접시의 만족도를 평가해 주세요.' },
  { key: 'tasteScore', label: '맛', helper: '맛은 어땠나요?' },
  { key: 'valueScore', label: '가성비', helper: '가격만큼 만족스러웠나요?' },
  { key: 'portionScore', label: '양', helper: '양은 적당했나요?' },
] as const

type ScoreKey = typeof scoreFields[number]['key']
type ReviewDraft = Record<ScoreKey, number>

type ReviewFormProps = {
  initialValue?: ReviewInput
  onSubmit: (review: ReviewInput) => Promise<void>
  onCancel: () => void
  submitLabel?: string
}

export default function ReviewForm({ initialValue, onSubmit, onCancel, submitLabel }: ReviewFormProps) {
  const [scores, setScores] = useState<ReviewDraft>({
    overallScore: initialValue?.overallScore ?? 0,
    tasteScore: initialValue?.tasteScore ?? 0,
    valueScore: initialValue?.valueScore ?? 0,
    portionScore: initialValue?.portionScore ?? 0,
  })
  const [comment, setComment] = useState(initialValue?.comment ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (Object.values(scores).some((score) => score < 1 || score > 5)) {
      setError('네 가지 항목의 별점을 모두 선택해 주세요.')
      return
    }
    if (comment.length > 1000) {
      setError('코멘트는 1,000자 이내로 작성해 주세요.')
      return
    }
    setSaving(true)
    try {
      await onSubmit({ ...scores, comment: comment.trim() || null })
    } catch (reason) {
      setError(reviewErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="review-form" onSubmit={submit} noValidate>
      <div className="review-form-heading"><div><span className="eyebrow">YOUR TASTE NOTE</span><h3>{initialValue ? '리뷰를 고쳐 적어요' : '먹어본 메뉴를 기록해요'}</h3></div><span className="review-form-hint">모든 별점은 1~5점</span></div>
      <div className="review-form-scores">
        {scoreFields.map(({ key, label, helper }) => (
          <fieldset className="score-picker" key={key}>
            <legend>{label}<span>{helper}</span></legend>
            <div className="score-options" role="radiogroup" aria-label={label}>
              {[1, 2, 3, 4, 5].map((score) => (
                <label className={`score-option ${scores[key] >= score ? 'is-selected' : ''}`} key={score}>
                  <input
                    type="radio"
                    name={key}
                    value={score}
                    checked={scores[key] === score}
                    onChange={() => setScores((current) => ({ ...current, [key]: score }))}
                  />
                  <span aria-hidden="true">★</span><span className="sr-only">{score}점</span>
                </label>
              ))}
              <span className="score-choice-value" aria-live="polite">{scores[key] ? `${scores[key]}점` : '선택'}</span>
            </div>
          </fieldset>
        ))}
      </div>
      <label className="review-comment-label" htmlFor="review-comment">한마디 <span>선택 · 최대 1,000자</span></label>
      <textarea id="review-comment" value={comment} maxLength={1000} rows={4} placeholder="다음 한 끼를 고르는 사람에게 들려주고 싶은 이야기를 적어주세요." onChange={(event) => setComment(event.target.value)} />
      <div className="review-form-footer"><span className="review-character-count">{comment.length.toLocaleString('ko-KR')} / 1,000</span>{error && <p className="review-form-error" role="alert">{error}</p>}<div className="review-form-actions"><button type="button" className="button button-outline" onClick={onCancel} disabled={saving}>취소</button><button type="submit" className="button button-dark" disabled={saving}>{saving ? '저장 중…' : submitLabel ?? (initialValue ? '수정 저장' : '리뷰 저장')} <span aria-hidden="true">↗</span></button></div></div>
    </form>
  )
}
