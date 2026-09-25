export type MenuSort = 'overall' | 'taste' | 'value' | 'portion' | 'reviewCount'
export type CuisineCategory = 'KOREAN' | 'WESTERN' | 'CHINESE' | 'JAPANESE' | 'SNACK' | 'PUB' | 'CAFE' | 'OTHER'

export type MenuCard = {
  id: number
  name: string
  description: string | null
  priceKrw: number | null
  restaurantId: number
  restaurantName: string
  restaurantAddress: string | null
  region: string | null
  cuisineCategory: CuisineCategory
  imageUrl: string | null
  distanceMeters: number | null
  overallAverage: number | null
  tasteAverage: number | null
  valueAverage: number | null
  portionAverage: number | null
  reviewCount: number
}

export type MenuSearchResponse = {
  menus: MenuCard[]
  sort: MenuSort
  radiusApplied: boolean
  unlocatedExcludedCount: number
  notice: string | null
}

export type MenuSearchInput = {
  q?: string
  category?: CuisineCategory | ''
  region?: string
  latitude?: number | null
  longitude?: number | null
  radiusMeters?: number | null
  sort?: MenuSort
}

export type RestaurantDetail = {
  id: number
  name: string
  description: string | null
  address: string | null
  region: string | null
  menus: MenuCard[]
}

export type MenuDetail = Omit<MenuCard, 'distanceMeters'>
export type MenuManagementItem = Omit<MenuCard, 'restaurantName' | 'restaurantAddress' | 'region' | 'distanceMeters'> & { active: boolean }

export type PublicReview = {
  id: number
  authorLabel: string
  overallScore: number
  tasteScore: number
  valueScore: number
  portionScore: number
  comment: string | null
  createdAt: string
  photoMediaIds: string[]
}

export type ApiErrorBody = { status?: number; code?: string; message?: string }

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}
