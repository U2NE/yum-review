export type MenuCard = {
  id: number
  name: string
  description: string
  priceKrw: number
  restaurantId: number
  restaurantName: string
  overallAverage: number | null
  tasteAverage: number | null
  valueAverage: number | null
  portionAverage: number | null
  reviewCount: number
}

export type RestaurantDetail = {
  id: number
  name: string
  description: string
  address: string
  menus: MenuCard[]
}

export type MenuDetail = Omit<MenuCard, 'restaurantName'> & {
  restaurantName: string
  restaurantAddress: string
}

export type PublicReview = {
  id: number
  authorLabel: string
  overallScore: number
  tasteScore: number
  valueScore: number
  portionScore: number
  comment: string | null
  createdAt: string
}

export type ApiErrorBody = {
  status?: number
  code?: string
  message?: string
}

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
