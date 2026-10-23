# =====================================================================
#  GIDC  ·  the lookup tables, so the numbers can be defined
#
#  The schema told me where things live. This tells me what the codes
#  mean: which production status is "cut", which is "painted", what
#  counts as a remake, and whether your Calendar table already knows
#  about your first Monday months.
#
#  It reads small reference tables only: statuses, types, targets, pay
#  periods, and a slice of the calendar around now. No customers, no
#  addresses, no phone numbers, no order values.
#
#  Writes gidc-lookups.txt to your Desktop and opens it.
#
#  TO RUN
#    Right click, Run with PowerShell. If Windows blocks it: right
#    click, Properties, tick Unblock. Or run it as
#      powershell -ExecutionPolicy Bypass -File "C:\path\gidc-lookups.ps1"
# =====================================================================

$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Host ""; Write-Host $msg -ForegroundColor Red; Write-Host ""
  Read-Host "Press Enter to close"; exit 1
}

$tries = @(
  "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  "\\SVR-GDDC\GIDC Database\Grinyer_be.mdb",
  "\\SVR-GDDC\GIDC Database\Grinyer_be"
)
$db = $null
foreach ($t in $tries) { if (Test-Path -LiteralPath $t) { $db = $t; break } }
if (-not $db) { Fail "Could not find the database at \\SVR-GDDC\GIDC Database\Grinyer_be" }

$out = Join-Path ([Environment]::GetFolderPath("Desktop")) "gidc-lookups.txt"

$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$db"); $opened = $true; break } catch { }
}
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Fail "Could not open the database. This is $bits PowerShell, so it needs a $bits Access engine. Try the other PowerShell:`n  C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`n  C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
}

# Each entry: the heading, then the SQL. Columns are named rather than
# starred so nothing personal comes out by accident.
$queries = @(
  @("ORDER STATUSES  (the columns in DailyLog_OrderStatus are these IDs)",
    "select OrderStatusID, OrderStatusName, SortOrder, Active from def_OrderStatus order by SortOrder"),

  @("ESTIMATE STATUSES  (the columns in DailyLog_EstimateStatus)",
    "select EstimateStatusID, EstimateStatusName, SortOrder, Active from def_EstimateStatus order by SortOrder"),

  @("DOOR PRODUCTION STATUSES  (which one is cut, which is painted)",
    "select DoorProductionStatusID, DoorProductionStatusName, ProductTypeID, SortOrder, Active from def_DoorProductionStatus order by SortOrder"),

  @("DOOR ORDER STATUSES",
    "select DoorOrderStatusID, DoorOrderStatusName, SortOrder, Active from def_DoorOrderStatus order by SortOrder"),

  @("PRODUCT TYPES",
    "select ProductTypeID, ProductTypeName, SortOrder, Active from def_ProductTypes order by SortOrder"),

  @("DOOR PRODUCT TYPES",
    "select DoorProductTypeID, DoorProductType, ProductTypeID, SortOrder from def_DoorProductTypes order by SortOrder"),

  @("LEAD TYPES  (is this web against phone?)",
    "select LeadTypeID, LeadTypeName, SortOrder, Active from def_LeadTypes order by SortOrder"),

  @("LEAD SOURCES  (names only, no supplier contacts)",
    "select LeadSourceID, LeadSourceName, AdCampaignFlag, SortOrder, Active from def_LeadSources order by SortOrder"),

  @("ISSUE PROBLEM TYPES  (which of these is a remake)",
    "select IssueProblemTypeID, IssueProblemTypeName, ProductTypeID, SortOrder, Active from def_IssueProblemTypes order by SortOrder"),

  @("ISSUE SOURCE TYPES  (whose fault, and is one of these a go back)",
    "select IssueSourceTypeID, IssueSourceTypeName, SortOrder, Active from def_IssueSourceTypes order by SortOrder"),

  @("ISSUE STATUSES",
    "select IssueStatusID, IssueStatusName, SortOrder, Active from def_IssueStatus order by SortOrder"),

  @("SALE TYPES",
    "select SaleTypeID, SaleTypeName, SortOrder, Active from def_SaleTypes order by SortOrder"),

  @("LEGS",
    "select LegID, LegName, SortOrder, Active from def_Legs order by SortOrder"),

  @("LOCATIONS  (showrooms, names only)",
    "select LocationID, LocationName, LocationShowroom, SortOrder, Active from def_Locations order by SortOrder"),

  @("DEPARTMENTS",
    "select DepartmentID, DepartmentName, SortOrder, Active from def_Departments order by SortOrder"),

  @("WHAT CHANGE HISTORY ACTUALLY TRACKS  (decides whether cut and painted can be dated)",
    "select ChangeHistoryID, TableName, FieldName, ChangeDescription, FormName, Condition from def_ChangeHistory"),

  @("AUTOMATIC APPOINTMENTS  (which appointments are sales appointments)",
    "select AutoApptID, AutoApptName, TableName, FieldName, SortOrder, Active from def_AutoAppointments order by SortOrder"),

  @("TARGETS ALREADY SET, most recent 24",
    "select top 24 TargetYear, TargetMonth, Calls, WebLeads, SalesTarget, InstallTarget, InstallOvertime from TargetsByMonth order by TargetYear desc, TargetID desc"),

  @("PAY PERIODS, most recent 16  (do these match your four week months?)",
    "select top 16 PayPeriodID, PayPeriodStartDate, PayPeriodEndDate, PayPeriodRange, FirstOfMonth, Status from def_PayPeriods order by PayPeriodStartDate desc"),

  @("THE CALENDAR TABLE, Sep to Dec 2026  (does it already know your months?)",
    "select CalendarDate, CalendarDay, CalendarWeek, CalendarMonth, CalendarQuarter, CalendarYear from Calendar where CalendarDate >= #2026-09-28# and CalendarDate <= #2026-12-13# order by CalendarDate"),

  @("DAILY LOG, last 10 days of order statuses  (the shape of the snapshot)",
    "select top 10 LogDate, DailyLogType, InstallBacklog, [1],[2],[3],[4],[5],[6],[7],[8],[9],[10],[11],[12],[13] from DailyLog_OrderStatus order by LogDate desc"),

  @("VARIABLES",
    "select VariableID, VariableName, VariableValue, VariableDescription from Variables")
)

$lines = @("GIDC lookups", "read " + (Get-Date -Format "yyyy-MM-dd HH:mm"), "file " + $db)

foreach ($q in $queries) {
  $title = $q[0]; $sql = $q[1]
  $lines += ""
  $lines += "=============================================================="
  $lines += $title
  $lines += "=============================================================="
  try {
    $rs = $cn.Execute($sql)
    $cols = @()
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $cols += $rs.Fields.Item($i).Name }
    $lines += ($cols -join " | ")
    $n = 0
    while (-not $rs.EOF) {
      $vals = @()
      for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
        $v = $rs.Fields.Item($i).Value
        if ($null -eq $v) { $v = "" }
        if ($v -is [datetime]) { $v = $v.ToString("yyyy-MM-dd") }
        $vals += [string]$v
      }
      $lines += ($vals -join " | ")
      $n++
      $rs.MoveNext()
    }
    $rs.Close()
    if ($n -eq 0) { $lines += "(no rows)" }
  } catch {
    $lines += "(could not read: " + $_.Exception.Message + ")"
  }
}

$cn.Close()
$lines | Set-Content -Encoding UTF8 $out

Write-Host ""
Write-Host "Written to $out" -ForegroundColor Green
Start-Process notepad.exe $out
