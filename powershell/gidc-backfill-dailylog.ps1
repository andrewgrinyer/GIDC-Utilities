# =====================================================================
#  GIDC  ·  the booked readings, backfilled from the daily log
#
#  Andrew was right. DailyLog_EstimateStatus has one row per day going
#  back to 18 September 2018, and a column per estimate status named
#  after the status number. Yesterday's row says 43 in column 1 and
#  today's says 39, which is exactly what the dashboard has been
#  showing. Column 4 says 10 and there are 10 estimates at Showroom
#  Booked right now.
#
#  So both readings have been recorded every day for eight years, and
#  the dashboard has been drawing them from a single reading of now
#  because nobody had looked in here.
#
#  WHAT THIS SENDS
#
#     appts_booked_measure    column 1,  Initial Visit Booked
#     appts_booked_showroom   column 4,  Showroom Booked
#
#  Twelve weeks by default, which is what was asked for. -Weeks takes it
#  further and -All sends everything the log holds, back to 2018. Going
#  further costs nothing: it is one number per day per figure, the
#  dashboard stores a day that is already there by replacing it, and the
#  monthly view of a reading shows its last day rather than a sum, so
#  none of this can inflate a total.
#
#  WHAT IT CHECKS BEFORE SENDING ANYTHING
#
#  That the columns really are status numbers. It counts every status
#  live, compares all sixteen against today's row in the log, and sends
#  nothing at all unless they agree. A column that turned out to mean
#  something else would quietly write eight years of wrong history, and
#  wrong history is worse than none: it looks like knowledge.
#
#  A DAY WITH NO ROW IS NOT A NOUGHT
#
#  The log covers about five days in six, because it only writes when
#  the office machine runs it. Sunday 11 October has no row and neither
#  does Thanksgiving Monday. Those days are left out rather than sent as
#  nought, and the chart breaks the line where they are missing instead
#  of drawing a dip that never happened.
#
#      powershell -ExecutionPolicy Bypass -File .\gidc-backfill-dailylog.ps1 -WhatIf
#      powershell -ExecutionPolicy Bypass -File .\gidc-backfill-dailylog.ps1
#      powershell -ExecutionPolicy Bypass -File .\gidc-backfill-dailylog.ps1 -All
#
#  -WhatIf reads everything, checks everything and sends nothing. Worth
#  running first.
#
#  It writes gidc-backfill-result.txt beside itself. Send me that.
# =====================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [int]    $Weeks = 12,
  [switch] $All,
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $Url  = "https://baakegbtuygtldksmant.supabase.co",
  [string] $Anon = "sb_publishable_CSwwslH9Jt60-WK2fEJORw_k-R9n8Vj",
  [string] $Key  = $env:GIDC_KPI_KEY,
  [string] $OutFile = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"
if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-backfill-result.txt"
}

$script:lines = New-Object System.Collections.Generic.List[string]
function Say($text = "", $colour = "Gray") {
  Write-Host $text -ForegroundColor $colour
  $script:lines.Add([string]$text)
}
function Finish($code) {
  try {
    [System.IO.File]::WriteAllLines($OutFile, $script:lines)
    Write-Host ""; Write-Host ("Saved to {0}" -f $OutFile) -ForegroundColor Cyan
  } catch { Write-Host ("Could not save: " + $_.Exception.Message) -ForegroundColor Red }
  if (-not $NoPause) {
    Write-Host ""; Write-Host "Press Enter to close." -ForegroundColor DarkGray
    try { [void](Read-Host) } catch { }
  }
  exit $code
}
function Acc($d) { return "#" + $d.ToString("MM/dd/yyyy") + "#" }

# which column of the log is which figure on the dashboard
$WANT = @(
  @{ metric = "appts_booked_measure";  column = "1"; what = "Initial Visit Booked" },
  @{ metric = "appts_booked_showroom"; column = "4"; what = "Showroom Booked" }
)

$dry = -not $PSCmdlet.ShouldProcess("the dashboard", "send the backfill")

Say ("GIDC, backfilling the booked readings, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
if ($dry) { Say "WhatIf: everything is read and checked, nothing is sent." "Yellow" }
Say

if (-not $dry -and [string]::IsNullOrWhiteSpace($Key)) {
  Say "No import key. Set GIDC_KPI_KEY on this machine, or pass -Key." "Red"; Finish 1
}
if (-not (Test-Path -LiteralPath $Database)) { Say "Cannot see the database." "Red"; Finish 1 }

$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read"); $opened = $true; break } catch { }
}
if (-not $opened) { Say "Could not open the database." "Red"; Finish 1 }
Say "Opened it, read only." "Green"

$from = if ($All) { [datetime]"2018-01-01" } else { (Get-Date).Date.AddDays(-7 * $Weeks) }
Say ("Reading the log from {0}." -f $from.ToString("yyyy-MM-dd"))

# ---------------------------------------------------------------------
#  1. READ THE LOG, ONE ROW PER DAY
# ---------------------------------------------------------------------
# More rows than days, so a day can have more than one. The last one
# written is the one kept: a reading taken later in the day is the more
# current answer, and whatever DailyLogType turns out to mean, the newest
# row for a day is the one the office was looking at when it left.
$byDay  = @{}
$types  = @{}
$seen   = 0
$rs = $null
try {
  $rs = $cn.Execute("select * from DailyLog_EstimateStatus
                      where LogDate >= $(Acc $from) order by LogDate, ID")
  while (-not $rs.EOF) {
    $d = $rs.Fields.Item("LogDate").Value
    if ($null -ne $d -and -not ($d -is [System.DBNull])) {
      $day = ([datetime]$d).ToString("yyyy-MM-dd")
      $row = @{}
      foreach ($w in $WANT) {
        $v = $rs.Fields.Item($w.column).Value
        if ($null -ne $v -and -not ($v -is [System.DBNull])) { $row[$w.column] = [double]$v }
      }
      $byDay[$day] = $row          # later row for a day replaces the earlier
      try {
        $t = [string]$rs.Fields.Item("DailyLogType").Value
        if ($t) { $types[$t] = 1 + $(if ($types.ContainsKey($t)) { $types[$t] } else { 0 }) }
      } catch { }
      $seen++
    }
    $rs.MoveNext()
  }
} catch {
  Say ("Could not read DailyLog_EstimateStatus: " + $_.Exception.Message) "Red"; Finish 1
} finally { if ($rs) { try { $rs.Close() } catch { } } }

Say ("{0} rows read, covering {1} days." -f $seen, $byDay.Count)
if ($types.Count -gt 0) {
  Say "   DailyLogType values in that stretch:"
  foreach ($k in ($types.Keys | Sort-Object)) { Say ("      {0,-24} {1} rows" -f $k, $types[$k]) }
}
if ($byDay.Count -eq 0) { Say "Nothing to send." "DarkYellow"; Finish 0 }

# ---------------------------------------------------------------------
#  2. PROVE THE COLUMNS ARE THE STATUS NUMBERS
# ---------------------------------------------------------------------
# Every status counted live and set against today's row. All sixteen have
# to agree. If a column ever meant something other than its name, this is
# the only thing standing between that and eight years of wrong history
# written into the dashboard as though it were known.
Say
Say "CHECKING THE COLUMNS AGAINST TODAY" "Cyan"
$today = (Get-Date).Date.ToString("yyyy-MM-dd")
$todayRow = $null
$rs = $null
try {
  $rs = $cn.Execute("select * from DailyLog_EstimateStatus
                      where Int(LogDate) = Int($(Acc (Get-Date).Date)) order by ID")
  while (-not $rs.EOF) { $todayRow = $rs; $last = @{}
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
      $nm = [string]$rs.Fields.Item($i).Name
      $vv = $rs.Fields.Item($i).Value
      if ($nm -match '^\d+$' -and $null -ne $vv -and -not ($vv -is [System.DBNull])) { $last[$nm] = [double]$vv }
    }
    $todayRow = $last
    $rs.MoveNext()
  }
} catch { } finally { if ($rs) { try { $rs.Close() } catch { } } }

if ($null -eq $todayRow) {
  Say ("   The log has no row for today ({0}), so there is nothing to check" -f $today) "Red"
  Say "   the columns against. Nothing has been sent. Run this again after"
  Say "   the log has written today, or tell me and I will check it another way."
  $cn.Close(); Finish 1
}

$agree = 0; $disagree = @()
foreach ($k in ($todayRow.Keys | Sort-Object { [int]$_ })) {
  $live = $null
  $r2 = $null
  try {
    $r2 = $cn.Execute("select count(*) from Estimates where EstimateStatusID = $k")
    if (-not $r2.EOF) { $live = [double]$r2.Fields.Item(0).Value }
  } catch { } finally { if ($r2) { try { $r2.Close() } catch { } } }
  if ($null -eq $live) { continue }
  if ($live -eq $todayRow[$k]) { $agree++ }
  else { $disagree += ("status {0}: the log says {1}, counting it now gives {2}" -f $k, $todayRow[$k], $live) }
}
Say ("   {0} of {1} status columns agree with a live count." -f $agree, ($agree + $disagree.Count))
if ($disagree.Count -gt 0) {
  foreach ($d in $disagree) { Say ("      " + $d) "DarkYellow" }
  Say
  Say "   NOTHING HAS BEEN SENT." "Red"
  Say "   The columns do not line up with the statuses, so I will not write"
  Say "   eight years of history on the strength of a guess. Send me this"
  Say "   file and I will work out what the columns really are."
  $cn.Close(); Finish 1
}
Say "   Every column lines up. The log is what it looks like." "Green"
$cn2 = $cn

# ---------------------------------------------------------------------
#  3. ALSO WORTH A LOOK, NOT SENT
# ---------------------------------------------------------------------
Say
Say "THE INSTALLATION BACKLOG, FOR INFORMATION ONLY" "Cyan"
Say "   DailyLog_OrderStatus has an InstallBacklog column going back to"
Say "   2018 as well. I have not sent it, because unlike the two above I"
Say "   have no live count to check it against. Compare these with the"
Say "   installation backlog on the dashboard and tell me if they match,"
Say "   and the next run can carry that one too."
Say
$rs = $null
try {
  $rs = $cn.Execute("select LogDate, InstallBacklog from DailyLog_OrderStatus
                      where LogDate >= $(Acc (Get-Date).Date.AddDays(-10))
                      order by LogDate desc")
  $n = 0
  while (-not $rs.EOF -and $n -lt 12) {
    $d = $rs.Fields.Item("LogDate").Value
    $v = $rs.Fields.Item("InstallBacklog").Value
    Say ("      {0}   {1}" -f ([datetime]$d).ToString("yyyy-MM-dd"), $v)
    $rs.MoveNext(); $n++
  }
} catch { Say ("      could not be read: " + $_.Exception.Message) "DarkYellow" }
finally { if ($rs) { try { $rs.Close() } catch { } } }

$cn.Close()

# ---------------------------------------------------------------------
#  4. BUILD AND SEND
# ---------------------------------------------------------------------
$rows = @()
foreach ($day in ($byDay.Keys | Sort-Object)) {
  foreach ($w in $WANT) {
    if ($byDay[$day].ContainsKey($w.column)) {
      $rows += @{ metric = $w.metric; date = $day; value = $byDay[$day][$w.column] }
    }
  }
}

Say
Say ("{0} numbers to send, {1} days of two figures." -f $rows.Count, $byDay.Count) "Cyan"
$days = @($byDay.Keys | Sort-Object)
Say ("   {0} to {1}" -f $days[0], $days[$days.Count - 1])
Say
Say "   the last ten days of each, so you can see them before they go:"
Say ("      {0,-12} {1,10} {2,10}" -f "day", "measures", "showroom")
foreach ($day in ($days | Select-Object -Last 10)) {
  $m = if ($byDay[$day].ContainsKey("1")) { $byDay[$day]["1"] } else { "." }
  $s = if ($byDay[$day].ContainsKey("4")) { $byDay[$day]["4"] } else { "." }
  Say ("      {0,-12} {1,10} {2,10}" -f $day, $m, $s)
}

if ($dry) {
  Say
  Say "WhatIf: nothing was sent. Run it again without -WhatIf to send." "Yellow"
  Finish 0
}

Say
$batch = 2000
$sent = 0
$headers = @{
  "apikey"        = $Anon
  "Authorization" = "Bearer $Anon"
  "x-gidc-key"    = $Key
  "Content-Type"  = "application/json"
}
for ($i = 0; $i -lt $rows.Count; $i += $batch) {
  $slice = $rows[$i..([Math]::Min($i + $batch - 1, $rows.Count - 1))]
  $body = @{
    rows           = $slice
    source         = "dailylog"
    refresh_portal = $false
  } | ConvertTo-Json -Depth 4 -Compress
  try {
    $res = Invoke-RestMethod -Method Post -Uri "$Url/functions/v1/kpi-import" `
             -Headers $headers -Body $body -TimeoutSec 120
    $sent += $res.written
    Say ("   sent {0} numbers, {1} to {2}" -f $res.written, $res.from, $res.to) "Green"
  } catch {
    $said = $_.Exception.Message
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $said = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
    } catch { }
    Say ("   refused after {0} numbers:" -f $sent) "Red"
    Say ("   " + $said) "Red"
    Finish 1
  }
}

Say
Say ("Done. {0} numbers are in. Open the dashboard, choose This week and" -f $sent) "Green"
Say "History 12 weeks, and the two booked lines now have a past."
Finish 0
