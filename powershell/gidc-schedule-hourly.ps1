# =====================================================================
#  GIDC  ·  set the KPI import to run every hour
#
#  Creates the scheduled task, or replaces it if it is already there, so
#  this is safe to run again when something needs changing.
#
#  MUST BE RUN AS ADMINISTRATOR. Right click PowerShell, Run as
#  administrator, then:
#
#      powershell -ExecutionPolicy Bypass -File "C:\GIDC\gidc-schedule-hourly.ps1"
#
#  WHICH ACCOUNT IT RUNS AS
#
#  By default it asks for an account and password. That matters: the
#  import reads the database over a network share, and a task with no
#  stored password cannot reach a share at all. Use the account that can
#  already open \\SVR-GDDC\GIDC Database.
#
#  The password is handed straight to Windows and is not written down,
#  logged, or kept by this script.
#
#  If the database path is local to this machine rather than a share,
#  -AsSystem avoids needing a password at all.
#
#  TO SEE WHAT IT WOULD DO
#      ... -WhatIf
#  TO STOP IT LATER
#      Unregister-ScheduledTask -TaskName "GIDC KPI import" -Confirm:$false
# =====================================================================

param(
  [string] $TaskName = "GIDC KPI import",
  [string] $Script   = "",

  # Must match what gidc-update-now.ps1 uses, or the hourly job and the
  # catch up will disagree about which source owns August.
  [string] $LeadSwitch = "2026-08-01",
  [string] $WebSwitch  = "",
  [string] $CallRailAccount = "ACC1012e5f19d8441c186e38d729382a1f8",

  # Not on the hour. Everything else on a Windows server fires at :00,
  # and there is no reason to join the queue.
  [int]    $Minute = 7,

  # A run takes a couple of minutes. Half an hour is generous and still
  # well short of the next one, so a hung run cannot pile up.
  [int]    $StopAfterMinutes = 30,

  [switch] $AsSystem,
  [switch] $WhatIf
)

$ErrorActionPreference = "Stop"

function Fail($why) { Write-Host $why -ForegroundColor Red; exit 1 }

if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
  Fail "This machine has no ScheduledTasks module, so the task cannot be set up from here. Use Task Scheduler by hand."
}

$admin = ([Security.Principal.WindowsPrincipal] `
          [Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Fail "Run this as administrator. Right click PowerShell and choose Run as administrator."
}

if (-not $Script) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $Script = Join-Path $here "gidc-kpi-import.ps1"
}
if (-not (Test-Path -LiteralPath $Script)) {
  Fail ("Cannot find the import script at " + $Script + ". Pass -Script with its path.")
}
if ($Minute -lt 0 -or $Minute -gt 59) { Fail "The minute has to be between 0 and 59." }

# ---- what it will run ------------------------------------------------
$argLine = '-ExecutionPolicy Bypass -NoProfile -File "{0}" -LeadSwitch {1}' -f $Script, $LeadSwitch
if ($WebSwitch)       { $argLine += " -WebSwitch $WebSwitch" }
if ($CallRailAccount) { $argLine += " -CallRailAccount $CallRailAccount" }

Write-Host ("=" * 62)
Write-Host "GIDC, setting the KPI import to hourly" -ForegroundColor Cyan
Write-Host ("=" * 62)
Write-Host ("  task      {0}" -f $TaskName)
Write-Host ("  runs      powershell {0}" -f $argLine)
Write-Host ("  when      every hour, at {0} minutes past" -f $Minute)
Write-Host ("  gives up  after {0} minutes, so a stuck run cannot block the next" -f $StopAfterMinutes)
Write-Host ""

# ---- who it runs as --------------------------------------------------
$cred = $null
if (-not $AsSystem) {
  Write-Host "The import reads the database over a network share, and a task" -ForegroundColor Yellow
  Write-Host "with no stored password cannot reach a share. Give the account" -ForegroundColor Yellow
  Write-Host "that can already open it." -ForegroundColor Yellow
  Write-Host ""
  if (-not $WhatIf) {
    $cred = Get-Credential -Message "The account the hourly import should run as" `
                           -UserName ([Environment]::UserName)
    if (-not $cred) { Fail "No account given, so nothing was changed." }
  }
}

# ---- the pieces ------------------------------------------------------
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argLine `
            -WorkingDirectory (Split-Path -Parent $Script)

# A trigger that starts once and repeats for ever is how an hourly job
# is expressed here. Starting in the past is fine and means the first
# run is the next time the clock passes the minute.
$startAt = (Get-Date).Date.AddHours((Get-Date).Hour).AddMinutes($Minute)
if ($startAt -lt (Get-Date)) { $startAt = $startAt.AddHours(1) }
$trigger = New-ScheduledTaskTrigger -Once -At $startAt `
             -RepetitionInterval (New-TimeSpan -Hours 1)

$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes $StopAfterMinutes) `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)

if ($WhatIf) {
  Write-Host "Nothing was changed. Remove -WhatIf to set it up." -ForegroundColor Yellow
  Write-Host ("First run would be {0}" -f $startAt.ToString("yyyy-MM-dd HH:mm"))
  exit 0
}

# ---- replace whatever is there ---------------------------------------
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host ("There is already a task called {0}. Replacing it." -f $TaskName) -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

try {
  if ($AsSystem) {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Settings $settings -User "SYSTEM" -RunLevel Highest `
      -Description "Brings the GIDC KPI dashboard up to date every hour." | Out-Null
  } else {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Settings $settings -User $cred.UserName `
      -Password $cred.GetNetworkCredential().Password -RunLevel Highest `
      -Description "Brings the GIDC KPI dashboard up to date every hour." | Out-Null
  }
} catch {
  Fail ("Windows would not take the task: " + $_.Exception.Message)
}

$cred = $null

Write-Host ""
Write-Host "Set up." -ForegroundColor Green
$t = Get-ScheduledTask -TaskName $TaskName
$i = $t | Get-ScheduledTaskInfo
Write-Host ("  state       {0}" -f $t.State)
Write-Host ("  next run    {0}" -f $i.NextRunTime)

# ---- prove it works now rather than finding out at midnight ----------
Write-Host ""
Write-Host "Running it once now to be sure it works..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 20
$i = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
if ($i.LastTaskResult -eq 0) {
  Write-Host "  it ran and finished cleanly." -ForegroundColor Green
} elseif ($i.LastTaskResult -eq 267009) {
  Write-Host "  it is still running, which is normal. Check the log in a minute:" -ForegroundColor Yellow
  Write-Host "     C:\GIDC\logs"
} else {
  Write-Host ("  it finished with code {0}, which is not a clean run." -f $i.LastTaskResult) -ForegroundColor Red
  Write-Host "  Open Task Scheduler, find the task, and look at History."
  Write-Host "  The usual cause is the account not being able to reach the share."
}

Write-Host ""
Write-Host "To change it later, run this again. To stop it:"
Write-Host ('   Unregister-ScheduledTask -TaskName "' + $TaskName + '" -Confirm:$false')
exit 0
