# =====================================================================
#  GIDC  ·  hardware probe: how Access records hinges, bypass tracks,
#  rollers, floor guides, finger pulls, astragals and flush bolts
#
#  Andrew, 23 November: count astragals (7' and 8', one per Double Swing
#  AST door) for Shop Supplies, and a new Hardware list: hinges (2, 3 or
#  4 a door; 3", 3.5", 4"; square, 1/4" or 5/8" radius; five finishes),
#  bypass tracks (48", 60", 72", 96") and extra roller sets, floor guides,
#  finger pulls (round and square, five finishes) and flush bolts. This
#  shows what DoorOrders holds for each, and the lookup tables behind
#  the numbers, so the sync counts them right.
#
#  Read only. Opens the back end with Mode=Read, writes nothing, sends
#  nothing. It prints counts and measurements only. No name, address,
#  phone number, price or note is printed.
#
#      powershell -ExecutionPolicy Bypass -File .\gidc-hardware-probe.ps1
#
#  Saves gidc-hardware-probe-result.txt beside itself.
# =====================================================================

[CmdletBinding()]
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile
)

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-hardware-probe-result.txt"
}

$script:lines = New-Object System.Collections.Generic.List[string]
function Out2($text = "", $colour = "Gray") {
  Write-Host $text -ForegroundColor $colour
  $script:lines.Add([string]$text)
}
function Head($text) { Out2 ""; Out2 ("==== " + $text + " ====") "Cyan" }
function Short($v) {
  if ($null -eq $v -or $v -is [DBNull]) { return "(blank)" }
  $s = ([string]$v) -replace '\s+', ' '
  if ($s.Length -gt 40) { $s = $s.Substring(0, 40) + "..." }
  return $s
}

if (-not (Test-Path -LiteralPath $Database)) { Out2 "Cannot see the database at $Database" "Red"; exit 1 }
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read"); $opened = $true; break } catch { }
}
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Out2 "Could not open the database. This is $bits PowerShell and needs a $bits Access engine." "Red"
  exit 1
}
Out2 ("Opened read only, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm"))

function Q($sql) {
  $rows = @()
  try {
    $rs = $cn.Execute($sql)
    while (-not $rs.EOF) {
      $r = @()
      for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $r += , $rs.Fields.Item($i).Value }
      $rows += , $r
      $rs.MoveNext()
    }
    $rs.Close()
  } catch { Out2 ("   query failed: " + $_.Exception.Message) "Yellow" }
  return , $rows
}
function Table($sql, $labels) {
  $rows = Q $sql
  if (-not $rows.Count) { Out2 "   (nothing)"; return }
  Out2 ("   " + ($labels -join " | ")) "White"
  foreach ($r in $rows) { Out2 ("   " + (($r | ForEach-Object { Short $_ }) -join " | ")) }
}

# Door lines from the last year, so old habits do not cloud the picture.
$since = (Get-Date).Date.AddDays(-365).ToString("MM/dd/yyyy")
$recent = "d.DateTimeCreated >= #$since#"


$bypass = "d.DoorTypeID = 4 and d.DoorProductTypeID = 1"

# ---- 1. the lookup tables ----------------------------------------------
Head "1. Lookup tables for hinges, handles, finishes, tracks, guides, pulls"
$tables = @()
$rs = $cn.OpenSchema(20)
while (-not $rs.EOF) {
  if ($rs.Fields.Item("TABLE_TYPE").Value -in @("TABLE", "LINK")) { $tables += [string]$rs.Fields.Item("TABLE_NAME").Value }
  $rs.MoveNext()
}
$rs.Close()
foreach ($t in ($tables | Where-Object { $_ -match '^def_' -and $_ -match 'hinge|handle|finish|track|guide|pull|roller|astragal|bolt|hardware' } | Sort-Object)) {
  $n = (Q "select count(*) from [$t]")[0][0]
  Out2 ("   {0} ({1} rows)" -f $t, $n) "White"
  if ($n -le 120) { foreach ($r in (Q "select * from [$t]")) { Out2 ("      " + (($r | ForEach-Object { Short $_ }) -join " | ")) } }
}

# ---- 2. hinges ------------------------------------------------------------
Head "2. Hinges in the last year: per door, size, radius and finish, by door type"
Table "select top 60 d.DoorTypeID, d.DoorHingeQuantity, d.DoorHingeSize, d.DoorHingeRadius, d.DoorHandleFinishID, count(*), sum(d.DoorQuantity)
         from DoorOrders as d where $recent and d.DoorProductTypeID = 1
        group by d.DoorTypeID, d.DoorHingeQuantity, d.DoorHingeSize, d.DoorHingeRadius, d.DoorHandleFinishID
        order by count(*) desc" @("door type", "hinges", "size", "radius", "finish id", "lines", "doors")
Out2 "   Hinges a door against door height:"
Table "select d.DoorHingeQuantity, min(d.DoorOrderHeight), max(d.DoorOrderHeight), count(*)
         from DoorOrders as d where $recent and d.DoorProductTypeID = 1 and d.DoorHingeQuantity > 0
        group by d.DoorHingeQuantity" @("hinges", "lowest door", "tallest door", "lines")

# ---- 3. bypass: tracks, rollers, floor guides, finger pulls ---------------
Head "3. Bypass openings (Interior Doors): doors on the line against the counts Access keeps"
Table "select d.DoorQuantity, d.DoorTrackNumber, d.DoorRollerSetNumber, d.DoorFloorGuideNumber, d.DoorFingerPullNumber, count(*)
         from DoorOrders as d where $recent and $bypass
        group by d.DoorQuantity, d.DoorTrackNumber, d.DoorRollerSetNumber, d.DoorFloorGuideNumber, d.DoorFingerPullNumber
        order by count(*) desc" @("doors", "track no", "roller sets", "floor guides", "finger pulls", "lines")
Out2 "   Track length against opening width:"
Table "select top 40 d.DoorQuantity, d.DoorOpeningWidth, d.DoorTrackLength, d.DoorTrackNumber, d.DoorRollerSetNumber
         from DoorOrders as d where $recent and $bypass order by d.DoorOrderID desc" @("doors", "opening width", "track length", "track no", "roller sets")
Out2 "   Openings wider than 96 inches:"
Table "select top 25 d.DoorQuantity, d.DoorOpeningWidth, d.DoorTrackLength, d.DoorTrackNumber, d.DoorRollerSetNumber
         from DoorOrders as d where $recent and $bypass and d.DoorOpeningWidth > 96 order by d.DoorOpeningWidth desc" @("doors", "opening width", "track length", "track no", "roller sets")
Out2 "   Bypass lines in one opening (same order and opening number):"
Table "select x.n, count(*) from (select d.OrderID, d.DoorOpeningNumber, count(*) as n from DoorOrders as d
          where $recent and $bypass group by d.OrderID, d.DoorOpeningNumber) as x group by x.n" @("lines in one opening", "openings")
Out2 "   Handles on bypass lines (the finger pull type and finish):"
Table "select top 30 d.DoorHandleTypeID, d.DoorHandleStyleID, d.DoorHandleID, d.DoorHandleFinishID, count(*)
         from DoorOrders as d where $recent and $bypass
        group by d.DoorHandleTypeID, d.DoorHandleStyleID, d.DoorHandleID, d.DoorHandleFinishID order by count(*) desc" @("handle type", "handle style", "handle", "finish", "lines")

# ---- 4. astragals and flush bolts -----------------------------------------
Head "4. Astragals and flush bolts, by door type"
Table "select d.DoorTypeID, d.DoorProductTypeID, iif(d.DoorAstragal, 'astragal', '-'), iif(d.DoorFlushBolt, 'flush bolt', '-'), count(*), sum(d.DoorQuantity)
         from DoorOrders as d where $recent and (d.DoorTypeID in (2, 7, 8) or d.DoorAstragal or d.DoorFlushBolt)
        group by d.DoorTypeID, d.DoorProductTypeID, iif(d.DoorAstragal, 'astragal', '-'), iif(d.DoorFlushBolt, 'flush bolt', '-')" @("door type", "product type", "astragal", "flush bolt", "lines", "doors")
Out2 "   Double Swing AST (door type 8): door heights, quantity and finish"
Table "select d.DoorOrderHeight, d.DoorQuantity, d.DoorHandleFinishID, count(*)
         from DoorOrders as d where $recent and d.DoorTypeID = 8
        group by d.DoorOrderHeight, d.DoorQuantity, d.DoorHandleFinishID order by count(*) desc" @("door height", "qty", "finish id", "lines")

# ---- 5. finger pull counts on other door types -----------------------------
Head "5. Finger pulls and floor guides on lines that are not bypass"
Table "select d.DoorTypeID, d.DoorFingerPullNumber, d.DoorFloorGuideNumber, count(*)
         from DoorOrders as d where $recent and not ($bypass) and (d.DoorFingerPullNumber > 0 or d.DoorFloorGuideNumber > 0)
        group by d.DoorTypeID, d.DoorFingerPullNumber, d.DoorFloorGuideNumber" @("door type", "finger pulls", "floor guides", "lines")

$cn.Close()
Out2 ""
Out2 "Done. Nothing was changed."
$script:lines | Set-Content -LiteralPath $OutFile -Encoding UTF8
Write-Host "Saved $OutFile"
