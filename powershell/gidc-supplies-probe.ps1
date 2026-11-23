# =====================================================================
#  GIDC  ·  supplies probe: how Access records rerail, bump stops and
#  valances, so Shop Supplies can forecast pine, rerail and valances
#
#  Andrew, 20 November: Shop Supplies predicts
#    Pine 3.5 x .75 x 16' Primed     bump stops, and one piece the width
#                                    of the opening for each valance
#    ReRail 1 1/8 x 1 1/8 Pine x 12' door width for each rerailed door
#    Small Valance                   openings 83" and under
#    Large Valance                   openings over 83"
#  The paint probe (19 November) found the columns on DoorOrders:
#  DoorReRail, DoorBumpStops, DoorBumpStopLength_L and _R,
#  DoorValanceLength, DoorAddPine, DoorOpeningWidth and the rest. This
#  shows what is actually in them, so the sync counts them right.
#
#  Also finds the installation and template dates, which decide the day
#  each job's supplies are needed (Andrew, 20 November).
#
#  Read only. Opens the back end with Mode=Read, writes nothing, sends
#  nothing. It prints counts and measurements only. No name, address,
#  phone number, price or note is printed.
#
#      powershell -ExecutionPolicy Bypass -File .\gidc-supplies-probe.ps1
#
#  Saves gidc-supplies-probe-result.txt beside itself.
# =====================================================================

[CmdletBinding()]
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile
)

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-supplies-probe-result.txt"
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

# ---- 1. how often each flag is set ------------------------------------
Head "1. Door lines in the last year, and how many have each flag or length"
Table "select d.DoorProductTypeID, count(*), sum(d.DoorQuantity),
              sum(iif(d.DoorReRail, 1, 0)), sum(iif(d.DoorReRail, d.DoorQuantity, 0)),
              sum(iif(d.DoorBumpStops, 1, 0)),
              sum(iif(d.DoorBumpStopLength_L > 0 or d.DoorBumpStopLength_R > 0, 1, 0)),
              sum(iif(d.DoorAddPine, 1, 0)),
              sum(iif(d.DoorValanceLength > 0, 1, 0)),
              sum(iif(d.DoorTrackLength > 0, 1, 0))
         from DoorOrders as d where $recent
        group by d.DoorProductTypeID order by d.DoorProductTypeID" `
  @("product type", "lines", "doors", "rerail lines", "rerail doors", "bump stop ticked",
    "bump stop length", "add pine ticked", "valance length", "track length")
Out2 "   Product types:"
foreach ($r in (Q "select * from def_DoorProductTypes")) { Out2 ("      " + (($r | ForEach-Object { Short $_ }) -join " | ")) }

# ---- 2. rerail ---------------------------------------------------------
Head "2. Rerail lines: quantity and the widths on them"
Table "select top 15 d.DoorQuantity, count(*) from DoorOrders as d
        where $recent and d.DoorReRail group by d.DoorQuantity order by count(*) desc" @("quantity", "lines")
Out2 "   Sample of 25 rerail lines (no job shown):"
Table "select top 25 d.DoorQuantity, d.DoorOrderWidth, d.DoorResizedWidth, d.DoorWidthManual,
              d.DoorOpeningWidth, d.DoorOrderHeight, d.DoorResizedHeight, d.DoorTypeID
         from DoorOrders as d where $recent and d.DoorReRail order by d.DoorOrderID desc" `
  @("qty", "order width", "resized width", "width manual", "opening width", "order height", "resized height", "door type")

# ---- 3. bump stops -----------------------------------------------------
Head "3. Bump stops: ticked or not, against the two lengths"
Table "select iif(d.DoorBumpStops, 'ticked', 'not ticked'),
              iif(d.DoorBumpStopLength_L > 0, 'L', '-'), iif(d.DoorBumpStopLength_R > 0, 'R', '-'), count(*)
         from DoorOrders as d where $recent
        group by iif(d.DoorBumpStops, 'ticked', 'not ticked'),
                 iif(d.DoorBumpStopLength_L > 0, 'L', '-'), iif(d.DoorBumpStopLength_R > 0, 'R', '-')" `
  @("bump stops", "left length", "right length", "lines")
Out2 "   Most common lengths, left then right:"
Table "select top 15 d.DoorBumpStopLength_L, count(*) from DoorOrders as d
        where $recent and d.DoorBumpStopLength_L > 0 group by d.DoorBumpStopLength_L order by count(*) desc" @("left inches", "lines")
Table "select top 15 d.DoorBumpStopLength_R, count(*) from DoorOrders as d
        where $recent and d.DoorBumpStopLength_R > 0 group by d.DoorBumpStopLength_R order by count(*) desc" @("right inches", "lines")
Out2 "   Sample of 20 bump stop lines:"
Table "select top 20 d.DoorQuantity, d.DoorBumpStops, d.DoorBumpStopLength_L, d.DoorBumpStopLength_R,
              d.DoorOpeningWidth, d.DoorOpeningHeight, d.DoorTypeID, d.DoorOpeningNumber
         from DoorOrders as d where $recent and (d.DoorBumpStops or d.DoorBumpStopLength_L > 0 or d.DoorBumpStopLength_R > 0)
        order by d.DoorOrderID desc" `
  @("qty", "ticked", "left", "right", "opening width", "opening height", "door type", "opening no")

# ---- 4. valances and the pine behind them --------------------------------
Head "4. Valances: length against opening width and height, and Add Pine"
Table "select iif(d.DoorValanceLength > 0, 'valance', 'no valance'), iif(d.DoorAddPine, 'add pine', '-'), count(*)
         from DoorOrders as d where $recent
        group by iif(d.DoorValanceLength > 0, 'valance', 'no valance'), iif(d.DoorAddPine, 'add pine', '-')" `
  @("valance", "add pine", "lines")
Out2 "   Sample of 25 valance lines:"
Table "select top 25 d.DoorQuantity, d.DoorValanceLength, d.DoorOpeningWidth, d.DoorOpeningHeight,
              d.DoorTrackLength, d.DoorAddPine, d.DoorTypeID, d.DoorOpeningNumber
         from DoorOrders as d where $recent and d.DoorValanceLength > 0 order by d.DoorOrderID desc" `
  @("qty", "valance length", "opening width", "opening height", "track length", "add pine", "door type", "opening no")
Out2 "   Valance lines that share an opening with another line (same order and opening number):"
Table "select x.n, count(*) from (
          select d.OrderID, d.DoorOpeningNumber, count(*) as n from DoorOrders as d
           where $recent and d.DoorValanceLength > 0 group by d.OrderID, d.DoorOpeningNumber) as x
        group by x.n order by x.n" @("valance lines in one opening", "openings")
Out2 "   Valance lines by opening width and height either side of 83 inches:"
Table "select iif(d.DoorOpeningWidth > 83, 'width over 83', 'width 83 or less'),
              iif(d.DoorOpeningHeight > 83, 'height over 83', 'height 83 or less'), count(*)
         from DoorOrders as d where $recent and d.DoorValanceLength > 0
        group by iif(d.DoorOpeningWidth > 83, 'width over 83', 'width 83 or less'),
                 iif(d.DoorOpeningHeight > 83, 'height over 83', 'height 83 or less')" `
  @("width", "height", "lines")
Out2 "   Sample of 15 Add Pine lines with no valance:"
Table "select top 15 d.DoorQuantity, d.DoorOpeningWidth, d.DoorOpeningHeight, d.DoorBumpStops,
              d.DoorBumpStopLength_L, d.DoorBumpStopLength_R, d.DoorTypeID
         from DoorOrders as d where $recent and d.DoorAddPine and (d.DoorValanceLength is null or d.DoorValanceLength = 0)
        order by d.DoorOrderID desc" `
  @("qty", "opening width", "opening height", "bump ticked", "left", "right", "door type")

# ---- 5. door types, to read the samples ---------------------------------
Head "5. Door types"
foreach ($t in @("def_DoorTypes", "def_DoorType")) {
  $rows = Q "select * from [$t]"
  if ($rows.Count) { foreach ($r in $rows) { Out2 ("   " + (($r | ForEach-Object { Short $_ }) -join " | ")) }; break }
}

# ---- 6. the cut date, and what it brings over the next eight weeks -----
Head "6. Next 8 weeks by Schedule Cut Date: doors, rerails, bump stops, valances"
$ids = @((Q "select ProductTypeDetailID from def_ProductTypeDetails where ProductTypeDetailName = 'Schedule Cut Date'") | ForEach-Object { $_[0] })
if (-not $ids.Count) { Out2 "   nothing called Schedule Cut Date" "Yellow" }
else {
  $idList = $ids -join ","
  $lo = (Get-Date).Date.AddDays(-7).ToString("MM/dd/yyyy")
  $hi = (Get-Date).Date.AddDays(56).ToString("MM/dd/yyyy")
  Out2 "   Orders with a cut date in that window, and how many carry each date:"
  foreach ($nm in @("Schedule Cut Date", "Scheduled Prime Date", "Packaging Date")) {
    $n = (Q "select count(*) from ProductsSelectedDetails as s inner join def_ProductTypeDetails as t
              on t.ProductTypeDetailID = s.ProductTypeDetailID
             where t.ProductTypeDetailName = '$nm' and s.ProductTypeDetailValue_DateTime >= #$lo#
               and s.ProductTypeDetailValue_DateTime < #$hi#")[0][0]
    Out2 ("      {0,-22} {1} orders" -f $nm, $n)
  }
  Table "select Format(s.ProductTypeDetailValue_DateTime, 'yyyy-mm-dd'), count(*), sum(d.DoorQuantity),
                sum(iif(d.DoorReRail, d.DoorQuantity, 0)),
                sum(iif(d.DoorBumpStops or d.DoorBumpStopLength_L > 0 or d.DoorBumpStopLength_R > 0, 1, 0)),
                sum(iif(d.DoorValanceLength > 0, 1, 0))
           from (ProductsSelectedDetails as s
                 inner join ProductsSelected as ps on ps.ProductSelectedID = s.ProductSelectedID)
                 inner join DoorOrders as d on d.OrderID = ps.OrderID
          where s.ProductTypeDetailID in ($idList)
            and s.ProductTypeDetailValue_DateTime >= #$lo# and s.ProductTypeDetailValue_DateTime < #$hi#
          group by Format(s.ProductTypeDetailValue_DateTime, 'yyyy-mm-dd')
          order by Format(s.ProductTypeDetailValue_DateTime, 'yyyy-mm-dd')" `
    @("cut date", "lines", "doors", "rerail doors", "bump stop lines", "valance lines")
}

# ---- 7. installation and template dates ---------------------------------
# Andrew, 20 November: the supplies are needed two weeks before the
# installation date, or, with no installation date, two weeks after the
# template date. Find both: as columns on any table, or as detail rows.
Head "7. Installation and template dates"
$schema = $cn.OpenSchema(4)
$dateCols = @()
while (-not $schema.EOF) {
  $t = [string]$schema.Fields.Item("TABLE_NAME").Value
  $c = [string]$schema.Fields.Item("COLUMN_NAME").Value
  $ty = [int]$schema.Fields.Item("DATA_TYPE").Value
  if ($t -notmatch '^MSys' -and $t -notmatch '^~' -and $ty -in @(7, 133, 135) -and
      ($c -match 'instal|templ|measur|book' -or $t -eq 'Orders')) { $dateCols += , @($t, $c) }
  $schema.MoveNext()
}
$schema.Close()
$lo8 = (Get-Date).Date.AddDays(-7).ToString("MM/dd/yyyy")
$hi8 = (Get-Date).Date.AddDays(84).ToString("MM/dd/yyyy")
foreach ($dc in $dateCols) {
  $n = (Q "select count(*) from [$($dc[0])] where [$($dc[1])] is not null")[0][0]
  $m = (Q "select count(*) from [$($dc[0])] where [$($dc[1])] >= #$lo8# and [$($dc[1])] < #$hi8#")[0][0]
  Out2 ("   {0}.{1}: filled on {2} rows, {3} in the next 12 weeks" -f $dc[0], $dc[1], $n, $m) "White"
}
Out2 "   Detail rows named like a date:"
foreach ($r in (Q "select ProductTypeDetailID, ProductTypeID, ProductTypeDetailName from def_ProductTypeDetails order by ProductTypeDetailID")) {
  if ([string]$r[2] -match 'instal|templ|measur|date|book') {
    $n = (Q "select count(*) from ProductsSelectedDetails where ProductTypeDetailID = $($r[0]) and ProductTypeDetailValue_DateTime is not null")[0][0]
    $m = (Q "select count(*) from ProductsSelectedDetails where ProductTypeDetailID = $($r[0]) and ProductTypeDetailValue_DateTime >= #$lo8# and ProductTypeDetailValue_DateTime < #$hi8#")[0][0]
    Out2 ("      id {0,4}  type {1,3}  {2,-28} filled {3}, next 12 weeks {4}" -f $r[0], $r[1], $r[2], $n, $m)
  }
}
Out2 "   Orders with door lines and a cut date in the next 12 weeks: how many have an installation booked"
if ($ids.Count) {
  Table "select count(*), sum(iif(o.InstallBookedDate is null, 0, 1)),
                avg(iif(o.InstallBookedDate is null, null, o.InstallBookedDate - s.ProductTypeDetailValue_DateTime))
           from (ProductsSelectedDetails as s
                 inner join ProductsSelected as ps on ps.ProductSelectedID = s.ProductSelectedID)
                 inner join Orders as o on o.OrderID = ps.OrderID
          where s.ProductTypeDetailID in ($idList)
            and s.ProductTypeDetailValue_DateTime >= #$lo8# and s.ProductTypeDetailValue_DateTime < #$hi8#" `
    @("orders", "with InstallBookedDate", "average days from cut to install")
}

$cn.Close()
Out2 ""
Out2 "Done. Nothing was changed."
$script:lines | Set-Content -LiteralPath $OutFile -Encoding UTF8
Write-Host "Saved $OutFile"
