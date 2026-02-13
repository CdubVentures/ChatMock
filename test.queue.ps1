param(
  [int]$RequestCount = 5,
  [string]$Model = "gpt-5-high",
  [string]$BaseUrl = "http://localhost:8000/v1"
)

$ErrorActionPreference = "Stop"
$endpoint = "$BaseUrl/chat/completions"

function New-Result {
  param(
    [int]$Id,
    [datetime]$StartedAt,
    [datetime]$CompletedAt,
    [double]$ElapsedSeconds,
    [bool]$Ok,
    [int]$StatusCode,
    [string]$Message
  )

  [pscustomobject]@{
    id = $Id
    started_at = $StartedAt
    completed_at = $CompletedAt
    elapsed_s = [math]::Round($ElapsedSeconds, 2)
    ok = $Ok
    status_code = $StatusCode
    message = $Message
  }
}

Write-Host ""
Write-Host "Queue test target: $endpoint"
Write-Host "Requests: $RequestCount | Model: $Model"
Write-Host ""

try {
  $health = Invoke-RestMethod -Uri "http://localhost:8000/health" -Method Get -TimeoutSec 10
  if (-not $health) {
    throw "health endpoint returned empty response"
  }
} catch {
  Write-Host "ERROR: ChatMock is not reachable at http://localhost:8000." -ForegroundColor Red
  Write-Host "Start the lab first (Launch-LLM-Eval-Lab.bat)." -ForegroundColor Yellow
  exit 1
}

$jobs = @()
for ($i = 1; $i -le $RequestCount; $i++) {
  $jobs += Start-Job -ArgumentList $i, $endpoint, $Model -ScriptBlock {
    param($id, $uri, $model)
    $started = Get-Date
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      $payload = @{
        model = $model
        stream = $false
        messages = @(
          @{
            role = "user"
            content = "Queue test request #$id. Reply with exactly: ok-$id"
          }
        )
      } | ConvertTo-Json -Depth 10

      $resp = Invoke-RestMethod `
        -Uri $uri `
        -Method Post `
        -ContentType "application/json" `
        -Headers @{ Authorization = "Bearer key" } `
        -Body $payload `
        -TimeoutSec 1800

      $sw.Stop()
      $done = Get-Date
      $msg = ""
      try {
        $msg = [string]$resp.choices[0].message.content
      } catch {
        $msg = "<no message content>"
      }

      [pscustomobject]@{
        id = $id
        started_at = $started
        completed_at = $done
        elapsed_s = [math]::Round($sw.Elapsed.TotalSeconds, 2)
        ok = $true
        status_code = 200
        message = $msg
      }
    } catch {
      $sw.Stop()
      $done = Get-Date
      $status = 0
      try {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
          $status = [int]$_.Exception.Response.StatusCode
        }
      } catch {
        $status = 0
      }

      [pscustomobject]@{
        id = $id
        started_at = $started
        completed_at = $done
        elapsed_s = [math]::Round($sw.Elapsed.TotalSeconds, 2)
        ok = $false
        status_code = $status
        message = $_.Exception.Message
      }
    }
  }
}

Wait-Job -Job $jobs | Out-Null
$results = Receive-Job -Job $jobs
Remove-Job -Job $jobs | Out-Null

$resultsById = $results | Sort-Object id
$resultsByDone = $results | Sort-Object completed_at

Write-Host ""
Write-Host "Results (by completion time):"
$resultsByDone | Format-Table id, elapsed_s, ok, status_code, completed_at -AutoSize

$failed = $results | Where-Object { -not $_.ok }
if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "FAILED: One or more requests failed." -ForegroundColor Red
  $failed | Format-Table id, status_code, message -AutoSize
  if (($failed | Where-Object { $_.status_code -eq 401 }).Count -gt 0) {
    Write-Host "Hint: run Login-LLM-Eval-Lab.bat first." -ForegroundColor Yellow
  }
  exit 1
}

$expectedOrder = (1..$RequestCount) -join ","
$actualOrder = ($resultsByDone | ForEach-Object { $_.id }) -join ","
$fifoOrderOk = ($expectedOrder -eq $actualOrder)

$elapsedList = $resultsById | ForEach-Object { [double]$_.elapsed_s }
$monotonicOk = $true
for ($i = 1; $i -lt $elapsedList.Count; $i++) {
  if ($elapsedList[$i] -lt $elapsedList[$i - 1]) {
    $monotonicOk = $false
    break
  }
}

Write-Host ""
Write-Host "Expected completion order: $expectedOrder"
Write-Host "Actual completion order:   $actualOrder"
Write-Host "Elapsed by request id:     $($elapsedList -join ', ')"

if ($fifoOrderOk -and $monotonicOk) {
  Write-Host ""
  Write-Host "PASS: Queue appears FIFO (single active request behavior)." -ForegroundColor Green
  exit 0
}

Write-Host ""
Write-Host "WARN: Queue result is inconclusive/non-FIFO." -ForegroundColor Yellow
Write-Host "This can happen if model latencies are highly irregular. Re-run the test." -ForegroundColor Yellow
exit 2
