import { ApiError, type ApiErrorBody } from '../types'

type RequestOptions = Omit<RequestInit, 'credentials'> & {
  json?: unknown
  csrf?: boolean
}

type CsrfTokenResponse = {
  headerName: string
  token: string
}

let csrfRequest: Promise<CsrfTokenResponse> | null = null

async function getCsrfToken(): Promise<CsrfTokenResponse> {
  if (!csrfRequest) {
    csrfRequest = fetch('/api/auth/csrf', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new ApiError('보안 토큰을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.', response.status)
        return (await response.json()) as CsrfTokenResponse
      })
      .catch((error: unknown) => {
        csrfRequest = null
        throw error
      })
  }
  return csrfRequest
}

/** Refresh after signup/login/logout because Spring Security may rotate the session token. */
export async function refreshCsrfToken(): Promise<void> {
  csrfRequest = null
  await getCsrfToken()
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, csrf, headers: suppliedHeaders, ...init } = options
  const method = (init.method ?? 'GET').toUpperCase()
  const isUnsafe = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method)
  const headers = new Headers(suppliedHeaders)
  let body = init.body

  if (json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(json)
  }

  if (csrf ?? isUnsafe) {
    const token = await getCsrfToken()
    headers.set(token.headerName, token.token)
  }

  let response: Response
  try {
    response = await fetch(path, { ...init, method, headers, body, credentials: 'include' })
  } catch {
    throw new ApiError('서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.', 0, 'NETWORK_ERROR')
  }

  if (!response.ok) {
    const requestPath = new URL(path, window.location.origin).pathname
    if (response.status === 401 && requestPath !== '/api/auth/login' && requestPath !== '/api/auth/me') {
      window.dispatchEvent(new Event('yum-review:session-expired'))
    }
    // A rejected write can mean that the session-bound token expired. Keep the
    // next explicit attempt from reusing a token we already know was rejected.
    if (response.status === 403 && isUnsafe) csrfRequest = null
    let errorBody: ApiErrorBody = {}
    try {
      errorBody = (await response.json()) as ApiErrorBody
    } catch {
      // Keep an understandable local message if the server returns a non-JSON error page.
    }
    const fallback = response.status === 401
      ? '로그인이 필요한 기능이에요.'
      : response.status === 403
        ? '요청을 처리할 권한이 없거나 보안 토큰이 만료됐어요.'
        : response.status === 404
          ? '요청한 정보를 찾을 수 없어요.'
          : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
    throw new ApiError(errorBody.message || fallback, response.status, errorBody.code)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
