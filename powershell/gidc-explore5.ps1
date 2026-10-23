# =====================================================================
#  GIDC  ·  the Appointments table
#
#  You want the number of initial visit appointments currently booked,
#  and the number of showroom ones. Both come out of Appointments, and I
#  have never seen that table's columns.
#
#  Three things I need from it:
#    1. Which field holds the date the appointment is FOR, as opposed to
#       the day it was booked. Counting bookings made is a different
#       question from counting bookings outstanding.
#    2. Whether a cancelled appointment is deleted or left as a row with
#       a status against it. If it is left, counting rows would count
#       cancellations as work still to come.
#    3. How many of each type are sitting in the future right now, so
#       the first figure on the dashboard can be checked against
#       something.
#
#  It reads only. It changes nothing, sends nothing, and prints no
#  password, username, phone or email.
#
#  HOW TO RUN IT
#    Right click and Run with PowerShell, or:
#        .\gidc-explore5.ps1
#
#  It writes gidc-explore5-result.txt beside itself. Send me that.
# =====================================================================

param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile  = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-explore5-result.txt"
}

# def_Employees holds passwords as readable text. Nothing that looks like
# a credential or a personal contact detail leaves this script.
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

Out2 ("GIDC back end, the Appointments table, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
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
function One($label, $sql) {
  try {
    $rs = $cn.Execute($sql)
    $v = if ($rs.EOF) { "(no rows)" } else { $rs.Fields.Item(0).Value }
    $rs.Close()
    if ($null -eq $v -or $v -is [System.DBNull]) { $v = 0 }
    Out2 ("      {0,-48} {1,8}" -f $label, $v)
  } catch {
    Out2 ("      {0,-48} could not be read" -f $label) "Yellow"
  }
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

$today = "#" + (Get-Date).ToString("MM/dd/yyyy") + "#"

# =====================================================================
# 1. WHAT IS IN IT
# =====================================================================
Out2
Out2 "1. WHAT IS IN THE APPOINTMENTS TABLE" "Cyan"
$cols = ColsOf "Appointments"
if (-not $cols.Count) {
  Out2 "   Appointments could not be read." "Red"
  $cn.Close()
  Finish 1
}
Out2 ("   columns: {0}" -f ($cols -join ", ")) "Green"
One "rows in it" "select count(*) from Appointments"

Out2
Out2 "   how many of each type:"
try {
  $rs = $cn.Execute(
    "select a.AutoApptID, d.AutoApptDescription, count(*) as n
       from Appointments as a
       left join def_AutoAppointments as d on d.AutoApptID = a.AutoApptID
      group by a.AutoApptID, d.AutoApptDescription
      order by a.AutoApptID")
  while (-not $rs.EOF) {
    Out2 ("      {0,-5} {1,-24} {2,8}" -f
          $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value, $rs.Fields.Item(2).Value)
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  # the description column may be named something else; the counts alone
  # still answer the question
  Out2 ("      with descriptions: " + $_.Exception.Message) "Yellow"
  try {
    $rs = $cn.Execute(
      "select AutoApptID, count(*) as n from Appointments
        group by AutoApptID order by AutoApptID")
    while (-not $rs.EOF) {
      Out2 ("      {0,-5} {1,8}" -f $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value)
      $rs.MoveNext()
    }
    $rs.Close()
  } catch {
    Out2 ("      could not count by type: " + $_.Exception.Message) "Yellow"
  }
}

# =====================================================================
# 2. WHICH DATE IS THE APPOINTMENT ITSELF
# =====================================================================
# Every date column gets the same three questions: how many have a value,
# how many are in the future, and what the earliest and latest are. The
# one that holds the appointment itself will have a healthy number in the
# future. DateTimeCreated will have none.
Out2
Out2 "2. WHICH DATE IS THE APPOINTMENT ITSELF" "Cyan"
Out2 "   Every date column, with how many sit in the future. The field"
Out2 "   that means the appointment will have some; the day it was"
Out2 "   booked will have none."
$dateCols = @($cols | Where-Object { $_ -match 'date|time' })
if (-not $dateCols.Count) { Out2 "      no column with date or time in the name." "Yellow" }
foreach ($c in $dateCols) {
  Out2 ("   [{0}]" -f $c) "Green"
  One "   rows with a value"  "select count(*) from Appointments where [$c] is not null"
  One "   of those, today or later" "select count(*) from Appointments where [$c] >= $today"
  try {
    $rs = $cn.Execute("select min([$c]) as a, max([$c]) as b from Appointments where [$c] is not null")
    if (-not $rs.EOF) {
      Out2 ("      {0,-48} {1} to {2}" -f "   earliest and latest",
            $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value)
    }
    $rs.Close()
  } catch { }
}

# =====================================================================
# 3. IS A CANCELLED APPOINTMENT STILL A ROW
# =====================================================================
Out2
Out2 "3. IS A CANCELLED APPOINTMENT STILL A ROW" "Cyan"
Out2 "   Anything that looks like a status or a flag on the table:"
$flags = @($cols | Where-Object {
  $_ -match 'status|cancel|active|deleted|void|complete|attended|kept|noshow|no_show' })
if (-not $flags.Count) {
  Out2 "      nothing that looks like one, so a cancelled appointment is"
  Out2 "      probably deleted outright." "Green"
}
foreach ($c in $flags) {
  Out2 ("   [{0}], and what is in it:" -f $c) "Green"
  try {
    $rs = $cn.Execute("select [$c], count(*) as n from Appointments group by [$c] order by [$c]")
    while (-not $rs.EOF) {
      $v = $rs.Fields.Item(0).Value
      Out2 ("      {0,-24} {1,8}" -f
            $(if ($null -eq $v -or $v -is [System.DBNull]) { "(blank)" } else { $v }),
            $rs.Fields.Item(1).Value)
      $rs.MoveNext()
    }
    $rs.Close()
  } catch {
    Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
  }
}
Out2
Out2 "   and any lookup those might point at:"
$lk = @(Tables 'apptstatus|appointmentstatus')
if (-not $lk.Count) { Out2 "      none named like one." }
foreach ($t in $lk) {
  Out2 ("      {0}: {1}" -f $t, ((ColsOf $t) -join ", ")) "Green"
}

# =====================================================================
# 4. WHAT IS BOOKED RIGHT NOW
# =====================================================================
# The figure the dashboard will show, so you have something to check it
# against on the first day. Written against whichever date column looks
# most like the appointment itself.
Out2
Out2 "4. WHAT IS BOOKED RIGHT NOW" "Cyan"
$best = $null
$bestFuture = -1
foreach ($c in $dateCols) {
  if ($c -match 'created') { continue }
  try {
    $rs = $cn.Execute("select count(*) from Appointments where [$c] >= $today")
    $n = [int]$rs.Fields.Item(0).Value
    $rs.Close()
    if ($n -gt $bestFuture) { $bestFuture = $n; $best = $c }
  } catch { }
}
if ($best) {
  Out2 ("   using [{0}], which has the most dates in the future:" -f $best) "Green"
  try {
    $rs = $cn.Execute(
      "select AutoApptID, count(*) as n from Appointments
        where [$best] >= $today group by AutoApptID order by AutoApptID")
    while (-not $rs.EOF) {
      Out2 ("      type {0,-5} {1,8} booked" -f
            $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value)
      $rs.MoveNext()
    }
    $rs.Close()
  } catch {
    Out2 ("      could not read it: " + $_.Exception.Message) "Yellow"
  }
  Out2
  Out2 "   for comparison, the two the dashboard already uses:"
  One "showroom booked ahead, from Estimates.ShowroomBookedDate" `
      "select count(*) from Estimates where ShowroomBookedDate >= $today"
  One "measures booked ahead, from Estimates.MeasureDate" `
      "select count(*) from Estimates where MeasureDate >= $today"
} else {
  Out2 "   no date column with anything in the future." "Yellow"
}

$cn.Close()
Out2
Out2 "Done. Nothing was changed and nothing was sent." "Green"
Finish 0
