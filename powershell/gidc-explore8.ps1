# =====================================================================
#  GIDC  ·  which date on an estimate is the initial measurement
#
#  Andrew, 16 October: credit the initial measurement to the sales
#  associate assigned to the estimate, and do not read the current
#  status to decide whether a measurement happened, because the status
#  moves on afterwards. In October so far: Nick 19 assigned with 11
#  moved on, Michael 23 assigned with 16 moved on and 7 still sitting
#  at Initial Visit Booked.
#
#  Those two numbers are the test. Estimates carries several dates and I
#  do not know which one is the measurement, so rather than pick one and
#  hope, this counts October by EVERY date column on the table, split by
#  the assigned associate, and prints them all. The column that reads
#  Nick 19 and Michael 23 is the right one and the rest are not.
#
#  It also prints the current status breakdown for those estimates, to
#  check the 11, the 16 and the 7 against what Access holds.
#
#  It reads only. It changes nothing, sends nothing, and prints no
#  password, username, phone, email or customer name.
#
#  HOW TO RUN IT
#      powershell -ExecutionPolicy Bypass -File .\gidc-explore8.ps1
#
#  It writes gidc-explore8-result.txt beside itself. Send me that.
# =====================================================================

param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile  = "",
  # the window the known numbers are from: 1 October to now
  [string] $From     = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-explore8-result.txt"
}
if (-not $From) { $From = (Get-Date -Format "yyyy-MM") + "-01" }

$HIDE = 'pass|pwd|secret|token|apikey|hash|salt|credential|' +
        'username|user_name|login|' +
        'phone|mobile|cell|email|fax|address|postal|zip|' +
        'clientname|customername'

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

Out2 ("GIDC back end, the initial measurement date, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
Out2 ("Window: {0} to now. Looking for Nick 19 and Michael 23." -f $From)
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
function Many($sql, $indent = "      ") {
  $rows = 0
  try {
    $rs = $cn.Execute($sql)
    while (-not $rs.EOF) {
      $who = $rs.Fields.Item(0).Value
      if ($null -eq $who -or $who -is [System.DBNull] -or "$who" -eq "") { $who = "(nobody)" }
      Out2 ("{0}{1,-28} {2,6}" -f $indent, $who, $rs.Fields.Item(1).Value)
      $rs.MoveNext(); $rows++
      if ($rows -ge 20) { Out2 ("{0}... stopped at 20" -f $indent); break }
    }
    $rs.Close()
  } catch {
    Out2 ("{0}could not be read: {1}" -f $indent, $_.Exception.Message) "DarkYellow"
  }
  return $rows
}

$lo = "#" + ([datetime]$From).ToString("MM/dd/yyyy") + "#"
$hi = "#" + (Get-Date).AddDays(1).ToString("MM/dd/yyyy") + "#"

# =====================================================================
# 1. WHAT IS ON AN ESTIMATE
# =====================================================================
Out2
Out2 "1. THE COLUMNS ON ESTIMATES" "Cyan"
$ec = ColsOf "Estimates"
if (-not $ec.Count) { Out2 "   Estimates could not be read." "Red"; $cn.Close(); Finish 1 }
Out2 ("   {0} columns: {1}" -f $ec.Count, (($ec | Where-Object { $_ -notmatch $HIDE }) -join ", "))

# every column whose name suggests it holds a date
$dates = @($ec | Where-Object { $_ -match 'Date' -and $_ -notmatch $HIDE })
Out2
Out2 ("   date columns to try: {0}" -f ($dates -join ", "))

# =====================================================================
# 2. OCTOBER BY EVERY DATE COLUMN, SPLIT BY THE ASSIGNED ASSOCIATE
# =====================================================================
Out2
Out2 "2. THE SAME WINDOW COUNTED BY EACH DATE COLUMN" "Cyan"
Out2 "   The one that reads Nick 19 and Michael 23 is the initial measurement date."
foreach ($d in $dates) {
  Out2
  Out2 ("   by Estimates.[{0}]:" -f $d) "Green"
  $n = Many "select n.CalendarName, count(*)
               from (Estimates as e left join def_Employees as n on n.EmployeeID = e.SalesAssociateID)
              where e.[$d] >= $lo and e.[$d] < $hi
              group by n.CalendarName
              order by count(*) desc"
  if (-not $n) { Out2 "      (nothing in the window)" }
}

# =====================================================================
# 3. AND WHERE THOSE ESTIMATES SIT NOW
# =====================================================================
# Not to count them by: Andrew's point is that the status moves on. This
# is only to check the 11, the 16 and the 7 against the database, so I
# know the window and the person field are being read the same way he
# reads them on screen.
Out2
Out2 "3. WHERE OCTOBER'S ESTIMATES SIT NOW, BY STATUS" "Cyan"
Out2 "   Counted by DateTimeCreated, as a cross check only."
Out2 "   Nick:"
Many "select s.EstimateStatusDescription, count(*)
        from ((Estimates as e left join def_Employees as n on n.EmployeeID = e.SalesAssociateID)
              left join def_EstimateStatus as s on s.EstimateStatusID = e.EstimateStatusID)
       where e.DateTimeCreated >= $lo and e.DateTimeCreated < $hi
         and n.CalendarName like 'Nick%'
       group by s.EstimateStatusDescription
       order by count(*) desc"
Out2 "   Michael:"
Many "select s.EstimateStatusDescription, count(*)
        from ((Estimates as e left join def_Employees as n on n.EmployeeID = e.SalesAssociateID)
              left join def_EstimateStatus as s on s.EstimateStatusID = e.EstimateStatusID)
       where e.DateTimeCreated >= $lo and e.DateTimeCreated < $hi
         and n.CalendarName like 'Michael%'
       group by s.EstimateStatusDescription
       order by count(*) desc"

# the status list itself, since the names are what everything is checked
# against and I have only ever seen two of the numbers
Out2
Out2 "   the status list:"
Many "select EstimateStatusID, EstimateStatusDescription from def_EstimateStatus order by EstimateStatusID" "      "

$cn.Close()
Out2
Out2 "Done. Nothing was changed and nothing was sent." "Green"
Finish 0
