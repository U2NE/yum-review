import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

const adminEmail = process.env.QA_ADMIN_EMAIL || 'yum-admin@example.invalid'
const adminPassword = process.env.QA_ADMIN_PASSWORD || ''
const rotatedAdminPassword = process.env.QA_ROTATED_ADMIN_PASSWORD || 'YumReview-QA-Changed-2026!'
const qaBaseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5174'
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII=', 'base64')

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: /로그인/ }).click()
}

async function createMember(browser: Browser, email: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/signup')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호', { exact: true }).fill('YumReview-Member-Password-28!')
  await page.getByLabel('비밀번호 확인').fill('YumReview-Member-Password-28!')
  await page.getByRole('button', { name: '이메일로 가입하기' }).click()
  await expect(page.getByText('가입이 완료됐어요')).toBeVisible()
  await page.getByRole('link', { name: '로그인하기' }).click()
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill('YumReview-Member-Password-28!')
  await page.getByRole('button', { name: /로그인/ }).click()
  await expect(page).toHaveURL(/\/my-reviews$/)
  return { context, page }
}

test('discovery, reviews, photos, owner menu management, server-admin controls', async ({ browser, page, context }) => {
  test.skip(!adminPassword, 'Isolated QA runner must provide a one-time bootstrap password.')

  // First-login password rotation and server-admin navigation.
  await signIn(page, adminEmail, adminPassword)
  await expect(page).toHaveURL(/\/password-change$/)
  await page.getByLabel('현재 비밀번호').fill(adminPassword)
  await page.getByLabel('새 비밀번호', { exact: true }).fill(rotatedAdminPassword)
  await page.getByLabel('새 비밀번호 확인').fill(rotatedAdminPassword)
  await page.getByRole('button', { name: '새 비밀번호 저장' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: /가게와 권한/ })).toBeVisible()

  const menuResponse = await page.request.get(`${qaBaseUrl}/api/menus?sort=overall`)
  expect(menuResponse.ok()).toBeTruthy()
  const catalog = await menuResponse.json() as { menus: Array<{ id: number; name: string; restaurantId: number; restaurantName: string }> }
  expect(catalog.menus.length).toBeGreaterThan(0)
  const menu = catalog.menus[0]

  // Register a regular account, then exercise discovery controls and the review form.
  const memberEmail = `qa-ui-${Date.now()}@example.invalid`
  const member = await createMember(browser, memberEmail)
  const memberPage = member.page
  await member.context.grantPermissions(['geolocation'])
  await member.context.setGeolocation({ latitude: 37.3217, longitude: 127.1269 })
  await memberPage.goto('/')
  await expect(memberPage.getByRole('heading', { name: '먹어본 메뉴' })).toBeVisible()
  await memberPage.getByLabel('음식 종류').selectOption('CAFE')
  await memberPage.getByLabel('정렬').selectOption('taste')
  await memberPage.getByLabel('정렬').selectOption('value')
  await memberPage.getByLabel('정렬').selectOption('portion')
  await memberPage.getByLabel('정렬').selectOption('reviewCount')
  await memberPage.getByLabel('정렬').selectOption('overall')
  await memberPage.getByLabel('지역').fill('죽전')
  await memberPage.getByRole('button', { name: '적용' }).click()
  await memberPage.getByRole('button', { name: '500m' }).click()
  await expect(memberPage.getByText(/단국대 죽전캠퍼스/)).toBeVisible()
  await memberPage.getByRole('button', { name: '현재 위치로' }).click()
  await expect(memberPage.getByText('500m 안 · 현재 위치')).toBeVisible()
  await memberPage.getByLabel('장소 검색').fill('단국대학교 죽전캠퍼스')
  await memberPage.getByRole('button', { name: '장소 찾기' }).click()
  await expect(memberPage.getByRole('status').filter({ hasText: /장소 검색을 사용하려면/ })).toBeVisible()
  await memberPage.getByLabel('지역').fill('')
  await memberPage.getByRole('button', { name: '적용' }).click()
  await memberPage.getByLabel('음식 종류').selectOption('')
  await memberPage.getByRole('button', { name: '1km' }).click()
  await memberPage.getByRole('button', { name: '전체', exact: true }).click()

  await memberPage.goto(`/menus/${menu.id}`)
  await expect(memberPage.getByRole('heading', { name: menu.name })).toBeVisible()
  await memberPage.getByRole('button', { name: '이 메뉴 리뷰 남기기' }).click()
  for (let field = 0; field < 4; field += 1) {
    await memberPage.locator('.score-picker').nth(field).getByRole('radio', { name: '2.5점' }).check()
  }
  await memberPage.locator('#review-comment').fill('2.5점을 기준으로 삼아 직접 먹고 남긴 QA 기록입니다.')
  await memberPage.locator('input[type="file"]').setInputFiles({ name: 'qa-review.png', mimeType: 'image/png', buffer: tinyPng })
  await memberPage.getByLabel('이 사진은 제가 촬영했거나, 게시 권한을 확인한 사진입니다.').check()
  await memberPage.getByRole('button', { name: '리뷰 저장' }).click()
  await expect(memberPage.getByRole('alert').filter({ hasText: '리뷰 이벤트 참여가 아닌 솔직한 리뷰' })).toBeVisible()
  await memberPage.getByLabel('리뷰 이벤트 참여가 아닌 솔직한 리뷰입니다.').check()
  await memberPage.getByRole('button', { name: '리뷰 저장' }).click()
  await expect(memberPage.getByText('2.5점을 기준으로 삼아 직접 먹고 남긴 QA 기록입니다.')).toBeVisible()
  await expect(memberPage.locator('.review-photo-strip img')).toHaveCount(1)

  await memberPage.getByRole('link', { name: '내 리뷰' }).click()
  await expect(memberPage).toHaveURL(/\/my-reviews$/)
  const myReview = memberPage.locator('.my-review-card').filter({ hasText: '2.5점을 기준으로 삼아 직접 먹고 남긴 QA 기록입니다.' })
  await expect(myReview).toBeVisible()
  await myReview.getByRole('button', { name: '수정하기' }).click()
  await expect(myReview.locator('.review-form')).toBeVisible()
  await myReview.locator('.review-form').getByRole('button', { name: '취소' }).click()
  await expect(myReview.locator('.review-form')).toHaveCount(0)

  // Server-admin assigns the registered account as the restaurant owner.
  await page.goto('/admin')
  await page.getByLabel('사용자 이메일 검색').fill(memberEmail)
  await page.getByRole('button', { name: '찾기' }).click()
  await expect(page.getByLabel('가입 계정')).toContainText(memberEmail)
  await page.getByLabel('담당 가게').selectOption(String(menu.restaurantId))
  await page.getByRole('button', { name: '업주 권한 연결' }).click()
  await expect(page.getByText(new RegExp(`${memberEmail}.*업주 권한을 연결`))).toBeVisible()

  // The owner can add, edit, and unlist a menu, but receives no review-delete action.
  // The account was already signed in before the admin changed its restaurant scope.
  await memberPage.reload()
  await memberPage.goto(`/menus/${menu.id}`)
  await expect(memberPage.getByRole('button', { name: '관리자 삭제' })).toHaveCount(0)
  await expect(memberPage.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0)
  const ownerDeleteStatus = await memberPage.evaluate(async () => {
    const csrf = await fetch('/api/auth/csrf').then((response) => response.json()) as { headerName: string; token: string }
    const reviews = await fetch(`/api/menus/${location.pathname.split('/').pop()}/reviews`).then((response) => response.json()) as Array<{ id: number }>
    return fetch(`/api/reviews/${reviews[0].id}`, { method: 'DELETE', headers: { [csrf.headerName]: csrf.token } }).then((response) => response.status)
  })
  expect(ownerDeleteStatus).toBe(403)
  await memberPage.goto(`/restaurants/${menu.restaurantId}`)
  await memberPage.getByRole('button', { name: '메뉴 추가' }).click()
  await memberPage.getByLabel('메뉴 이름').fill('QA 임시 메뉴')
  await memberPage.getByLabel('음식 종류').last().selectOption('KOREAN')
  await memberPage.getByLabel('가격 (원)').fill('4500')
  await memberPage.getByLabel('메뉴 설명').fill('격리 QA용 메뉴')
  await memberPage.locator('.menu-photo-upload input[type="file"]').setInputFiles({ name: 'qa-menu.png', mimeType: 'image/png', buffer: tinyPng })
  await memberPage.getByLabel('이 사진은 제가 촬영했거나 게시 권한을 확인한 사진입니다.').check()
  await memberPage.getByRole('button', { name: '메뉴 저장' }).click()
  const qaMenu = memberPage.locator('.managed-menu').filter({ hasText: 'QA 임시 메뉴' })
  await expect(qaMenu).toBeVisible()
  await expect(qaMenu.locator('img')).toHaveCount(1)
  await qaMenu.getByRole('button', { name: '수정' }).click()
  await memberPage.getByLabel('메뉴 이름').fill('QA 임시 메뉴 수정')
  await memberPage.getByRole('button', { name: '메뉴 저장' }).click()
  const renamedMenu = memberPage.locator('.managed-menu').filter({ hasText: 'QA 임시 메뉴 수정' })
  await expect(renamedMenu).toBeVisible()
  await renamedMenu.getByRole('button', { name: '메뉴 내리기' }).click()
  await memberPage.getByRole('button', { name: '목록에서 내리기' }).click()
  await expect(memberPage.locator('.managed-menu').filter({ hasText: '목록에서 내림' })).toContainText('QA 임시 메뉴 수정')

  // Server-admin review removal and owner assignment revocation.
  await page.goto(`/menus/${menu.id}`)
  await page.getByRole('button', { name: '관리자 삭제' }).click()
  await page.getByRole('button', { name: '삭제하기' }).click()
  await expect(page.getByText('2.5점을 기준으로 삼아 직접 먹고 남긴 QA 기록입니다.')).toHaveCount(0)
  await page.goto('/admin')
  const assignment = page.locator('.owner-assignment-list article').filter({ hasText: memberEmail })
  await assignment.getByRole('button', { name: '권한 해제' }).click()
  await expect(page.getByText(memberEmail, { exact: true })).toHaveCount(0)

  await memberPage.setViewportSize({ width: 390, height: 844 })
  await memberPage.goto('/')
  await memberPage.getByRole('button', { name: '메뉴 열기' }).click()
  await expect(memberPage.getByRole('button', { name: '메뉴 열기' })).toHaveAttribute('aria-expanded', 'true')
  await memberPage.getByRole('link', { name: '메뉴 둘러보기' }).click()
  await expect(memberPage).toHaveURL(/\/$/)

  await member.context.close()
  await context.clearCookies()
})
