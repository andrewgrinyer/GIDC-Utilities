# =====================================================================
#  GIDC  ·  nightly KPI import
#
#  Reads the Access back end, works out nine of the dashboard numbers for
#  each day, and pushes them to Supabase in one request. The two wholesale
#  numbers are rebuilt at the far end out of the dealer portal's own
#  orders, so nothing about them travels.
#
#  Nothing to install: it uses the Access engine already on the machine
#  and PowerShell's own web client.
#
#  HOW TO USE IT
#
#    See the numbers without sending anything, which is how to start:
#        .\gidc-kpi-import.ps1 -WhatIf
#
#    Send yesterday and today:
#        .\gidc-kpi-import.ps1
#
#    Fill in the history, once, in chunks it will handle itself:
#        .\gidc-kpi-import.ps1 -From 2018-11-20 -To 2026-10-13
#
#    Then put it in Task Scheduler, daily, something like 6am:
#        powershell -ExecutionPolicy Bypass -File "C:\GIDC\gidc-kpi-import.ps1"
#
#  WHAT IT NEEDS
#    $Key   the KPI_IMPORT_KEY you set in Supabase. Put it in the GIDC_KPI_KEY
#           environment variable on the server rather than in this file, so
#           the secret is not sitting in something that gets emailed around.
#           In an admin PowerShell, once:
#               [Environment]::SetEnvironmentVariable(
#                 'GIDC_KPI_KEY', 'the-long-random-string', 'Machine')
#
#  WHAT IT WILL NOT DO
#    It never deletes anything and it never writes anywhere but the
#    dashboard. Sending the same day twice replaces that day rather than
#    doubling it, so running it again after a correction in Access is the
#    normal way to fix a figure.
# =====================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string] $From,
  [string] $To,
  # Not -Db: PowerShell keeps "db" for itself as a short form of -Debug,
  # and passing -Db fails with a confusing message about an alias.
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $Url = "https://baakegbtuygtldksmant.supabase.co",
  [string] $Anon = "sb_publishable_CSwwslH9Jt60-WK2fEJORw_k-R9n8Vj",
  [string] $Key  = $env:GIDC_KPI_KEY,
  [string] $LogDir = "C:\GIDC\logs",

  # ---- where the two new numbers come from --------------------------
  # Andrew, 14 October: showroom appointments on their own, and sales
  # broken down by salesperson.
  #
  # Showroom comes from Estimates.ShowroomBookedDate, which he confirmed
  # is the field that records a showroom visit. It is not counted from
  # Appointments by type: two places record a showroom visit and this is
  # the one he works from.
  #
  # The salesperson is Orders.SalesAssociateSoldID, the one field on
  # Orders that means who sold it, with their name read out of
  # def_Employees. The name column in that table is found at run time
  # rather than assumed, and the log says which one it used.
  [string] $ShowroomField  = "ShowroomBookedDate",
  [string] $ShowroomTable  = "Estimates",
  [string] $RepTable       = "Orders",
  [string] $RepField       = "SalesAssociateSoldID",
  # def_Employees.CalendarName holds the whole name in one field, which
  # is why it is used rather than the first and last name columns: the
  # provider has no string functions to join those two with.
  [string] $RepNameTable   = "def_Employees",
  [string] $RepNameKey     = "EmployeeID",
  [string] $RepNameField   = "CalendarName",

  # ---- opportunities per salesperson, 16 October ---------------------
  # Andrew wants the number of opportunities beside what each person
  # sold, and settled what an opportunity is: just initial visits.
  #
  # Appointments has no EstimateID on it, so an appointment cannot be
  # traced to a salesperson through the estimate. What it does have is
  # ApptCalendarEmployeeID, the calendar the appointment sits on, and
  # that is the salesperson who went. Over the six months to 16 October
  # that reads Jason 525, Nick 213, Michael 49, Andrew 5, against 179,
  # 79, 9 and 11 sold, so it behaves like a denominator should for the
  # three full time sellers.
  #
  # Andrew's own 5 against 11 sold is the exception and it is real: he
  # sells from estimates that are on somebody else's calendar. His
  # opportunities figure will therefore read low rather than wrong, and
  # it is better to show that than to invent a rule for it.
  #
  # Dated by ApptDateTime, the day of the visit, not the day the booking
  # was made. The booking date is what the company level Booked
  # Appointments figure uses and it is right there, because that figure
  # answers "how much work came in". This one sits beside a person's
  # sold figure for the same period and answers "how many chances did
  # they get", so the visit date is the honest one. To swap it, pass
  # -ApptDateField DateTimeCreated.
  [string] $ApptTable           = "Appointments",
  [string] $ApptRepField        = "ApptCalendarEmployeeID",
  [string] $ApptDateField       = "ApptDateTime",
  # Checked against def_AutoAppointments at run time rather than
  # trusted. If id 1 is not the initial visit in your lookup, the metric
  # is skipped and the log prints the whole list so the right one can be
  # passed here.
  [int]    $InitialVisitApptType = 1,

  # Andrew, 14 October: a wholesale order must not count toward the
  # dollars in the Sold section. Those orders belong to the Wholesale
  # section, where they are counted out of the dealer portal, so letting
  # them into Sold as well counts the same sale twice.
  #
  # Estimates.SaleTypeID is the field, and 4 is Deal Doors, which Andrew
  # confirmed is the wholesale one. The other three stay in:
  #     1 Showroom, 2 Sold In Home, 3 Supply Only.
  #
  # Setting this to @() puts wholesale back in, which is worth doing once
  # to see how much of the sold figure it was.
  [int[]]  $ExcludeSaleTypes = @(4),

  # The two lead figures are leads sitting at a status. Settled against
  # def_EstimateStatus on 15 October: 1 is Initial Visit Booked and 4 is
  # Showroom Booked. Here as settings rather than written into the
  # queries, so a renumbering is one line rather than a hunt.
  [int]    $StatusInitialVisit   = 1,
  [int]    $StatusShowroomBooked = 4,

  # Andrew, 15 October: first time callers and web submissions become two
  # lines of their own, with incoming leads kept as the total of the two.
  #
  # Both have always been in Access: first time callers keyed into
  # AdCampaignCalls by hand, web leads counted from Estimates with
  # LeadTypeID 2. That is where the history comes from and it keeps
  # working untouched.
  #
  # LeadSwitch is the day the live sources take over. Before it, Access
  # still provides both. On and after it, CallRail provides the callers
  # and the script inside the Google Sheet provides the submissions, and
  # Access stops writing them so the two cannot argue.
  #
  # Leave it empty until both of those are actually running. Empty means
  # nothing changes: Access provides both, exactly as it does today.
  [string] $LeadSwitch = "",

  # Web submissions can switch on a different day from the callers, and
  # on 15 October they did: the callers changed hands on 1 August, while
  # the sheet goes back a year. Left empty this follows LeadSwitch, which
  # is what it did before there were two of them.
  [string] $WebSwitch = "",

  # CallRail. The key is made in CallRail under Account, Integrations,
  # API Keys, and lives on this machine as an environment variable. It is
  # never written into this file.
  #
  #   [Environment]::SetEnvironmentVariable(
  #     'GIDC_CALLRAIL_KEY', 'the-key', 'Machine')
  #
  # With no key the CallRail step is skipped and the run says so. The
  # account is found automatically when there is only one.
  [string] $CallRailKey     = $env:GIDC_CALLRAIL_KEY,
  [string] $CallRailAccount = $env:GIDC_CALLRAIL_ACCOUNT,

  [switch] $Explore
)

$ErrorActionPreference = "Stop"

# ---- where the output goes ------------------------------------------
# A scheduled task runs with nobody watching, so it keeps a log. Without
# one the first anybody knows of a broken night is a flat graph.
#
# But a log nobody can write is a poor reason to lose a night's numbers.
# C:\GIDC created by an elevated window cannot be written to by a normal
# one, which is exactly what happened the first time this was run. So the
# log is attempted, and if it cannot be had the run says so once and
# carries on to the screen alone.
$logFile = $null
try {
  if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force -WhatIf:$false -ErrorAction Stop | Out-Null
  }
  $try = Join-Path $LogDir ("kpi-import-{0}.log" -f (Get-Date -Format "yyyy-MM"))
  # Proved by writing, not by looking: a folder can exist and still refuse.
  [System.IO.File]::AppendAllText($try, "")
  $logFile = $try
} catch {
  # Built by joining rather than by -f, because -f binds to the piece of a
  # concatenation nearest it and the first version of this printed its own
  # {0} and {1} on screen.
  $why = $_.Exception.Message.Trim()
  Write-Host ("No log this run: " + $LogDir + " cannot be written to. " + $why) `
             -ForegroundColor Yellow
  Write-Host "The numbers below are still correct; only the record of them is missing." `
             -ForegroundColor Yellow
  Write-Host ("To keep a log, in an administrator PowerShell:  icacls " +
              [char]34 + $LogDir + [char]34 + " /grant " +
              [char]34 + $env:USERNAME + ":(OI)(CI)M" + [char]34) -ForegroundColor Yellow
}
function Say($msg, $colour = "Gray") {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Write-Host $line -ForegroundColor $colour
  # .NET rather than Add-Content, because Add-Content supports ShouldProcess
  # and under -WhatIf would print "What if: Add Content" against every
  # single line, burying the numbers the dry run was asked for.
  if ($logFile) {
    try { [System.IO.File]::AppendAllText($logFile, $line + [Environment]::NewLine) }
    catch { $script:logFile = $null }
  }
}
function Stop-Badly($msg) {
  Say $msg "Red"
  exit 1
}

# ---- the window ------------------------------------------------------
# Yesterday and today by default: yesterday because a day is only
# complete once it is over, today so the dashboard is not a day stale.
if (-not $From) { $From = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd") }
if (-not $To)   { $To   = (Get-Date).ToString("yyyy-MM-dd") }
$fromDate = [datetime]::ParseExact($From, "yyyy-MM-dd", $null)
$toDate   = [datetime]::ParseExact($To,   "yyyy-MM-dd", $null)
if ($toDate -lt $fromDate) { Stop-Badly "The To date is before the From date." }

Say ("=" * 62)
Say ("KPI import, {0} to {1}" -f $From, $To) "Cyan"
if (-not $Key -and -not $WhatIfPreference) {
  Stop-Badly ("No import key. Set GIDC_KPI_KEY on this machine, or pass -Key. " +
              "Run with -WhatIf to see the numbers without one.")
}

# ---- Access ----------------------------------------------------------
if (-not (Test-Path -LiteralPath $Database)) { Stop-Badly "Cannot see the database at $Database" }
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database"); $opened = $true; break } catch { }
}
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Stop-Badly ("Could not open the database. This is $bits PowerShell and needs a " +
    "$bits Access engine. Try the other one: " +
    "C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe")
}
Say "Opened the Access back end"

# ---- -Explore: read the schema and say what to fill in ---------------
# This reads nothing but names. It sends nothing and writes nothing.
if ($Explore) {
  Say "EXPLORING. Nothing will be read as a figure and nothing sent." "Yellow"

  $tables = @()
  try {
    $rs = $cn.OpenSchema(20)                       # adSchemaTables
    while (-not $rs.EOF) {
      if ($rs.Fields.Item("TABLE_TYPE").Value -eq "TABLE") {
        $tables += [string]$rs.Fields.Item("TABLE_NAME").Value
      }
      $rs.MoveNext()
    }
    $rs.Close()
  } catch { Stop-Badly ("Could not list the tables: " + $_.Exception.Message) }

  function ColumnsOf($t) {
    $out = @()
    try {
      $rs = $cn.OpenSchema(4, @($null, $null, $t))  # adSchemaColumns
      while (-not $rs.EOF) {
        $out += [string]$rs.Fields.Item("COLUMN_NAME").Value
        $rs.MoveNext()
      }
      $rs.Close()
    } catch { }
    return $out
  }

  Write-Host ""
  Write-Host "1. THE SHOWROOM APPOINTMENT TYPE" -ForegroundColor Cyan
  Write-Host "   Booked appointments already counts AutoApptID 1 and 2, which are"
  Write-Host "   Initial Visit and Showroom. These are the types as your database"
  Write-Host "   has them, so pass the Showroom one as -ShowroomApptId."
  $apptLookups = $tables | Where-Object { $_ -match 'appt|appointment' }
  foreach ($t in $apptLookups) {
    $cols = ColumnsOf $t
    $idc  = $cols | Where-Object { $_ -match 'AutoApptID|ApptTypeID' } | Select-Object -First 1
    $txt  = $cols | Where-Object { $_ -match 'Desc|Name|Type|Title' } | Select-Object -First 1
    if (-not $idc -or -not $txt) { continue }
    try {
      $rs = $cn.Execute("select [$idc], [$txt] from [$t] order by [$idc]")
      if ($rs.EOF) { $rs.Close(); continue }
      Write-Host ("   table {0}:" -f $t) -ForegroundColor Green
      while (-not $rs.EOF) {
        Write-Host ("      {0,4}  {1}" -f $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value)
        $rs.MoveNext()
      }
      $rs.Close()
    } catch { }
  }

  Write-Host ""
  Write-Host "2. THE SALESPERSON" -ForegroundColor Cyan
  Write-Host "   Any field that looks like it holds who sold the order. Pass the"
  Write-Host "   right one as -RepTable and -RepField. If it is an ID rather than"
  Write-Host "   a name, also pass -RepNameTable, -RepNameKey and -RepNameField."
  foreach ($t in @("Orders", "Estimates")) {
    foreach ($c in (ColumnsOf $t)) {
      if ($c -match 'sales.*(person|rep|man)|salesid|employee|staff|rep$|soldby|user') {
        Write-Host ("   -RepTable {0} -RepField {1}" -f $t, $c) -ForegroundColor Green
      }
    }
  }
  Write-Host "   and the lookups those IDs probably point at:"
  foreach ($t in ($tables | Where-Object { $_ -match 'employee|staff|salesperson|salesrep|users|people' })) {
    Write-Host ("      {0}: {1}" -f $t, ((ColumnsOf $t) -join ", "))
  }

  Write-Host ""
  Write-Host "Send me those two lines and I will pin them into this file." -ForegroundColor Yellow
  $cn.Close()
  exit 0
}

# Access wants dates wrapped in hashes, in US order, whatever the machine
# is set to. Getting this wrong silently returns the wrong month.
function AccDate([datetime] $d) { "#" + $d.ToString("MM/dd/yyyy") + "#" }

# WHAT THIS FILE IS ALLOWED TO USE, AND WHY
#
# The queries run through the OLEDB provider, not inside Access, and the
# provider does not have Access's VBA functions. Nz is the obvious one:
# every query that used it failed on the server with "Undefined function
# 'Nz' in expression", and DateValue and Trim are from the same family.
#
# So only what has actually been seen to run against your back end is
# used here:
#     Format(col,'yyyy-mm-dd')   for the day a figure belongs to
#     IIf(col Is Null, 0, col)   where a null has to become a zero
#     is null / is not null      for testing one
#     count(), sum()             which ignore nulls by themselves
#     #MM/dd/yyyy#               for a date
# Nothing else. A figure that cannot be collected is worth more as a gap
# than as a query that falls over at six in the morning.
#
# Grouping by Format gives a text day rather than a date, which is what
# this wants anyway: the day is sent as yyyy-mm-dd.
function AccDay($col) { "Format($col,'yyyy-mm-dd')" }

# A database null is not PowerShell's null. It arrives as [DBNull]::Value,
# which is a real object, so a test for $null says there is a value and
# the cast to a number then fails with something about DBNull. Every value
# read out of a recordset goes through here first.
#
# This only started to matter once Nz was taken out of the queries: Nz had
# been turning those nulls into zeros inside Access, and Access is not
# where these run.
function Plain($value) {
  if ($null -eq $value) { return $null }
  if ($value -is [System.DBNull]) { return $null }
  return $value
}
$lo = AccDate $fromDate
$hi = AccDate $toDate.AddDays(1)      # exclusive, so a day's times all count

# ---- how far forward the measurements figure reaches ------------------
# A measurement booked for next Tuesday is a real measurement on the
# books, and Andrew counts it: Michael's 7 still at Initial Visit Booked
# are in his 23. So that one figure has to read past today, which no
# other figure here does.
#
# It stops at the end of the GIDC month today sits in, and that limit is
# not caution, it is the dashboard. The page builds its list of periods
# out of the days it finds, newest first, and opens on the newest one. A
# measurement booked for the middle of next month would create a period
# that does not exist yet, make it the newest, and the dashboard would
# open on a month holding one number and nothing else.
#
# THE PERIOD RULE IS THE DATABASE'S, NOT A RECONSTRUCTION OF IT
#
# A GIDC month starts on the first Monday of a calendar month and runs
# until the day before the NEXT month's first Monday. Most are four
# weeks and four a year are five. My first version here added 28 days
# and called it done, which put 60 days of every two years in no period
# at all: the five week months are not an exception to work around, they
# are what makes the twelve add up to 52 weeks with no gaps.
#
# Same rule as kpi_periods in the database, which is the table the
# dashboard actually buckets by.
function FirstMonday([int] $y, [int] $m) {
  $d = [datetime]::new($y, $m, 1)
  while ($d.DayOfWeek -ne [DayOfWeek]::Monday) { $d = $d.AddDays(1) }
  return $d
}
function GidcPeriodEnd([datetime] $day) {
  $thisFm = FirstMonday $day.Year $day.Month
  # the first days of a calendar month still belong to the period that
  # began in the month before, and that period ends here
  if ($day.Date -lt $thisFm.Date) { return $thisFm }
  $n = [datetime]::new($day.Year, $day.Month, 1).AddMonths(1)
  return (FirstMonday $n.Year $n.Month)       # exclusive
}
$visitEnd = $toDate.AddDays(1)
if ($toDate.Date -ge (Get-Date).Date) { $visitEnd = GidcPeriodEnd (Get-Date) }
$visitHi = AccDate $visitEnd

# For the readings that can only be taken now rather than reconstructed.
# Written into the query as plain text rather than asked of the database,
# because the functions that would give today's date belong to Access and
# not to the provider these run through.
$today = (Get-Date).ToString("yyyy-MM-dd")

# The two hand kept lead figures stop at the switch, because from that
# day CallRail and the sheet provide them and two sources writing the
# same day would just overwrite each other in whichever order they ran.
#
# No switch set means no change: Access covers the whole range, which is
# what happens every night until the new sources are actually running.
#
# The parsed date is deliberately not called $leadSwitch. PowerShell does
# not care about case, so that name and the -LeadSwitch parameter are one
# variable, and setting it to $null first emptied the setting before the
# line below could read it. That cost me twenty minutes here and an hour
# the last time it happened.
$leadHi    = $hi
$webHi     = $hi
$switchDay = $null
if ($LeadSwitch) {
  try { $switchDay = [datetime]::ParseExact($LeadSwitch, "yyyy-MM-dd", $null) }
  catch { Stop-Badly ("LeadSwitch has to look like 2026-10-20. It says: " + $LeadSwitch) }
  if ($switchDay -lt $toDate.AddDays(1)) { $leadHi = AccDate $switchDay }
  $webHi = $leadHi
}

# The web half, which may switch on a different day from the callers.
$webDay = $null
if ($WebSwitch) {
  try { $webDay = [datetime]::ParseExact($WebSwitch, "yyyy-MM-dd", $null) }
  catch { Stop-Badly ("WebSwitch has to look like 2025-10-15. It says: " + $WebSwitch) }
  $webHi = if ($webDay -lt $toDate.AddDays(1)) { AccDate $webDay } else { $hi }
}

# ---- what comes out of Access ----------------------------------------
# Each one returns two columns: a day and a number. The comment on each is
# the definition Andrew agreed, so if a figure ever looks wrong this is
# the place the argument gets settled.
$skipped = @()
$QUERIES = @(
  # These two used to be added together into one figure. They are now a
  # line each, and the database adds them up into incoming leads as soon
  # as either one lands. Same numbers, same history, shown separately.
  @{ metric = "phone_leads_new"
     why    = "First time callers logged against a campaign"
     sql    = "select Format(AdCampaignCallDate,'yyyy-mm-dd') as d,
                      sum(CountFirstTimeCallers) as v
                 from AdCampaignCalls
                where AdCampaignCallDate >= $lo and AdCampaignCallDate < $leadHi
                group by Format(AdCampaignCallDate,'yyyy-mm-dd')" },

  @{ metric = "web_leads"
     why    = "Web leads, from Estimates marked as lead type 2"
     sql    = "select Format(DateTimeCreated,'yyyy-mm-dd') as d, count(*) as v
                 from Estimates
                where LeadTypeID = 2
                  and DateTimeCreated >= $lo and DateTimeCreated < $webHi
                group by Format(DateTimeCreated,'yyyy-mm-dd')" },

  # INITIAL VISITS ONLY. IT USED TO BE TYPES 1 AND 2 AND THAT WAS WRONG
  #
  # Andrew, 16 October: a showroom appointment does not start life as a
  # showroom appointment. Every one of them begins as an initial visit,
  # so counting both types counted the same opportunity twice, and the
  # second count landed in a different week from the first.
  #
  # Everything downstream was wrong with it. Close rate is sold orders
  # divided by this figure, so an inflated denominator has been making
  # the whole company look worse at closing than it is.
  #
  # Showroom bookings are still counted, in showroom_appts, and that is
  # the right place for them: they are a stage an opportunity reaches,
  # not an opportunity arriving. The one thing nobody may do is add the
  # two figures together.
  #
  # History already in the database was written the old way. Run this
  # with -From to rewrite it: the import replaces a day it recounts
  # rather than adding to it.
  @{ metric = "booked_appts"
     why    = "Initial visit appointments, by the day the booking was made. Showroom appointments are NOT counted: they begin as initial visits and would be the same opportunity twice. A rebooking counts again: the work was done."
     sql    = "select Format(DateTimeCreated,'yyyy-mm-dd') as d, count(*) as v
                 from Appointments
                where AutoApptID = $InitialVisitApptType
                  and DateTimeCreated >= $lo and DateTimeCreated < $hi
                group by Format(DateTimeCreated,'yyyy-mm-dd')" },

  # These two are replaced further down by a version broken down by
  # salesperson. Both join Estimates, the count as well as the money, so
  # that a wholesale sale can be left out of the count too.
  @{ metric = "sold_orders"
     why    = "Orders by the day they were sold"
     sql    = "select Format(o.SalesDate,'yyyy-mm-dd') as d, count(*) as v
                 from Orders as o inner join Estimates as e on e.EstimateID = o.EstimateID
                where o.SalesDate >= $lo and o.SalesDate < $hi@@SOLD@@
                group by Format(o.SalesDate,'yyyy-mm-dd')" },

  @{ metric = "total_sales"
     why    = "The price on those orders' estimates"
     sql    = "select Format(o.SalesDate,'yyyy-mm-dd') as d, sum(e.Price) as v
                 from Orders as o inner join Estimates as e on e.EstimateID = o.EstimateID
                where o.SalesDate >= $lo and o.SalesDate < $hi@@SOLD@@
                group by Format(o.SalesDate,'yyyy-mm-dd')" },

  # Andrew, 10:33: an install belongs to the day it was booked for, not
  # the day the paperwork was closed. CompletedDate is when somebody got
  # round to marking the order finished, which can be weeks later or
  # never; InstallBookedDate is the day the van turned up.
  #
  # Wholesale is still excluded, which it was not until 10:13. Of 788
  # orders with a completed date in 2026, 378 were Deal Doors carrying
  # the $1 placeholder, so the count was nearly double what it should be
  # and the average per install was half. Estimates is joined in for the
  # count as well as the money, so both are filtered the same way.
  @{ metric = "installs"
     why    = "Orders by the day the install was booked for, wholesale excluded"
     sql    = "select Format(o.InstallBookedDate,'yyyy-mm-dd') as d, count(*) as v
                 from Orders as o inner join Estimates as e on e.EstimateID = o.EstimateID
                where o.InstallBookedDate >= $lo and o.InstallBookedDate < $hi@@SOLD@@
                group by Format(o.InstallBookedDate,'yyyy-mm-dd')" },

  @{ metric = "installed_value"
     why    = "Estimates.Price on those orders, by the day the install was booked for, wholesale excluded"
     sql    = "select Format(o.InstallBookedDate,'yyyy-mm-dd') as d, sum(e.Price) as v
                 from Orders as o inner join Estimates as e on e.EstimateID = o.EstimateID
                where o.InstallBookedDate >= $lo and o.InstallBookedDate < $hi@@SOLD@@
                group by Format(o.InstallBookedDate,'yyyy-mm-dd')" },

  @{ metric = "gobacks"
     why    = "Issues raised, not counting the voided ones"
     sql    = "select Format(IssueDateOpened,'yyyy-mm-dd') as d, count(*) as v
                 from Issues
                where IssueStatusID <> 3
                  and IssueDateOpened >= $lo and IssueDateOpened < $hi
                group by Format(IssueDateOpened,'yyyy-mm-dd')" },

  # The nine status columns are added together, and a null in any one of
  # them would make the whole sum null, so each is guarded. IIf, not Nz.
  @{ metric = "retail_backlog"
     why    = "Orders at statuses 1 to 9, from your own daily snapshot. A reading, not a total."
     sql    = "select Format(LogDate,'yyyy-mm-dd') as d,
                      IIf([1] Is Null,0,[1])+IIf([2] Is Null,0,[2])+IIf([3] Is Null,0,[3])
                     +IIf([4] Is Null,0,[4])+IIf([5] Is Null,0,[5])+IIf([6] Is Null,0,[6])
                     +IIf([7] Is Null,0,[7])+IIf([8] Is Null,0,[8])+IIf([9] Is Null,0,[9]) as v
                 from DailyLog_OrderStatus
                where LogDate >= $lo and LogDate < $hi" },

  @{ metric = "install_backlog"
     why    = "Days of installation work outstanding, from your own daily snapshot"
     sql    = "select Format(LogDate,'yyyy-mm-dd') as d, InstallBacklog as v
                 from DailyLog_OrderStatus
                where LogDate >= $lo and LogDate < $hi" },

  # Andrew, 21:35: the retail backlog in doors as well as orders, and
  # 21:40: product type Doors only, so closets, garage and the two
  # Grinyer lines are not counted. DoorOrders.DoorProductTypeID 1 is
  # Interior Doors; 2 and 3 are the GDL lines.
  #
  # This is a reading of how things stand now, not a figure for a past
  # day: there is no record of what the backlog was last March. So the
  # day is written in rather than taken from the data, which also keeps
  # a backfill from inventing a year of identical readings.
  # Andrew, 10:13: these are leads sitting at a status, not appointments
  # in a diary. That is why my first attempt read 29 and 6 against his 38
  # and 12: I was counting future-dated appointments, and the business
  # counts estimates waiting at a stage.
  #
  #   EstimateStatusID 1 is Initial Visit Booked
  #   EstimateStatusID 4 is Showroom Booked
  #
  # Both are readings of now rather than counts of a period: an estimate
  # moves off a status and there is no record of what the figure was last
  # March, so the day is written in rather than taken from the data.
  @{ metric = "appts_booked_measure"
     why    = "Leads at Initial Visit Booked, status 1. A reading of today."
     sql    = "select '$today' as d, count(*) as v
                 from Estimates
                where EstimateStatusID = $StatusInitialVisit" },

  @{ metric = "appts_booked_showroom"
     why    = "Leads at Showroom Booked, status 4. A reading of today."
     sql    = "select '$today' as d, count(*) as v
                 from Estimates
                where EstimateStatusID = $StatusShowroomBooked" },

  #
  # Andrew, 22:17: wholesale was being counted in here. The product type
  # filter keeps closets and garage out but says nothing about who the
  # order is for, so a dealer order sitting at Order Sent was landing in
  # the retail backlog. Those doors belong to the Wholesale section,
  # which counts them out of the portal, so counting them here as well
  # counted the same work twice. Estimates is joined in for the sale
  # type and the exclusion is the same clause the sold figures use.
  @{ metric = "retail_backlog_doors"
     why    = "Doors outstanding on retail orders at statuses 1 to 9, product type Doors only, wholesale excluded. A reading of today."
     sql    = "select '$today' as d, sum(dr.DoorQuantity) as v
                 from (DoorOrders as dr
                       inner join Orders as o on o.OrderID = dr.OrderID)
                       inner join Estimates as e on e.EstimateID = o.EstimateID
                where dr.DoorProductTypeID = 1
                  and o.OrderStatusID >= 1 and o.OrderStatusID <= 9@@SOLD@@" }
)

# ---- and the two Andrew asked for on 14 October ----------------------
# Each is added only once the setting it needs is filled in, so a blank
# setting costs one line in the log and nothing else.
if ($ShowroomTable -and $ShowroomField) {
  $QUERIES += @{ metric = "showroom_appts"
     why    = "Showroom appointments, by $ShowroomField"
     sql    = "select Format([$ShowroomField],'yyyy-mm-dd') as d, count(*) as v
                 from [$ShowroomTable]
                where [$ShowroomField] >= $lo and [$ShowroomField] < $hi
                group by Format([$ShowroomField],'yyyy-mm-dd')" }
} else {
  $skipped += "showroom_appts (no -ShowroomField)"
}

# ---- wholesale out of the sold figures -------------------------------
# One clause, shared by every query that counts a sale, so the two can
# never end up filtered differently. Written as "is null or not in"
# rather than wrapping the column, because an order with no sale type on
# it at all must be kept rather than dropped by a comparison to null.
$soldWhere = ""
if ($ExcludeSaleTypes.Count) {
  $list = ($ExcludeSaleTypes | ForEach-Object { [int]$_ }) -join ","
  $soldWhere = " and (e.SaleTypeID is null or e.SaleTypeID not in ($list))"
  Say ("  sold figures exclude SaleTypeID {0}" -f $list)
} else {
  $skipped += "wholesale is NOT being excluded from the sold figures (-ExcludeSaleTypes is empty)"
}

# ---- who the salesperson is, in words --------------------------------
# A dashboard row reading 7 helps nobody, so the ID is turned into a name
# where one can be found. Which column holds it is read off the table
# rather than assumed: this is somebody else's schema and the cost of
# guessing wrong is a column of blanks.
function ColumnsIn($table) {
  $out = @()
  try {
    $rs = $cn.Execute("select * from [$table] where 1=0")
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $out += [string]$rs.Fields.Item($i).Name }
    $rs.Close()
  } catch { }
  return $out
}

if ($RepNameTable) {
  $ecols = ColumnsIn $RepNameTable
  # Checked even when both names are set, because a lookup that cannot be
  # read at all has to fall back to IDs rather than fail the night.
  if ($ecols.Count -and $RepNameField -and ($ecols -notcontains $RepNameField)) {
    Say ("  {0} has no {1} column, so a name column will be looked for" -f
         $RepNameTable, $RepNameField) "Yellow"
    $RepNameField = ""
  }
  if ($ecols.Count -and $RepNameKey -and ($ecols -notcontains $RepNameKey)) {
    Say ("  {0} has no {1} column, so its key will be looked for" -f
         $RepNameTable, $RepNameKey) "Yellow"
    $RepNameKey = ""
  }
  if (-not $ecols.Count) {
    Say ("  cannot read {0}, so the breakdown will show IDs rather than names" -f $RepNameTable) "Yellow"
    $RepNameTable = ""
  } else {
    if (-not $RepNameKey) {
      $RepNameKey = @($ecols | Where-Object { $_ -match '^(EmployeeID|StaffID|PersonID|ID)$' })[0]
      if (-not $RepNameKey) { $RepNameKey = @($ecols | Where-Object { $_ -match 'ID$' })[0] }
    }
    if (-not $RepNameField) {
      # One column holding the whole name. Nothing is stitched together
      # here: the provider has no string functions, so a first and last
      # name cannot be joined in the query.
      $RepNameField = @($ecols | Where-Object {
        $_ -match '^(CalendarName|FullName|EmployeeName|DisplayName|Name|StaffName)$' })[0]
    }
    if ($RepNameKey -and $RepNameField) {
      Say ("  salesperson names from {0}.{1}, keyed on {2}" -f
           $RepNameTable, $RepNameField, $RepNameKey)
    } else {
      Say ("  no name column found in {0}, so the breakdown will show IDs" -f $RepNameTable) "Yellow"
      $RepNameTable = ""
    }
  }
}

if ($RepTable -and $RepField) {
  # Who gets the credit. If the field holds an ID and a name lookup was
  # given, the name is used, because a dashboard row reading 7 helps
  # nobody. Without the lookup the ID is used as it stands and the
  # dashboard shows that, which is at least honest.
  $repExpr  = "o.[$RepField]"
  $repFrom  = "[$RepTable] as o"
  $salesTbl = $RepTable
  if ($RepNameTable -and $RepNameKey -and $RepNameField) {
    # One column only. Joining a first and a last name together would
    # need the string functions the provider does not have, and
    # def_Employees already carries CalendarName, which is the whole
    # name in one field.
    $repExpr = "n.[$RepNameField]"
    # A left join, not an inner one: an order whose salesperson has been
    # deleted from the lookup must still be counted, or the people stop
    # adding up to the company total.
    $repFrom = "[$RepTable] as o left join [$RepNameTable] as n on n.[$RepNameKey] = o.[$RepField]"
  }

  # Sold orders per person. If the salesperson lives on Estimates rather
  # than Orders, the join runs the other way; both shapes are handled by
  # naming the table in the setting.
  $dateCol = if ($salesTbl -eq "Orders") { "o.SalesDate" } else { "ord.SalesDate" }

  # Estimates is joined in for every one of these, not only the money
  # query: the count needs it too, so that a wholesale order can be left
  # out of the count as well as out of the dollars. Access needs each
  # join nested in its own brackets once there is more than one.
  if ($salesTbl -eq "Orders") {
    $base = if ($RepNameTable) { "(" + $repFrom + ")" } else { $repFrom }
    $withPrice = "(" + $base + " inner join [Estimates] as e on e.EstimateID = o.EstimateID)"
  } else {
    $base = "([Orders] as ord inner join " + $repFrom + " on o.EstimateID = ord.EstimateID)"
    $withPrice = "(" + $base + " inner join [Estimates] as e on e.EstimateID = ord.EstimateID)"
  }

  $QUERIES += @{ metric = "sold_orders"
     why    = "Orders by the day they were sold, broken down by $RepField"
     dim    = $true
     sql    = "select Format($dateCol,'yyyy-mm-dd') as d, count(*) as v, $repExpr as r
                 from $withPrice
                where $dateCol >= $lo and $dateCol < $hi@@SOLD@@
                group by Format($dateCol,'yyyy-mm-dd'), $repExpr" }

  # And the money on those orders, per person. Estimates is joined in for
  # the price whichever side the salesperson sits on.
  $QUERIES += @{ metric = "total_sales"
     why    = "The price on those orders, broken down by $RepField"
     dim    = $true
     sql    = "select Format($dateCol,'yyyy-mm-dd') as d, sum(e.Price) as v, $repExpr as r
                 from $withPrice
                where $dateCol >= $lo and $dateCol < $hi@@SOLD@@
                group by Format($dateCol,'yyyy-mm-dd'), $repExpr" }

  # The company figures for those two are now the sum of the people, so
  # the undivided versions above would land on the same days as well as
  # the split rows. Dropped here rather than edited out above, so the
  # definition everybody argues about stays in one place.
  $QUERIES = @($QUERIES | Where-Object {
    -not ($_.dim -ne $true -and ($_.metric -eq "sold_orders" -or $_.metric -eq "total_sales")) })
} else {
  $skipped += "the breakdown by salesperson (needs -RepTable and -RepField; run -Explore)"
}

# ---- initial measurements per salesperson, 16 October ----------------
# THIS CAME OFF THE APPOINTMENTS TABLE FIRST AND THAT WAS WRONG
#
# My first version counted rows in Appointments and credited them to
# ApptCalendarEmployeeID, the calendar the appointment sat on. Andrew,
# 10:51: the credit belongs to the sales associate assigned to the
# estimate, and the current status must not be used to decide whether a
# measurement happened, because the status moves on afterwards.
#
# So it is Estimates, by MeasureDate, credited to SalesAssociateID, and
# the status is not read at all. Checked against two numbers he gave
# from his own screen for October: Nick 19 and Michael 23. Counting the
# whole calendar month on MeasureDate gives Nick 19 and Michael 24, and
# the one extra is a measurement booked in the forty minutes between.
#
# The three readings that disagreed, kept here because the next person
# to wonder will wonder the same thing:
#     MeasureDate, month to date       Nick 13   Michael 17
#     DateTimeCreated, whole month     Nick 16   Michael 18
#     MeasureDate, GIDC month          Nick 18   Michael 19
#     MeasureDate, whole month         Nick 19   Michael 24   <- his
#
# An estimate with no MeasureDate is not counted, which is right: a
# showroom only job never had a measurement. In October that is 21 of
# Andrew's and 6 belonging to nobody.
if ($RepNameTable -and $RepNameKey -and $RepNameField) {
  $visitWho = "n.[$RepNameField]"
  $visitFrom = "Estimates as e left join [$RepNameTable] as n on n.[$RepNameKey] = e.SalesAssociateID"
} else {
  $visitWho  = "e.SalesAssociateID"
  $visitFrom = "Estimates as e"
}
$QUERIES += @{ metric = "initial_visits"
   why    = "Estimates by MeasureDate, credited to the assigned sales associate. Status is never read: it moves on after the measurement is done."
   dim    = $true
   sql    = "select Format(e.MeasureDate,'yyyy-mm-dd') as d, count(*) as v, $visitWho as r
               from $visitFrom
              where e.MeasureDate >= $lo and e.MeasureDate < $visitHi
              group by Format(e.MeasureDate,'yyyy-mm-dd'), $visitWho" }

# THE APPOINTMENT TYPE BOOKED APPOINTMENTS RESTS ON, CONFIRMED
#
# Booked sales appointments counts AutoApptID 1 and nothing else as of
# this morning, so the whole figure rests on 1 meaning the initial
# visit. That has been assumed since the figure was built and never read
# back from the lookup, so it is read here. If it is not what we think,
# the figure is dropped for the night and the list printed: a missing
# number is an obvious problem and a wrong one is not.
$apptName = $null
$apptAll  = @()
try {
  $rs = $cn.Execute("select AutoApptID, AutoApptName from def_AutoAppointments order by AutoApptID")
  while (-not $rs.EOF) {
    $id = [int]$rs.Fields.Item(0).Value
    $nm = [string]$rs.Fields.Item(1).Value
    $apptAll += ("{0} {1}" -f $id, $nm)
    if ($id -eq $InitialVisitApptType) { $apptName = $nm }
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Say "  could not read def_AutoAppointments, so the appointment type cannot be checked" "Yellow"
}
if ($apptName -and $apptName -match 'initial|first|1st|measure') {
  Say ("  booked appointments: type {0} is '{1}'" -f $InitialVisitApptType, $apptName)
} else {
  if ($apptName) {
    Say ("  appointment type {0} is called '{1}', which is not an initial visit." -f
         $InitialVisitApptType, $apptName) "Yellow"
    foreach ($a in $apptAll) { Say ("      {0}" -f $a) }
  }
  $QUERIES = @($QUERIES | Where-Object { $_.metric -ne "booked_appts" })
  $skipped += "booked_appts (pass the right -InitialVisitApptType from the list above)"
}

foreach ($s in $skipped) { Say ("  skipped: {0}" -f $s) "Yellow" }

# The filter goes in last, in one place, so every query that counts a sale
# carries exactly the same clause and no query can be missed.
foreach ($q in $QUERIES) { $q.sql = $q.sql -replace '@@SOLD@@', $soldWhere }

# ---- collect ----------------------------------------------------------
$byKey = @{}     # "metric|date" -> value, so the two lead queries can add up
$counts = @{}

foreach ($q in $QUERIES) {
  $metric = $q.metric
  $n = 0
  try {
    $rs = $cn.Execute($q.sql)
    while (-not $rs.EOF) {
      $d = Plain $rs.Fields.Item(0).Value
      $v = Plain $rs.Fields.Item(1).Value
      # a split query returns a third column: who the number belongs to
      $dim = ""
      if ($q.dim) {
        $raw = Plain $rs.Fields.Item(2).Value
        $dim = if ($null -eq $raw) { "Unassigned" } else { ([string]$raw).Trim() }
        if ($dim -eq "") { $dim = "Unassigned" }
      }
      $rs.MoveNext()
      # No day means the row cannot be placed anywhere, so it is dropped.
      if ($null -eq $d -or "$d" -eq "") { continue }
      $day = ([datetime]$d).ToString("yyyy-MM-dd")
      # No value means nothing happened that day, which is a zero. This is
      # what Nz used to do inside the query before it turned out not to
      # exist outside Access.
      if ($null -eq $v -or "$v" -eq "") { $v = 0 }
      $k = "$metric|$day|$dim"
      if ($q.add -and $byKey.ContainsKey($k)) { $byKey[$k] = $byKey[$k] + [double]$v }
      else { $byKey[$k] = [double]$v }
      $n++
    }
    $rs.Close()
  } catch {
    Stop-Badly ("The query for {0} failed: {1}`n{2}" -f $metric, $_.Exception.Message, $q.sql)
  }
  $counts[$metric] = ($counts[$metric] + $n)
  Say ("  {0,-18} {1,5} day(s)   {2}" -f $metric, $n, $q.why)
}
$cn.Close()

# ---- first time callers, from CallRail --------------------------------
# One request covers the whole stretch: CallRail reports a figure per day
# and first_time_callers is one of the fields it will break out. Counting
# the calls one by one and working out which were new would be the same
# answer arrived at slowly, with every caller's phone number dragged
# across the internet to get there.
#
# This runs after Access on purpose. They write to the same place, and
# the one that runs second is the one that stands, so if a day is ever
# covered by both it is CallRail that wins.
function Get-CallRail($path, $what, $key) {
  $uri = "https://api.callrail.com/v3/$path"
  try {
    return Invoke-RestMethod -Method Get -Uri $uri -TimeoutSec 90 `
             -Headers @{ "Authorization" = ('Token token="' + $key + '"') }
  } catch {
    $said = $_.Exception.Message
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $said = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
    } catch { }
    if ("$said" -match '401|[Uu]nauthor') {
      $said = "CallRail refused the key. Check GIDC_CALLRAIL_KEY on this machine."
    }
    Say ("  could not " + $what + ": " + $said) "Yellow"
    return $null
  }
}

if (-not $CallRailKey) {
  Say "  no CallRail key on this machine, so first time callers come from Access" "Yellow"
} elseif (-not $switchDay) {
  # A key with no switch date is a half finished setup. Writing anyway
  # would have CallRail quietly overwrite years of hand kept figures,
  # which is not something to do as a side effect of setting a variable.
  Say "  CallRail key found, but no switch date, so it is not being used." "Yellow"
  Say "  Run the checker first, then pass -LeadSwitch yyyy-mm-dd to turn it on." "Yellow"
} else {
  # Windows Server offers an older handshake first and CallRail will not
  # take it.
  try {
    [Net.ServicePointManager]::SecurityProtocol =
      [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch { }

  $acct = $CallRailAccount
  if (-not $acct) {
    $found = Get-CallRail "a.json" "find the CallRail account" $CallRailKey
    if ($found -and $found.accounts -and $found.accounts.Count -ge 1) {
      $acct = $found.accounts[0].id
      if ($found.accounts.Count -gt 1) {
        Say ("  {0} CallRail accounts, using the first. Pass -CallRailAccount to pick." -f
             $found.accounts.Count) "Yellow"
      }
    }
  }

  if (-not $acct) {
    Say "  no CallRail account to read, so first time callers come from Access" "Yellow"
  } else {
    # CallRail keeps 25 months and answers with an error for anything
    # older, so a backfill of 2019 asks only for the part that exists.
    $crFrom = $switchDay
    if ($crFrom -lt $fromDate) { $crFrom = $fromDate }
    $oldest = (Get-Date).Date.AddMonths(-24)
    if ($crFrom -lt $oldest) {
      Say ("  CallRail only keeps about two years, so this starts at {0}" -f
           $oldest.ToString("yyyy-MM-dd")) "Yellow"
      $crFrom = $oldest
    }

    if ($crFrom -gt $toDate) {
      Say "  nothing in this range is on or after the switch, so CallRail is not needed" "Gray"
    } else {
      $f = $crFrom.ToString("yyyy-MM-dd")
      $t = $toDate.ToString("yyyy-MM-dd")
      $series = Get-CallRail ("a/$acct/calls/timeseries.json?start_date=$f&end_date=$t" +
                              "&fields=first_time_callers&time_zone=America/Toronto") `
                             "read the daily figures from CallRail" $CallRailKey
      if ($series -and $series.data) {
        $n = 0
        foreach ($d in $series.data) {
          $day = "$($d.date)"
          if ($day -notmatch '^\d{4}-\d{2}-\d{2}$') { continue }
          # A quiet day comes back as a nought and is stored as one. That
          # is different from Access, where a day nobody keyed in simply
          # has no row, and it is better: a real nought is a fact.
          $v = $d.first_time_callers
          if ($null -eq $v -or "$v" -eq "") { $v = 0 }
          $byKey["phone_leads_new|$day|"] = [double]$v
          $n++
        }
        $counts["phone_leads_new"] = ($counts["phone_leads_new"] + $n)
        Say ("  {0,-18} {1,5} day(s)   First time callers from CallRail, {2} onward" -f
             "phone_leads_new", $n, $f)
      }
    }
  }
}

# ---- a rescheduled measurement must not leave yesterday's count -------
# The far end stores a number against metric, day and person, and
# replaces one it already has. It cannot know about a row that should no
# longer exist: if Nick had two measurements booked for the 20th and one
# of them moves to the 27th, the query comes back with one for the 20th
# and the stored two becomes one. But if BOTH move, the query says
# nothing at all about the 20th and the stored two sits there forever.
#
# Rescheduling is ordinary and this figure reads into the future, where
# rescheduling is most of what happens, so every day in the window is
# written for every person seen in it, as a nought where there is
# nothing. A nought is also true: that person had no measurements that
# day.
$visitDims = @()
foreach ($k in $byKey.Keys) {
  $b = $k.Split("|")
  if ($b[0] -eq "initial_visits" -and $b.Length -gt 2 -and $b[2] -ne "") { $visitDims += $b[2] }
}
$visitDims = @($visitDims | Sort-Object -Unique)
if ($visitDims.Count) {
  $filled = 0
  $day = $fromDate.Date
  while ($day -lt $visitEnd.Date) {
    $ds = $day.ToString("yyyy-MM-dd")
    foreach ($who in $visitDims) {
      $k = "initial_visits|$ds|$who"
      if (-not $byKey.ContainsKey($k)) { $byKey[$k] = 0.0; $filled++ }
    }
    $day = $day.AddDays(1)
  }
  Say ("  initial measurements: {0} quiet person day(s) written as nought, so a rescheduled measurement leaves nothing behind" -f $filled)
}

# ---- the rows ---------------------------------------------------------
$rows = @()
foreach ($k in ($byKey.Keys | Sort-Object)) {
  $bits = $k.Split("|")
  $row  = [ordered]@{ metric = $bits[0]; date = $bits[1]; value = $byKey[$k] }
  # dim is only sent when there is one. The far end defaults it to empty,
  # which is the key the undivided numbers are stored against.
  if ($bits.Length -gt 2 -and $bits[2] -ne "") { $row.dim = $bits[2] }
  $rows += [pscustomobject]$row
}
Say ("{0} numbers for {1} to {2}" -f $rows.Count, $From, $To) "Cyan"

if ($rows.Count -eq 0) {
  Say "Nothing to send. That is normal for a weekend or a holiday." "Yellow"
  exit 0
}

# ---- the dry run -------------------------------------------------------
# -WhatIf prints what would go and sends nothing, which is how to check the
# definitions against what you believe before any of it is stored.
if ($WhatIfPreference) {
  Say "DRY RUN: nothing will be sent." "Yellow"
  Write-Host ""
  $rows | Sort-Object date, metric |
    Format-Table @{n='Day';e={$_.date}},
                 @{n='Metric';e={$_.metric}},
                 @{n='Who';e={$_.dim}},
                 @{n='Value';e={'{0:N0}' -f $_.value};a='right'} -AutoSize |
    # -Width because Out-String otherwise takes the width from the console,
    # and there is no console when the output is redirected to a file: the
    # table comes out blank and the dry run looks like it found nothing.
    Out-String -Width 200 | Write-Host
  Write-Host ("Totals over the window:") -ForegroundColor Cyan
  $rows | Group-Object metric | Sort-Object Name | ForEach-Object {
    $sum  = ($_.Group | Measure-Object -Property value -Sum).Sum
    $days = ($_.Group | Select-Object -ExpandProperty date -Unique).Count
    $who  = ($_.Group | Where-Object { $_.dim } |
             Select-Object -ExpandProperty dim -Unique | Sort-Object)
    Write-Host ("  {0,-22} {1,12:N0}   over {2} day(s){3}" -f $_.Name, $sum, $days,
      $(if ($who) { "   split between: " + ($who -join ", ") } else { "" }))
  }
  Write-Host ""
  Say "Run it again without -WhatIf to send these." "Yellow"
  exit 0
}

# ---- send ---------------------------------------------------------------
# In batches, because a backfill of eight years is tens of thousands of
# numbers and one enormous request is the thing most likely to time out.
$batch = 2000
$sent = 0
$headers = @{
  "apikey"        = $Anon
  "Authorization" = "Bearer $Anon"
  "x-gidc-key"    = $Key
  "Content-Type"  = "application/json"
}

for ($i = 0; $i -lt $rows.Count; $i += $batch) {
  $slice = $rows[$i..([Math]::Min($i + $batch - 1, $rows.Count - 1))]
  $body = @{
    rows           = $slice
    source         = "access"
    refresh_portal = ($i -eq 0)      # once per run is plenty
  } | ConvertTo-Json -Depth 4 -Compress

  try {
    $res = Invoke-RestMethod -Method Post -Uri "$Url/functions/v1/kpi-import" `
             -Headers $headers -Body $body -TimeoutSec 90
    $sent += $res.written
    Say ("  sent {0} numbers, {1} to {2}" -f $res.written, $res.from, $res.to)
    if ($res.wholesale_days -and $res.wholesale_days -ne "skipped") {
      Say ("  wholesale rebuilt for {0} day(s)" -f $res.wholesale_days)
    }
    if ($res.lead_days -and $res.lead_days -ne "skipped") {
      Say ("  incoming leads added up again for {0} day(s)" -f $res.lead_days)
    }
  } catch {
    # The function answers with a sentence when it refuses, so show that
    # rather than the generic web error wrapped around it.
    $said = $_.Exception.Message
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $said = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
    } catch { }
    Stop-Badly ("The import was refused after {0} numbers:`n{1}" -f $sent, $said)
  }
}

Say ("Done. {0} numbers are in the dashboard." -f $sent) "Green"
exit 0
