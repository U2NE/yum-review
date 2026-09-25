import { apiRequest } from './client'
import { ApiError } from '../types'

export type MediaKind = 'MENU' | 'REVIEW'
export type MediaSource = 'OWNER_UPLOAD' | 'ADMIN_UPLOAD' | 'USER_UPLOAD' | 'LICENSED'
export type UploadedImage = { mediaId: string; kind: MediaKind; contentType: string; originalBytes: number; storedBytes: number; lifecycleStatus: string }

export async function uploadImage(file: File, kind: MediaKind, source: MediaSource, rightsBasis: string): Promise<UploadedImage> {
  if (file.size >= 100_000_000) throw new ApiError('100MB 이상인 사진은 올릴 수 없어요.', 400, 'IMAGE_TOO_LARGE')
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('kind', kind)
  form.append('source', source)
  form.append('rightsAttested', 'true')
  form.append('rightsBasis', rightsBasis)
  return apiRequest<UploadedImage>('/api/media', { method: 'POST', body: form })
}

export function imageSrc(mediaId: string) {
  return `/api/images/${encodeURIComponent(mediaId)}`
}

export function imageUploadMessage(error: unknown) {
  if (error instanceof ApiError && error.code === 'IMAGE_TOO_LARGE') return error.message
  if (error instanceof ApiError && error.status === 507) return '사진 저장 공간이 부족해 업로드하지 못했어요.'
  if (error instanceof ApiError && error.status === 400) return error.message
  return '사진을 올리지 못했어요. JPEG, PNG, WebP 사진인지 확인하고 다시 시도해 주세요.'
}
