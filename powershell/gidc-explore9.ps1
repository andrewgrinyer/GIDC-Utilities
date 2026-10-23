# =====================================================================
#  GIDC  ·  the window, not the field
#
#  explore8 settled the field by elimination and then missed by a few:
#  MeasureDate gave Nick 13 and Michael 17 against your 19 and 23.
#
#  I think the shortfall is mine. I counted up to this morning, and a
#  measurement booked for next Tuesday has a MeasureDate in the future,
#  so every one still to be done was thrown away. That is exactly the 7
#  Michael has sitting at Initial Visit Booked.
#
#  So this counts MeasureDate over four windows and prints them side by
#  side. One of them should read Nick 19 and Michael 23, and that tells
#  me both which window your screen uses and that MeasureDate is right.
#
#  It also prints how many of those measurements are dated after today,
#  which is the number that explains the gap either way.
#
#  It reads only. It changes nothing and sends nothing.
#
#      powershell -ExecutionPolicy Bypass -File .\gidc-explore9.ps1
#
#  It writes gidc-explore9-result.txt beside itself. Send me that.
# =====================================================================

param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile  = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"
if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-explore9-result.txt"
}

$script:lines = New-Object System.Collections.Generic.List[string]
function Out2($text = "", $colour = "Gray") {
  Write-Host $text -ForegroundColor $colour
  $script:lines.Add([string]$text)
}
function Finish($code) {
  try {
    [System.IO.File]::WriteAllLines($OutFile, $script:lines)
    Write-Host ""; Write-Host ("Saved to {0}" -f $OutFile) -ForegroundColor Cyan
    Write-Host "Send me that file." -ForegroundColor Cyan
  } catch { Write-Host ("Could not save: " + $_.Exception.Message) -ForegroundColor Red }
  if (-not $NoPause) {
    Write-Host ""; Write-Host "Press Enter to close." -ForegroundColor DarkGray
    try { [void](Read-Host) } catch { }
  }
  exit $code
}

Out2 ("GIDC back end, the measurement window, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
Out2 "Looking for Nick 19 and Michael 23."
Out2

if (-not (Test-Path -LiteralPath $Database)) { Out2 "Cannot see the database." "Red"; Finish 1 }
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read"); $opened = $true; break } catch { }
}
if (-not $opened) { Out2 "Could not open the database." "Red"; Finish 1 }
Out2 "Opened it, read only." "Green"

function Many($sql, $indent = "      ") {
  $rows = 0
  try {
    $rs = $cn.Execute($sql)
    while (-not $rs.EOF) {
      $who = $rs.Fields.Item(0).Value
      if ($null -eq $who -or $who -is [System.DBNull] -or "$who" -eq "") { $who = "(nobody)" }
      Out2 ("{0}{1,-28} {2,6}" -f $indent, $who, $rs.Fields.Item(1).Value)
      $rs.MoveNext(); $rows++
      if ($rows -ge 20) { break }
    }
    $rs.Close()
  } catch { Out2 ("{0}could not be read: {1}" -f $indent, $_.Exception.Message) "DarkYellow" }
  return $rows
}
function Acc($d) { return "#" + $d.ToString("MM/dd/yyyy") + "#" }

$now = Get-Date
# the GIDC month: first Monday of the calendar month, four weeks
$first = Get-Date -Year $now.Year -Month $now.Month -Day 1
while ($first.DayOfWeek -ne [DayOfWeek]::Monday) { $first = $first.AddDays(1) }

$windows = @(
  @{ name = "calendar October, the whole month";      lo = (Get-Date -Year $now.Year -Month $now.Month -Day 1); hi = (Get-Date -Year $now.Year -Month $now.Month -Day 1).AddMonths(1) },
  @{ name = "calendar October, up to today only";     lo = (Get-Date -Year $now.Year -Month $now.Month -Day 1); hi = $now.Date.AddDays(1) },
  @{ name = "GIDC month, first Monday plus 4 weeks";  lo = $first;                                             hi = $first.AddDays(28) },
  @{ name = "GIDC month, up to today only";           lo = $first;                                             hi = $now.Date.AddDays(1) }
)

foreach ($w in $windows) {
  Out2
  Out2 ("{0}   ({1} to {2})" -f $w.name, $w.lo.ToString("yyyy-MM-dd"), $w.hi.AddDays(-1).ToString("yyyy-MM-dd")) "Cyan"
  [void](Many "select n.CalendarName, count(*)
                 from (Estimates as e left join def_Employees as n on n.EmployeeID = e.SalesAssociateID)
                where e.MeasureDate >= $(Acc $w.lo) and e.MeasureDate < $(Acc $w.hi)
                group by n.CalendarName
                order by count(*) desc")
}

Out2
Out2 "MEASUREMENTS IN THE MONTH THAT ARE STILL TO COME" "Cyan"
Out2 "   dated after today, which is the gap between the two readings above:"
[void](Many "select n.CalendarName, count(*)
               from (Estimates as e left join def_Employees as n on n.EmployeeID = e.SalesAssociateID)
              where e.MeasureDate > $(Acc $now.Date)
                and e.MeasureDate < $(Acc (Get-Date -Year $now.Year -Month $now.Month -Day 1).AddMonths(1))
              group by n.CalendarName
              order by count(*) desc")

Out2
Out2 "AND HOW MANY ESTIMATES HAVE NO MEASURE DATE AT ALL THIS MONTH" "Cyan"
Out2 "   counted by the day the estimate was created, so a showroom only job shows up here:"
[void](Many "select n.CalendarName, count(*)
               from (Estimates as e left join def_Employees as n on n.EmployeeID = e.SalesAssociateID)
              where e.MeasureDate is null
                and e.DateTimeCreated >= $(Acc (Get-Date -Year $now.Year -Month $now.Month -Day 1))
              group by n.CalendarName
              order by count(*) desc")

$cn.Close()
Out2
Out2 "Done. Nothing was changed and nothing was sent." "Green"
Finish 0
