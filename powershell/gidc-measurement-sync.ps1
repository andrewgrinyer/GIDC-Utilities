# =====================================================================
#  GIDC  ·  hourly measurement app sync
#
#  Reads the retail customers out of Access and sends them to the
#  measurement app, which then:
#    * gives every linked job its Access status and job number, one way
#    * links the jobs not linked yet where one customer clearly matches,
#      and flags the rest for an administrator to link by hand
#    * makes a job for every new customer from 24 November on
#  Every one of those rules lives in Supabase (measurement-access-link.sql),
#  so this script only reads and sends.
#
#  THREE WAYS TO RUN IT
#
#      .\gidc-measurement-sync.ps1 -WhatIf
#          TRY. Reads Access and says what it found. Sends nothing.
#          Prints counts, column names and the status lists only, never a
#          customer's name or details, so the result can be passed on.
#
#      .\gidc-measurement-sync.ps1 -Preview
#          PREVIEW. Sends the customer list up, and Supabase works out
#          every link, then undoes it all. No job changes. Prints what
#          would have linked, what would be flagged and what would be made.
#
#      .\gidc-measurement-sync.ps1
#          SEND. Does it. This is what the hourly task runs.
#
#  WHAT IT NEEDS
#    The same GIDC_KPI_KEY the KPI import and the dealer sync use.
#
#  WHAT IT WILL NOT DO
#    It only ever reads Access (Mode=Read). It leaves out the dealer
#    orders (SFD, CIN, CDC, PIT at the front of the last name) and the
#    wholesale ones (sale type 4, Deal Doors), so only retail customers
#    reach the measurement app.
#
#  WHICH COLUMNS
#    The names, statuses, dates and job numbers are the ones the dealer
#    sync and the KPI import already read. The address, city, phone and
#    email columns have never been read by anything here before, so they
#    are found by their names, and the TRY says which ones it picked. If
#    one is wrong, pass it, for example -PhoneColumn "HomePhone".
# =====================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]   $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string]   $Url  = "https://baakegbtuygtldksmant.supabase.co",
  [string]   $Anon = "sb_publishable_CSwwslH9Jt60-WK2fEJORw_k-R9n8Vj",
  [string]   $Key  = $env:GIDC_KPI_KEY,
  [string]   $LogDir = "C:\GIDC\logs",
  [switch]   $Preview,
  # how far back to send. Older customers are only there so a job can be
  # matched to them, and so a repeat customer's old estimate is seen as old
  [int]      $Years = 3,
  [string[]] $DealerTags = @("SFD", "CIN", "CDC", "PIT"),
  [int[]]    $ExcludeSaleTypes = @(4),
  [string]   $AddressColumn = "",
  [string]   $CityColumn = "",
  [string[]] $PhoneColumns = @(),
  [string]   $EmailColumn = ""
)

$ErrorActionPreference = "Stop"
function Say($msg, $colour = "Gray") { Write-Host $msg -ForegroundColor $colour }
function Stop-Badly($msg) { Say $msg "Red"; exit 1 }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch { }

$mode = if ($WhatIfPreference) { "TRY" } elseif ($Preview) { "PREVIEW" } else { "SEND" }
Say ("GIDC measurement app sync, {0}, {1}" -f $mode, (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
if ($mode -eq "TRY")     { Say "Reads Access only. Nothing is sent." }
if ($mode -eq "PREVIEW") { Say "Sends the Access customer list up, then works out the links and undoes them. No job changes." }

# ---- Access, read only ----------------------------------------------
if (-not (Test-Path -LiteralPath $Database)) { Stop-Badly "Cannot see the database at $Database" }
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read"); $opened = $true; break } catch { }
}
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Stop-Badly ("Could not open the database. This is $bits PowerShell and needs a $bits Access engine. " +
              "Try C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe")
}
Say "Opened the Access back end, read only"

function ColumnsOf($table) {
  $cols = @()
  try {
    $r = $cn.Execute("select * from [$table] where 1=0")
    for ($i = 0; $i -lt $r.Fields.Count; $i++) { $cols += [string]$r.Fields.Item($i).Name }
    $r.Close()
  } catch { }
  return $cols
}
# a field's value, with Access's empty (null or DBNull) as $null
function V($rs, $name) {
  $v = $rs.Fields.Item($name).Value
  if ($v -eq $null -or $v -is [System.DBNull]) { return $null }
  return $v
}
function T($v) { if ($v -eq $null) { return $null }; $s = ([string]$v).Trim(); if ($s) { return $s } else { return $null } }
function I($v) { if ($v -eq $null) { return $null }; try { return [int]$v } catch { return $null } }
function D($v) { if ($v -eq $null) { return $null }; try { return ([datetime]$v).ToString("yyyy-MM-dd") } catch { return $null } }
# the first column that is one of these names, else the first one matching
function Pick($cols, [string[]] $names, [string] $like, [string] $unlike) {
  foreach ($n in $names) { $hit = @($cols | Where-Object { $_ -ieq $n }); if ($hit.Count) { return $hit[0] } }
  if ($like) {
    $hit = @($cols | Where-Object { $_ -match $like -and (-not $unlike -or $_ -notmatch $unlike) })
    if ($hit.Count) { return $hit[0] }
  }
  return ""
}

$ecols = ColumnsOf "Estimates"
$ocols = ColumnsOf "Orders"
if (-not $ecols.Count) { $cn.Close(); Stop-Badly "Cannot read the Estimates table." }
foreach ($need in @("EstimateID", "FirstName", "LastName", "DateTimeCreated")) {
  if ($ecols -notcontains $need) { $cn.Close(); Stop-Badly "Estimates has no $need column, which the other syncs rely on. Nothing was sent." }
}

# ---- where the contact details live ---------------------------------
if (-not $AddressColumn) {
  $AddressColumn = Pick $ecols @("Address", "Address1", "StreetAddress", "Street", "CustomerAddress",
                                 "SiteAddress", "JobAddress", "InstallAddress", "MailingAddress") `
                        'address|street' 'mail$|e_?mail|city|postal|zip|town|prov|2$|no$|num|name$'
}
$streetNo = ""; $streetName = ""
if (-not $AddressColumn) {
  # some screens keep the number and the street apart
  $streetNo   = Pick $ecols @("StreetNo", "StreetNumber", "HouseNumber", "CivicNumber") 'street.?(no|num)|house.?num' ''
  $streetName = Pick $ecols @("StreetName") 'street.?name' ''
}
if (-not $CityColumn) {
  $CityColumn = Pick $ecols @("City", "Town", "CustomerCity", "SiteCity", "Municipality") 'city|town' ''
}
if (-not $PhoneColumns.Count) {
  $all = @($ecols | Where-Object { $_ -match 'phone|cell|mobile' -and $_ -notmatch 'fax|ext' })
  $order = @("Phone", "HomePhone", "Phone1", "PrimaryPhone", "CellPhone", "Cell", "MobilePhone", "Mobile",
             "Phone2", "WorkPhone", "BusinessPhone")
  $PhoneColumns = @(@($order | ForEach-Object { $n = $_; $all | Where-Object { $_ -ieq $n } }) + $all |
                    Select-Object -Unique | Select-Object -First 2)
}
if (-not $EmailColumn) {
  $EmailColumn = Pick $ecols @("Email", "EmailAddress", "EMail", "E_Mail", "CustomerEmail") 'e_?mail' ''
}

# ---- the lookups: reps and the two status lists ---------------------
$reps = @{}
if ((ColumnsOf "def_Employees") -contains "CalendarName") {
  # only these two columns: that table also holds passwords
  $rs = $cn.Execute("select EmployeeID, CalendarName from def_Employees")
  while (-not $rs.EOF) { $reps[[string](V $rs "EmployeeID")] = T (V $rs "CalendarName"); $rs.MoveNext() }
  $rs.Close()
}
function StatusList($table, $idCol) {
  $cols = ColumnsOf $table
  $list = @{}
  if (-not $cols.Count -or $cols -notcontains $idCol) { return $list }
  $nameCol = Pick $cols @(($idCol -replace 'ID$', 'Name'), ($idCol -replace 'ID$', 'Description')) 'name|desc' ''
  $sortCol = Pick $cols @("SortOrder") '' ''
  if (-not $nameCol) { return $list }
  $sel = "[$idCol], [$nameCol]" + $(if ($sortCol) { ", [$sortCol]" } else { "" })
  $rs = $cn.Execute("select $sel from [$table]")
  while (-not $rs.EOF) {
    $id = I (V $rs $idCol)
    if ($id -ne $null) {
      $list[$id] = [pscustomobject]@{ id = $id; name = (T (V $rs $nameCol))
                                      sort = $(if ($sortCol) { I (V $rs $sortCol) } else { $id }) }
    }
    $rs.MoveNext()
  }
  $rs.Close()
  return $list
}
$estStatus = StatusList "def_EstimateStatus" "EstimateStatusID"
$ordStatus = StatusList "def_OrderStatus" "OrderStatusID"

# ---- the customers --------------------------------------------------
# EVERY COLUMN COMES BACK UNDER A NAME OF ITS OWN, q AND THE NAME
# Access refuses "OrderID as OrderID" as a circular reference, so no alias
# is ever the same as a column it could be read as.
function Col($table, $cols, $name, $as) {
  if ($name -and $cols -contains $name) { return "$table.[$name] as [q$as]" } else { return "null as [q$as]" }
}
$sel = @(
  "e.EstimateID as [qEstimateID]",
  (Col "e" $ecols "OrderID" "OrderID"),
  "e.FirstName as [qFirstName]", "e.LastName as [qLastName]",
  (Col "e" $ecols "EstimateStatusID" "EstimateStatusID"),
  (Col "e" $ecols "SalesAssociateID" "SalesAssociateID"),
  "e.DateTimeCreated as [qDateTimeCreated]",
  (Col "e" $ecols "MeasureDate" "MeasureDate"),
  (Col "e" $ecols "SaleTypeID" "SaleTypeID"),
  (Col "e" $ecols $AddressColumn "Addr"),
  (Col "e" $ecols $streetNo "AddrNo"),
  (Col "e" $ecols $streetName "AddrStreet"),
  (Col "e" $ecols $CityColumn "City"),
  (Col "e" $ecols $EmailColumn "Email"),
  (Col "e" $ecols $(if ($PhoneColumns.Count -gt 0) { $PhoneColumns[0] } else { "" }) "Phone1"),
  (Col "e" $ecols $(if ($PhoneColumns.Count -gt 1) { $PhoneColumns[1] } else { "" }) "Phone2")
)
$joinOrders = ($ecols -contains "OrderID") -and ($ocols -contains "OrderID")
if ($joinOrders) {
  $sel += @((Col "o" $ocols "OrderNo" "OrderNo"), (Col "o" $ocols "OrderStatusID" "OrderStatusID"),
            (Col "o" $ocols "SalesDate" "SalesDate"), (Col "o" $ocols "CompletedDate" "CompletedDate"))
  $from = "Estimates as e left join Orders as o on o.OrderID = e.OrderID"
} else {
  $sel += @("null as [qOrderNo]", "null as [qOrderStatusID]", "null as [qSalesDate]", "null as [qCompletedDate]")
  $from = "Estimates as e"
}
$since = (Get-Date).Date.AddYears(-$Years)
$sql = "select " + ($sel -join ", ") + " from $from where e.DateTimeCreated >= #" + $since.ToString("MM/dd/yyyy") + "#"

$TagSet = @($DealerTags | ForEach-Object { $_.ToUpper() })
# a list rather than an array, which would be copied whole on every row
$rows = New-Object System.Collections.Generic.List[object]
$skipDealer = 0; $skipWholesale = 0; $skipNoName = 0
try { $rs = $cn.Execute($sql) } catch { $cn.Close(); Stop-Badly ("Access did not like the query: " + $_.Exception.Message) }
while (-not $rs.EOF) {
  $last  = T (V $rs "qLastName")
  $first = T (V $rs "qFirstName")
  $tag = if ($last) { (@($last -split '\s+')[0]).ToUpper() } else { "" }
  $saleType = I (V $rs "qSaleTypeID")
  if (-not $last -and -not $first)                                   { $skipNoName++;    $rs.MoveNext(); continue }
  if ($TagSet -contains $tag)                                        { $skipDealer++;    $rs.MoveNext(); continue }
  if ($saleType -ne $null -and $ExcludeSaleTypes -contains $saleType) { $skipWholesale++; $rs.MoveNext(); continue }

  $addr = T (V $rs "qAddr")
  if (-not $addr) { $addr = T ((@((T (V $rs "qAddrNo")), (T (V $rs "qAddrStreet"))) | Where-Object { $_ }) -join " ") }
  $esId = I (V $rs "qEstimateStatusID"); $osId = I (V $rs "qOrderStatusID")
  # a hashtable will not be asked for a null key, so look only when there is one
  $es = if ($esId -ne $null -and $estStatus.ContainsKey($esId)) { $estStatus[$esId] } else { $null }
  $os = if ($osId -ne $null -and $ordStatus.ContainsKey($osId)) { $ordStatus[$osId] } else { $null }
  $repId = I (V $rs "qSalesAssociateID")
  $rows.Add([pscustomobject]@{
    estimate_id          = I (V $rs "qEstimateID")
    order_id             = I (V $rs "qOrderID")
    order_no             = T (V $rs "qOrderNo")
    first_name           = $first
    last_name            = $last
    address              = $addr
    city                 = T (V $rs "qCity")
    phone                = T (V $rs "qPhone1")
    phone2               = T (V $rs "qPhone2")
    email                = T (V $rs "qEmail")
    rep                  = $(if ($repId -ne $null -and $reps.ContainsKey([string]$repId)) { $reps[[string]$repId] } else { $null })
    created_on           = D (V $rs "qDateTimeCreated")
    measure_on           = D (V $rs "qMeasureDate")
    sold_on              = D (V $rs "qSalesDate")
    completed_on         = D (V $rs "qCompletedDate")
    estimate_status_id   = I (V $rs "qEstimateStatusID")
    estimate_status      = $(if ($es) { $es.name } else { $null })
    estimate_status_sort = $(if ($es) { $es.sort } else { $null })
    order_status_id      = I (V $rs "qOrderStatusID")
    order_status         = $(if ($os) { $os.name } else { $null })
    order_status_sort    = $(if ($os) { $os.sort } else { $null })
    sale_type_id         = $saleType
  })
  $rs.MoveNext()
}
$rs.Close(); $cn.Close()

# ---- what was found, as counts only ---------------------------------
function CountOf($f) { return @($rows | Where-Object $f).Count }
Say ""
Say ("Read {0} retail customer(s) created since {1}" -f $rows.Count, $since.ToString("yyyy-MM-dd")) "Green"
Say ("  left out: {0} dealer order(s), {1} wholesale, {2} with no name" -f $skipDealer, $skipWholesale, $skipNoName)
Say ""
Say "WHERE THE DETAILS COME FROM (column names on Estimates)" "Cyan"
$addrWhere = if ($AddressColumn) { $AddressColumn } elseif ($streetNo -or $streetName) { "$streetNo + $streetName" } else { "" }
foreach ($p in @(@("address", $addrWhere, { $_.address }), @("city", $CityColumn, { $_.city }),
                 @("phone", ($PhoneColumns -join " and "), { $_.phone -or $_.phone2 }), @("email", $EmailColumn, { $_.email }))) {
  if ($p[1]) { Say ("  {0,-8} {1,-32} filled on {2} of {3}" -f $p[0], $p[1], (CountOf $p[2]), $rows.Count) }
  else       { Say ("  {0,-8} NOT FOUND, so it is sent empty" -f $p[0]) "Yellow" }
}
$contact = @($ecols | Where-Object { $_ -match 'addr|street|city|town|phone|cell|mobile|mail|postal|zip|prov|unit|suite' })
Say ("  every column on Estimates that looks like a contact detail: {0}" -f ($contact -join ", "))
if ($joinOrders) { Say ("  job number from Orders.OrderNo, on {0} of them" -f (CountOf { $_.order_no })) }
else             { Say "  Estimates has no OrderID, so there is no job number to send" "Yellow" }
Say ("  sales rep name on {0} (from def_Employees.CalendarName)" -f (CountOf { $_.rep }))
Say ("  sold (Orders.SalesDate) {0}, completed (Orders.CompletedDate) {1}" -f (CountOf { $_.sold_on }), (CountOf { $_.completed_on }))
$newOnes = CountOf { $_.created_on -ge "2026-11-24" }
Say ("  created on or after 24 November, so they become new jobs: {0}" -f $newOnes)

Say ""
Say "THE ACCESS STATUS LISTS, AND HOW MANY CUSTOMERS SIT AT EACH" "Cyan"
Say "  A job shows the estimate status until Access has sold it, then the order status."
foreach ($pair in @(@("Estimate status (def_EstimateStatus)", $estStatus, "estimate_status_id", $false),
                    @("Order status (def_OrderStatus), sold ones only", $ordStatus, "order_status_id", $true))) {
  Say ("  {0}:" -f $pair[0])
  if (-not $pair[1].Count) { Say "    could not read the list" "Yellow"; continue }
  foreach ($s in ($pair[1].Values | Sort-Object sort, id)) {
    $k = $pair[2]; $soldOnly = $pair[3]
    $n = @($rows | Where-Object { $_.$k -eq $s.id -and (-not $soldOnly -or $_.sold_on) }).Count
    Say ("    {0,4}  {1,-34} {2,6}" -f $s.id, $s.name, $n)
  }
}

# ---- TRY: stop here -------------------------------------------------
if ($WhatIfPreference) {
  Say ""
  Say "TRY finished. Nothing was sent." "Green"
  exit 0
}

# ---- send it --------------------------------------------------------
if (-not $Key) { Stop-Badly "No key. Set GIDC_KPI_KEY on this machine, or pass -Key. Run the TRY to see the counts without one." }
if (-not $rows.Count) { Stop-Badly "Nothing read out of Access, so nothing was sent." }

$body = @{ preview = [bool]$Preview; customers = $rows.ToArray() } | ConvertTo-Json -Depth 5 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$headers = @{ "apikey" = $Anon; "Authorization" = "Bearer $Anon"; "x-gidc-key" = $Key }
try {
  $res = Invoke-RestMethod -Method Post -Uri "$Url/functions/v1/measurement-sync" -Headers $headers `
           -Body $bytes -ContentType "application/json; charset=utf-8" -TimeoutSec 180
} catch {
  $detail = ""
  try {
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $detail = $reader.ReadToEnd(); $reader.Close()
  } catch { }
  if (-not $detail -and $_.ErrorDetails) { $detail = $_.ErrorDetails.Message }
  Say ("The measurement app would not take it: " + $_.Exception.Message) "Red"
  if ($detail) { Say ""; Say "What the far end said:" "Yellow"; Say $detail }
  exit 1
}

Say ""
$verb = if ($Preview) { "would be" } else { "were" }
Say ("Sent {0} customer(s). Supabase has {1} jobs, {2} linked after this." -f $res.staged, $res.jobs_total,
     $(if ($Preview) { "$($res.jobs_linked) would be" } else { $res.jobs_linked })) "Green"
if ($res.dropped) { Say ("  {0} row(s) dropped as not making sense: {1}" -f @($res.dropped).Count, (@($res.dropped) -join "; ")) "Yellow" }
Say ("  statuses changed: {0}" -f $res.statuses_changed)
Say ""
Say ("JOBS THAT {0} LINKED: {1}" -f $verb.ToUpper(), $res.linked_count) "Cyan"
foreach ($l in @($res.linked)) {
  if ($l) { Say ("  {0,-28} {1}  ->  Access {2}, {3}, {4}  (on {5})" -f $l.job, $l.day, $l.access_no, $l.access_name, $l.access_address, $l.on) }
}
Say ""
Say ("JOBS THAT {0} FLAGGED FOR LINKING BY HAND: {1}" -f $verb.ToUpper(), $res.flagged_count) "Cyan"
foreach ($f in @($res.flagged)) { if ($f) { Say ("  {0,-28} {1}  {2}" -f $f.job, $f.day, $f.why) } }
Say ""
Say ("NEW JOBS THAT {0} MADE FROM ACCESS: {1}" -f $verb.ToUpper(), $res.made_count) "Cyan"
foreach ($m in @($res.made)) { if ($m) { Say ("  {0,-28} Access {1}, {2}, created {3}" -f $m.job, $m.access_no, $m.rep, $m.created) } }
Say ""
if ($Preview) { Say "PREVIEW finished. No job was changed." "Green" }

# ---- a line in the log ----------------------------------------------
if (-not $Preview) {
  try {
    if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $line = "{0}  read {1}  statuses {2}  linked {3}  flagged {4}  made {5}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm"),
            $rows.Count, $res.statuses_changed, $res.linked_count, $res.flagged_count, $res.made_count
    Add-Content -LiteralPath (Join-Path $LogDir "measurement-sync.log") -Value $line
  } catch { }
}
exit 0
