# =====================================================================
#  GIDC  ·  pine and valance check: why Order Supplies shows no job
#  needing pine or valances in the next four weeks
#
#  Andrew, 27 November: "it's strange there aren't any jobs calling for
#  pine or valance in the next four weeks". This lists every open order
#  with a valance, Add Pine, bump stops or a rerail, the dates on it, and
#  the day the supplies sync gives it (cut date first, else two weeks
#  before installation, else two weeks after templating), so we can see
#  whether the jobs are really further out, or are being given a day
#  that is already past, or no day at all.
#
#  Also prints the last lines of the supplies sync log, to show when it
#  last sent.
#
#  Read only. Opens the back end with Mode=Read, writes nothing to it,
#  sends nothing. Prints order numbers, the job's last name (as Order
#  Supplies already shows it), dates and counts: no address, phone
#  number, price or note.
#
#      powershell -ExecutionPolicy Bypass -File .\gidc-pine-check.ps1
#
#  Saves gidc-pine-check-result.txt beside itself.
# =====================================================================

[CmdletBinding()]
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $LogDir   = "C:\GIDC\logs",
  [string] $OutFile,
  [int]    $MonthsBack = 12
)

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-pine-check-result.txt"
}
$script:lines = New-Object System.Collections.Generic.List[string]
function Out2($text = "", $colour = "Gray") { Write-Host $text -ForegroundColor $colour; $script:lines.Add([string]$text) }
function Head($text) { Out2 ""; Out2 ("==== " + $text + " ====") "Cyan" }
function Save { $script:lines | Set-Content -LiteralPath $OutFile -Encoding UTF8 }
$inv = [Globalization.CultureInfo]::InvariantCulture
function D($d) { return $d.ToString("MM/dd/yyyy", $inv) }
function Ymd($d) { if ($d) { return $d.ToString("yyyy-MM-dd") } else { return "-" } }

Out2 ("Opened read only, " + (Get-Date).ToString("yyyy-MM-dd HH:mm"))

Head "1. When the supplies sync last ran"
foreach ($f in @("materials-sync.log", "supplies-sync.log")) {
  $p = Join-Path $LogDir $f
  if (Test-Path -LiteralPath $p) {
    Out2 ("  " + $f + ", last 6 lines:")
    Get-Content -LiteralPath $p -Tail 6 | ForEach-Object { Out2 ("    " + $_) }
  } else { Out2 ("  " + $f + ": not found in " + $LogDir) "Yellow" }
}
try {
  $t = Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -match 'GIDC (materials|supplies) sync' }
  foreach ($x in $t) {
    $i = $x | Get-ScheduledTaskInfo
    Out2 ("  task '{0}': {1}, last run {2}, result {3}, next run {4}" -f $x.TaskName, $x.State, $i.LastRunTime, $i.LastTaskResult, $i.NextRunTime)
  }
  if (-not $t) { Out2 "  No GIDC materials or supplies sync task found." "Yellow" }
} catch { Out2 "  Could not read the scheduled tasks." "Yellow" }

if (-not (Test-Path -LiteralPath $Database)) { Out2 "Cannot see the database at $Database" "Red"; Save; exit 1 }
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read"); $opened = $true; break } catch { }
}
if (-not $opened) { Out2 "Could not open the database. Try C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" "Red"; Save; exit 1 }

function Rows($sql) {
  $out = New-Object System.Collections.Generic.List[object]
  try { $rs = $cn.Execute($sql) } catch { Out2 ("Access did not like a query: " + $_.Exception.Message) "Red"; return , $out }
  while (-not $rs.EOF) {
    $h = @{}
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $h[$rs.Fields.Item($i).Name] = $rs.Fields.Item($i).Value }
    $out.Add($h); $rs.MoveNext()
  }
  $rs.Close()
  return , $out
}
function Blank($v) { return ($null -eq $v -or $v -is [DBNull] -or "$v" -eq "") }
function Num($v) { if (Blank $v) { return 0.0 }; try { return [double]$v } catch { return 0.0 } }
function Yes($v) { if (Blank $v) { return $false }; try { return [bool]$v } catch { return $false } }
function DayOf($v) { if (Blank $v) { return $null }; try { return ([datetime]$v).Date } catch { return $null } }

$today = (Get-Date).Date
$from  = $today.AddMonths(-$MonthsBack)
$cutIds = @(); $packIds = @()
foreach ($r in (Rows "select ProductTypeDetailID, ProductTypeDetailName from def_ProductTypeDetails")) {
  if ([string]$r["ProductTypeDetailName"] -eq "Schedule Cut Date") { $cutIds += [int]$r["ProductTypeDetailID"] }
  if ([string]$r["ProductTypeDetailName"] -eq "Packaging Date") { $packIds += [int]$r["ProductTypeDetailID"] }
}

# every door line with a valance, Add Pine, bump stop length or rerail, on an
# order sold in the last year
$lines = Rows ("select d.OrderID, d.DoorQuantity, d.DoorReRail, d.DoorValanceLength, d.DoorAddPine,
                       d.DoorBumpStopLength_L, d.DoorBumpStopLength_R
                  from DoorOrders as d inner join Orders as o on o.OrderID = d.OrderID
                 where o.SalesDate >= #" + (D $from) + "#
                   and (d.DoorValanceLength > 0 or d.DoorAddPine = true or d.DoorBumpStopLength_L > 0
                        or d.DoorBumpStopLength_R > 0 or d.DoorReRail = true)")
$per = @{}
foreach ($r in $lines) {
  $id = [int]$r["OrderID"]
  if (-not $per.ContainsKey($id)) { $per[$id] = @{ val = 0; pine = 0; bump = 0; rerail = 0 } }
  if ((Num $r["DoorValanceLength"]) -gt 0) { $per[$id].val++ }
  if (Yes $r["DoorAddPine"]) { $per[$id].pine++ }
  if ((Num $r["DoorBumpStopLength_L"]) -gt 0 -or (Num $r["DoorBumpStopLength_R"]) -gt 0) { $per[$id].bump++ }
  if (Yes $r["DoorReRail"]) { $per[$id].rerail++ }
}
$ids = @($per.Keys)
Out2 ""
Out2 ("{0} order(s) sold since {1} have a valance, Add Pine, bump stops or a rerail" -f $ids.Count, (Ymd $from))

$o = @{}; $cut = @{}; $pack = @{}
for ($i = 0; $i -lt $ids.Count; $i += 200) {
  $chunk = ($ids[$i..([Math]::Min($i + 199, $ids.Count - 1))]) -join ","
  foreach ($r in (Rows "select OrderID, OrderNo, SalesDate, TemplateBookedDate, InstallBookedDate, CompletedDate from Orders where OrderID in ($chunk)")) {
    $o[[int]$r["OrderID"]] = @{ no = [string]$r["OrderNo"]; sold = DayOf $r["SalesDate"]; tmpl = DayOf $r["TemplateBookedDate"];
                               inst = DayOf $r["InstallBookedDate"]; done = DayOf $r["CompletedDate"] }
  }
  foreach ($r in (Rows "select OrderID, LastName from Estimates where OrderID in ($chunk)")) {
    $id = [int]$r["OrderID"]
    if ($o.ContainsKey($id) -and -not (Blank $r["LastName"])) { $o[$id].job = [string]$r["LastName"] }
  }
  $want = @($cutIds) + @($packIds)
  if ($want.Count) {
    foreach ($r in (Rows ("select ps.OrderID, d.ProductTypeDetailID, d.ProductTypeDetailValue_DateTime as V
                             from ProductsSelectedDetails as d inner join ProductsSelected as ps on ps.ProductSelectedID = d.ProductSelectedID
                            where ps.OrderID in ($chunk) and d.ProductTypeDetailID in (" + ($want -join ",") + ")"))) {
      $day = DayOf $r["V"]; if (-not $day) { continue }
      $id = [int]$r["OrderID"]
      $set = if ($cutIds -contains [int]$r["ProductTypeDetailID"]) { $cut } else { $pack }
      if (-not $set.ContainsKey($id) -or $set[$id] -lt $day) { $set[$id] = $day }
    }
  }
}
$cn.Close()

# the day the sync gives each order, and where that day falls
$rows = @()
foreach ($id in $ids) {
  if (-not $o.ContainsKey($id)) { continue }
  $x = $o[$id]
  $c = if ($cut.ContainsKey($id)) { $cut[$id] } else { $null }
  $need = $null; $why = "no date"
  if ($c) { $need = $c; $why = "cut" }
  elseif ($x.inst) { $need = $x.inst.AddDays(-14); $why = "install" }
  elseif ($x.tmpl) { $need = $x.tmpl.AddDays(14); $why = "template" }
  $state = if ($x.done -and $x.done -le $today) { "completed" }
           elseif (-not $need) { "no date at all" }
           elseif ($need -lt $today.AddDays(-14)) { "day long past, not completed" }
           elseif ($need -lt $today) { "day in the last 2 weeks" }
           elseif ($need -le $today.AddDays(27)) { "next 4 weeks" }
           elseif ($need -le $today.AddDays(120)) { "later, within 120 days" }
           else { "past 120 days" }
  $rows += [pscustomobject]@{ no = $x.no; job = $x.job; sold = $x.sold; tmpl = $x.tmpl; inst = $x.inst; cut = $c;
                              pack = $(if ($pack.ContainsKey($id)) { $pack[$id] } else { $null }); done = $x.done;
                              need = $need; why = $why; state = $state; v = $per[$id] }
}

Head "2. Where each order's day falls"
Out2 "   where it falls | orders | with valance | with Add Pine | with bump stops | with rerail"
foreach ($g in ($rows | Group-Object state | Sort-Object Name)) {
  $l = $g.Group
  Out2 ("   {0} | {1} | {2} | {3} | {4} | {5}" -f $g.Name, $l.Count,
        @($l | Where-Object { $_.v.val }).Count, @($l | Where-Object { $_.v.pine }).Count,
        @($l | Where-Object { $_.v.bump }).Count, @($l | Where-Object { $_.v.rerail }).Count)
}

Head "3. Every order not completed, with a valance, Add Pine or bump stops"
Out2 "   order | job | sold | template | install | cut | packaging | completed | day given | from | valance lines | add pine lines | bump stop lines | rerail lines"
foreach ($r in ($rows | Where-Object { $_.state -ne "completed" -and ($_.v.val -or $_.v.pine -or $_.v.bump) } | Sort-Object { if ($_.need) { $_.need } else { [datetime]::MaxValue } })) {
  Out2 ("   {0} | {13} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8} | {9} | {10} | {11} | {12}" -f $r.no, (Ymd $r.sold), (Ymd $r.tmpl), (Ymd $r.inst),
        (Ymd $r.cut), (Ymd $r.pack), (Ymd $r.done), (Ymd $r.need), $r.why, $r.v.val, $r.v.pine, $r.v.bump, $r.v.rerail, $(if ($r.job) { $r.job } else { "-" }))
}

Out2 ""
Out2 "Done. Nothing was changed."
Save
Write-Host ""
Write-Host ("Saved " + $OutFile) -ForegroundColor Green
