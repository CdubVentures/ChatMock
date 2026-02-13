param(
  [switch]$SkipBrowser,
  [switch]$LoginOnly,
  [switch]$ForceLogin
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-DockerEngine {
  Write-Step "Checking Docker engine"
  try {
    docker info | Out-Null
    Write-Host "Docker engine is running."
    return
  } catch {
    Write-Host "Docker engine is not running. Starting Docker Desktop..."
  }

  $dockerDesktopPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path $dockerDesktopPath)) {
    throw "Docker Desktop not found at '$dockerDesktopPath'. Install Docker Desktop first."
  }

  Start-Process $dockerDesktopPath | Out-Null

  $maxChecks = 90
  for ($i = 1; $i -le $maxChecks; $i++) {
    Start-Sleep -Seconds 2
    try {
      docker info | Out-Null
      Write-Host "Docker engine is ready."
      return
    } catch {
      if (($i % 10) -eq 0) {
        Write-Host "Waiting for Docker engine... ($($i * 2)s elapsed)"
      }
    }
  }

  throw "Timed out waiting for Docker engine."
}

function Get-ChromeExecutable {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  )

  foreach ($path in $candidates) {
    if ($path -and (Test-Path $path)) {
      return $path
    }
  }

  try {
    $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
    $regValue = (Get-ItemProperty -Path $regPath -ErrorAction Stop)."(default)"
    if ($regValue -and (Test-Path $regValue)) {
      return $regValue
    }
  } catch {}

  try {
    $regPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
    $regValue = (Get-ItemProperty -Path $regPath -ErrorAction Stop)."(default)"
    if ($regValue -and (Test-Path $regValue)) {
      return $regValue
    }
  } catch {}

  return $null
}

function Open-Url {
  param(
    [string]$Url,
    [string]$BrowserPath
  )

  if ($BrowserPath -and (Test-Path $BrowserPath)) {
    Start-Process -FilePath $BrowserPath -ArgumentList $Url | Out-Null
    return
  }
  Start-Process $Url | Out-Null
}

function Start-Stack {
  Write-Step "Starting Docker Compose stack"
  docker compose up -d --build
}

function Wait-ForHttp {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      # Service still warming up.
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Test-ChatMockAuthFile {
  # First-run detection without spending tokens:
  # check /data/auth.json inside the shared auth volume.
  $probe = "import os,sys; sys.exit(0 if os.path.exists('/data/auth.json') else 1)"
  & docker compose run --rm --no-deps --entrypoint python chatmock -c $probe | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Run-InteractiveLogin {
  Write-Step "ChatMock first-time login required"
  Write-Host "Starting login flow. A browser tab will open automatically when the auth URL is detected."
  Ensure-LoginPortAvailable
  $watcher = Start-AuthUrlWatcher -ProjectRoot $projectRoot -BrowserPath $script:PreferredBrowserPath -TimeoutSeconds 240
  docker compose --profile login run --rm --service-ports chatmock-login
  $loginExit = $LASTEXITCODE

  if ($watcher) {
    if ((Get-Job -Id $watcher.Id -ErrorAction SilentlyContinue) -and $watcher.State -eq "Running") {
      Stop-Job -Id $watcher.Id -ErrorAction SilentlyContinue | Out-Null
    }
    $watcherOutput = Receive-Job -Id $watcher.Id -ErrorAction SilentlyContinue
    if ($watcherOutput) {
      $watcherOutput | ForEach-Object { Write-Host $_ }
    }
    Remove-Job -Id $watcher.Id -ErrorAction SilentlyContinue | Out-Null
  }

  if ($loginExit -ne 0) {
    throw "Login did not complete successfully."
  }
}

function Start-AuthUrlWatcher {
  param(
    [string]$ProjectRoot,
    [string]$BrowserPath,
    [int]$TimeoutSeconds = 240
  )

  return Start-Job -ScriptBlock {
    param($RootPath, $ChosenBrowserPath, $Timeout)

    Set-Location $RootPath
    $deadline = (Get-Date).AddSeconds([int]$Timeout)
    $opened = $false

    while ((Get-Date) -lt $deadline -and -not $opened) {
      try {
        $candidates = @()
        $lines = docker ps --format "{{.ID}}|{{.Names}}" 2>$null
        foreach ($line in $lines) {
          if (-not $line) { continue }
          if ($line -match "\|chatmock-chatmock-login-run-") {
            $parts = $line -split "\|", 2
            if ($parts.Count -eq 2) {
              $candidates += $parts[0]
            }
          }
        }

        foreach ($containerId in ($candidates | Select-Object -Unique)) {
          $logs = (docker logs $containerId 2>&1) | Out-String
          if (-not $logs) { continue }
          $match = [regex]::Match($logs, "https://auth\.openai\.com/oauth/authorize\S+")
          if ($match.Success) {
            if ($ChosenBrowserPath -and (Test-Path $ChosenBrowserPath)) {
              Start-Process -FilePath $ChosenBrowserPath -ArgumentList $match.Value | Out-Null
              Write-Output "Opened Chrome for OpenAI login URL."
            } else {
              Start-Process $match.Value | Out-Null
              Write-Output "Opened default browser for OpenAI login URL."
            }
            $opened = $true
            break
          }
        }
      } catch {
        # Keep polling while container initializes.
      }
      Start-Sleep -Milliseconds 800
    }

    if (-not $opened) {
      Write-Output "Could not auto-detect login URL. Use the URL printed in the terminal output if prompted."
    }
  } -ArgumentList $ProjectRoot, $BrowserPath, $TimeoutSeconds
}

function Remove-StaleLoginContainers {
  $ids = @()
  try {
    $raw = docker ps -aq --filter "name=chatmock-chatmock-login-run-"
    if ($raw) {
      $ids += ($raw | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
    }
  } catch {
    # Ignore and continue.
  }

  if ($ids.Count -gt 0) {
    Write-Host "Removing stale login containers..."
    foreach ($id in ($ids | Select-Object -Unique)) {
      docker rm -f $id | Out-Null
    }
  }
}

function Get-DockerPort1455Holders {
  $holders = @()
  try {
    $lines = docker ps --format "{{.ID}}|{{.Names}}|{{.Ports}}"
    foreach ($line in $lines) {
      if (-not $line) { continue }
      $parts = $line -split "\|", 3
      if ($parts.Count -lt 3) { continue }
      $id = $parts[0]
      $name = $parts[1]
      $ports = $parts[2]
      if ($ports -match "[:\[]1455->|0\.0\.0\.0:1455->|\[::\]:1455->") {
        $holders += [pscustomobject]@{
          Id = $id
          Name = $name
          Ports = $ports
        }
      }
    }
  } catch {
    # Ignore and continue.
  }
  return $holders
}

function Get-ListeningProcessOn1455 {
  try {
    $conn = Get-NetTCPConnection -LocalPort 1455 -State Listen -ErrorAction Stop | Select-Object -First 1
    if (-not $conn) {
      return $null
    }
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    return [pscustomobject]@{
      ProcessId = $conn.OwningProcess
      ProcessName = if ($proc) { $proc.ProcessName } else { "unknown" }
    }
  } catch {
    return $null
  }
}

function Ensure-LoginPortAvailable {
  Remove-StaleLoginContainers

  $holders = Get-DockerPort1455Holders
  if ($holders.Count -gt 0) {
    foreach ($holder in $holders) {
      if ($holder.Name -like "chatmock-chatmock-login-run-*") {
        docker rm -f $holder.Id | Out-Null
      }
    }
  }

  $remaining = Get-DockerPort1455Holders
  if ($remaining.Count -gt 0) {
    $details = ($remaining | ForEach-Object { "$($_.Name) ($($_.Id))" }) -join ", "
    throw "Port 1455 is in use by container(s): $details. Stop them and relaunch."
  }

  $process = Get-ListeningProcessOn1455
  if ($process -and ($process.ProcessName -notmatch "docker|com\.docker")) {
    throw "Port 1455 is currently in use by process '$($process.ProcessName)' (PID $($process.ProcessId)). Close it and relaunch."
  }
}

function Print-ProviderConfig {
  Write-Step "Provider settings for your other app"
  Write-Host "LLM_PROVIDER=chatmock"
  Write-Host "LLM_BASE_URL=http://localhost:8000/v1"
  Write-Host "LLM_MODEL=gpt-5-high"
  Write-Host ""
  Write-Host "Note: ChatMock reasoning variants are exposed like gpt-5-high, gpt-5-medium, gpt-5-low."
}

try {
  $script:PreferredBrowserPath = Get-ChromeExecutable
  if ($script:PreferredBrowserPath) {
    Write-Host "Using Chrome: $script:PreferredBrowserPath"
  } else {
    Write-Host "Chrome not found. Falling back to default browser."
  }

  Ensure-DockerEngine

  if ($LoginOnly) {
    Run-InteractiveLogin
    Print-ProviderConfig
    Write-Host ""
    Write-Host "Login completed." -ForegroundColor Green
    exit 0
  }

  Start-Stack

  if (-not (Wait-ForHttp -Url "http://localhost:8000/health" -TimeoutSeconds 120)) {
    throw "ChatMock did not become healthy on http://localhost:8000/health"
  }

  if ($ForceLogin -or -not (Test-ChatMockAuthFile)) {
    Run-InteractiveLogin
    Start-Stack
  }

  if (-not (Wait-ForHttp -Url "http://localhost:4000/health" -TimeoutSeconds 120)) {
    throw "Eval Bench did not become healthy on http://localhost:4000/health"
  }

  if (-not $SkipBrowser) {
    Open-Url -Url "http://localhost:4000" -BrowserPath $script:PreferredBrowserPath
  }

  Print-ProviderConfig
  Write-Host ""
  Write-Host "LLM Evaluation Lab is running." -ForegroundColor Green
  exit 0
} catch {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Check Docker Desktop and run: docker compose logs --tail 200"
  exit 1
}
