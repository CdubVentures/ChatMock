param(
  [switch]$Rebuild,
  [switch]$LoginOnly,
  [switch]$SkipBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

# In PowerShell 7+, native-command stderr can become terminating errors when
# ErrorActionPreference=Stop. Docker emits benign warnings on stderr; ignore them.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-ChromePath {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  )
  foreach ($path in $candidates) {
    if ([string]::IsNullOrWhiteSpace($path)) {
      continue
    }
    if (Test-Path $path) {
      return $path
    }
  }
  return $null
}

function Open-Url {
  param(
    [string]$Url,
    [string]$ChromePath
  )
  if ($SkipBrowser) {
    return
  }
  if ($ChromePath -and (Test-Path $ChromePath)) {
    Start-Process -FilePath $ChromePath -ArgumentList @("--new-tab", $Url) | Out-Null
    return
  }
  Start-Process $Url | Out-Null
}

function Ensure-DockerEngine {
  Write-Step "Checking Docker engine"
  & docker ps --format "{{.ID}}" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Docker engine is running."
    return
  }

  $dockerDesktop = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path $dockerDesktop)) {
    throw "Docker Desktop is not running and was not found at: $dockerDesktop"
  }

  Write-Host "Docker engine not ready. Starting Docker Desktop..."
  Start-Process $dockerDesktop | Out-Null

  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 2
    & docker ps --format "{{.ID}}" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Docker engine is running."
      return
    }
  }

  throw "Docker engine did not become ready within 4 minutes."
}

function Invoke-Compose {
  param([string[]]$ComposeArgs)

  if (-not $ComposeArgs -or $ComposeArgs.Count -eq 0) {
    throw "Internal error: Invoke-Compose called without arguments."
  }

  & docker compose @ComposeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($ComposeArgs -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Remove-StaleLoginContainers {
  Write-Host "Removing stale login containers..."
  $ids = @(
    docker ps -a --filter "publish=1455" --format "{{.ID}}" 2>$null
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  if ($ids.Count -eq 0) {
    Write-Host "No stale login containers found."
    return
  }

  foreach ($id in $ids) {
    docker rm -f $id *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Removed container: $id"
    }
  }
}

function Test-ChatMockAuth {
  # Fast, warning-free auth check: verify persisted auth file in shared volume.
  & docker compose run --rm --no-deps --entrypoint python chatmock -c "import os,sys; sys.exit(0 if os.path.exists('/data/auth.json') else 1)" 1>$null 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Run-LoginFlow {
  param([string]$ChromePath)

  Write-Step "ChatMock first-time login required"
  Write-Host "Starting login flow. A browser tab will open automatically when the auth URL is detected."
  Remove-StaleLoginContainers

  $opened = $false
  & docker compose --profile login run --rm --service-ports --build chatmock-login 2>&1 | ForEach-Object {
    $line = $_.ToString()
    Write-Host $line
    if (-not $opened -and $line -match "https://auth\.openai\.com/\S+") {
      $authUrl = $Matches[0].Trim()
      Write-Host "Opening auth URL in browser..."
      Open-Url -Url $authUrl -ChromePath $ChromePath
      $opened = $true
    }
  }

  if ($LASTEXITCODE -ne 0) {
    throw "Login flow exited with code $LASTEXITCODE."
  }

  if (-not (Test-ChatMockAuth)) {
    throw "Login did not complete successfully."
  }
}

function Wait-ForService {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 90
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  return $false
}

function Start-Stack {
  Write-Step "Starting Docker Compose stack"
  if ($Rebuild) {
    Invoke-Compose -ComposeArgs @("up", "-d", "--build")
    return
  }
  Invoke-Compose -ComposeArgs @("up", "-d")
}

try {
  $chromePath = Get-ChromePath
  if ($chromePath) {
    Write-Host "Using Chrome: $chromePath"
  }

  Ensure-DockerEngine

  if ($LoginOnly) {
    Run-LoginFlow -ChromePath $chromePath
    Write-Host ""
    Write-Host "Login complete." -ForegroundColor Green
    exit 0
  }

  Start-Stack

  if (-not (Test-ChatMockAuth)) {
    Run-LoginFlow -ChromePath $chromePath
    Write-Step "Refreshing stack after login"
    Invoke-Compose -ComposeArgs @("up", "-d")
  }

  $benchUp = Wait-ForService -Url "http://localhost:4000/health" -TimeoutSeconds 90
  if ($benchUp) {
    Write-Host ""
    Write-Host "Eval Bench is up: http://localhost:4000" -ForegroundColor Green
    Open-Url -Url "http://localhost:4000" -ChromePath $chromePath
  } else {
    Write-Host "Eval Bench did not report healthy within timeout." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Use this in your app:"
  Write-Host "LLM_PROVIDER=chatmock"
  Write-Host "LLM_BASE_URL=http://localhost:8000/v1"
  Write-Host "LLM_MODEL=gpt-5-high"
} catch {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Check Docker Desktop and run: docker compose logs --tail 200" -ForegroundColor Yellow
  exit 1
}
