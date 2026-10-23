# =====================================================================
#  GIDC  ·  opportunities per salesperson
#
#  Andrew, 16 October: the number of opportunities or sales appointments
#  for each salesperson, under their sold figure.
#
#  Before that can be a number on the dashboard I have to know which
#  thing in Access counts as an opportunity, and the honest answer is
#  that there are three candidates and I cannot tell which is yours from
#  the outside:
#
#    1. an appointment     a row in Appointments of type Initial Visit
#                          or Showroom, which is what the company level
#                          Booked Appointments figure already counts
#    2. an estimate        a row in Estimates assigned to a salesperson,
#                          which is the lead itself rather than a visit
#    3. a quoted estimate  an estimate that got as far as a price
#
#  They give different numbers and a different close rate, so this reads
#  all three for the same window and puts them side by side against what
#  each person sold in it. Then you pick, once, and it stays picked.
#
#  It also has to find out whether an appointment knows whose it is.
#  Booked Appointments is a company figure today and has never needed a
#  salesperson, so I have never looked.
#
#  It reads only. It changes nothing, sends nothing, and prints no
#  password, username, phone, email or customer name. Employee names are
#  printed, because a sales figure per person is the whole point.
#
#  HOW TO RUN IT
#      powershell -ExecutionPolicy Bypass -File .\gidc-explore7.ps1
#
#  It writes gidc-explore7-result.txt beside itself. Send me that.
# =====================================================================

param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile  = "",
  # how far back to count. Six months is long enough to see the shape
  # and short enough that nobody who left last year clutters it up.
  [int]    $Days     = 180,
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-explore7-result.txt"
}

# def_Employees holds passwords as readable text. Nothing that looks
# like a credential or a customer's details leaves this script.
$HIDE = 'pass|pwd|secret|token|apikey|hash|salt|credential|' +
        'username|user_name|login|' +
        'phone|mobile|cell|email|fax|address|postal|zip|' +
        'clientname|customername'
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

Out2 ("GIDC back end, opportunities per salesperson, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
Out2

if (-not (Test-Path -LiteralPath $Database)) { Out2 "Cannot see the database at that path." "Red"; Finish 1 }

$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read"); $opened = $true; break } catch { }
}
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Out2 ("Could not open the database. This is $bits PowerShell and it needs a $bits Access engine.") "Red"
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
    Out2 ("      {0,-52} {1,8}" -f $label, $v)
  } catch {
    Out2 ("      {0,-52} could not be read" -f $label) "Yellow"
    Out2 ("        {0}" -f $_.Exception.Message) "DarkYellow"
  }
}
# a two column answer, name and number, printed as a little table
function Many($sql, $indent = "      ") {
  try {
    $rs = $cn.Execute($sql)
    $n = 0
    while (-not $rs.EOF) {
      $who = $rs.Fields.Item(0).Value
      if ($null -eq $who -or $who -is [System.DBNull] -or "$who" -eq "") { $who = "(nobody)" }
      Out2 ("{0}{1,-28} {2,8}" -f $indent, $who, $rs.Fields.Item(1).Value)
      $rs.MoveNext(); $n++
      if ($n -ge 25) { Out2 ("{0}... stopped at 25" -f $indent); break }
    }
    $rs.Close()
    if (-not $n) { Out2 ("{0}(nothing came back)" -f $indent) "Yellow" }
  } catch {
    Out2 ("{0}could not be read: {1}" -f $indent, $_.Exception.Message) "Yellow"
  }
}

$from = "#" + (Get-Date).AddDays(-$Days).ToString("MM/dd/yyyy") + "#"
Out2 ("Counting everything from {0} to now." -f (Get-Date).AddDays(-$Days).ToString("yyyy-MM-dd"))

# =====================================================================
# 1. DOES AN APPOINTMENT KNOW WHOSE IT IS
# =====================================================================
Out2
Out2 "1. DOES AN APPOINTMENT KNOW WHOSE IT IS" "Cyan"
$ac = ColsOf "Appointments"
if (-not $ac.Count) { Out2 "   Appointments could not be read." "Red"; $cn.Close(); Finish 1 }
Out2 ("   columns: {0}" -f (($ac | Where-Object { -not (Hidden $_) }) -join ", "))

# anything that looks like it names a person, and anything that looks
# like a link to the estimate the appointment belongs to
$apptRep  = @($ac | Where-Object { $_ -match 'Employee|SalesAssoc|AssignedTo|Estimator|UserID|StaffID' })
$apptLink = @($ac | Where-Object { $_ -match '^EstimateID$' })
$apptDate = @($ac | Where-Object { $_ -match 'Date|Start' -and $_ -notmatch 'Created|Modified|Updated' })

Out2 ("   looks like a person:  {0}" -f $(if ($apptRep.Count)  { $apptRep  -join ", " } else { "nothing" }))
Out2 ("   links to an estimate: {0}" -f $(if ($apptLink.Count) { $apptLink -join ", " } else { "nothing" }))
Out2 ("   date fields:          {0}" -f $(if ($apptDate.Count) { $apptDate -join ", " } else { "nothing" }))

# =====================================================================
# 2. WHO THE SALESPEOPLE ARE
# =====================================================================
Out2
Out2 "2. WHO SOLD WHAT, WHICH IS THE FIGURE ALREADY ON THE DASHBOARD" "Cyan"
Out2 "   Orders.SalesAssociateSoldID, wholesale left out the same way the dashboard leaves it out:"
Many "select n.CalendarName, count(*)
        from ((Orders as o inner join Estimates as e on e.EstimateID = o.EstimateID)
              left join def_Employees as n on n.EmployeeID = o.SalesAssociateSoldID)
       where o.SalesDate >= $from and (e.SaleTypeID is null or e.SaleTypeID <> 4)
       group by n.CalendarName
       order by count(*) desc"

# =====================================================================
# 3. CANDIDATE ONE: APPOINTMENTS
# =====================================================================
Out2
Out2 "3. CANDIDATE ONE: APPOINTMENTS OF TYPE INITIAL VISIT OR SHOWROOM" "Cyan"
Out2 "   This is what the company level Booked Appointments figure counts today."
if ($apptLink.Count) {
  Out2 "   by the salesperson on the estimate the appointment belongs to, by the day it was booked:"
  Many "select n.CalendarName, count(*)
          from ((Appointments as a inner join Estimates as e on e.EstimateID = a.EstimateID)
                left join def_Employees as n on n.EmployeeID = e.SalesAssociateID)
         where a.AutoApptID in (1,2) and a.DateTimeCreated >= $from
         group by n.CalendarName
         order by count(*) desc"
} else {
  Out2 "   Appointments has no EstimateID, so an appointment cannot be traced to a salesperson that way." "Yellow"
}
foreach ($f in $apptRep) {
  Out2 ("   by Appointments.{0}, in case the appointment carries its own person:" -f $f)
  Many "select n.CalendarName, count(*)
          from (Appointments as a left join def_Employees as n on n.EmployeeID = a.[$f])
         where a.AutoApptID in (1,2) and a.DateTimeCreated >= $from
         group by n.CalendarName
         order by count(*) desc"
}

# =====================================================================
# 4. CANDIDATE TWO: ESTIMATES
# =====================================================================
Out2
Out2 "4. CANDIDATE TWO: ESTIMATES ASSIGNED TO A SALESPERSON" "Cyan"
$ec = ColsOf "Estimates"
$eRep = @($ec | Where-Object { $_ -match 'SalesAssoc|Employee|Estimator|AssignedTo' })
Out2 ("   fields on Estimates that name a person: {0}" -f $(if ($eRep.Count) { $eRep -join ", " } else { "nothing" }))
Out2 "   estimates created in the window, by SalesAssociateID:"
Many "select n.CalendarName, count(*)
        from (Estimates as e left join def_Employees as n on n.EmployeeID = e.SalesAssociateID)
       where e.DateTimeCreated >= $from
       group by n.CalendarName
       order by count(*) desc"

Out2
Out2 "   and the same, counting only the ones that got as far as a price:"
Many "select n.CalendarName, count(*)
        from (Estimates as e left join def_Employees as n on n.EmployeeID = e.SalesAssociateID)
       where e.DateTimeCreated >= $from and e.Price > 0
       group by n.CalendarName
       order by count(*) desc"

# =====================================================================
# 5. THE TWO NUMBERS THAT DECIDE IT
# =====================================================================
Out2
Out2 "5. THE TOTALS, SO THE THREE CAN BE COMPARED AT A GLANCE" "Cyan"
One "appointments, initial visit and showroom" `
    "select count(*) from Appointments where AutoApptID in (1,2) and DateTimeCreated >= $from"
One "estimates created" `
    "select count(*) from Estimates where DateTimeCreated >= $from"
One "estimates created with a price on them" `
    "select count(*) from Estimates where DateTimeCreated >= $from and Price > 0"
One "orders sold, wholesale left out" `
    "select count(*) from Orders as o inner join Estimates as e on e.EstimateID = o.EstimateID
      where o.SalesDate >= $from and (e.SaleTypeID is null or e.SaleTypeID <> 4)"
One "estimates with nobody against them" `
    "select count(*) from Estimates where DateTimeCreated >= $from and SalesAssociateID is null"

$cn.Close()
Out2
Out2 "Done. Nothing was changed and nothing was sent." "Green"
Finish 0
