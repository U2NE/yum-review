export function formatPrice(value: number | null | undefined) {
  return value == null ? '가격 미확인' : `${value.toLocaleString('ko-KR')}원`
}

export function formatDistance(value: number | null | undefined) {
  if (value == null) return '거리 정보 없음'
  return value < 1000 ? `${Math.round(value)}m` : `${(value / 1000).toFixed(1)}km`
}

export const cuisineLabels: Record<string, string> = {
  KOREAN: '한식', WESTERN: '양식', CHINESE: '중식', JAPANESE: '일식',
  SNACK: '분식', PUB: '주점', CAFE: '카페', OTHER: '기타',
}
