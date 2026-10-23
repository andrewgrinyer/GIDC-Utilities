# =====================================================================
#  GIDC  ·  look at the Access back end, third pass
#
#  Two questions this time.
#
#    1. Where the number of doors on an order lives, so retail backlog
#       can be shown in doors as well as orders.
#
#    2. Why dollars installed comes out far too low. It currently takes
#       Estimates.Price for every order with a CompletedDate. Something
#       about that is wrong and this is meant to show which: orders that
#       do not join to an estimate at all, prices that are empty, or a
#       price that lives somewhere else entirely.
#
#  It reads a few lookup tables and counts things. It changes nothing,
#  sends nothing, and prints no password, username, phone or email.
#
#  HOW TO RUN IT
#    Right click and Run with PowerShell, or:
#        .\gidc-explore3.ps1
#
#  It writes gidc-explore3-result.txt beside itself. Send me that.
# =====================================================================

param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile  = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-explore3-result.txt"
}

# ---- what never gets printed ----------------------------------------
# def_Employees holds passwords as readable text. Nothing that looks like
# a credential or a personal contact detail leaves this script, whichever
# table it turns up in. The column is still named; only the value is
# withheld.
$HIDE = 'pass|pwd|secret|token|apikey|api_key|hash|salt|credential|' +
        'username|user_name|login|account|' +
        'phone|mobile|cell|email|fax|' +
        'address|postal|zip|' +
        '^sin$|socialinsurance|insurance|licence|license|birth|dob|' +
        'salary|wage|commstr'
function Hidden($column) { return ($column -match $HIDE) }

$script:lines = New-Object System.Collections.Generic.List[string]
function Out2($text = "", $colour = "Gray") {
  Write-Host $text -ForegroundColor $colour
  $script:lines.Add([string]$text)
}
function Finish($code) {
  try {
    [System.IO.File]::WriteAllLines($OutFile, $script:lines)
    Write-Host ""
    Write-Host ("Saved to {0}" -f $OutFile) -ForegroundColor Cyan
    Write-Host "Send me that file." -ForegroundColor Cyan
  } catch {
    Write-Host ("Could not save the file: " + $_.Exception.Message) -ForegroundColor Red
  }
  if (-not $NoPause) {
    Write-Host ""
    Write-Host "Press Enter to close." -ForegroundColor DarkGray
    try { [void](Read-Host) } catch { }
  }
  exit $code
}

Out2 ("GIDC back end, third pass, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
Out2 ("Database: {0}" -f $Database)
Out2

if (-not (Test-Path -LiteralPath $Database)) {
  Out2 "Cannot see the database at that path." "Red"
  Finish 1
}

$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try {
    $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read")
    $opened = $true
    break
  } catch { }
}
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Out2 ("Could not open the database. This is " + $bits +
        " PowerShell and it needs a " + $bits + " Access engine.") "Red"
  Finish 1
}
Out2 "Opened it, read only." "Green"

# Columns read off a select rather than from the engine's schema, because
# the schema call comes back empty on PowerShell 5.1.
function ColsOf($table) {
  $cols = @()
  try {
    $rs = $cn.Execute("select * from [$table] where 1=0")
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $cols += [string]$rs.Fields.Item($i).Name }
    $rs.Close()
  } catch { }
  return $cols
}
function RowsIn($table) {
  try {
    $c = $cn.Execute("select count(*) from [$table]")
    $n = [int]$c.Fields.Item(0).Value
    $c.Close()
    return $n
  } catch { return -1 }
}
function Tables($pattern) {
  $out = @()
  try {
    $rs = $cn.OpenSchema(20)
    while (-not $rs.EOF) {
      if ($rs.Fields.Item("TABLE_TYPE").Value -eq "TABLE") {
        $nm = [string]$rs.Fields.Item("TABLE_NAME").Value
        if ($nm -match $pattern) { $out += $nm }
      }
      $rs.MoveNext()
    }
    $rs.Close()
  } catch { }
  return $out
}
# One number, printed with a label, or the reason it could not be had.
function One($label, $sql) {
  try {
    $rs = $cn.Execute($sql)
    $v = if ($rs.EOF) { "(no rows)" } else { $rs.Fields.Item(0).Value }
    $rs.Close()
    if ($null -eq $v -or $v -is [System.DBNull]) { $v = "(empty)" }
    Out2 ("      {0,-46} {1}" -f $label, $v)
  } catch {
    Out2 ("      {0,-46} could not be read: {1}" -f $label, $_.Exception.Message) "Yellow"
  }
}

# =====================================================================
# 1. WHERE THE DOORS ARE
# =====================================================================
Out2
Out2 "1. WHERE THE DOORS ARE" "Cyan"
Out2 "   Retail backlog should show doors as well as orders. I need the"
Out2 "   table and field that says how many doors are on an order."
Out2
Out2 "   Your own daily snapshot first, since the backlog already comes"
Out2 "   from there and it may already carry a door count:"
$dl = ColsOf "DailyLog_OrderStatus"
if ($dl.Count) {
  Out2 ("      DailyLog_OrderStatus: {0}" -f ($dl -join ", ")) "Green"
} else {
  Out2 "      could not be read" "Yellow"
}

Out2
Out2 "   and any table that sounds like it holds the lines of an order:"
$cands = @(Tables 'line|item|detail|door|opening|product|unit|slab|panel')
if (-not $cands.Count) { Out2 "      nothing by name." "Yellow" }
foreach ($t in $cands) {
  $c = ColsOf $t
  if (-not $c.Count) { continue }
  Out2 ("      {0}  ({1} rows)" -f $t, (RowsIn $t)) "Green"
  Out2 ("         {0}" -f ($c -join ", "))
}

Out2
Out2 "   and whether an order or an estimate carries a count of its own:"
foreach ($t in @("Orders", "Estimates")) {
  $c = ColsOf $t
  $hits = @($c | Where-Object { $_ -match 'qty|quantity|count|doors|units|pieces|total' })
  if ($hits.Count) { Out2 ("      {0}: {1}" -f $t, ($hits -join ", ")) "Green" }
  else { Out2 ("      {0}: nothing that looks like a count" -f $t) }
}

# =====================================================================
# 2. WHY DOLLARS INSTALLED IS TOO LOW
# =====================================================================
Out2
Out2 "2. WHY DOLLARS INSTALLED IS TOO LOW" "Cyan"
Out2 "   It currently sums Estimates.Price for orders with a CompletedDate."
Out2 "   Each line below narrows where that goes wrong."
Out2
Out2 "   2026 so far:"
One "orders with a CompletedDate" `
    "select count(*) from Orders where CompletedDate >= #01/01/2026#"
One "   of those, joining to an estimate" `
    "select count(*) from Orders as o inner join Estimates as e
        on e.EstimateID = o.EstimateID where o.CompletedDate >= #01/01/2026#"
One "   of those, with a price that is not empty" `
    "select count(*) from Orders as o inner join Estimates as e
        on e.EstimateID = o.EstimateID
      where o.CompletedDate >= #01/01/2026# and e.Price is not null and e.Price > 1"
One "   of those, Deal Doors" `
    "select count(*) from Orders as o inner join Estimates as e
        on e.EstimateID = o.EstimateID
      where o.CompletedDate >= #01/01/2026# and e.SaleTypeID = 4"
One "dollars as the dashboard counts them now" `
    "select sum(e.Price) from Orders as o inner join Estimates as e
        on e.EstimateID = o.EstimateID where o.CompletedDate >= #01/01/2026#"
One "dollars with Deal Doors left out" `
    "select sum(e.Price) from Orders as o inner join Estimates as e
        on e.EstimateID = o.EstimateID
      where o.CompletedDate >= #01/01/2026#
        and (e.SaleTypeID is null or e.SaleTypeID <> 4)"
One "the same orders, summed on Orders.GrossProfit instead" `
    "select sum(o.GrossProfit) from Orders as o
      where o.CompletedDate >= #01/01/2026#"

Out2
Out2 "   and for comparison, the same year by SalesDate rather than"
Out2 "   CompletedDate, which is what the Sold section uses:"
One "orders sold in 2026, Deal Doors left out" `
    "select count(*) from Orders as o inner join Estimates as e
        on e.EstimateID = o.EstimateID
      where o.SalesDate >= #01/01/2026#
        and (e.SaleTypeID is null or e.SaleTypeID <> 4)"
One "dollars sold in 2026, Deal Doors left out" `
    "select sum(e.Price) from Orders as o inner join Estimates as e
        on e.EstimateID = o.EstimateID
      where o.SalesDate >= #01/01/2026#
        and (e.SaleTypeID is null or e.SaleTypeID <> 4)"

Out2
Out2 "   installed by month in 2026, as it stands and with Deal Doors out:"
try {
  $rs = $cn.Execute(
    "select Format(o.CompletedDate,'yyyy-mm') as m, count(*) as n,
            sum(e.Price) as allv,
            sum(IIf(e.SaleTypeID = 4, 0, e.Price)) as keptv
       from Orders as o inner join Estimates as e on e.EstimateID = o.EstimateID
      where o.CompletedDate >= #01/01/2026#
      group by Format(o.CompletedDate,'yyyy-mm')
      order by Format(o.CompletedDate,'yyyy-mm')")
  Out2 ("      {0,-9} {1,7} {2,15} {3,15}" -f 'month', 'orders', 'dollars now', 'without type 4')
  while (-not $rs.EOF) {
    Out2 ("      {0,-9} {1,7} {2,15:N0} {3,15:N0}" -f
          $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value,
          $rs.Fields.Item(2).Value, $rs.Fields.Item(3).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

# =====================================================================
# 3. ANYWHERE ELSE A PRICE MIGHT LIVE
# =====================================================================
# If the estimate price is not the real value of the job, the real one is
# somewhere else. This looks for it by name rather than guessing.
Out2
Out2 "3. ANYWHERE ELSE A PRICE MIGHT LIVE" "Cyan"
$money = @(Tables 'invoice|payment|charge|billing|revenue|contract')
if (-not $money.Count) { Out2 "   no table named like an invoice." }
foreach ($t in $money) {
  $c = ColsOf $t
  if (-not $c.Count) { continue }
  Out2 ("   {0}  ({1} rows)" -f $t, (RowsIn $t)) "Green"
  Out2 ("      {0}" -f ($c -join ", "))
}
Out2
Out2 "   and every field on Orders or Estimates that sounds like money:"
foreach ($t in @("Orders", "Estimates")) {
  $hits = @((ColsOf $t) | Where-Object {
    $_ -match 'price|cost|value|amount|total|deposit|profit|margin|tax|discount' })
  if ($hits.Count) { Out2 ("      {0}: {1}" -f $t, ($hits -join ", ")) "Green" }
}

$cn.Close()
Out2
Out2 "Done. Nothing was changed and nothing was sent." "Green"
Finish 0
