# =====================================================================
#  GIDC  ·  look at the Access back end, second pass
#
#  The first pass answered most of it, and you settled showroom
#  appointments by pointing at Estimates.ShowroomBookedDate. Two things
#  are left, and both are a number I need out of a small lookup table:
#
#    1. Which SaleTypeID means wholesale, so wholesale orders stop
#       counting toward the dollars in the Sold section.
#
#    2. Confirmation that Orders.SalesAssociateSoldID is who sold the
#       order, and which column in def_Employees holds their name.
#
#  The first pass could not read either lookup because it asked the
#  Access engine for the column names a way that works on PowerShell 7
#  and comes back empty on 5.1, which is what the server runs. This one
#  asks the tables themselves, which works on both.
#
#  It reads a few rows from small lookup tables and counts orders. It
#  changes nothing and sends nothing.
#
#  HOW TO RUN IT
#    Right click and Run with PowerShell, or:
#        .\gidc-explore2.ps1
#
#  It writes gidc-explore2-result.txt beside itself. Send me that.
# =====================================================================

param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile  = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-explore2-result.txt"
}

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

Out2 ("GIDC back end, second pass, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
Out2 ("Database: {0}" -f $Database)
Out2 ("PowerShell: {0}, {1}" -f $PSVersionTable.PSVersion,
        $(if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }))
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

# ---- reading a small table, whatever its columns are ----------------
# Asking the engine for a schema came back empty on 5.1, so this asks the
# table for no rows at all and reads the column names off the answer.
# That works wherever a select works.
function ColsOf($table) {
  $cols = @()
  try {
    $rs = $cn.Execute("select * from [$table] where 1=0")
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $cols += [string]$rs.Fields.Item($i).Name }
    $rs.Close()
  } catch { }
  return $cols
}

function Dump($table, $limit = 80) {
  $cols = ColsOf $table
  if (-not $cols.Count) {
    Out2 ("   {0}: could not be read" -f $table) "Yellow"
    return
  }
  Out2 ("   {0}" -f $table) "Green"
  Out2 ("      columns: {0}" -f ($cols -join ", "))
  $n = -1
  try { $c = $cn.Execute("select count(*) from [$table]"); $n = [int]$c.Fields.Item(0).Value; $c.Close() } catch { }
  Out2 ("      rows: {0}" -f $n)
  if ($n -le 0 -or $n -gt $limit) {
    if ($n -gt $limit) { Out2 "      too many to print, so it is not a lookup" }
    return
  }
  try {
    $rs = $cn.Execute("select * from [$table]")
    while (-not $rs.EOF) {
      $bits = @()
      for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
        $v = $rs.Fields.Item($i).Value
        if ($null -ne $v -and [string]$v -ne "") { $bits += ("{0}={1}" -f $cols[$i], $v) }
      }
      Out2 ("      " + ($bits -join "  |  "))
      $rs.MoveNext()
    }
    $rs.Close()
  } catch {
    Out2 ("      could not read the rows: " + $_.Exception.Message) "Yellow"
  }
}

# Any table whose name sounds like a given thing, so a lookup called
# something I did not predict still turns up.
function Like($pattern) {
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

# =====================================================================
# 1. THE SALE TYPES
# =====================================================================
# Estimates.SaleTypeID is the field. I need the number that means
# wholesale so those orders stop counting toward the Sold dollars.
Out2
Out2 "1. THE SALE TYPES" "Cyan"
Out2 "   I need the number that means wholesale."
$saleLookups = @(Like 'saletype|sale_type|typeofsale')
if (-not $saleLookups.Count) { $saleLookups = @('def_SaleTypes', 'SaleTypes') }
foreach ($t in $saleLookups) { Dump $t 80 }

Out2
Out2 "   and how many orders of each type, since 2025:"
try {
  $rs = $cn.Execute(
    "select e.SaleTypeID, count(*) as n, sum(Nz(e.Price,0)) as v
       from Estimates as e inner join Orders as o on o.EstimateID = e.EstimateID
      where o.SalesDate >= #01/01/2025#
      group by e.SaleTypeID
      order by e.SaleTypeID")
  while (-not $rs.EOF) {
    $id = $rs.Fields.Item(0).Value
    Out2 ("      SaleTypeID {0,-6} {1,7} order(s)   {2,14:N0} dollars" -f
          $(if ($null -eq $id) { "(blank)" } else { $id }),
          $rs.Fields.Item(1).Value, $rs.Fields.Item(2).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

Out2
Out2 "   the same, split by whether the order has a dealer on it, which is"
Out2 "   the other way to tell a wholesale order apart:"
try {
  $rs = $cn.Execute(
    "select e.SaleTypeID, iif(o.DealerID is null, 'no dealer', 'has a dealer') as k,
            count(*) as n
       from Estimates as e inner join Orders as o on o.EstimateID = e.EstimateID
      where o.SalesDate >= #01/01/2025#
      group by e.SaleTypeID, iif(o.DealerID is null, 'no dealer', 'has a dealer')
      order by e.SaleTypeID")
  while (-not $rs.EOF) {
    $id = $rs.Fields.Item(0).Value
    Out2 ("      SaleTypeID {0,-6} {1,-14} {2,7} order(s)" -f
          $(if ($null -eq $id) { "(blank)" } else { $id }),
          $rs.Fields.Item(1).Value, $rs.Fields.Item(2).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

# =====================================================================
# 2. THE SALESPEOPLE
# =====================================================================
Out2
Out2 "2. THE SALESPEOPLE" "Cyan"
Out2 "   Orders.SalesAssociateSoldID looks like who sold the order."
Out2 "   This is what is in it, and what those numbers point at."
foreach ($t in @('def_Employees')) { Dump $t 120 }

Out2
Out2 "   Orders.SalesAssociateSoldID, by how much each sold since 2025:"
try {
  $rs = $cn.Execute(
    "select o.SalesAssociateSoldID, count(*) as n
       from Orders as o
      where o.SalesDate >= #01/01/2025#
      group by o.SalesAssociateSoldID
      order by count(*) desc")
  while (-not $rs.EOF) {
    $who = $rs.Fields.Item(0).Value
    Out2 ("      {0,-8} {1,6} order(s)" -f
          $(if ($null -eq $who) { "(blank)" } else { $who }), $rs.Fields.Item(1).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

Out2
Out2 "   and Estimates.SalesAssociateID for the same orders, to compare:"
try {
  $rs = $cn.Execute(
    "select e.SalesAssociateID, count(*) as n
       from Estimates as e inner join Orders as o on o.EstimateID = e.EstimateID
      where o.SalesDate >= #01/01/2025#
      group by e.SalesAssociateID
      order by count(*) desc")
  while (-not $rs.EOF) {
    $who = $rs.Fields.Item(0).Value
    Out2 ("      {0,-8} {1,6} order(s)" -f
          $(if ($null -eq $who) { "(blank)" } else { $who }), $rs.Fields.Item(1).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

# =====================================================================
# 3. SHOWROOM, AS A SANITY CHECK
# =====================================================================
# Settled as Estimates.ShowroomBookedDate. This is only here so the first
# month of the dashboard can be checked against something.
Out2
Out2 "3. SHOWROOM APPOINTMENTS, BY MONTH" "Cyan"
Out2 "   From Estimates.ShowroomBookedDate, this year so far:"
try {
  $rs = $cn.Execute(
    "select Format(ShowroomBookedDate,'yyyy-mm') as m, count(*) as n
       from Estimates
      where ShowroomBookedDate >= #01/01/2026#
      group by Format(ShowroomBookedDate,'yyyy-mm')
      order by Format(ShowroomBookedDate,'yyyy-mm')")
  while (-not $rs.EOF) {
    Out2 ("      {0}  {1,6}" -f $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

$cn.Close()
Out2
Out2 "Done. Nothing was changed and nothing was sent." "Green"
Finish 0
