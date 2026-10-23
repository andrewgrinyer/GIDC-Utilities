# =====================================================================
#  GIDC  ·  what counts as backlog
#
#  The retail door backlog looks high, and the reason may be a guess of
#  mine. The tally counts orders at OrderStatusID 1 to 9, which I worked
#  out from your daily snapshot having columns numbered 1 to 9 rather
#  than from seeing your status list. If any of those nine means finished
#  or cancelled, the tally is counting work that is done.
#
#  This prints the status list with the doors and orders sitting at each
#  one, so you can tell me where the line actually is.
#
#  It reads only. It changes nothing and sends nothing.
#
#  HOW TO RUN IT
#    Right click and Run with PowerShell, or:
#        .\gidc-explore4.ps1
#
#  It writes gidc-explore4-result.txt beside itself. Send me that.
# =====================================================================

param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile  = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-explore4-result.txt"
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

Out2 ("GIDC back end, what counts as backlog, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
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

function ColsOf($table) {
  $cols = @()
  try {
    $rs = $cn.Execute("select * from [$table] where 1=0")
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $cols += [string]$rs.Fields.Item($i).Name }
    $rs.Close()
  } catch { }
  return $cols
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

# =====================================================================
# 1. THE ORDER STATUSES
# =====================================================================
Out2
Out2 "1. THE ORDER STATUSES" "Cyan"
Out2 "   The tally currently counts 1 to 9. Tell me which of these"
Out2 "   actually mean work still outstanding."
$lk = @(Tables 'orderstatus')
$lk = @($lk | Where-Object { $_ -notmatch 'DailyLog|Door' })
if (-not $lk.Count) { $lk = @('def_OrderStatus', 'def_OrderStatuses') }
foreach ($t in $lk) {
  $c = ColsOf $t
  if (-not $c.Count) { continue }
  Out2 ("      {0}" -f $t) "Green"
  try {
    $rs = $cn.Execute("select * from [$t]")
    while (-not $rs.EOF) {
      $bits = @()
      for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
        $v = $rs.Fields.Item($i).Value
        if ($null -ne $v -and -not ($v -is [System.DBNull]) -and [string]$v -ne "") {
          $bits += ("{0}={1}" -f $c[$i], $v)
        }
      }
      Out2 ("         " + ($bits -join "  |  "))
      $rs.MoveNext()
    }
    $rs.Close()
  } catch {
    Out2 ("         could not read the rows: " + $_.Exception.Message) "Yellow"
  }
}

# =====================================================================
# 2. WHAT IS SITTING AT EACH ONE
# =====================================================================
# Doors and orders by status, product type Doors only. Whichever statuses
# carry a big pile of doors and are not really outstanding are the ones
# inflating the tally.
Out2
Out2 "2. DOORS AND ORDERS AT EACH STATUS, PRODUCT TYPE DOORS ONLY" "Cyan"
try {
  $rs = $cn.Execute(
    "select o.OrderStatusID, count(*) as openings, sum(dr.DoorQuantity) as doors,
            count(distinct o.OrderID) as orders
       from DoorOrders as dr inner join Orders as o on o.OrderID = dr.OrderID
      where dr.DoorProductTypeID = 1
      group by o.OrderStatusID
      order by o.OrderStatusID")
  Out2 ("      {0,-8} {1,10} {2,10} {3,10}" -f 'status', 'openings', 'doors', 'orders')
  while (-not $rs.EOF) {
    $st = $rs.Fields.Item(0).Value
    Out2 ("      {0,-8} {1,10} {2,10} {3,10}" -f
          $(if ($null -eq $st -or $st -is [System.DBNull]) { "(blank)" } else { $st }),
          $rs.Fields.Item(1).Value, $rs.Fields.Item(2).Value, $rs.Fields.Item(3).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

Out2
Out2 "   the same, split by whether the order has been completed, because"
Out2 "   a completed order is not backlog whatever its status says:"
try {
  $rs = $cn.Execute(
    "select o.OrderStatusID,
            IIf(o.CompletedDate Is Null, 'not completed', 'completed') as k,
            sum(dr.DoorQuantity) as doors
       from DoorOrders as dr inner join Orders as o on o.OrderID = dr.OrderID
      where dr.DoorProductTypeID = 1
      group by o.OrderStatusID, IIf(o.CompletedDate Is Null, 'not completed', 'completed')
      order by o.OrderStatusID")
  while (-not $rs.EOF) {
    $st = $rs.Fields.Item(0).Value
    Out2 ("      status {0,-6} {1,-15} {2,8} doors" -f
          $(if ($null -eq $st -or $st -is [System.DBNull]) { "(blank)" } else { $st }),
          $rs.Fields.Item(1).Value, $rs.Fields.Item(2).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

# =====================================================================
# 3. WHAT THE TALLY SAYS TODAY, AND THE OBVIOUS ALTERNATIVES
# =====================================================================
Out2
Out2 "3. THE TALLY, THREE WAYS" "Cyan"
function One($label, $sql) {
  try {
    $rs = $cn.Execute($sql)
    $v = if ($rs.EOF) { "(no rows)" } else { $rs.Fields.Item(0).Value }
    $rs.Close()
    if ($null -eq $v -or $v -is [System.DBNull]) { $v = 0 }
    Out2 ("      {0,-52} {1,8}" -f $label, $v)
  } catch {
    Out2 ("      {0,-52} could not be read" -f $label) "Yellow"
  }
}
One "as the dashboard counts it now, statuses 1 to 9" `
    "select sum(dr.DoorQuantity) from DoorOrders as dr
       inner join Orders as o on o.OrderID = dr.OrderID
      where dr.DoorProductTypeID = 1
        and o.OrderStatusID >= 1 and o.OrderStatusID <= 9"
One "orders that have not been completed, any status" `
    "select sum(dr.DoorQuantity) from DoorOrders as dr
       inner join Orders as o on o.OrderID = dr.OrderID
      where dr.DoorProductTypeID = 1 and o.CompletedDate Is Null"
One "not completed, and sold within the last two years" `
    "select sum(dr.DoorQuantity) from DoorOrders as dr
       inner join Orders as o on o.OrderID = dr.OrderID
      where dr.DoorProductTypeID = 1 and o.CompletedDate Is Null
        and o.SalesDate >= #01/01/2025#"
One "every door ever, for scale" `
    "select sum(dr.DoorQuantity) from DoorOrders as dr
      where dr.DoorProductTypeID = 1"

Out2
Out2 "   and how old the uncompleted ones are, by the year they sold:"
try {
  $rs = $cn.Execute(
    "select Format(o.SalesDate,'yyyy') as y, sum(dr.DoorQuantity) as doors,
            count(distinct o.OrderID) as orders
       from DoorOrders as dr inner join Orders as o on o.OrderID = dr.OrderID
      where dr.DoorProductTypeID = 1 and o.CompletedDate Is Null
      group by Format(o.SalesDate,'yyyy')
      order by Format(o.SalesDate,'yyyy')")
  while (-not $rs.EOF) {
    Out2 ("      {0,-8} {1,8} doors on {2,5} order(s)" -f
          $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value, $rs.Fields.Item(2).Value)
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
