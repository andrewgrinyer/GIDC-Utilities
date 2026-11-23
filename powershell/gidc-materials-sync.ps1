# =====================================================================
#  GIDC  ·  hourly materials sync: paint, Shop Supplies and Hardware
#
#  Andrew, 23 November: one utility on the server for all the materials,
#  not one per list. This runs each materials sync in turn, in the same
#  PowerShell, and one hourly task (GIDC materials sync) runs this. It
#  replaces the separate GIDC paint sync and GIDC supplies sync tasks.
#
#    gidc-paint-sync.ps1     paint and primer for the schedule
#    gidc-supplies-sync.ps1  Shop Supplies and Hardware: pine, rerail,
#                            valances, astragals, hinges, tracks, rollers,
#                            floor guides, finger pulls, flush bolts
#
#  A new list later (Sanding, Install) is one more name in -Parts.
#  Each part runs on its own: if one fails, the others still run, and
#  the run ends with code 1 so the task shows it did not go cleanly.
#
#  SEE WHAT IT WOULD SEND, SENDING NOTHING
#      .\gidc-materials-sync.ps1 -WhatIf
#  SEND NOW
#      .\gidc-materials-sync.ps1
#  ONLY ONE PART
#      .\gidc-materials-sync.ps1 -Parts gidc-paint-sync.ps1
#
#  Reads Access only, through the parts. Each part keeps its own log in
#  C:\GIDC\logs; this adds one line per run to materials-sync.log.
# =====================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string[]] $Parts = @("gidc-paint-sync.ps1", "gidc-supplies-sync.ps1"),
  [string]   $LogDir = "C:\GIDC\logs"
)

$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
# The same PowerShell as this one, so a 32 bit run stays 32 bit for the
# Access engine.
$ps = (Get-Process -Id $PID).Path
if (-not $ps) { $ps = "powershell.exe" }

$results = @()
$bad = 0
foreach ($p in $Parts) {
  $file = if ([IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $here $p }
  Write-Host ""
  Write-Host ("=" * 62)
  Write-Host ("  " + [IO.Path]::GetFileNameWithoutExtension($file)) -ForegroundColor Cyan
  Write-Host ("=" * 62)
  if (-not (Test-Path -LiteralPath $file)) {
    Write-Host ("Cannot find " + $file + ". It needs to sit beside this script.") -ForegroundColor Red
    $results += ("{0} missing" -f $p); $bad++
    continue
  }
  $args2 = @("-ExecutionPolicy", "Bypass", "-NoProfile", "-File", $file)
  if ($WhatIfPreference) { $args2 += "-WhatIf" }
  $started = Get-Date
  & $ps @args2
  $code = $LASTEXITCODE
  $secs = [int]((Get-Date) - $started).TotalSeconds
  if ($code -eq 0) { $results += ("{0} ok {1}s" -f $p, $secs) }
  else { $results += ("{0} FAILED code {1}" -f $p, $code); $bad++ }
}

Write-Host ""
Write-Host ("=" * 62)
foreach ($r in $results) {
  Write-Host ("  " + $r) -ForegroundColor $(if ($r -match 'FAILED|missing') { "Red" } else { "Green" })
}
if ($WhatIfPreference) { Write-Host "  Nothing was sent." -ForegroundColor Cyan }

if (-not $WhatIfPreference) {
  try {
    if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    Add-Content -LiteralPath (Join-Path $LogDir "materials-sync.log") `
      -Value ("{0}  {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm"), ($results -join "; "))
  } catch { }
}
if ($bad) { exit 1 }
exit 0
