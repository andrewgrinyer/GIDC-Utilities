# =====================================================================
#  GIDC  ·  paint probe: where Access keeps the colour of each door
#
#  Andrew, 19 November: the paint tool counts doors per colour per day
#  off the production schedule. The colour is chosen per door line, and
#  nothing in this repository says yet which table and column hold it.
#  This finds it, and checks the two schedule dates the tool counts on.
#
#  Read only. Opens the back end with Mode=Read, writes nothing, sends
#  nothing. It prints table names, column names, counts, dates, and the
#  values of colour columns only (colour names are not customer data).
#  No name, address, phone number, price or commission is printed.
#
#      powershell -ExecutionPolicy Bypass -File .\gidc-paint-probe.ps1
#
#  Saves gidc-paint-probe-result.txt beside itself.
# =====================================================================

[CmdletBinding()]
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile
)

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-paint-probe-result.txt"
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

# Colour words, and the five stocked colours, so a column holding them
# stands out even if it is called something unexpected.
$COLOURWORDS = 'colou?r|paint|prime|primer|finish|stain|coat|sheen'
$STOCKED = @('extra white', 'pure white', 'alabaster', 'pearly', 'chantil')

# ---- open, read only --------------------------------------------------
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

# ---- every table and column ------------------------------------------
$tables = @()
$rs = $cn.OpenSchema(20)
while (-not $rs.EOF) {
  if ($rs.Fields.Item("TABLE_TYPE").Value -in @("TABLE", "LINK")) { $tables += [string]$rs.Fields.Item("TABLE_NAME").Value }
  $rs.MoveNext()
}
$rs.Close()
$cols = @{}
$rs = $cn.OpenSchema(4)
while (-not $rs.EOF) {
  $t = [string]$rs.Fields.Item("TABLE_NAME").Value
  if ($tables -contains $t) {
    if (-not $cols.ContainsKey($t)) { $cols[$t] = @() }
    $cols[$t] += , @([string]$rs.Fields.Item("COLUMN_NAME").Value, [int]$rs.Fields.Item("DATA_TYPE").Value)
  }
  $rs.MoveNext()
}
$rs.Close()
function IsText($type) { return $type -in @(129, 130, 200, 201, 202, 203) }

# ---- 1. the door line table -------------------------------------------
Head "1. DoorOrders: every column (one row per door line)"
if ($cols.ContainsKey("DoorOrders")) {
  foreach ($c in $cols["DoorOrders"]) { Out2 ("   {0,-40} type {1}" -f $c[0], $c[1]) }
} else { Out2 "   no table called DoorOrders" "Yellow" }

# ---- 2. tables with a colour sounding name -----------------------------
Head "2. Tables whose name sounds like colour or paint, with their rows"
foreach ($t in $tables | Where-Object { $_ -match $COLOURWORDS }) {
  $n = (Q "select count(*) from [$t]")[0][0]
  Out2 ("   {0}  ({1} rows)  columns: {2}" -f $t, $n, (($cols[$t] | ForEach-Object { $_[0] }) -join ", "))
  if ($n -le 200) {
    foreach ($r in (Q "select * from [$t]")) { Out2 ("      " + (($r | ForEach-Object { Short $_ }) -join " | ")) }
  }
}

# ---- 3. columns with a colour sounding name, in any table ---------------
Head "3. Columns whose name sounds like colour or paint, in any table"
foreach ($t in ($tables | Sort-Object)) {
  foreach ($c in $cols[$t]) {
    if ($c[0] -notmatch $COLOURWORDS) { continue }
    $n = (Q "select count(*) from [$t] where [$($c[0])] is not null")[0][0]
    Out2 ("   {0}.{1}  type {2}, filled on {3} rows" -f $t, $c[0], $c[1], $n) "White"
    if ($n -gt 0 -and ((IsText $c[1]) -or $c[0] -match 'ID$')) {
      $top = Q "select top 25 [$($c[0])], count(*) from [$t] where [$($c[0])] is not null group by [$($c[0])] order by count(*) desc"
      foreach ($r in $top) { Out2 ("      {0,6}  {1}" -f $r[1], (Short $r[0])) }
    }
  }
}

# ---- 4. text columns in the door line table holding a stocked colour ----
Head "4. Text columns in DoorOrders that hold one of the five stocked colours"
if ($cols.ContainsKey("DoorOrders")) {
  foreach ($c in $cols["DoorOrders"]) {
    if (-not (IsText $c[1])) { continue }
    $like = ($STOCKED | ForEach-Object { "[$($c[0])] like '%$_%'" }) -join " or "
    $n = (Q "select count(*) from DoorOrders where $like")[0][0]
    if ($n -gt 0) {
      Out2 ("   DoorOrders.{0}: {1} lines name a stocked colour" -f $c[0], $n) "White"
      $top = Q "select top 25 [$($c[0])], count(*) from DoorOrders where $like group by [$($c[0])] order by count(*) desc"
      foreach ($r in $top) { Out2 ("      {0,6}  {1}" -f $r[1], (Short $r[0])) }
    }
  }
}

# ---- 5. the colour as a production detail row ---------------------------
# The schedule dates are rows in ProductsSelectedDetails, named by
# def_ProductTypeDetails. The colour may be kept the same way.
Head "5. Production detail names (def_ProductTypeDetails) about colour, paint or dates"
$details = Q "select ProductTypeDetailID, ProductTypeID, ProductTypeDetailName from def_ProductTypeDetails order by ProductTypeDetailID"
foreach ($r in $details) {
  if ([string]$r[2] -match "$COLOURWORDS|date|bifold|panel") { Out2 ("   id {0,4}  type {1,3}  {2}" -f $r[0], $r[1], $r[2]) }
}
if ($cols.ContainsKey("ProductsSelectedDetails")) {
  Out2 ("   ProductsSelectedDetails columns: " + (($cols["ProductsSelectedDetails"] | ForEach-Object { $_[0] }) -join ", "))
  $textCols = @($cols["ProductsSelectedDetails"] | Where-Object { (IsText $_[1]) } | ForEach-Object { $_[0] })
  foreach ($r in $details) {
    if ([string]$r[2] -notmatch $COLOURWORDS) { continue }
    foreach ($tc in $textCols) {
      $top = Q "select top 25 [$tc], count(*) from ProductsSelectedDetails where ProductTypeDetailID = $($r[0]) and [$tc] is not null group by [$tc] order by count(*) desc"
      if ($top.Count) {
        Out2 ("   values of '{0}' (id {1}) in {2}:" -f $r[2], $r[0], $tc) "White"
        foreach ($v in $top) { Out2 ("      {0,6}  {1}" -f $v[1], (Short $v[0])) }
      }
    }
  }
}
if ($cols.ContainsKey("ProductsSelected")) {
  Out2 ("   ProductsSelected columns: " + (($cols["ProductsSelected"] | ForEach-Object { $_[0] }) -join ", "))
}

# ---- 6. the two schedule dates, over the next eight weeks --------------
Head "6. Doors per day on Scheduled Prime Date and Scheduled Paint Date, next 8 weeks"
foreach ($name in @("Scheduled Prime Date", "Scheduled Paint Date")) {
  $ids = @((Q "select ProductTypeDetailID from def_ProductTypeDetails where ProductTypeDetailName = '$name'") | ForEach-Object { $_[0] })
  if (-not $ids.Count) { Out2 "   nothing called '$name'" "Yellow"; continue }
  $idList = $ids -join ","
  Out2 ("   {0}: detail id {1}" -f $name, $idList) "White"
  $lo = (Get-Date).Date.AddDays(-7).ToString("MM/dd/yyyy")
  $hi = (Get-Date).Date.AddDays(56).ToString("MM/dd/yyyy")
  # The door count comes from a subquery inside a derived table, because
  # Access will not sum a subquery directly.
  $sql = "select x.dy, count(*) as orders, sum(x.doors) as doors
            from (select Format(d.ProductTypeDetailValue_DateTime,'yyyy-mm-dd') as dy,
                         (select sum(dr.DoorQuantity) from DoorOrders as dr
                           where dr.OrderID = ps.OrderID and dr.DoorProductTypeID = 1) as doors
                    from ProductsSelectedDetails as d
                         inner join ProductsSelected as ps on ps.ProductSelectedID = d.ProductSelectedID
                   where d.ProductTypeDetailID in ($idList)
                     and d.ProductTypeDetailValue_DateTime >= #$lo#
                     and d.ProductTypeDetailValue_DateTime < #$hi#) as x
           group by x.dy order by x.dy"
  foreach ($r in (Q $sql)) { Out2 ("      {0}  {1,4} orders  {2,5} doors" -f $r[0], $r[1], (Short $r[2])) }
}

# ---- 7. bifolds: is a bifold one line, or one per panel? --------------
Head "7. Door product types, and how bifold lines are counted"
foreach ($r in (Q "select * from def_DoorProductTypes")) { Out2 ("   " + (($r | ForEach-Object { Short $_ }) -join " | ")) }
if ($cols.ContainsKey("DoorOrders")) {
  foreach ($c in $cols["DoorOrders"]) {
    if (-not (IsText $c[1])) { continue }
    $n = (Q "select count(*) from DoorOrders where [$($c[0])] like '%bifold%' or [$($c[0])] like '%bi-fold%' or [$($c[0])] like '%bi fold%'")[0][0]
    if ($n -gt 0) {
      Out2 ("   DoorOrders.{0} says bifold on {1} lines. DoorQuantity on those lines:" -f $c[0], $n) "White"
      foreach ($r in (Q "select DoorQuantity, count(*) from DoorOrders where [$($c[0])] like '%bifold%' or [$($c[0])] like '%bi-fold%' or [$($c[0])] like '%bi fold%' group by DoorQuantity order by DoorQuantity")) {
        Out2 ("      quantity {0,3}: {1} lines" -f (Short $r[0]), $r[1])
      }
    }
  }
}

$cn.Close()
Out2 ""
Out2 "Done. Nothing was changed."
$script:lines | Set-Content -LiteralPath $OutFile -Encoding UTF8
Write-Host "Saved $OutFile"
