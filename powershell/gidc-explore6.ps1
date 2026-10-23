# =====================================================================
#  GIDC  ·  the estimate statuses
#
#  You said the two lead figures should be the leads sitting at a
#  status: Initial Visit Booked, and Showroom Booked. That is a
#  different thing from what I built, which counted appointments in the
#  diary, and it explains why mine read 29 and 6 against your 38 and 12.
#
#  I need the status list with its numbers to pin them, and the counts
#  at each one so the figures can be checked the moment they appear.
#
#  It reads only. It changes nothing, sends nothing, and prints no
#  password, username, phone, email or customer name.
#
#  HOW TO RUN IT
#    Right click and Run with PowerShell, or:
#        .\gidc-explore6.ps1
#
#  It writes gidc-explore6-result.txt beside itself. Send me that.
# =====================================================================

param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile  = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-explore6-result.txt"
}

$HIDE = 'pass|pwd|secret|token|apikey|hash|salt|credential|' +
        'username|user_name|login|account|' +
        'phone|mobile|cell|email|fax|address|postal|zip|' +
        'firstname|lastname|surname|clientname|customername'
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

Out2 ("GIDC back end, the estimate statuses, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
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
function Dump($table) {
  $c = ColsOf $table
  if (-not $c.Count) { Out2 ("      {0}: could not be read" -f $table) "Yellow"; return }
  Out2 ("      {0}" -f $table) "Green"
  try {
    $rs = $cn.Execute("select * from [$table]")
    $n = 0
    while (-not $rs.EOF -and $n -lt 60) {
      $bits = @()
      for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
        if (Hidden $c[$i]) { continue }
        $v = $rs.Fields.Item($i).Value
        if ($null -ne $v -and -not ($v -is [System.DBNull]) -and [string]$v -ne "") {
          $bits += ("{0}={1}" -f $c[$i], $v)
        }
      }
      Out2 ("         " + ($bits -join "  |  "))
      $rs.MoveNext(); $n++
    }
    $rs.Close()
  } catch {
    Out2 ("         could not read the rows: " + $_.Exception.Message) "Yellow"
  }
}

# =====================================================================
# 1. THE STATUS LIST
# =====================================================================
Out2
Out2 "1. THE ESTIMATE STATUSES" "Cyan"
Out2 "   I need the numbers against Initial Visit Booked and Showroom"
Out2 "   Booked."
$lk = @(Tables 'estimatestatus|leadstatus')
if (-not $lk.Count) { $lk = @('def_EstimateStatus', 'def_EstimateStatuses') }
foreach ($t in $lk) { Dump $t }

# =====================================================================
# 2. HOW MANY LEADS ARE SITTING AT EACH ONE
# =====================================================================
# The figure the dashboard will show, so it can be checked the moment it
# appears rather than argued about later.
Out2
Out2 "2. HOW MANY ESTIMATES ARE AT EACH STATUS, RIGHT NOW" "Cyan"
try {
  $rs = $cn.Execute(
    "select EstimateStatusID, count(*) as n
       from Estimates
      group by EstimateStatusID
      order by EstimateStatusID")
  Out2 ("      {0,-10} {1,10}" -f 'status', 'estimates')
  while (-not $rs.EOF) {
    $v = $rs.Fields.Item(0).Value
    Out2 ("      {0,-10} {1,10}" -f
          $(if ($null -eq $v -or $v -is [System.DBNull]) { "(blank)" } else { $v }),
          $rs.Fields.Item(1).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

Out2
Out2 "   and the same for estimates created in the last two years only,"
Out2 "   in case the figure is meant to ignore old ones:"
try {
  $rs = $cn.Execute(
    "select EstimateStatusID, count(*) as n
       from Estimates
      where DateTimeCreated >= #01/01/2025#
      group by EstimateStatusID
      order by EstimateStatusID")
  while (-not $rs.EOF) {
    $v = $rs.Fields.Item(0).Value
    Out2 ("      {0,-10} {1,10}" -f
          $(if ($null -eq $v -or $v -is [System.DBNull]) { "(blank)" } else { $v }),
          $rs.Fields.Item(1).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

# =====================================================================
# 3. THE INSTALLED FIGURE, ONE MORE TIME
# =====================================================================
# You said this is still wrong. Wholesale was in it and is now out, which
# halves the count and barely moves the money. These are the numbers that
# change, so you can tell me whether the money is right yet.
Out2
Out2 "3. INSTALLED, WITH WHOLESALE OUT" "Cyan"
Out2 "   by month this year, orders then dollars, wholesale excluded:"
try {
  $rs = $cn.Execute(
    "select Format(o.CompletedDate,'yyyy-mm') as m,
            count(*) as alln, sum(e.Price) as allv,
            sum(IIf(e.SaleTypeID = 4, 0, 1)) as keptn,
            sum(IIf(e.SaleTypeID = 4, 0, e.Price)) as keptv
       from Orders as o inner join Estimates as e on e.EstimateID = o.EstimateID
      where o.CompletedDate >= #01/01/2026#
      group by Format(o.CompletedDate,'yyyy-mm')
      order by Format(o.CompletedDate,'yyyy-mm')")
  Out2 ("      {0,-9} {1,7} {2,14} {3,7} {4,14}" -f
        'month', 'orders', 'dollars', 'kept', 'kept dollars')
  while (-not $rs.EOF) {
    Out2 ("      {0,-9} {1,7} {2,14:N0} {3,7} {4,14:N0}" -f
          $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value, $rs.Fields.Item(2).Value,
          $rs.Fields.Item(3).Value, $rs.Fields.Item(4).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
}

Out2
Out2 "   and whether any completed order has no price at all, which would"
Out2 "   be work that never reaches the figure:"
try {
  $rs = $cn.Execute(
    "select IIf(e.Price Is Null, 'no price', IIf(e.Price <= 1, 'a dollar or less', 'priced')) as k,
            count(*) as n
       from Orders as o inner join Estimates as e on e.EstimateID = o.EstimateID
      where o.CompletedDate >= #01/01/2026#
        and (e.SaleTypeID is null or e.SaleTypeID <> 4)
      group by IIf(e.Price Is Null, 'no price', IIf(e.Price <= 1, 'a dollar or less', 'priced'))")
  while (-not $rs.EOF) {
    Out2 ("      {0,-20} {1,8}" -f $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value)
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
