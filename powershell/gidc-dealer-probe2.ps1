# =====================================================================
#  GIDC  ·  dealer probe, second pass
#
#  The first one answered most of it and got two things wrong, both mine:
#
#    * It dumped two daily log tables with thousands of rows in them,
#      because it took any table with "status" in the name as a lookup.
#      This one only reads def_ tables and stops at 40 rows.
#
#    * It looked for the customer name on Clients, which turns out to
#      hold one ClientName field and no first or last name at all. The
#      names you described live on Estimates.FirstName and LastName.
#
#  What it still has to find out:
#
#    1. The shape of a dealer order's name on Estimates, to write the
#       matching rule. No name is printed: "SFD Carlton" comes out as
#       "SFD + 1 word of 7".
#    2. Whether Orders.DealerID is filled in, because if it is, that is
#       a better key than reading tags out of a name field.
#    3. Where the packaging date lives. Nothing in the order tables
#       looks like one, so this lists every table in the database and
#       every date column that could be it.
#
#  Read only. It writes nothing and sends nothing.
#
#      powershell -ExecutionPolicy Bypass -File .\gidc-dealer-probe2.ps1
#
#  It saves gidc-dealer-probe2-result.txt beside itself.
# =====================================================================

[CmdletBinding()]
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile,
  [string[]] $Tags = @("CIN", "CDC", "SFD")
)

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-dealer-probe2-result.txt"
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
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Out2 ("Could not open the database. This is {0} PowerShell and needs a {0} Access engine." -f $bits) "Red"
  Finish 1
}
Out2 ("GIDC dealer probe 2  ·  {0}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm"))
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
  try { $r = $cn.Execute($sql); $v = $r.Fields.Item(0).Value; $r.Close(); return $v } catch { return $null }
}

# ---- 1. the shape of a dealer name on Estimates ----------------------
Out2 "THE SHAPE OF A DEALER ORDER'S NAME, ON ESTIMATES" "Cyan"
$ecols = ColumnsOf "Estimates"
if ($ecols -notcontains "LastName") {
  Out2 "  Estimates has no LastName" "Yellow"
} else {
  foreach ($tag in $Tags) {
    $n = Scalar "select count(*) from Estimates where LastName like '$tag%'"
    Out2 ("  {0,-5} {1} estimate(s) whose last name starts with it" -f $tag, $n)
  }
  $q = ($Tags | ForEach-Object { "LastName like '$_%'" }) -join " or "
  try {
    $r = $cn.Execute("select top 25 LastName, FirstName, EstimateID, OrderID from Estimates where $q order by EstimateID desc")
    Out2 "  the last twenty five, as shapes only:"
    while (-not $r.EOF) {
      $l = [string]$r.Fields.Item(0).Value
      $f = [string]$r.Fields.Item(1).Value
      $oid = $r.Fields.Item(3).Value
      $parts = @($l -split '\s+' | Where-Object { $_ -ne "" })
      $tag   = if ($parts.Count) { $parts[0] } else { "(none)" }
      $rest  = if ($parts.Count -gt 1) { $parts[1..($parts.Count-1)] } else { @() }
      $restShape = if ($rest.Count) { ($rest | ForEach-Object { "{0} letters" -f $_.Length }) -join " + " } else { "nothing after the tag" }
      $fShape = if ($f -match '^\s*$') { "empty" }
                elseif ($f -match '^\d+$') { "all digits, {0} of them" -f $f.Trim().Length }
                elseif ($f -match '^\d') { "digits then more" }
                else { "no digits at the front" }
      $hasOrder = if ($oid) { "has an order" } else { "no order yet" }
      Out2 ("      {0,-6} + {1,-24} first: {2,-24} {3}" -f $tag, $restShape, $fShape, $hasOrder)
      $r.MoveNext()
    }
    $r.Close()
  } catch { Out2 ("  could not read the shapes: {0}" -f $_.Exception.Message) "Red" }
}
Out2 ""

# ---- 2. is Orders.DealerID filled in ---------------------------------
Out2 "DEALERS AS THE DATABASE ALREADY KNOWS THEM" "Cyan"
if ((ColumnsOf "Orders") -contains "DealerID") {
  $withDealer = Scalar "select count(*) from Orders where DealerID is not null"
  $all        = Scalar "select count(*) from Orders"
  Out2 ("  Orders: {0} of {1} have a DealerID on them" -f $withDealer, $all)
  try {
    $r = $cn.Execute("select DealerID, count(*) as n from Orders where DealerID is not null group by DealerID order by DealerID")
    while (-not $r.EOF) {
      Out2 ("      DealerID {0,-4} {1} order(s)" -f $r.Fields.Item(0).Value, $r.Fields.Item(1).Value)
      $r.MoveNext()
    }
    $r.Close()
  } catch { }
} else { Out2 "  Orders has no DealerID column" "Yellow" }

# def_Dealers is a list of businesses, not people, so it prints as it is,
# minus the contact columns.
if ($tables -contains "def_Dealers") {
  try {
    $r = $cn.Execute("select DealerID, DealerCode, DealerShortName, DealerLongName from def_Dealers order by DealerID")
    Out2 "  def_Dealers:"
    while (-not $r.EOF) {
      Out2 ("      {0,-4} {1,-8} {2,-22} {3}" -f $r.Fields.Item(0).Value, $r.Fields.Item(1).Value,
                                                $r.Fields.Item(2).Value, $r.Fields.Item(3).Value)
      $r.MoveNext()
    }
    $r.Close()
  } catch { Out2 ("  could not read def_Dealers: {0}" -f $_.Exception.Message) "Red" }
}
Out2 ""

# ---- 3. where a packaging date could be ------------------------------
Out2 "EVERY TABLE IN THE DATABASE" "Cyan"
Out2 ("  " + (($tables | Sort-Object) -join ", "))
Out2 ""
Out2 "EVERY COLUMN THAT COULD BE A PACKING OR SHIPPING DATE" "Cyan"
$hits = 0
foreach ($t in ($tables | Sort-Object)) {
  foreach ($c in (ColumnsOf $t)) {
    if ($c -match 'pack|crate|palle|skid|ship|dispatch|freight|batch|load') {
      $n = Scalar "select count(*) from [$t] where [$c] is not null"
      Out2 ("  {0}.{1}   {2} row(s) filled" -f $t, $c, $n)
      $hits++
    }
  }
}
if (-not $hits) { Out2 "  nothing anywhere matches pack, pallet, ship, batch or freight" "Yellow" }
Out2 ""
Out2 "AND EVERY DATE COLUMN ON THE ORDER TABLES, SO YOU CAN POINT AT THE RIGHT ONE" "Cyan"
foreach ($t in @("Orders","DoorOrders","DoorOrderPanels")) {
  if ($tables -notcontains $t) { continue }
  foreach ($c in (ColumnsOf $t)) {
    if ($c -match 'date|time') {
      $n = Scalar "select count(*) from [$t] where [$c] is not null"
      Out2 ("  {0}.{1}   {2} row(s) filled" -f $t, $c, $n)
    }
  }
}

$cn.Close()
Out2 ""
Out2 "Done. Nothing was changed and no customer details are in this file." "Green"
Finish 0
