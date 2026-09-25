import { apiRequest } from './client'
import { ApiError } from '../types'

export type ReviewInput = {
  overallScore: number
  tasteScore: number
  valueScore: number
  portionScore: number
  comment: string | null
  nonEventReviewConsent: true
}

export type MyReview = Omit<ReviewInput, 'nonEventReviewConsent'> & {
  nonEventReviewConsent: boolean | null
  id: number
  menuId: number
  menuName: string
  restaurantId: number
  restaurantName: string
  photoMediaIds: string[]
  createdAt: string
  updatedAt: string
}

export function getMyReviews() { return apiRequest<MyReview[]>('/api/me/reviews') }
export function createReview(menuId: number | string, review: ReviewInput) {
  return apiRequest<MyReview>(`/api/menus/${menuId}/reviews`, { method: 'POST', json: review })
}
export function updateReview(reviewId: number, review: ReviewInput) {
  return apiRequest<MyReview>(`/api/reviews/${reviewId}`, { method: 'PUT', json: review })
}
export function attachReviewPhoto(reviewId: number, mediaId: string) {
  return apiRequest<MyReview>(`/api/reviews/${reviewId}/photos`, { method: 'POST', json: { mediaId } })
}
export function detachReviewPhoto(reviewId: number, mediaId: string) {
  return apiRequest<MyReview>(`/api/reviews/${reviewId}/photos/${encodeURIComponent(mediaId)}`, { method: 'DELETE' })
}
export function deleteReview(reviewId: number) { return apiRequest<void>(`/api/reviews/${reviewId}`, { method: 'DELETE' }) }

export function reviewErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return '리뷰를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
  if (error.status === 0) return '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.'
  if (error.status === 400) return error.message || '별점은 0.5점 간격으로 선택하고, 비이벤트 동의를 확인해 주세요.'
  if (error.status === 401) return '로그인 상태가 만료됐어요. 다시 로그인해 주세요.'
  if (error.status === 403) return '본인이 작성한 리뷰만 수정하거나 삭제할 수 있어요. 로그인 상태도 확인해 주세요.'
  if (error.status === 404) return '메뉴나 리뷰를 찾을 수 없어요. 화면을 새로고침해 주세요.'
  if (error.status === 409) return error.message || '이 메뉴에는 이미 리뷰가 있어요. 내 리뷰에서 수정해 주세요.'
  return '리뷰를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}
