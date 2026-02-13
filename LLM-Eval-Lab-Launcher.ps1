Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$script:activeProcess = $null
$script:activeProcessName = ""
$script:activeSubscriptions = @()

function Append-Log {
  param([string]$Message)
  if ([string]::IsNullOrWhiteSpace($Message)) {
    return
  }

  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message.TrimEnd()
  if ($script:logBox.InvokeRequired) {
    $null = $script:logBox.BeginInvoke((New-Object System.Action {
      $script:logBox.AppendText($line + [Environment]::NewLine)
      $script:logBox.SelectionStart = $script:logBox.TextLength
      $script:logBox.ScrollToCaret()
    }))
    return
  }

  $script:logBox.AppendText($line + [Environment]::NewLine)
  $script:logBox.SelectionStart = $script:logBox.TextLength
  $script:logBox.ScrollToCaret()
}

function Set-TaskStatus {
  param(
    [string]$Text,
    [System.Drawing.Color]$Color
  )
  if ($script:taskStatusLabel.InvokeRequired) {
    $null = $script:taskStatusLabel.BeginInvoke((New-Object System.Action {
      $script:taskStatusLabel.Text = $Text
      $script:taskStatusLabel.ForeColor = $Color
    }))
    return
  }

  $script:taskStatusLabel.Text = $Text
  $script:taskStatusLabel.ForeColor = $Color
}

function Set-BusyState {
  param([bool]$Busy)
  $script:startButton.Enabled = -not $Busy
  $script:rebuildButton.Enabled = -not $Busy
  $script:loginButton.Enabled = -not $Busy
  $script:stopButton.Enabled = -not $Busy
  $script:queueButton.Enabled = -not $Busy
}

function Clear-ProcessSubscriptions {
  foreach ($sub in $script:activeSubscriptions) {
    try {
      Unregister-Event -SourceIdentifier $sub.Name -ErrorAction SilentlyContinue
    } catch {}
    try {
      Remove-Job -Id $sub.Id -Force -ErrorAction SilentlyContinue
    } catch {}
  }
  $script:activeSubscriptions = @()
}

function Start-LoggedProcess {
  param(
    [string]$DisplayName,
    [string]$FileName,
    [string]$Arguments
  )

  if ($script:activeProcess -and -not $script:activeProcess.HasExited) {
    [System.Windows.Forms.MessageBox]::Show(
      "A command is already running: $($script:activeProcessName)",
      "Launcher Busy",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    return
  }

  Clear-ProcessSubscriptions
  Set-BusyState -Busy $true
  Set-TaskStatus -Text "Running: $DisplayName" -Color ([System.Drawing.Color]::DarkOrange)
  Append-Log "Starting $DisplayName"

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FileName
  $psi.Arguments = $Arguments
  $psi.WorkingDirectory = $projectRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $proc.EnableRaisingEvents = $true

  $script:activeProcess = $proc
  $script:activeProcessName = $DisplayName

  $subOut = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
    if (-not [string]::IsNullOrWhiteSpace($EventArgs.Data)) {
      Append-Log $EventArgs.Data
    }
  }
  $subErr = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
    if (-not [string]::IsNullOrWhiteSpace($EventArgs.Data)) {
      $line = $EventArgs.Data.Trim()
      if ($line -match "^(ERROR:|Error:|error:|failed|exception|Traceback)") {
        Append-Log ("ERR: " + $line)
      } else {
        Append-Log $line
      }
    }
  }
  $subExit = Register-ObjectEvent -InputObject $proc -EventName Exited -Action {
    $exitCode = $Event.Sender.ExitCode
    Append-Log "$($script:activeProcessName) finished with exit code $exitCode"
    if ($exitCode -eq 0) {
      Set-TaskStatus -Text "Idle" -Color ([System.Drawing.Color]::ForestGreen)
    } else {
      Set-TaskStatus -Text "Failed (exit code $exitCode)" -Color ([System.Drawing.Color]::Firebrick)
    }
    Set-BusyState -Busy $false
    $script:activeProcess = $null
    $script:activeProcessName = ""
    Update-HealthStatus
    Clear-ProcessSubscriptions
  }
  $script:activeSubscriptions = @($subOut, $subErr, $subExit)

  $null = $proc.Start()
  $proc.BeginOutputReadLine()
  $proc.BeginErrorReadLine()
}

function Test-Url {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Set-ServiceStatusLabel {
  param(
    [System.Windows.Forms.Label]$Label,
    [bool]$Healthy,
    [string]$OkText,
    [string]$FailText
  )
  $Label.Text = if ($Healthy) { $OkText } else { $FailText }
  $Label.ForeColor = if ($Healthy) { [System.Drawing.Color]::ForestGreen } else { [System.Drawing.Color]::Firebrick }
}

function Update-HealthStatus {
  $chatmockUp = Test-Url -Url "http://localhost:8000/health"
  $benchUp = Test-Url -Url "http://localhost:4000/health"

  Set-ServiceStatusLabel -Label $script:chatmockStatusLabel -Healthy $chatmockUp -OkText "ChatMock: Up" -FailText "ChatMock: Down"
  Set-ServiceStatusLabel -Label $script:benchStatusLabel -Healthy $benchUp -OkText "Eval Bench: Up" -FailText "Eval Bench: Down"
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "LLM Evaluation Lab Launcher"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(960, 680)
$form.MinimumSize = New-Object System.Drawing.Size(900, 620)
$form.BackColor = [System.Drawing.Color]::FromArgb(246, 248, 252)

$headerLabel = New-Object System.Windows.Forms.Label
$headerLabel.Text = "LLM Evaluation Lab"
$headerLabel.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$headerLabel.Location = New-Object System.Drawing.Point(20, 18)
$headerLabel.AutoSize = $true
$form.Controls.Add($headerLabel)

$subLabel = New-Object System.Windows.Forms.Label
$subLabel.Text = "One-click control panel for Docker stack, login, queue test, and bench UI."
$subLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$subLabel.ForeColor = [System.Drawing.Color]::DimGray
$subLabel.Location = New-Object System.Drawing.Point(23, 52)
$subLabel.AutoSize = $true
$form.Controls.Add($subLabel)

$statusPanel = New-Object System.Windows.Forms.Panel
$statusPanel.Location = New-Object System.Drawing.Point(20, 84)
$statusPanel.Size = New-Object System.Drawing.Size(900, 60)
$statusPanel.BackColor = [System.Drawing.Color]::White
$statusPanel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$form.Controls.Add($statusPanel)

$script:chatmockStatusLabel = New-Object System.Windows.Forms.Label
$script:chatmockStatusLabel.Text = "ChatMock: Checking..."
$script:chatmockStatusLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$script:chatmockStatusLabel.Location = New-Object System.Drawing.Point(16, 20)
$script:chatmockStatusLabel.AutoSize = $true
$statusPanel.Controls.Add($script:chatmockStatusLabel)

$script:benchStatusLabel = New-Object System.Windows.Forms.Label
$script:benchStatusLabel.Text = "Eval Bench: Checking..."
$script:benchStatusLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$script:benchStatusLabel.Location = New-Object System.Drawing.Point(210, 20)
$script:benchStatusLabel.AutoSize = $true
$statusPanel.Controls.Add($script:benchStatusLabel)

$script:taskStatusLabel = New-Object System.Windows.Forms.Label
$script:taskStatusLabel.Text = "Idle"
$script:taskStatusLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$script:taskStatusLabel.ForeColor = [System.Drawing.Color]::ForestGreen
$script:taskStatusLabel.Location = New-Object System.Drawing.Point(430, 20)
$script:taskStatusLabel.AutoSize = $true
$statusPanel.Controls.Add($script:taskStatusLabel)

$buttonPanel = New-Object System.Windows.Forms.Panel
$buttonPanel.Location = New-Object System.Drawing.Point(20, 156)
$buttonPanel.Size = New-Object System.Drawing.Size(900, 120)
$buttonPanel.BackColor = [System.Drawing.Color]::White
$buttonPanel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$form.Controls.Add($buttonPanel)

function New-ActionButton {
  param(
    [string]$Text,
    [int]$X,
    [int]$Y
  )
  $btn = New-Object System.Windows.Forms.Button
  $btn.Text = $Text
  $btn.Size = New-Object System.Drawing.Size(170, 38)
  $btn.Location = New-Object System.Drawing.Point($X, $Y)
  $btn.Font = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Bold)
  $btn.BackColor = [System.Drawing.Color]::FromArgb(40, 112, 255)
  $btn.ForeColor = [System.Drawing.Color]::White
  $btn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $btn.FlatAppearance.BorderSize = 0
  return $btn
}

$script:startButton = New-ActionButton -Text "Start Stack" -X 16 -Y 14
$script:startButton.Add_Click({
  $arg = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$projectRoot\Launch-LLM-Eval-Lab.ps1`""
  Start-LoggedProcess -DisplayName "Start Stack" -FileName "powershell.exe" -Arguments $arg
})
$buttonPanel.Controls.Add($script:startButton)

$script:rebuildButton = New-ActionButton -Text "Start + Rebuild" -X 196 -Y 14
$script:rebuildButton.BackColor = [System.Drawing.Color]::FromArgb(24, 140, 96)
$script:rebuildButton.Add_Click({
  $arg = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$projectRoot\Launch-LLM-Eval-Lab.ps1`" -Rebuild"
  Start-LoggedProcess -DisplayName "Start + Rebuild" -FileName "powershell.exe" -Arguments $arg
})
$buttonPanel.Controls.Add($script:rebuildButton)

$script:loginButton = New-ActionButton -Text "Login Only" -X 376 -Y 14
$script:loginButton.BackColor = [System.Drawing.Color]::FromArgb(96, 72, 180)
$script:loginButton.Add_Click({
  $arg = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$projectRoot\Launch-LLM-Eval-Lab.ps1`" -LoginOnly"
  Start-LoggedProcess -DisplayName "Login Only" -FileName "powershell.exe" -Arguments $arg
})
$buttonPanel.Controls.Add($script:loginButton)

$script:stopButton = New-ActionButton -Text "Stop Stack" -X 556 -Y 14
$script:stopButton.BackColor = [System.Drawing.Color]::FromArgb(200, 70, 55)
$script:stopButton.Add_Click({
  $arg = "-NoLogo -NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$projectRoot'; docker compose down`""
  Start-LoggedProcess -DisplayName "Stop Stack" -FileName "powershell.exe" -Arguments $arg
})
$buttonPanel.Controls.Add($script:stopButton)

$script:queueButton = New-ActionButton -Text "Run Queue Test" -X 736 -Y 14
$script:queueButton.BackColor = [System.Drawing.Color]::FromArgb(28, 128, 156)
$script:queueButton.Add_Click({
  $arg = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$projectRoot\test.queue.ps1`""
  Start-LoggedProcess -DisplayName "Run Queue Test" -FileName "powershell.exe" -Arguments $arg
})
$buttonPanel.Controls.Add($script:queueButton)

$openBenchButton = New-Object System.Windows.Forms.Button
$openBenchButton.Text = "Open Eval Bench"
$openBenchButton.Size = New-Object System.Drawing.Size(170, 32)
$openBenchButton.Location = New-Object System.Drawing.Point(16, 66)
$openBenchButton.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$openBenchButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$openBenchButton.Add_Click({
  Start-Process "http://localhost:4000" | Out-Null
})
$buttonPanel.Controls.Add($openBenchButton)

$openProxyButton = New-Object System.Windows.Forms.Button
$openProxyButton.Text = "Open Proxy Traffic API"
$openProxyButton.Size = New-Object System.Drawing.Size(170, 32)
$openProxyButton.Location = New-Object System.Drawing.Point(196, 66)
$openProxyButton.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$openProxyButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$openProxyButton.Add_Click({
  Start-Process "http://localhost:8000/debug/traffic" | Out-Null
})
$buttonPanel.Controls.Add($openProxyButton)

$providerBox = New-Object System.Windows.Forms.TextBox
$providerBox.Multiline = $true
$providerBox.ReadOnly = $true
$providerBox.Location = New-Object System.Drawing.Point(376, 68)
$providerBox.Size = New-Object System.Drawing.Size(530, 38)
$providerBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$providerBox.Text = "LLM_PROVIDER=chatmock`r`nLLM_BASE_URL=http://localhost:8000/v1`r`nLLM_MODEL=gpt-5-high"
$buttonPanel.Controls.Add($providerBox)

$logPanel = New-Object System.Windows.Forms.Panel
$logPanel.Location = New-Object System.Drawing.Point(20, 290)
$logPanel.Size = New-Object System.Drawing.Size(900, 330)
$logPanel.BackColor = [System.Drawing.Color]::White
$logPanel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$form.Controls.Add($logPanel)

$logHeader = New-Object System.Windows.Forms.Label
$logHeader.Text = "Launcher Log"
$logHeader.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$logHeader.Location = New-Object System.Drawing.Point(12, 10)
$logHeader.AutoSize = $true
$logPanel.Controls.Add($logHeader)

$script:logBox = New-Object System.Windows.Forms.TextBox
$script:logBox.Multiline = $true
$script:logBox.ReadOnly = $true
$script:logBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$script:logBox.Location = New-Object System.Drawing.Point(14, 34)
$script:logBox.Size = New-Object System.Drawing.Size(870, 280)
$script:logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$script:logBox.BackColor = [System.Drawing.Color]::FromArgb(250, 251, 253)
$logPanel.Controls.Add($script:logBox)

$clearLogButton = New-Object System.Windows.Forms.Button
$clearLogButton.Text = "Clear Log"
$clearLogButton.Size = New-Object System.Drawing.Size(90, 26)
$clearLogButton.Location = New-Object System.Drawing.Point(794, 6)
$clearLogButton.Add_Click({ $script:logBox.Clear() })
$logPanel.Controls.Add($clearLogButton)

$statusTimer = New-Object System.Windows.Forms.Timer
$statusTimer.Interval = 5000
$statusTimer.Add_Tick({ Update-HealthStatus })
$statusTimer.Start()

$form.Add_Shown({
  Append-Log "Launcher ready at $projectRoot"
  Append-Log "Double-click this launcher any time to start/login/stop without terminal commands."
  Update-HealthStatus
})

$form.Add_FormClosing({
  if ($script:activeProcess -and -not $script:activeProcess.HasExited) {
    $answer = [System.Windows.Forms.MessageBox]::Show(
      "A command is still running. Close anyway?",
      "Confirm Close",
      [System.Windows.Forms.MessageBoxButtons]::YesNo,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
      $_.Cancel = $true
      return
    }
  }
  $statusTimer.Stop()
  Clear-ProcessSubscriptions
})

[void]$form.ShowDialog()
