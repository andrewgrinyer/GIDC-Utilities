# =====================================================================
#  GIDC  ·  hourly web leads sync (estimates and sales for the leads sheet)
#
#  Andrew, 26 November 2026: the Google Sheet the website form writes
#  to gets a Status column (Not Booked, Booked or Sold) and a Sold Price
#  column, matched to Access by email first, then phone, then name.
#
#  This half reads every retail estimate out of Access with the names,
#  the emails and phones on it, when it was made (DateTimeCreated), the
#  sale date if it sold (Orders.SalesDate) and the price
#  (Estimates.Price), and sends them to
#  Supabase through the web-leads edge function. The script inside the
#  Google Sheet then checks each lead against that list every hour and
#  fills in the two columns. The matching rules are in
#  sql/web-leads-sold.sql.
#
#  START HERE. See what it would send, without sending anything:
#
#      .\gidc-web-leads-sync.ps1 -WhatIf
#
#  The TRY prints counts and column names only, never a customer.
#  Then, once that looks right:
#
#      .\gidc-web-leads-sync.ps1
#
#  And hourly, set up by gidc-schedule-web-leads-sync.ps1.
#
#  WHAT IT NEEDS
#    The same GIDC_KPI_KEY the KPI import and the other syncs use.
#
#  WHAT IT WILL NOT DO
#    It only ever reads Access, with Mode=Read. It leaves out the dealer
#    orders (SFD, CIN, CDC, PIT at the front of the last name) and the
#    wholesale ones (sale type 4), the same as the measurement app sync.
# =====================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]   $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string]   $Url  = "https://baakegbtuygtldksmant.supabase.co",
  [string]   $Anon = "sb_publishable_CSwwslH9Jt60-WK2fEJORw_k-R9n8Vj",
  [string]   $Key  = $env:GIDC_KPI_KEY,
  [string]   $LogDir = "C:\GIDC\logs",
  # how far back, by estimate date or sale date. The sheet only counts
  # what came on or after a lead, so this only needs to reach its first row.
  [int]      $Years = 10,
  [string[]] $DealerTags = @("SFD", "CIN", "CDC", "PIT"),
  [int[]]    $ExcludeSaleTypes = @(4),
  [string]   $PriceColumn = "Price",
  [string[]] $PhoneColumns = @(),
  [string[]] $EmailColumns = @()
)

$ErrorActionPreference = "Stop"
function Say($msg, $colour = "Gray") { Write-Host $msg -ForegroundColor $colour }
function Stop-Badly($msg) { Say $msg "Red"; exit 1 }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch { }

$mode = if ($WhatIfPreference) { "TRY" } else { "SEND" }
Say ("GIDC web leads sync, {0}, {1}" -f $mode, (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
if ($mode -eq "TRY") { Say "Reads Access only. Nothing is sent." }

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
function V($rs, $name) {
  $v = $rs.Fields.Item($name).Value
  if ($v -eq $null -or $v -is [System.DBNull]) { return $null }
  return $v
}
function T($v) { if ($v -eq $null) { return $null }; $s = ([string]$v).Trim(); if ($s) { return $s } else { return $null } }
function I($v) { if ($v -eq $null) { return $null }; try { return [int]$v } catch { return $null } }
function D($v) { if ($v -eq $null) { return $null }; try { return ([datetime]$v).ToString("yyyy-MM-dd") } catch { return $null } }
function M($v) { if ($v -eq $null) { return $null }; try { return [math]::Round([double]$v, 2) } catch { return $null } }

$ecols = ColumnsOf "Estimates"
$ocols = ColumnsOf "Orders"
foreach ($need in @("EstimateID", "FirstName", "LastName", "OrderID", "DateTimeCreated")) {
  if ($ecols -notcontains $need) { $cn.Close(); Stop-Badly "Estimates has no $need column, which the other syncs rely on. Nothing was sent." }
}
foreach ($need in @("OrderID", "SalesDate")) {
  if ($ocols -notcontains $need) { $cn.Close(); Stop-Badly "Orders has no $need column, which the other syncs rely on. Nothing was sent." }
}

# ---- where the contact details live ---------------------------------
# The measurement sync's TRY (23 Nov) found PhoneNumbers and
# EmailAddresses on Estimates, each able to hold several. Every column
# that looks like one is read, so a second phone column is not missed.
if (-not $PhoneColumns.Count) { $PhoneColumns = @($ecols | Where-Object { $_ -match 'phone|cell|mobile' -and $_ -notmatch 'fax|ext' }) }
if (-not $EmailColumns.Count) { $EmailColumns = @($ecols | Where-Object { $_ -match 'e_?mail' }) }
$hasPrice = $PriceColumn -and ($ecols -contains $PriceColumn)

$sel = @("e.EstimateID as [qEstimateID]", "e.FirstName as [qFirstName]", "e.LastName as [qLastName]",
         "o.SalesDate as [qSalesDate]", "e.DateTimeCreated as [qCreated]")
$sel += $(if ($hasPrice) { "e.[$PriceColumn] as [qPrice]" } else { "null as [qPrice]" })
$sel += $(if ($ecols -contains "SaleTypeID") { "e.SaleTypeID as [qSaleTypeID]" } else { "null as [qSaleTypeID]" })
$i = 0; foreach ($c in $PhoneColumns) { $sel += "e.[$c] as [qPhone$i]"; $i++ }
$i = 0; foreach ($c in $EmailColumns) { $sel += "e.[$c] as [qEmail$i]"; $i++ }
$since = (Get-Date).Date.AddYears(-$Years)
$sql = "select " + ($sel -join ", ") +
       " from Estimates as e left join Orders as o on o.OrderID = e.OrderID" +
       " where e.DateTimeCreated >= #" + $since.ToString("MM/dd/yyyy") + "#" +
       " or o.SalesDate >= #" + $since.ToString("MM/dd/yyyy") + "#"

$TagSet = @($DealerTags | ForEach-Object { $_.ToUpper() })
$rows = New-Object System.Collections.Generic.List[object]
$skipDealer = 0; $skipWholesale = 0; $skipNoName = 0
$withEmail = 0; $withPhone = 0; $withPrice = 0; $sold = 0
try { $rs = $cn.Execute($sql) } catch { $cn.Close(); Stop-Badly ("Access did not like the query: " + $_.Exception.Message) }
while (-not $rs.EOF) {
  $last  = T (V $rs "qLastName")
  $first = T (V $rs "qFirstName")
  $tag = if ($last) { (@($last -split '\s+')[0]).ToUpper() } else { "" }
  $saleType = I (V $rs "qSaleTypeID")
  if (-not $last -and -not $first)                                    { $skipNoName++;    $rs.MoveNext(); continue }
  if ($TagSet -contains $tag)                                         { $skipDealer++;    $rs.MoveNext(); continue }
  if ($saleType -ne $null -and $ExcludeSaleTypes -contains $saleType) { $skipWholesale++; $rs.MoveNext(); continue }

  $phones = @(); for ($k = 0; $k -lt $PhoneColumns.Count; $k++) { $p = T (V $rs "qPhone$k"); if ($p) { $phones += $p } }
  $emails = @(); for ($k = 0; $k -lt $EmailColumns.Count; $k++) { $m = T (V $rs "qEmail$k"); if ($m) { $emails += $m } }
  $price = M (V $rs "qPrice")
  $soldOn = D (V $rs "qSalesDate")
  if ($soldOn) { $sold++ }
  if ($phones.Count) { $withPhone++ }; if ($emails.Count) { $withEmail++ }; if ($price -ne $null -and $price -gt 0) { $withPrice++ }
  $rows.Add([pscustomobject]@{
    estimate_id = I (V $rs "qEstimateID")
    first_name  = $first
    last_name   = $last
    emails      = ($emails -join "; ")
    phones      = ($phones -join "; ")
    created_on  = D (V $rs "qCreated")
    sold_on     = $soldOn
    price       = $price
  })
  $rs.MoveNext()
}
$rs.Close(); $cn.Close()

Say ""
Say ("Read {0} retail estimate(s) made or sold since {1}, {2} of them sold" -f $rows.Count, $since.ToString("yyyy-MM-dd"), $sold) "Green"
Say ("  left out: {0} dealer order(s), {1} wholesale, {2} with no name" -f $skipDealer, $skipWholesale, $skipNoName)
Say ""
Say "WHERE THE DETAILS COME FROM (column names on Estimates)" "Cyan"
Say ("  email   {0,-34} on {1} of {2}" -f $(if ($EmailColumns.Count) { $EmailColumns -join ", " } else { "NOT FOUND" }), $withEmail, $rows.Count)
Say ("  phone   {0,-34} on {1} of {2}" -f $(if ($PhoneColumns.Count) { $PhoneColumns -join ", " } else { "NOT FOUND" }), $withPhone, $rows.Count)
Say ("  price   {0,-34} above zero on {1}" -f $(if ($hasPrice) { $PriceColumn } else { "NOT FOUND" }), $withPrice)
Say  "  made    Estimates.DateTimeCreated"
Say  "  sold    Orders.SalesDate"
if ($rows.Count) {
  $byYear = $rows | Group-Object { ("" + $_.created_on + "????").Substring(0, 4) } | Sort-Object Name
  Say ("  estimates by year made: {0}" -f (($byYear | ForEach-Object { "{0} {1}" -f $_.Name, $_.Count }) -join ", "))
}

if ($WhatIfPreference) {
  Say ""
  Say "TRY finished. Nothing was sent." "Green"
  exit 0
}

# ---- send it --------------------------------------------------------
if (-not $Key) { Stop-Badly "No key. Set GIDC_KPI_KEY on this machine, or pass -Key. Run the TRY to see the counts without one." }
if (-not $rows.Count) { Stop-Badly "Nothing read out of Access, so nothing was sent." }

$counts = @{ read = $rows.Count; sold = $sold; dealer = $skipDealer; wholesale = $skipWholesale; with_email = $withEmail
             with_phone = $withPhone; with_price = $withPrice; since = $since.ToString("yyyy-MM-dd") }
$body = @{ action = "load"; sales = $rows.ToArray(); counts = $counts } | ConvertTo-Json -Depth 5 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$headers = @{ "apikey" = $Anon; "Authorization" = "Bearer $Anon"; "x-gidc-key" = $Key }
try {
  $res = Invoke-RestMethod -Method Post -Uri "$Url/functions/v1/web-leads" -Headers $headers `
           -Body $bytes -ContentType "application/json; charset=utf-8" -TimeoutSec 180
} catch {
  $detail = ""
  try {
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $detail = $reader.ReadToEnd(); $reader.Close()
  } catch { }
  if (-not $detail -and $_.ErrorDetails) { $detail = $_.ErrorDetails.Message }
  Say ("Supabase would not take it: " + $_.Exception.Message) "Red"
  if ($detail) { Say ""; Say "What the far end said:" "Yellow"; Say $detail }
  exit 1
}

Say ""
Say ("ok. Sent {0} estimate(s), {1} loaded." -f $res.sent, $res.loaded) "Green"
if ($res.dropped) { Say ("  {0} dropped as not making sense: {1}" -f @($res.dropped).Count, (@($res.dropped) -join "; ")) "Yellow" }

try {
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  Add-Content -LiteralPath (Join-Path $LogDir "web-leads-sync.log") `
    -Value ("{0}  read {1}  loaded {2}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm"), $rows.Count, $res.loaded)
} catch { }
exit 0
