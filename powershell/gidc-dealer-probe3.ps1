# =====================================================================
#  GIDC  ·  dealer probe, third pass: find the production dates
#
#  The Production Scheduling screen shows an Arrival Date, a Scheduled
#  Cut, Prime and Paint Date and a Package Date, and every front end
#  reads the same ones, so they are in the back end. My last search did
#  not find them because it looked for pack, pallet, skid, ship, batch
#  and freight, and a column called SchedPkg or PaintDate matches none
#  of those.
#
#  This one looks for cut, prime, paint, pkg, package, arrival,
#  scheduled and production across every table in the file, prints the
#  full column list of the handful of tables I could not identify from
#  their names, and for every hit says how many rows have one and what
#  the earliest and latest are, so there is no doubt which column the
#  screen is showing.
#
#  Read only. It writes nothing, sends nothing, and prints no customer
#  details: only column names, counts and dates.
#
#      powershell -ExecutionPolicy Bypass -File .\gidc-dealer-probe3.ps1
#
#  Saves gidc-dealer-probe3-result.txt beside itself.
# =====================================================================

[CmdletBinding()]
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile,
  # an order number off the scheduling screen, to prove the match
  [string] $OrderNo = "4973"
)

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-dealer-probe3-result.txt"
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
  } catch { Write-Host ("Could not save: {0}" -f $_.Exception.Message) -ForegroundColor Red }
  exit $code
}

if (-not (Test-Path -LiteralPath $Database)) { Out2 ("Cannot see {0}" -f $Database) "Red"; Finish 1 }
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database"); $opened = $true; break } catch { }
}
if (-not $opened) { Out2 "Could not open the database" "Red"; Finish 1 }

Out2 ("GIDC dealer probe 3  ·  {0}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm"))
Out2 ""

$tables = @()
$rs = $cn.OpenSchema(20)
while (-not $rs.EOF) {
  $t = [string]$rs.Fields.Item("TABLE_NAME").Value
  $k = [string]$rs.Fields.Item("TABLE_TYPE").Value
  if ($k -eq "TABLE" -and $t -notlike "MSys*") { $tables += $t }
  $rs.MoveNext()
}
$rs.Close()

function ColumnsOf($table) {
  $cols = @()
  try {
    $r = $cn.Execute("select * from [$table] where 1=0")
    for ($i = 0; $i -lt $r.Fields.Count; $i++) { $cols += [string]$r.Fields.Item($i).Name }
    $r.Close()
  } catch { }
  return $cols
}
function Scalar($sql) {
  try { $r = $cn.Execute($sql); $v = $r.Fields.Item(0).Value; $r.Close(); return $v } catch { return "?" }
}

# ---- 1. the wide net ------------------------------------------------
Out2 "ANY COLUMN, ANY TABLE, THAT COULD BE A PRODUCTION DATE" "Cyan"
$WANT = 'cut|prime|paint|pkg|packag|pack|arriv|sched|produc|stage|route|crate'
$found = $false
foreach ($t in ($tables | Sort-Object)) {
  foreach ($c in (ColumnsOf $t)) {
    if ($c -notmatch $WANT) { continue }
    $n   = Scalar "select count(*) from [$t] where [$c] is not null"
    $min = Scalar "select min([$c]) from [$t]"
    $max = Scalar "select max([$c]) from [$t]"
    Out2 ("  {0}.{1}" -f $t, $c) "White"
    Out2 ("      {0} filled, earliest {1}, latest {2}" -f $n, $min, $max)
    $found = $true
  }
}
if (-not $found) { Out2 "  nothing matched" "Yellow" }
Out2 ""

# ---- 2. the tables whose names say nothing --------------------------
Out2 "THE TABLES I CANNOT NAME FROM THE OUTSIDE, IN FULL" "Cyan"
foreach ($t in @("Calendar","Blank","Variables","ProductsSelected",
                 "ProductsSelectedDetails","ProductsSelectedList","TeamMembers")) {
  if ($tables -notcontains $t) { continue }
  $cols = ColumnsOf $t
  $n = Scalar "select count(*) from [$t]"
  Out2 ("  {0}  ({1} columns, {2} rows)" -f $t, $cols.Count, $n) "White"
  Out2 ("      {0}" -f ($cols -join ", "))
}
Out2 ""

# ---- 3. one order off the scheduling screen -------------------------
# Every date on the order and its doors, so the five on the screen can
# be picked out by their values rather than by their names.
Out2 ("EVERY DATE HELD AGAINST ORDER No {0}" -f $OrderNo) "Cyan"
$oid = Scalar "select min(OrderID) from Orders where OrderNo = '$OrderNo'"
if (-not $oid -or $oid -eq "?") { $oid = Scalar "select min(OrderID) from Orders where OrderNo = $OrderNo" }
if (-not $oid -or $oid -eq "?") {
  Out2 ("  no order with OrderNo {0}" -f $OrderNo) "Yellow"
} else {
  Out2 ("  OrderID {0}" -f $oid)
  foreach ($t in @("Orders","DoorOrders")) {
    foreach ($c in (ColumnsOf $t)) {
      if ($c -notmatch 'date|time|cut|prime|paint|pkg|pack|arriv|sched') { continue }
      $where = if ($t -eq "Orders") { "OrderID = $oid" } else { "OrderID = $oid" }
      $v = Scalar "select max([$c]) from [$t] where $where"
      if ($v -ne $null -and "$v" -ne "" -and "$v" -ne "?") {
        Out2 ("      {0}.{1} = {2}" -f $t, $c, $v)
      }
    }
  }
}

$cn.Close()
Out2 ""
Out2 "Done. Nothing was changed and no customer details are in this file." "Green"
Finish 0
