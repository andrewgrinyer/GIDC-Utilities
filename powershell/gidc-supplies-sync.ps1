# =====================================================================
#  GIDC  ·  hourly Shop Supplies schedule sync
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
#                   that has them. And for each valance, a piece the width
#                   of the opening.
#    valance_small  a valance on an opening 83" high or less.
#    valance_large  a valance on an opening over 83" high.
#                   A line has a valance when DoorValanceLength is filled.
#                   One valance per opening, however many lines it has,
#                   cut at DoorValanceLength (the opening width if blank).
#    doors          how many interior doors, for supplies counted per door.
#  Every piece is sent as a cut, so the page can fit whole cuts into
#  stock lengths: a valance is never pieced from two.
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
                               d.DoorValanceLength
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
function Use($id, $uses, $amount, $cuts) {
  $k = "$id|$uses"
  if (-not $byKey.Contains($k)) {
    $byKey[$k] = [pscustomobject]@{
      order_id = $id
      order_no = $names[$id].no
      job      = $names[$id].job
      uses     = $uses
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
  if ($vl -gt 0) {
    $opening = if (Blank $r["DoorOpeningNumber"]) { "line" + $byKey.Count + "_" + $valances.Count } else { [string]$r["DoorOpeningNumber"] }
    $vk = "$id|$opening"
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
  Use $v.id "pine" $v.width @($v.width)
}

$lines = @($byKey.Values | ForEach-Object {
  [pscustomobject]@{ order_id = $_.order_id; order_no = $_.order_no; job = $_.job; uses = $_.uses
                     need_on = $_.need_on; amount = [Math]::Round($_.amount, 3); cuts = @($_.cuts) } })
Say ("{0} line(s) to send from {1} order(s)" -f $lines.Count, (@($lines | ForEach-Object { $_.order_id } | Select-Object -Unique)).Count) "Green"
$fromWhat = $why.Values | Group-Object | ForEach-Object { "{0} by {1} date" -f $_.Count, $_.Name }
if ($fromWhat) { Say ("  days needed: " + ($fromWhat -join ", ")) }

# ---- -WhatIf: show it and stop -------------------------------------------------------
if ($WhatIfPreference) {
  Say ""
  Say "Totals in the window, inches for cuts:" "Cyan"
  $lines | Group-Object uses | Sort-Object Name | ForEach-Object {
    $cuts = ($_.Group | ForEach-Object { $_.cuts.Count } | Measure-Object -Sum).Sum
    Say ("  {0,-14} {1,9:N1}  in {2} cut(s), {3} order(s)" -f $_.Name, (($_.Group | Measure-Object amount -Sum).Sum), $cuts, $_.Count)
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
