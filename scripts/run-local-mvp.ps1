$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backendDir = Join-Path $repoRoot 'backend'
$frontendDir = Join-Path $repoRoot 'frontend'
$runDir = Join-Path $backendDir 'var\mvp-local'
$mediaDir = Join-Path $runDir 'media'
$logDir = Join-Path $runDir 'logs'
$schema = 'yum_review_mvp'
$adminEmail = 'admin@yum-review.local'
$apiProcess = $null
$viteProcess = $null
$initialAdminPassword = $null

foreach ($port in @(8081, 5173)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "개발 서버 포트 $port 가 이미 사용 중입니다. 기존 프로세스는 종료하지 않았습니다."
    }
}

$createSchemaSql = "CREATE SCHEMA IF NOT EXISTS $schema AUTHORIZATION yum_review"
wsl.exe -d Ubuntu --exec env PGPASSWORD=yum_review_local psql -h 127.0.0.1 -U yum_review -d yum_review -v ON_ERROR_STOP=1 -c $createSchemaSql
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 개발 스키마를 준비하지 못했습니다.' }

$schemaHistoryTable = "SELECT to_regclass('$schema.app_user')"
$userTable = (& wsl.exe -d Ubuntu --exec env PGPASSWORD=yum_review_local psql -h 127.0.0.1 -U yum_review -d yum_review -At -c $schemaHistoryTable | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw '개발 스키마 상태를 확인하지 못했습니다.' }
if ($userTable) {
    $adminCountSql = "SELECT count(*) FROM $schema.app_user WHERE system_role = 'SERVER_ADMIN'"
    $adminCount = [int]((& wsl.exe -d Ubuntu --exec env PGPASSWORD=yum_review_local psql -h 127.0.0.1 -U yum_review -d yum_review -At -c $adminCountSql | Out-String).Trim())
    if ($LASTEXITCODE -ne 0) { throw '개발 관리자 계정 상태를 확인하지 못했습니다.' }
    if ($adminCount -eq 0) {
        $randomBytes = New-Object byte[] 32
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
        $initialAdminPassword = 'YumReview-' + [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
    }
} else {
    $randomBytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
    $initialAdminPassword = 'YumReview-' + [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
}

$env:DB_URL = "jdbc:postgresql://127.0.0.1:5432/yum_review?currentSchema=$schema"
$env:DB_USERNAME = 'yum_review'
$env:DB_PASSWORD = 'yum_review_local'
$env:SERVER_PORT = '8081'
$env:SPRING_FLYWAY_SCHEMAS = $schema
$env:SPRING_FLYWAY_DEFAULT_SCHEMA = $schema
$env:BOOTSTRAP_SERVER_ADMIN_EMAIL = $adminEmail
$env:BOOTSTRAP_SERVER_ADMIN_PASSWORD = $initialAdminPassword
$env:YUM_REVIEW_MEDIA_DIR = $mediaDir
$env:YUM_REVIEW_API_TARGET = 'http://127.0.0.1:8081'

New-Item -ItemType Directory -Path (Join-Path $mediaDir 'tmp') -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$jarPath = Join-Path $backendDir 'target\yum-review-api-0.1.0-SNAPSHOT.jar'
if (-not (Test-Path -LiteralPath $jarPath)) { throw '백엔드 JAR가 없습니다. 먼저 프로젝트를 패키징해 주세요.' }
$java = (Get-Command java.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source

try {
    $apiProcess = Start-Process -FilePath $java -ArgumentList "-jar `"$jarPath`"" -WorkingDirectory $backendDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'api.log') -RedirectStandardError (Join-Path $logDir 'api-error.log')
    $viteProcess = Start-Process -FilePath $node -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $frontendDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'vite.log') -RedirectStandardError (Join-Path $logDir 'vite-error.log')

    $apiReady = $false
    $uiReady = $false
    $until = [DateTime]::UtcNow.AddSeconds(120)
    while ([DateTime]::UtcNow -lt $until -and (-not $apiReady -or -not $uiReady)) {
        if (-not $apiReady) {
            try { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8081/api/auth/csrf' -TimeoutSec 3 -UseBasicParsing; $apiReady = $response.StatusCode -lt 500 } catch { }
        }
        if (-not $uiReady) {
            try { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -TimeoutSec 3 -UseBasicParsing; $uiReady = $response.StatusCode -eq 200 } catch { }
        }
        if (-not $apiReady -or -not $uiReady) { Start-Sleep -Seconds 2 }
    }
    if (-not $apiReady -or -not $uiReady) { throw '개발 서버가 제한 시간 안에 준비되지 않았습니다. backend/var/mvp-local/logs를 확인해 주세요.' }
} catch {
    foreach ($process in @($viteProcess, $apiProcess)) {
        if ($null -ne $process) {
            try { $process.Refresh(); if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit(10000) | Out-Null } } catch { }
        }
    }
    throw
}

[ordered]@{
    url = 'http://localhost:5173/'
    apiPort = 8081
    databaseSchema = $schema
    apiProcessId = $apiProcess.Id
    viteProcessId = $viteProcess.Id
    adminEmail = $adminEmail
    initialAdminPassword = $initialAdminPassword
    firstLoginRequiresPasswordChange = [bool]$initialAdminPassword
} | ConvertTo-Json -Compress
