# =====================================================================
#  GIDC  ·  bring the whole dashboard up to date, now
#
#  One run that rebuilds everything the Access database and CallRail can
#  tell us, from the start of 2025 to today. Use it after a reset, after
#  changing a definition, or any time the figures need to be made to
#  agree with the back end again.
#
#  It is the same import the hourly job runs, just over a long stretch
#  instead of two days, so nothing here is special or risky. Every day it
#  writes replaces that day rather than adding to it, so running it twice
#  changes nothing the second time.
#
#  HOW TO RUN IT
#      powershell -ExecutionPolicy Bypass -File "C:\GIDC\gidc-update-now.ps1"
#
#  To see what it would do without doing it:
#      powershell -ExecutionPolicy Bypass -File "C:\GIDC\gidc-update-now.ps1" -WhatIf
#
#  It takes a few minutes. Each year is sent as its own batch so one bad
#  year cannot take the others down with it.
# =====================================================================

param(
  # Where the import script lives. Beside this one by default.
  [string] $Script = "",

  # How far back to go. Access has more history than this, but the
  # dashboard draws twelve periods and compares against last year, so
  # two full years is what it can actually show.
  [string] $From = "2025-01-01",
  [string] $To   = "",

  # The day the live feeds took over from the hand kept figures. These
  # have to match what the hourly job uses or the two will disagree
  # about who owns August.
  [string] $LeadSwitch = "2026-08-01",
  [string] $WebSwitch  = "",

  # Passing the account saves a lookup request on every run and removes
  # the one call that can fail before the useful one.
  [string] $CallRailAccount = "ACC1012e5f19d8441c186e38d729382a1f8",

  [switch] $WhatIf
)

$ErrorActionPreference = "Stop"

if (-not $Script) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $Script = Join-Path $here "gidc-kpi-import.ps1"
}
if (-not (Test-Path -LiteralPath $Script)) {
  Write-Host ("Cannot find the import script at " + $Script) -ForegroundColor Red
  Write-Host "Put this file beside gidc-kpi-import.ps1, or pass -Script with its path."
  exit 1
}

if (-not $To) { $To = (Get-Date).ToString("yyyy-MM-dd") }

# ---- the stretches ---------------------------------------------------
# A year at a time. Eight years in one request is the thing most likely
# to time out, and a year is small enough to retry without thinking.
$start = [datetime]::ParseExact($From, "yyyy-MM-dd", $null)
$end   = [datetime]::ParseExact($To,   "yyyy-MM-dd", $null)
if ($end -lt $start) { Write-Host "The To date is before the From date." -ForegroundColor Red; exit 1 }

$runs = @()
$y = $start.Year
while ($y -le $end.Year) {
  $a = if ($y -eq $start.Year) { $start } else { [datetime]"$y-01-01" }
  $b = if ($y -eq $end.Year)   { $end }   else { [datetime]"$y-12-31" }
  $runs += [pscustomobject]@{ From = $a.ToString("yyyy-MM-dd"); To = $b.ToString("yyyy-MM-dd") }
  $y++
}

Write-Host ("=" * 62)
Write-Host "GIDC, bringing the dashboard up to date" -ForegroundColor Cyan
Write-Host ("=" * 62)
Write-Host ("  {0} to {1}, in {2} batch(es)" -f $From, $To, $runs.Count)
Write-Host ("  callers change hands on {0}" -f $LeadSwitch)
if ($WebSwitch) { Write-Host ("  web submissions change hands on {0}" -f $WebSwitch) }
else            { Write-Host  "  web submissions follow the callers" }
Write-Host ""

$failed = @()
foreach ($r in $runs) {
  Write-Host ("---- {0} to {1} " -f $r.From, $r.To) -ForegroundColor Cyan

  $args = @("-ExecutionPolicy", "Bypass", "-File", $Script,
            "-From", $r.From, "-To", $r.To, "-LeadSwitch", $LeadSwitch)
  if ($WebSwitch)       { $args += @("-WebSwitch", $WebSwitch) }
  if ($CallRailAccount) { $args += @("-CallRailAccount", $CallRailAccount) }
  if ($WhatIf)          { $args += "-WhatIf" }

  Write-Host ("     powershell " + ($args -join " ")) -ForegroundColor DarkGray
  & powershell @args
  if ($LASTEXITCODE -ne 0) {
    Write-Host ("     that batch failed with code {0}" -f $LASTEXITCODE) -ForegroundColor Red
    $failed += ("{0} to {1}" -f $r.From, $r.To)
  }
  Write-Host ""
}

Write-Host ("=" * 62)
if ($failed.Count) {
  Write-Host ("{0} of {1} batches failed:" -f $failed.Count, $runs.Count) -ForegroundColor Red
  $failed | ForEach-Object { Write-Host ("   " + $_) -ForegroundColor Red }
  Write-Host "The ones that worked are in. Fix the reason and run this again:"
  Write-Host "nothing is added twice, so a repeat is free."
  exit 1
}
Write-Host "All of it is in. The dashboard is up to date." -ForegroundColor Green
Write-Host ""
Write-Host "If the hourly job is not set up yet, run gidc-schedule-hourly.ps1 next."
exit 0
