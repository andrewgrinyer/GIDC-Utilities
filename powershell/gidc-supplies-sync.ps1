# =====================================================================
#  GIDC  ·  hourly Shop Supplies and Hardware schedule sync
#
#  Andrew, 20 November: Shop Supplies on the tools site predicts pine,
#  rerail and valances from the doors in Access. This reads what each
#  order needs and the day it needs it, and sends that to Supabase
#  through the supplies-sync edge function. The page turns it into
#  pieces, stock and orders; this only says what each job will use.
#
#  START HERE. See what it would send, without sending anything:
#
#      .\gidc-supplies-sync.ps1 -WhatIf
#
#  Then, once that looks right:
#
#      .\gidc-supplies-sync.ps1
#
#  And hourly, set up by gidc-schedule-supplies-sync.ps1.
#
#  WHAT IT NEEDS
#    The same GIDC_KPI_KEY the KPI import, dealer sync and paint sync use.
#
#  WHAT EACH JOB USES (Andrew, 20 November). Access measures in inches.
#    rerail         every door line ticked DoorReRail: its door width,
#                   once for each door on the line.
#    pine           bump stops: DoorBumpStopLength_L and _R on each line
#                   that has them. And a piece the width of the opening for
#                   each opening with a valance or with DoorAddPine ticked
#                   (Andrew, 20 November: "if the order calls to add pine
#                   that must be counted"), once per opening.
#    valance_small  a valance on an opening 83" high or less.
#    valance_large  a valance on an opening over 83" high.
#                   A line has a valance when DoorValanceLength is filled.
#                   One valance per opening, however many lines it has,
#                   cut at DoorValanceLength (the opening width if blank).
#    doors          how many interior doors, for supplies counted per door.
#  Every piece is sent as a cut, so the page can fit whole cuts into
#  stock lengths: a valance is never pieced from two.
#
#  ASTRAGALS AND HARDWARE (Andrew, 23 November). Counted, not cut. Each
#  is sent with a spec that names which one, written exactly as the
#  items on the Hardware list are: "size=3.5; corner=1/4 radius;
#  finish=Satin Nickel", "length=72", "shape=round; finish=Black".
#    astragal_7/_8  one per Double Swing AST line (door type 8): 7' for a
#                   door 84" high or less, 8' above that.
#    flush_bolt     one per astragal, in the door's finish.
#    hinge          DoorHingeQuantity for each door, by size, corner and
#                   finish.
#    track          bypass (door type 4) interior doors only, per opening:
#                   the shortest track that covers the opening; wider than
#                   the longest, the two shortest that fill it together.
#    roller_set     extra roller sets: a 3 door system needs one. A second
#                   track brings two, so 3 doors on two tracks need none
#                   and 4 doors on two tracks need none.
#    floor_guide    2 per bypass system.
#    finger_pull    2 doors: 4. 3 doors: 4 (none on the middle door).
#                   4 doors: 8. Square pulls go on the front only, so a
#                   square order is half square, half round, one finish.
#                   Round ones are counted singly; the item turns them
#                   into pairs.
#  Finishes are matched by word to Satin Nickel, Bright Brass, Black,
#  Aged Bronze and Chrome. A line with no finish, size or corner that
#  can be read is counted as "not matched" and shown, not sent.
#
#  THE DAY A JOB NEEDS THEM (Andrew, 20 November)
#    Two weeks before its installation date (Orders.InstallBookedDate).
#    With none, two weeks after its template date. With neither, the
#    Schedule Cut Date, so dealer orders (no installation) still count;
#    -NoCutDate turns that off.
#    CHANGED 20 November (Andrew chose it): the Schedule Cut Date comes
#    first whenever an order has one, since that is the day the shop uses
#    the material and nearly every order has one. The rule above is then
#    the fallback. -InstallFirst puts the rule above first again.
#    The supplies check (20 November) found the template date at
#    Orders.TemplateBookedDate. Of 73 orders with a cut date in the next
#    12 weeks, only 1 had an installation booked.
#    The template date is found by name: an Orders column with "templat"
#    in its name, or a production detail with it. -TemplateColumn or
#    -TemplateDetail names it outright once the supplies check has shown
#    where it is.
#
#  WHAT IT WILL NOT DO
#    It only ever reads Access, with Mode=Read. No customer details go
#    beyond the order number and the last name on the estimate, the same
#    as the paint sync.
# =====================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $Url  = "https://baakegbtuygtldksmant.supabase.co",
  [string] $Anon = "sb_publishable_CSwwslH9Jt60-WK2fEJORw_k-R9n8Vj",
  [string] $Key  = $env:GIDC_KPI_KEY,
  [string] $LogDir = "C:\GIDC\logs",

  [string] $InstallColumn  = "InstallBookedDate",
  # Found by the supplies check, 20 November: Orders.TemplateBookedDate.
  [string] $TemplateColumn = "TemplateBookedDate",
  [string] $TemplateDetail = "",
  [string] $CutName        = "Schedule Cut Date",
  [switch] $NoCutDate,
  # Andrew, 20 November: the cut date first, when an order has one.
  # -InstallFirst goes back to installation, then template, then cut.
  [switch] $InstallFirst,
  [int]    $InstallLeadDays  = 14,
  [int]    $TemplateLagDays  = 14,

  # Valances: an opening this high or less takes the small one.
  [double] $SmallValanceMaxHeight = 83,

  # Interior doors, for the door count.
  [int[]]  $DoorProductTypes = @(1),

  # Hardware (Andrew, 23 November).
  [int[]]  $AstragalDoorTypes = @(8),
  [double] $Astragal7MaxHeight = 84,
  [int[]]  $BypassDoorTypes = @(4),
  [int[]]  $BypassProductTypes = @(1),
  [double[]] $TrackLengths = @(48, 60, 72, 96),
  [int]    $FloorGuidesPerSystem = 2,
  [switch] $NoHardware,

  # Days already passed that Access may still correct. Anything older is
  # left as Supabase has it, so supplies used stay used.
  [int] $DaysBack  = 14,
  [int] $DaysAhead = 120
)

$ErrorActionPreference = "Stop"
function Say($msg, $colour = "Gray") { Write-Host $msg -ForegroundColor $colour }
function Stop-Badly($msg) { Say $msg "Red"; exit 1 }
$inv = [Globalization.CultureInfo]::InvariantCulture

# ---- Access, read only ---------------------------------------------------
if (-not (Test-Path -LiteralPath $Database)) { Stop-Badly "Cannot see the database at $Database" }
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read"); $opened = $true; break } catch { }
}
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Stop-Badly ("Could not open the database. This is $bits PowerShell and needs a $bits Access engine. " +
              "Try C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe")
}
Say "Opened the Access back end, read only"

function Rows($sql) {
  $out = New-Object System.Collections.Generic.List[object]
  try { $rs = $cn.Execute($sql) } catch { $cn.Close(); Stop-Badly ("Access did not like a query: " + $_.Exception.Message + "`n" + $sql) }
  while (-not $rs.EOF) {
    $h = @{}
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $h[$rs.Fields.Item($i).Name] = $rs.Fields.Item($i).Value }
    $out.Add($h)
    $rs.MoveNext()
  }
  $rs.Close()
  return , $out
}
function Blank($v) { return ($null -eq $v -or $v -is [DBNull] -or "$v" -eq "") }
function Num($v) { if (Blank $v) { return 0.0 }; try { return [double]$v } catch { return 0.0 } }
function Yes($v) { if (Blank $v) { return $false }; try { return [bool]$v } catch { return $false } }
function DayOf($v) { if (Blank $v) { return $null }; try { return ([datetime]$v).Date } catch { return $null } }

# ---- lookup tables behind hardware numbers ------------------------------------
# A DoorOrders column like DoorHandleFinishID holds a number; the name is in
# the def_ table that has that column. Found by column name, so a column that
# holds the value itself (DoorHingeSize = 3.5) is read as it is.
$schemaCols = @{}
$rs = $cn.OpenSchema(4)
while (-not $rs.EOF) {
  $t = [string]$rs.Fields.Item("TABLE_NAME").Value
  if (-not $schemaCols.ContainsKey($t)) { $schemaCols[$t] = @() }
  $schemaCols[$t] += [string]$rs.Fields.Item("COLUMN_NAME").Value
  $rs.MoveNext()
}
$rs.Close()
function Lookup($col) {
  $map = @{}
  foreach ($t in $schemaCols.Keys) {
    if ($t -notmatch '^def_') { continue }
    $cols = $schemaCols[$t]
    $key = @($cols | Where-Object { $_ -eq $col -or $_ -eq ($col + "ID") })[0]
    if (-not $key) { continue }
    $base = $key -replace 'ID$', ''
    $name = @($cols | Where-Object { $_ -ne $key -and ($_ -eq $base -or $_ -eq ($base + "Name") -or $_ -eq ($base + "Description")) })[0]
    if (-not $name) { $name = @($cols | Where-Object { $_ -ne $key -and $_ -match 'Name|Desc' })[0] }
    if (-not $name) { continue }
    try { $rs = $cn.Execute("select [$key], [$name] from [$t]") } catch { continue }
    while (-not $rs.EOF) {
      if (-not (Blank $rs.Fields.Item(0).Value)) { $map[[string]$rs.Fields.Item(0).Value] = [string]$rs.Fields.Item(1).Value }
      $rs.MoveNext()
    }
    $rs.Close()
    if ($map.Count) { return $map }
  }
  return $map
}
function Named($map, $v) { if (Blank $v) { return "" }; $k = [string]$v; if ($map.ContainsKey($k)) { return $map[$k] }; return $k }
$hw = @{}
if (-not $NoHardware) {
  foreach ($c in @("DoorHandleFinishID", "DoorHingeSize", "DoorHingeRadius", "DoorHandleID", "DoorHandleStyleID", "DoorHandleTypeID")) { $hw[$c] = Lookup $c }
}
function FinishOf($text) {
  $t = "$text".ToLower()
  if ($t -match 'nickel|satin|\bsn\b') { return "Satin Nickel" }
  if ($t -match 'brass') { return "Bright Brass" }
  if ($t -match 'bronze|\borb\b') { return "Aged Bronze" }
  if ($t -match 'chrome') { return "Chrome" }
  if ($t -match 'black|\bblk\b') { return "Black" }
  return $null
}
function HingeSizeOf($text) {
  $t = "$text" -replace '"', ''
  if ($t -match '3\s*1/2|3\.5') { return "3.5" }
  if ($t -match '(^|[^0-9.])4([^0-9]|$)|^4') { return "4" }
  if ($t -match '(^|[^0-9.])3([^0-9.]|$)|^3') { return "3" }
  return $null
}
function CornerOf($text) {
  $t = "$text".ToLower() -replace '"', ''
  if ($t -match '5/8|0?\.625') { return "5/8 radius" }
  if ($t -match '1/4|0?\.25') { return "1/4 radius" }
  if ($t -eq '0' -or $t -match 'square|none|no radius') { return "square" }
  return $null
}

# ---- where the dates are ------------------------------------------------------
$orderCols = @()
$rs = $cn.OpenSchema(4)
while (-not $rs.EOF) {
  if ([string]$rs.Fields.Item("TABLE_NAME").Value -eq "Orders") { $orderCols += [string]$rs.Fields.Item("COLUMN_NAME").Value }
  $rs.MoveNext()
}
$rs.Close()
if ($orderCols -notcontains $InstallColumn) { $cn.Close(); Stop-Badly "Orders has no column called $InstallColumn." }

function DetailIds($pattern, $exact) {
  $ids = @(); $names = @()
  foreach ($r in (Rows "select ProductTypeDetailID, ProductTypeDetailName from def_ProductTypeDetails")) {
    $n = [string]$r["ProductTypeDetailName"]
    if (($exact -and $n -eq $exact) -or (-not $exact -and $n -match $pattern)) { $ids += [int]$r["ProductTypeDetailID"]; $names += $n }
  }
  return @{ ids = $ids; names = $names }
}

$templateIds = @()
if (-not $TemplateColumn -and -not $TemplateDetail) {
  $TemplateColumn = @($orderCols | Where-Object { $_ -match 'templat' } | Select-Object -First 1)[0]
  if (-not $TemplateColumn) {
    $found = DetailIds 'templat' $null
    $templateIds = $found.ids
    if ($templateIds.Count) { Say ("  template date: production detail {0}" -f ($found.names -join ", ")) }
  }
} elseif ($TemplateDetail) {
  $found = DetailIds $null $TemplateDetail
  $templateIds = $found.ids
  if (-not $templateIds.Count) { $cn.Close(); Stop-Badly "Nothing in def_ProductTypeDetails is called '$TemplateDetail'." }
}
if ($TemplateColumn) {
  if ($orderCols -notcontains $TemplateColumn) { $cn.Close(); Stop-Badly "Orders has no column called $TemplateColumn." }
  Say "  template date: Orders.$TemplateColumn"
}
if (-not $TemplateColumn -and -not $templateIds.Count) {
  Say "  No template date found. Jobs with no installation date fall back to the cut date. Pass -TemplateColumn or -TemplateDetail." "Yellow"
}
$cutIds = @()
if (-not $NoCutDate) {
  $cutIds = (DetailIds $null $CutName).ids
  if (-not $cutIds.Count) { Say "  Nothing called '$CutName'; no cut date fallback." "Yellow" }
}
Say ("  installation date: Orders.{0}" -f $InstallColumn)

# ---- the orders with a date in the window ---------------------------------------
$today = (Get-Date).Date
$keep  = $today.AddDays(-$DaysBack)
$last  = $today.AddDays($DaysAhead)
function D($d) { return $d.ToString("MM/dd/yyyy", $inv) }
$candidates = New-Object System.Collections.Generic.HashSet[int]
function AddIds($sql) { foreach ($r in (Rows $sql)) { if (-not (Blank $r["OrderID"])) { [void]$candidates.Add([int]$r["OrderID"]) } } }

# Wide windows on purpose: the exact day is worked out per order below.
AddIds ("select OrderID from Orders where [$InstallColumn] >= #" + (D $keep) + "# and [$InstallColumn] < #" + (D $last.AddDays($InstallLeadDays + 1)) + "#")
$tLo = $keep.AddDays(-$TemplateLagDays); $tHi = $last.AddDays(1)
if ($TemplateColumn) {
  AddIds ("select OrderID from Orders where [$InstallColumn] is null and [$TemplateColumn] >= #" + (D $tLo) + "# and [$TemplateColumn] < #" + (D $tHi) + "#")
}
foreach ($set in @(@{ ids = $templateIds; lo = $tLo; hi = $tHi }, @{ ids = $cutIds; lo = $keep; hi = $last.AddDays(1) })) {
  if (-not $set.ids.Count) { continue }
  AddIds ("select distinct ps.OrderID from ProductsSelectedDetails as d
             inner join ProductsSelected as ps on ps.ProductSelectedID = d.ProductSelectedID
            where d.ProductTypeDetailID in (" + ($set.ids -join ",") + ")
              and d.ProductTypeDetailValue_DateTime >= #" + (D $set.lo) + "#
              and d.ProductTypeDetailValue_DateTime < #" + (D $set.hi) + "#")
}
$orderIds = @($candidates)
Say ("{0} order(s) may need supplies from {1} to {2}" -f $orderIds.Count, $keep.ToString("yyyy-MM-dd"), $last.ToString("yyyy-MM-dd"))

# ---- dates, names and door lines, a couple of hundred orders at a time -----------
$install = @{}; $template = @{}; $cut = @{}; $names = @{}; $doorRows = @()
$detailIds = @($templateIds) + @($cutIds)
for ($i = 0; $i -lt $orderIds.Count; $i += 200) {
  $chunk = ($orderIds[$i..([Math]::Min($i + 199, $orderIds.Count - 1))]) -join ","

  $tSel = if ($TemplateColumn) { ", o.[$TemplateColumn] as T" } else { "" }
  foreach ($r in (Rows "select o.OrderID, o.OrderNo, o.[$InstallColumn] as I $tSel from Orders as o where o.OrderID in ($chunk)")) {
    $id = [int]$r["OrderID"]
    $install[$id] = DayOf $r["I"]
    if ($TemplateColumn) { $template[$id] = DayOf $r["T"] }
    $names[$id] = @{ no = [string]$r["OrderNo"]; job = $null }
  }
  foreach ($r in (Rows "select e.OrderID, e.LastName from Estimates as e where e.OrderID in ($chunk)")) {
    $id = [int]$r["OrderID"]
    if ($names.ContainsKey($id) -and -not (Blank $r["LastName"])) { $names[$id].job = [string]$r["LastName"] }
  }
  if ($detailIds.Count) {
    foreach ($r in (Rows ("select ps.OrderID, d.ProductTypeDetailID, d.ProductTypeDetailValue_DateTime as V
                             from ProductsSelectedDetails as d
                                  inner join ProductsSelected as ps on ps.ProductSelectedID = d.ProductSelectedID
                            where ps.OrderID in ($chunk) and d.ProductTypeDetailID in (" + ($detailIds -join ",") + ")"))) {
      $day = DayOf $r["V"]
      if (-not $day) { continue }
      $id = [int]$r["OrderID"]
      $set = if ($templateIds -contains [int]$r["ProductTypeDetailID"]) { $template } else { $cut }
      if (-not $set.ContainsKey($id) -or -not $set[$id] -or $set[$id] -lt $day) { $set[$id] = $day }
    }
  }
  foreach ($r in (Rows "select d.OrderID, d.DoorOpeningNumber, d.DoorProductTypeID, d.DoorQuantity,
                               d.DoorReRail, d.DoorOrderWidth, d.DoorWidthManual, d.DoorResizedWidth,
                               d.DoorOpeningWidth, d.DoorOpeningHeight, d.DoorOrderHeight,
                               d.DoorBumpStops, d.DoorBumpStopLength_L, d.DoorBumpStopLength_R,
                               d.DoorValanceLength, d.DoorAddPine, d.DoorTrackLength,
                               d.DoorTypeID, d.DoorHingeQuantity, d.DoorHingeSize, d.DoorHingeRadius,
                               d.DoorHandleFinishID, d.DoorHandleID, d.DoorHandleStyleID, d.DoorHandleTypeID
                          from DoorOrders as d where d.OrderID in ($chunk)")) {
    $doorRows += $r
  }
}
$cn.Close()

# ---- the day each order needs its supplies ----------------------------------------
$needOn = @{}; $why = @{}
foreach ($id in $orderIds) {
  if (-not $InstallFirst -and $cut.ContainsKey($id) -and $cut[$id]) { $needOn[$id] = $cut[$id]; $why[$id] = "cut" }
  elseif ($install[$id]) { $needOn[$id] = $install[$id].AddDays(-$InstallLeadDays); $why[$id] = "install" }
  elseif ($template.ContainsKey($id) -and $template[$id]) { $needOn[$id] = $template[$id].AddDays($TemplateLagDays); $why[$id] = "template" }
  elseif ($cut.ContainsKey($id) -and $cut[$id]) { $needOn[$id] = $cut[$id]; $why[$id] = "cut" }
}

# ---- what each order uses ---------------------------------------------------------
$byKey = [ordered]@{}
function Use($id, $uses, $amount, $cuts, $spec = "") {
  $k = "$id|$uses|$spec"
  if (-not $byKey.Contains($k)) {
    $byKey[$k] = [pscustomobject]@{
      order_id = $id
      order_no = $names[$id].no
      job      = $names[$id].job
      uses     = $uses
      spec     = $spec
      need_on  = $needOn[$id].ToString("yyyy-MM-dd")
      amount   = 0.0
      cuts     = New-Object System.Collections.Generic.List[double]
    }
  }
  $byKey[$k].amount += $amount
  foreach ($c in $cuts) { $byKey[$k].cuts.Add([Math]::Round($c, 3)) }
}
function FirstOf($r, $cols) { foreach ($c in $cols) { $v = Num $r[$c]; if ($v -gt 0) { return $v } }; return 0.0 }

$valances = @{}     # one per opening: "order|opening" -> @{ length; width; height }
$pineOpenings = @{} # one piece per opening with a valance or Add Pine: "order|opening" -> @{ id; width }
foreach ($r in $doorRows) {
  $id = [int]$r["OrderID"]
  if (-not $needOn.ContainsKey($id)) { continue }
  $day = $needOn[$id]
  if ($day -lt $keep -or $day -gt $last) { continue }
  $qty = [int](Num $r["DoorQuantity"]); if ($qty -lt 1) { $qty = 1 }

  if ($DoorProductTypes -contains [int](Num $r["DoorProductTypeID"])) { Use $id "doors" $qty @() }

  if (Yes $r["DoorReRail"]) {
    $w = FirstOf $r @("DoorOrderWidth", "DoorWidthManual", "DoorResizedWidth", "DoorOpeningWidth")
    if ($w -gt 0) { Use $id "rerail" ($w * $qty) (@(1..$qty) | ForEach-Object { $w }) }
  }

  $bl = Num $r["DoorBumpStopLength_L"]; $br = Num $r["DoorBumpStopLength_R"]
  $bump = @(@($bl, $br) | Where-Object { $_ -gt 0 })
  if ($bump.Count) { Use $id "pine" (($bump | Measure-Object -Sum).Sum) $bump }

  $vl = Num $r["DoorValanceLength"]
  $opening = if (Blank $r["DoorOpeningNumber"]) { "line" + $valances.Count + "_" + $pineOpenings.Count + "_" + $byKey.Count } else { [string]$r["DoorOpeningNumber"] }
  $vk = "$id|$opening"
  if ($vl -gt 0 -or (Yes $r["DoorAddPine"])) {
    $pw = FirstOf $r @("DoorOpeningWidth", "DoorTrackLength")
    if ($pw -le 0) { $pw = $vl }
    if ($pw -gt 0 -and (-not $pineOpenings.ContainsKey($vk) -or $pineOpenings[$vk].width -lt $pw)) {
      $pineOpenings[$vk] = @{ id = $id; width = $pw }
    }
  }
  if ($vl -gt 0) {
    $h = FirstOf $r @("DoorOpeningHeight", "DoorOrderHeight")
    $wd = FirstOf $r @("DoorOpeningWidth")
    if (-not $valances.ContainsKey($vk) -or $valances[$vk].length -lt $vl) {
      $valances[$vk] = @{ id = $id; length = $vl; width = $(if ($wd -gt 0) { $wd } else { $vl }); height = $h }
    }
  }
}
foreach ($v in $valances.Values) {
  $size = if ($v.height -gt 0 -and $v.height -le $SmallValanceMaxHeight) { "valance_small" }
          elseif ($v.height -gt $SmallValanceMaxHeight) { "valance_large" }
          else { "valance_small" }
  Use $v.id $size $v.length @($v.length)
}
foreach ($p in $pineOpenings.Values) { Use $p.id "pine" $p.width @($p.width) }

# ---- astragals and hardware (Andrew, 23 November) ---------------------------------
$unmatched = @{}
function Miss($what) { if (-not $unmatched.ContainsKey($what)) { $unmatched[$what] = 0 }; $unmatched[$what]++ }
function LineFinish($r) { return FinishOf (Named $hw["DoorHandleFinishID"] $r["DoorHandleFinishID"]) }
function IsSquarePull($r) {
  foreach ($c in @("DoorHandleID", "DoorHandleStyleID", "DoorHandleTypeID")) {
    if ((Named $hw[$c] $r[$c]) -match '(?i)square') { return $true }
  }
  return $false
}
# The shortest track that covers the width; wider than the longest, the two
# whose lengths add to the least that still covers it.
function TracksFor($width) {
  $ls = @($TrackLengths | Sort-Object)
  foreach ($l in $ls) { if ($l -ge $width) { return , @($l) } }
  $best = $null
  for ($a = 0; $a -lt $ls.Count; $a++) { for ($b = $a; $b -lt $ls.Count; $b++) {
    $sum = $ls[$a] + $ls[$b]
    if ($sum -ge $width -and ($null -eq $best -or $sum -lt ($best[0] + $best[1]))) { $best = @($ls[$a], $ls[$b]) }
  } }
  if ($null -eq $best) { $best = @($ls[-1], $ls[-1]) }
  return , $best
}
$bypass = @{}   # "order|opening" -> @{ id; doors; width; finish; square }
if (-not $NoHardware) {
  $n = 0
  foreach ($r in $doorRows) {
    $n++
    $id = [int]$r["OrderID"]
    if (-not $needOn.ContainsKey($id)) { continue }
    $day = $needOn[$id]
    if ($day -lt $keep -or $day -gt $last) { continue }
    $qty = [int](Num $r["DoorQuantity"]); if ($qty -lt 1) { $qty = 1 }
    $type = [int](Num $r["DoorTypeID"]); $prod = [int](Num $r["DoorProductTypeID"])
    $fin = LineFinish $r

    if ($AstragalDoorTypes -contains $type) {
      $h = FirstOf $r @("DoorOrderHeight", "DoorOpeningHeight")
      Use $id $(if ($h -gt $Astragal7MaxHeight) { "astragal_8" } else { "astragal_7" }) 1 @()
      if ($fin) { Use $id "flush_bolt" 1 @() ("finish=" + $fin) } else { Miss "flush bolt, no finish" }
    }

    $hq = [int](Num $r["DoorHingeQuantity"])
    if ($hq -gt 0) {
      $sz = HingeSizeOf (Named $hw["DoorHingeSize"] $r["DoorHingeSize"])
      $cr = CornerOf (Named $hw["DoorHingeRadius"] $r["DoorHingeRadius"])
      if ($sz -and $cr -and $fin) { Use $id "hinge" ($hq * $qty) @() ("size=$sz; corner=$cr; finish=$fin") }
      else { Miss ("hinges, " + $(if (-not $sz) { "size" } elseif (-not $cr) { "corner" } else { "finish" }) + " not read") }
    }

    if (($BypassDoorTypes -contains $type) -and ($BypassProductTypes -contains $prod)) {
      $opening = if (Blank $r["DoorOpeningNumber"]) { "row$n" } else { [string]$r["DoorOpeningNumber"] }
      $bk = "$id|$opening"
      if (-not $bypass.ContainsKey($bk)) { $bypass[$bk] = @{ id = $id; doors = 0; width = 0.0; finish = $fin; square = $false } }
      $b = $bypass[$bk]
      $b.doors += $qty
      $w = FirstOf $r @("DoorOpeningWidth", "DoorTrackLength")
      if ($w -gt $b.width) { $b.width = $w }
      if (-not $b.finish) { $b.finish = $fin }
      if (IsSquarePull $r) { $b.square = $true }
    }
  }
  foreach ($b in $bypass.Values) {
    if ($b.width -le 0) { Miss "bypass track, no width"; continue }
    $tracks = TracksFor $b.width
    foreach ($t in $tracks) { Use $b.id "track" 1 @() ("length=" + $t) }
    $extra = [Math]::Max(0, ($b.doors - 2) - ($tracks.Count - 1) * 2)
    if ($extra -gt 0) { Use $b.id "roller_set" $extra @() }
    Use $b.id "floor_guide" $FloorGuidesPerSystem @()
    $pulls = if ($b.doors -le 3) { 4 } else { 2 * $b.doors }
    if (-not $b.finish) { Miss "finger pulls, no finish"; continue }
    if ($b.square) {
      Use $b.id "finger_pull" ($pulls / 2) @() ("shape=square; finish=" + $b.finish)
      Use $b.id "finger_pull" ($pulls / 2) @() ("shape=round; finish=" + $b.finish)
    } else {
      Use $b.id "finger_pull" $pulls @() ("shape=round; finish=" + $b.finish)
    }
  }
}

$lines = @($byKey.Values | ForEach-Object {
  [pscustomobject]@{ order_id = $_.order_id; order_no = $_.order_no; job = $_.job; uses = $_.uses; spec = $_.spec
                     need_on = $_.need_on; amount = [Math]::Round($_.amount, 3); cuts = @($_.cuts) } })
Say ("{0} line(s) to send from {1} order(s)" -f $lines.Count, (@($lines | ForEach-Object { $_.order_id } | Select-Object -Unique)).Count) "Green"
$fromWhat = $why.Values | Group-Object | ForEach-Object { "{0} by {1} date" -f $_.Count, $_.Name }
if ($fromWhat) { Say ("  days needed: " + ($fromWhat -join ", ")) }
if ($unmatched.Count) {
  Say "  Not counted, Access did not say enough:" "Yellow"
  foreach ($k in $unmatched.Keys) { Say ("    {0}: {1} line(s)" -f $k, $unmatched[$k]) "Yellow" }
}

# ---- -WhatIf: show it and stop -------------------------------------------------------
if ($WhatIfPreference) {
  Say ""
  Say "Totals in the window, inches for cuts:" "Cyan"
  $lines | Group-Object uses, spec | Sort-Object Name | ForEach-Object {
    $cuts = ($_.Group | ForEach-Object { $_.cuts.Count } | Measure-Object -Sum).Sum
    $what = if ($cuts) { "in $cuts cut(s)" } else { "counted" }
    Say ("  {0,-48} {1,9:N1}  {2}, {3} order(s)" -f $_.Name, (($_.Group | Measure-Object amount -Sum).Sum), $what, $_.Count)
  }
  Say ""
  Say "Next three weeks, by the day needed:" "Cyan"
  $lines | Where-Object { $_.need_on -ge $today.ToString("yyyy-MM-dd") -and $_.need_on -le $today.AddDays(21).ToString("yyyy-MM-dd") } |
    Group-Object need_on | Sort-Object Name | ForEach-Object {
      $bits = $_.Group | Group-Object uses | Sort-Object Name | ForEach-Object { "{0} {1:N0}" -f $_.Name, (($_.Group | Measure-Object amount -Sum).Sum) }
      Say ("  {0}  {1}" -f $_.Name, ($bits -join ", "))
    }
  Say ""
  Say "This is what would be sent. Nothing has been." "Cyan"
  exit 0
}

# ---- send it ---------------------------------------------------------------------------
if (-not $Key) { Stop-Badly "No key. Set GIDC_KPI_KEY on this machine, or pass -Key. Use -WhatIf to see the lines without one." }

$body = @{ keep_before = $keep.ToString("yyyy-MM-dd"); lines = @($lines) } | ConvertTo-Json -Depth 6 -Compress
$headers = @{ "apikey" = $Anon; "Authorization" = "Bearer $Anon"
              "x-gidc-key" = $Key; "Content-Type" = "application/json" }
try {
  $res = Invoke-RestMethod -Method Post -Uri "$Url/functions/v1/supplies-sync" -Headers $headers `
           -Body ([Text.Encoding]::UTF8.GetBytes($body))
} catch {
  $detail = ""
  try {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $detail = $reader.ReadToEnd(); $reader.Close()
  } catch { }
  if (-not $detail -and $_.ErrorDetails) { $detail = $_.ErrorDetails.Message }
  Say ("Supabase would not take it: " + $_.Exception.Message) "Red"
  if ($detail) { Say ""; Say "What the far end said:" "Yellow"; Say $detail }
  exit 1
}
Say ("Sent {0} line(s). Loaded {1}, replaced {2}." -f $lines.Count, $res.added, $res.removed) "Green"
if ($res.dropped) { foreach ($d in $res.dropped) { Say ("    dropped: " + $d) "Yellow" } }

# ---- a line in the log ------------------------------------------------------------------
try {
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  $line = "{0}  orders {1}  lines {2}  loaded {3}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm"),
          $orderIds.Count, $lines.Count, $res.added
  Add-Content -LiteralPath (Join-Path $LogDir "supplies-sync.log") -Value $line
} catch { }
