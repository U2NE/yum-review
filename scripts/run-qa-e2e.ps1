$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectToken = [Guid]::NewGuid().ToString('N').Substring(0, 10)
$qaProject = "yum-review-qa-$projectToken"
$apiProcess = $null
$viteProcess = $null
$qaRunDir = Join-Path $repoRoot "backend\var\$qaProject"
$qaMedia = Join-Path $qaRunDir 'media'
$tempRoot = Join-Path $qaRunDir 'logs'
$apiLog = Join-Path $tempRoot 'api.log'
$apiErrorLog = Join-Path $tempRoot 'api-error.log'
$viteLog = Join-Path $tempRoot 'vite.log'
$viteErrorLog = Join-Path $tempRoot 'vite-error.log'
$composeFile = Join-Path $repoRoot 'compose.qa.yaml'
$qaSchema = "qa_$projectToken"
$qaDatabaseMode = ''
$qaSchemaCreated = $false
$qaSucceeded = $false
$originalEnv = @{}
$envNames = @('DB_URL', 'DB_USERNAME', 'DB_PASSWORD', 'SERVER_PORT', 'BOOTSTRAP_SERVER_ADMIN_EMAIL', 'BOOTSTRAP_SERVER_ADMIN_PASSWORD', 'YUM_REVIEW_MEDIA_DIR', 'YUM_REVIEW_API_TARGET', 'YUM_REVIEW_QA_DB_PASSWORD', 'QA_BASE_URL', 'QA_ADMIN_EMAIL', 'QA_ADMIN_PASSWORD', 'QA_ROTATED_ADMIN_PASSWORD')
foreach ($name in $envNames) { $originalEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

function Set-ProcessEnv([string]$Name, [string]$Value) {
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Wait-Http([string]$Url, [int]$Seconds = 120) {
    $until = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $until) {
        try {
            $response = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch { Start-Sleep -Seconds 2 }
    }
    throw "QA 서비스가 준비되지 않았습니다: $Url"
}

function New-RandomSecret([int]$ByteCount = 32) {
    $bytes = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
}

function Stop-Child([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process) { return }
    try {
        $Process.Refresh()
        if (-not $Process.HasExited) { $Process.Kill($true); $Process.WaitForExit(10000) | Out-Null }
    } catch { }
}

try {
    foreach ($port in @(55432, 18081, 5174)) {
        if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
            throw "격리 QA 포트 $port 가 이미 사용 중입니다. 기존 프로세스를 종료하지 않고 중단합니다."
        }
    }

    $dbPassword = New-RandomSecret 30
    $adminEmail = 'yum-admin@example.invalid'
    $adminPassword = New-RandomSecret 32
    $rotatedPassword = New-RandomSecret 32
    Set-ProcessEnv 'YUM_REVIEW_QA_DB_PASSWORD' $dbPassword
    Set-ProcessEnv 'DB_URL' 'jdbc:postgresql://127.0.0.1:55432/yum_review_qa'
    Set-ProcessEnv 'DB_USERNAME' 'yum_review_qa'
    Set-ProcessEnv 'DB_PASSWORD' $dbPassword
    Set-ProcessEnv 'SERVER_PORT' '18081'
    Set-ProcessEnv 'BOOTSTRAP_SERVER_ADMIN_EMAIL' $adminEmail
    Set-ProcessEnv 'BOOTSTRAP_SERVER_ADMIN_PASSWORD' $adminPassword
    Set-ProcessEnv 'YUM_REVIEW_MEDIA_DIR' $qaMedia
    Set-ProcessEnv 'YUM_REVIEW_API_TARGET' 'http://127.0.0.1:18081'
    Set-ProcessEnv 'QA_BASE_URL' 'http://127.0.0.1:5174'
    Set-ProcessEnv 'QA_ADMIN_EMAIL' $adminEmail
    Set-ProcessEnv 'QA_ADMIN_PASSWORD' $adminPassword
    Set-ProcessEnv 'QA_ROTATED_ADMIN_PASSWORD' $rotatedPassword

    Push-Location (Join-Path $repoRoot 'frontend')
    try {
        if (-not (Test-Path -LiteralPath (Join-Path (Get-Location) 'node_modules\@playwright\test')) -or -not (Test-Path -LiteralPath (Join-Path (Get-Location) 'node_modules\vite'))) {
            npm ci
            if ($LASTEXITCODE -ne 0) { throw '프런트엔드 의존성 설치에 실패했습니다.' }
        }
    }
    finally { Pop-Location }

    Push-Location (Join-Path $repoRoot 'backend')
    try {
        .\mvnw.cmd -q -DskipTests package
        if ($LASTEXITCODE -ne 0) { throw '백엔드 패키징에 실패했습니다.' }
    } finally { Pop-Location }

    Push-Location (Join-Path $repoRoot 'frontend')
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw '프런트엔드 빌드에 실패했습니다.' }
        npx playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw 'Playwright Chromium 설치에 실패했습니다.' }
    } finally { Pop-Location }

    New-Item -ItemType Directory -Path $qaMedia -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $qaMedia 'tmp') -Force | Out-Null
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -eq 0) {
        docker compose -p $qaProject -f $composeFile up -d --wait --wait-timeout 120
        if ($LASTEXITCODE -ne 0) { throw '격리 PostgreSQL을 시작하지 못했습니다.' }
        $qaDatabaseMode = 'compose'
    } else {
        # The local Docker engine can be unavailable on Windows. This fallback creates a
        # uniquely named scratch schema in the project's PostgreSQL, preserving its public schema.
        $qaSchemaSql = "CREATE SCHEMA $qaSchema AUTHORIZATION yum_review"
        wsl.exe -d Ubuntu --exec sh -lc "PGPASSWORD=yum_review_local psql -h 127.0.0.1 -U yum_review -d yum_review -v ON_ERROR_STOP=1 -c '$qaSchemaSql'" *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Docker와 격리 QA 스키마 생성 모두 실패했습니다.' }
        $qaSchemaCreated = $true
        $qaDatabaseMode = 'schema'
        Set-ProcessEnv 'DB_URL' "jdbc:postgresql://127.0.0.1:5432/yum_review?currentSchema=$qaSchema"
        Set-ProcessEnv 'DB_USERNAME' 'yum_review'
        Set-ProcessEnv 'DB_PASSWORD' 'yum_review_local'
        Set-ProcessEnv 'SPRING_FLYWAY_SCHEMAS' $qaSchema
        Set-ProcessEnv 'SPRING_FLYWAY_DEFAULT_SCHEMA' $qaSchema
    }

    $jar = Join-Path $repoRoot 'backend\target\yum-review-api-0.1.0-SNAPSHOT.jar'
    if (-not (Test-Path -LiteralPath $jar)) { throw '패키징된 백엔드 JAR를 찾을 수 없습니다.' }
    $javaCommand = Get-Command java.exe -ErrorAction Stop
    $apiProcess = Start-Process -FilePath $javaCommand.Source -ArgumentList "-jar `"$jar`"" -WorkingDirectory (Join-Path $repoRoot 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrorLog

    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    $viteProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort') -WorkingDirectory (Join-Path $repoRoot 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput $viteLog -RedirectStandardError $viteErrorLog
    Wait-Http 'http://127.0.0.1:18081/api/auth/csrf'
    Wait-Http 'http://127.0.0.1:5174/'

    Push-Location (Join-Path $repoRoot 'frontend')
    try { npm run test:e2e; if ($LASTEXITCODE -ne 0) { throw 'Playwright UI QA에서 실패가 발생했습니다.' } }
    finally { Pop-Location }

    Write-Host '격리 환경에서 브라우저 UI QA가 통과했습니다.'
    $qaSucceeded = $true
}
finally {
    Stop-Child $viteProcess
    Stop-Child $apiProcess
    if ($qaDatabaseMode -eq 'compose') {
        docker compose -p $qaProject -f $composeFile down --volumes --remove-orphans 2>$null | Out-Null
    } elseif ($qaSchemaCreated) {
        wsl.exe -d Ubuntu --exec sh -lc "PGPASSWORD=yum_review_local psql -h 127.0.0.1 -U yum_review -d yum_review -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS $qaSchema CASCADE'" *> $null
    }

    $mediaRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'backend\var'))
    $runPath = [System.IO.Path]::GetFullPath($qaRunDir)
    if ($qaSucceeded -and $runPath.StartsWith($mediaRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $runPath) -eq $qaProject -and (Test-Path -LiteralPath $runPath)) {
        Remove-Item -LiteralPath $runPath -Recurse -Force
    } elseif (-not $qaSucceeded -and (Test-Path -LiteralPath $runPath)) {
        Write-Host "QA 진단 로그 보존 위치: $runPath"
    }
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $originalEnv[$name], 'Process') }
}
