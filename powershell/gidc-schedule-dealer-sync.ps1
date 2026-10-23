# =====================================================================
#  GIDC  ·  set the dealer order sync to run every hour
#
#  gidc-schedule-hourly.ps1 only ever scheduled the KPI import. Nothing
#  scheduled gidc-dealer-sync.ps1, so unless a task was made for it by
#  hand, statuses and ship dates only moved when somebody ran it. This
#  makes that task, or replaces it, so it is safe to run again.
#
#  MUST BE RUN AS ADMINISTRATOR. Right click PowerShell, Run as
#  administrator, then:
#
#      powershell -ExecutionPolicy Bypass -File "C:\GIDC\gidc-schedule-dealer-sync.ps1"
#
#  It asks for the account to run as, for the same reason the KPI task
#  does: the sync reads the database over a network share, and a task
#  with no stored password cannot reach a share. Use the account the KPI
#  import task already runs as. The password goes straight to Windows
#  and is not written down, logged, or kept by this script.
#
#  TO SEE WHAT IT WOULD DO
#      ... -WhatIf
#  TO STOP IT LATER
#      Unregister-ScheduledTask -TaskName "GIDC dealer sync" -Confirm:$false
# =====================================================================

param(
  [string] $TaskName = "GIDC dealer sync",
  [string] $Script   = "",
  # Half past, so it never shares a minute with the KPI import at :07.
  [int]    $Minute = 37,
  [int]    $StopAfterMinutes = 20,
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
if (-not $admin) { Fail "Run this as administrator. Right click PowerShell and choose Run as administrator." }

if (-not $Script) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $Script = Join-Path $here "gidc-dealer-sync.ps1"
}
if (-not (Test-Path -LiteralPath $Script)) { Fail ("Cannot find the sync script at " + $Script + ". Pass -Script with its path.") }
if ($Minute -lt 0 -or $Minute -gt 59) { Fail "The minute has to be between 0 and 59." }

# The key is read from the machine, not the person, because a scheduled
# task does not see a variable set only for whoever was signed in.
if (-not [Environment]::GetEnvironmentVariable("GIDC_KPI_KEY", "Machine")) {
  Write-Host "GIDC_KPI_KEY is not set for the whole machine, so the task would run and send nothing." -ForegroundColor Yellow
  Write-Host "Set it the same way as for the KPI import, then run this again." -ForegroundColor Yellow
  if (-not $WhatIf) { exit 1 }
}

$argLine = '-ExecutionPolicy Bypass -NoProfile -File "{0}"' -f $Script
Write-Host ("=" * 62)
Write-Host "GIDC, setting the dealer order sync to hourly" -ForegroundColor Cyan
Write-Host ("=" * 62)
Write-Host ("  task      {0}" -f $TaskName)
Write-Host ("  runs      powershell {0}" -f $argLine)
Write-Host ("  when      every hour, at {0} minutes past" -f $Minute)
Write-Host ""

$cred = $null
if (-not $AsSystem -and -not $WhatIf) {
  $cred = Get-Credential -Message "The account the hourly dealer sync should run as" `
                         -UserName ([Environment]::UserName)
  if (-not $cred) { Fail "No account given, so nothing was changed." }
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argLine `
            -WorkingDirectory (Split-Path -Parent $Script)
$startAt = (Get-Date).Date.AddHours((Get-Date).Hour).AddMinutes($Minute)
if ($startAt -lt (Get-Date)) { $startAt = $startAt.AddHours(1) }
$trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
  -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes $StopAfterMinutes) `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)

if ($WhatIf) {
  Write-Host "Nothing was changed. Remove -WhatIf to set it up." -ForegroundColor Yellow
  Write-Host ("First run would be {0}" -f $startAt.ToString("yyyy-MM-dd HH:mm"))
  exit 0
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host ("There is already a task called {0}. Replacing it." -f $TaskName) -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
$desc = "Moves dealer portal statuses and ship dates from Access every hour."
try {
  if ($AsSystem) {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Settings $settings -User "SYSTEM" -RunLevel Highest -Description $desc | Out-Null
  } else {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Settings $settings -User $cred.UserName -Password $cred.GetNetworkCredential().Password `
      -RunLevel Highest -Description $desc | Out-Null
  }
} catch { Fail ("Windows would not take the task: " + $_.Exception.Message) }
$cred = $null

Write-Host "Set up. Running it once now to be sure it works..." -ForegroundColor Green
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 30
$i = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
if ($i.LastTaskResult -eq 0) {
  Write-Host "  it ran and finished cleanly. The last line of C:\GIDC\logs\dealer-sync.log says what moved." -ForegroundColor Green
} elseif ($i.LastTaskResult -eq 267009) {
  Write-Host "  it is still running, which is normal. Check C:\GIDC\logs\dealer-sync.log in a minute." -ForegroundColor Yellow
} else {
  Write-Host ("  it finished with code {0}, which is not a clean run." -f $i.LastTaskResult) -ForegroundColor Red
  Write-Host "  Run gidc-dealer-sync.ps1 by hand in a window to see the reason."
}
exit 0
