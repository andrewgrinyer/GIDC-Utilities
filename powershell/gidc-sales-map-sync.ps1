# =====================================================================
#  GIDC  ·  hourly Sales Map sync
#
#  Andrew, 26 November: a map of every retail customer on the tools
#  site, filtered by estimate date, coloured by how far they got, to see
#  how the close rate changes with the distance from the showroom.
#  Dealer orders are left out.
#
#  This reads the Estimates side of Access (Andrew: "draw all data from
#  the estimates side ... use the appointment booked sections for
#  showroom bookings"), finds where each address is with OpenStreetMap
#  (Andrew chose it, 26 November), and sends the lot to Supabase through
#  the sales-map-sync edge function. The page works out the colours.
#
#  START HERE. See what it would send, without sending anything and
#  without looking up any customer's address:
#
#      .\gidc-sales-map-sync.ps1 -WhatIf
#
#  The TRY looks up the three showroom addresses only, to prove the
#  server can reach OpenStreetMap. Then, once that looks right:
#
#      .\gidc-sales-map-sync.ps1
#
#  And hourly, set up by gidc-schedule-sales-map-sync.ps1.
#
#  WHAT EACH CUSTOMER CARRIES
#    estimate date     Estimates.DateTimeCreated (the page filters on it)
#    in home visit     Estimates.MeasureDate, or failing that the first
#                      Initial Visit appointment (Appointments type 1)
#    showroom          Estimates.ShowroomBookedDate, or failing that the
#                      first Showroom appointment (Appointments type 2)
#    sold              Orders.SalesDate, through Estimates.OrderID
#  Only customers with an in home visit or a sale are sent: those are
#  the ones with a colour. A showroom visit with no in home visit and no
#  sale has no colour since Andrew dropped Orange (26 November), so
#  those addresses are never looked up.
#
#  PLACING THE ADDRESSES
#    Each address is looked up once at nominatim.openstreetmap.org, at
#    most one a second as their rules ask, and the answer is kept in
#    C:\GIDC\sales-map-places.csv so it is never asked for again. Only
#    the street, city, province and postal code go out, never a name,
#    phone or email. If the street cannot be found, the postal code is
#    tried; that dot is then near, not on, the house, and the page says
#    so. An address that cannot be found at all is asked again after 30
#    days, in case it was fixed in Access.
#    A run stops looking up after -MaxMinutes (45) and sends what it has,
#    so the first fill takes a few hourly runs, or one long SEND by hand.
#
#  WHAT IT NEEDS
#    The same GIDC_KPI_KEY the KPI import and the other syncs use.
#
#  WHAT IT WILL NOT DO
#    It only ever reads Access, with Mode=Read. It leaves out the dealer
#    orders (SFD, CIN, CDC, PIT at the front of the last name) and the
#    wholesale ones (sale type 4), the same as the measurement app sync.
#    The TRY prints counts and column names only, never a customer.
# =====================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]   $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string]   $Url  = "https://baakegbtuygtldksmant.supabase.co",
  [string]   $Anon = "sb_publishable_CSwwslH9Jt60-WK2fEJORw_k-R9n8Vj",
  [string]   $Key  = $env:GIDC_KPI_KEY,
  [string]   $LogDir = "C:\GIDC\logs",
  [string]   $PlacesFile = "C:\GIDC\sales-map-places.csv",
  # how far back, by estimate date
  [int]      $Years = 3,
  [int]      $MaxMinutes = 45,
  [int]      $RetryNotFoundDays = 30,
  [string[]] $DealerTags = @("SFD", "CIN", "CDC", "PIT"),
  [int[]]    $ExcludeSaleTypes = @(4),
  [string]   $MeasureColumn  = "MeasureDate",
  [string]   $ShowroomColumn = "ShowroomBookedDate",
  [int]      $VisitApptType = 1,
  [int]      $ShowroomApptType = 2,
  [switch]   $NoAppointments,
  [string]   $AddressColumn = "",
  [string]   $CityColumn = "",
  [string]   $PostalColumn = "",
  [string]   $ProvinceColumn = "",
  # Andrew, 26 November
  [string[]] $Showrooms = @("Cambridge|1177 Franklin Blvd|Cambridge",
                            "Mississauga|2225 Dundas St E|Mississauga",
                            "Burlington|18 Plains Road W|Burlington"),
  [string]   $LookupUrl = "https://nominatim.openstreetmap.org/search",
  [string]   $UserAgent = "GIDC-SalesMap/1.0"
)

$ErrorActionPreference = "Stop"
function Say($msg, $colour = "Gray") { Write-Host $msg -ForegroundColor $colour }
function Stop-Badly($msg) { Say $msg "Red"; exit 1 }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch { }
$inv = [Globalization.CultureInfo]::InvariantCulture
$started = Get-Date

$mode = if ($WhatIfPreference) { "TRY" } else { "SEND" }
Say ("GIDC sales map sync, {0}, {1}" -f $mode, $started.ToString("yyyy-MM-dd HH:mm")) "Cyan"
if ($mode -eq "TRY") { Say "Reads Access only. Nothing is sent, and no customer address is looked up." }

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
function Pick($cols, [string[]] $names, [string] $like, [string] $unlike) {
  foreach ($n in $names) { $hit = @($cols | Where-Object { $_ -ieq $n }); if ($hit.Count) { return $hit[0] } }
  if ($like) {
    $hit = @($cols | Where-Object { $_ -match $like -and (-not $unlike -or $_ -notmatch $unlike) })
    if ($hit.Count) { return $hit[0] }
  }
  return ""
}
# every column comes back under a name of its own, q and the name, since
# Access refuses "OrderID as OrderID" as a circular reference
function Col($table, $cols, $name, $as) {
  if ($name -and $cols -contains $name) { return "$table.[$name] as [q$as]" } else { return "null as [q$as]" }
}

$ecols = ColumnsOf "Estimates"
$ocols = ColumnsOf "Orders"
if (-not $ecols.Count) { $cn.Close(); Stop-Badly "Cannot read the Estimates table." }
foreach ($need in @("EstimateID", "FirstName", "LastName", "DateTimeCreated")) {
  if ($ecols -notcontains $need) { $cn.Close(); Stop-Badly "Estimates has no $need column, which the other syncs rely on. Nothing was sent." }
}

# ---- where the address lives (found by name, as the measurement sync does)
if (-not $AddressColumn) {
  $AddressColumn = Pick $ecols @("Address", "Address1", "StreetAddress", "Street", "CustomerAddress",
                                 "SiteAddress", "JobAddress", "InstallAddress", "MailingAddress") `
                        'address|street' 'mail$|e_?mail|city|postal|zip|town|prov|2$|no$|num|name$'
}
$streetNo = ""; $streetName = ""
if (-not $AddressColumn) {
  $streetNo   = Pick $ecols @("StreetNo", "StreetNumber", "HouseNumber", "AddressNo") 'street.?(no|num)|house.?num' ''
  $streetName = Pick $ecols @("StreetName") 'street.?name' ''
}
if (-not $CityColumn)     { $CityColumn     = Pick $ecols @("City", "Town", "CustomerCity", "SiteCity", "Municipality") 'city|town' '' }
if (-not $PostalColumn)   { $PostalColumn   = Pick $ecols @("PostalCode", "Postal", "PostCode", "ZipCode", "Zip") 'postal|zip' '' }
if (-not $ProvinceColumn) { $ProvinceColumn = Pick $ecols @("Province", "Prov", "State", "ProvinceState") 'prov' '' }

# ---- the appointments, as a fallback for the two booked dates ---------
$visitOf = @{}; $showOf = @{}
$apptNote = "not read"
if (-not $NoAppointments) {
  $acols = ColumnsOf "Appointments"
  if ($acols -contains "EstimateID" -and $acols -contains "AutoApptID") {
    $adate = Pick $acols @("ApptDate", "AppointmentDate", "ApptDateTime", "StartDate", "StartDateTime",
                           "ApptStart", "Start", "DateTime") 'date|start' 'created|modified|updated|entered'
    if (-not $adate -and $acols -contains "DateTimeCreated") { $adate = "DateTimeCreated" }
    if ($adate) {
      $since0 = (Get-Date).Date.AddYears(-$Years).AddMonths(-3)
      $q = "select EstimateID as qE, AutoApptID as qT, [$adate] as qD from Appointments " +
           "where AutoApptID in ($VisitApptType, $ShowroomApptType) and [$adate] >= #" + $since0.ToString("MM/dd/yyyy") + "#"
      try {
        $rs = $cn.Execute($q)
        while (-not $rs.EOF) {
          $e = I (V $rs "qE"); $t = I (V $rs "qT"); $d = D (V $rs "qD")
          if ($e -ne $null -and $d) {
            $map = if ($t -eq $VisitApptType) { $visitOf } else { $showOf }
            if (-not $map.ContainsKey($e) -or $d -lt $map[$e]) { $map[$e] = $d }
          }
          $rs.MoveNext()
        }
        $rs.Close()
        $apptNote = "Appointments.$adate, types $VisitApptType and $ShowroomApptType"
      } catch { $apptNote = "could not be read: " + $_.Exception.Message }
    } else { $apptNote = "Appointments has no date column that could be found" }
  } else { $apptNote = "Appointments has no EstimateID or AutoApptID" }
}

# ---- the customers --------------------------------------------------
$sel = @(
  "e.EstimateID as [qEstimateID]",
  "e.FirstName as [qFirstName]", "e.LastName as [qLastName]",
  "e.DateTimeCreated as [qDateTimeCreated]",
  (Col "e" $ecols $MeasureColumn "Measure"),
  (Col "e" $ecols $ShowroomColumn "Showroom"),
  (Col "e" $ecols "SaleTypeID" "SaleTypeID"),
  (Col "e" $ecols $AddressColumn "Addr"),
  (Col "e" $ecols $streetNo "AddrNo"),
  (Col "e" $ecols $streetName "AddrStreet"),
  (Col "e" $ecols $CityColumn "City"),
  (Col "e" $ecols $PostalColumn "Postal"),
  (Col "e" $ecols $ProvinceColumn "Prov")
)
$joinOrders = ($ecols -contains "OrderID") -and ($ocols -contains "OrderID")
if ($joinOrders) {
  $sel += @((Col "o" $ocols "OrderNo" "OrderNo"), (Col "o" $ocols "SalesDate" "SalesDate"))
  $from = "Estimates as e left join Orders as o on o.OrderID = e.OrderID"
} else {
  $sel += @("null as [qOrderNo]", "null as [qSalesDate]")
  $from = "Estimates as e"
}
$since = (Get-Date).Date.AddYears(-$Years)
$sql = "select " + ($sel -join ", ") + " from $from where e.DateTimeCreated >= #" + $since.ToString("MM/dd/yyyy") + "#"

$TagSet = @($DealerTags | ForEach-Object { $_.ToUpper() })
$rows = New-Object System.Collections.Generic.List[object]
$read = 0; $skipDealer = 0; $skipWholesale = 0; $skipNoColour = 0
$fromAppt = @{ visit = 0; showroom = 0 }
try { $rs = $cn.Execute($sql) } catch { $cn.Close(); Stop-Badly ("Access did not like the query: " + $_.Exception.Message) }
while (-not $rs.EOF) {
  $read++
  $last  = T (V $rs "qLastName")
  $first = T (V $rs "qFirstName")
  $tag = if ($last) { (@($last -split '\s+')[0]).ToUpper() } else { "" }
  $saleType = I (V $rs "qSaleTypeID")
  if ($TagSet -contains $tag)                                        { $skipDealer++;    $rs.MoveNext(); continue }
  if ($saleType -ne $null -and $ExcludeSaleTypes -contains $saleType) { $skipWholesale++; $rs.MoveNext(); continue }

  $id = I (V $rs "qEstimateID")
  $measure = D (V $rs "qMeasure")
  if (-not $measure -and $visitOf.ContainsKey($id)) { $measure = $visitOf[$id]; $fromAppt.visit++ }
  $show = D (V $rs "qShowroom")
  if (-not $show -and $showOf.ContainsKey($id)) { $show = $showOf[$id]; $fromAppt.showroom++ }
  $sold = D (V $rs "qSalesDate")
  if (-not $measure -and -not $sold) { $skipNoColour++; $rs.MoveNext(); continue }

  $addr = T (V $rs "qAddr")
  if (-not $addr) { $addr = T ((@((T (V $rs "qAddrNo")), (T (V $rs "qAddrStreet"))) | Where-Object { $_ }) -join " ") }
  $rows.Add([pscustomobject]@{
    estimate_id = $id
    order_no    = T (V $rs "qOrderNo")
    name        = T ((@($first, $last) | Where-Object { $_ }) -join " ")
    address     = $addr
    city        = T (V $rs "qCity")
    postal      = T (V $rs "qPostal")
    prov        = T (V $rs "qProv")
    created_on  = D (V $rs "qDateTimeCreated")
    measure_on  = $measure
    showroom_on = $show
    sold_on     = $sold
    lat = $null; lng = $null; placed_by = $null
  })
  $rs.MoveNext()
}
$rs.Close(); $cn.Close()

function CountOf($f) { return @($rows | Where-Object $f).Count }
Say ""
Say "WHAT WAS READ" "Cyan"
Say ("  {0} estimate(s) since {1}" -f $read, $since.ToString("yyyy-MM-dd"))
Say ("  left out: {0} dealer order(s), {1} wholesale, {2} with no in home visit and no sale" -f $skipDealer, $skipWholesale, $skipNoColour)
Say ("  {0} customer(s) for the map" -f $rows.Count) "Green"
Say ("  in home visit {0} ({1} of them from Appointments), showroom {2} ({3} from Appointments), sold {4}" -f `
     (CountOf { $_.measure_on }), $fromAppt.visit, (CountOf { $_.showroom_on }), $fromAppt.showroom, (CountOf { $_.sold_on }))
Say ""
Say "THE COLOURS, AS THE PAGE WILL DRAW THEM" "Cyan"
Say ("  red     in home visit only, not sold        {0}" -f (CountOf { $_.measure_on -and -not $_.showroom_on -and -not $_.sold_on }))
Say ("  yellow  in home visit and showroom, not sold {0}" -f (CountOf { $_.measure_on -and $_.showroom_on -and -not $_.sold_on }))
Say ("  green   in home visit and showroom, sold     {0}" -f (CountOf { $_.measure_on -and $_.showroom_on -and $_.sold_on }))
Say ("  purple  sold with no showroom visit          {0}" -f (CountOf { $_.sold_on -and -not $_.showroom_on }))
Say ("  blue    sold in showroom, no in home visit   {0}" -f (CountOf { $_.sold_on -and $_.showroom_on -and -not $_.measure_on }))
Say ""
Say "WHERE THE DETAILS COME FROM" "Cyan"
$addrWhere = if ($AddressColumn) { $AddressColumn } elseif ($streetNo -or $streetName) { "$streetNo + $streetName" } else { "(none found)" }
Say ("  address   Estimates.{0}, on {1}" -f $addrWhere, (CountOf { $_.address }))
Say ("  city      Estimates.{0}, on {1}" -f $(if ($CityColumn) { $CityColumn } else { "(none found)" }), (CountOf { $_.city }))
Say ("  postal    Estimates.{0}, on {1}" -f $(if ($PostalColumn) { $PostalColumn } else { "(none found)" }), (CountOf { $_.postal }))
Say ("  province  Estimates.{0}, on {1}" -f $(if ($ProvinceColumn) { $ProvinceColumn } else { "(none found, Ontario assumed)" }), (CountOf { $_.prov }))
Say ("  in home   Estimates.{0}; showroom Estimates.{1}" -f $MeasureColumn, $ShowroomColumn)
Say ("  fallback  {0}" -f $apptNote)
Say ("  sold      Orders.SalesDate{0}" -f $(if ($joinOrders) { "" } else { " (Orders could not be joined, so nothing reads as sold)" }))
$contact = @($ecols | Where-Object { $_ -match 'addr|street|city|town|postal|zip|prov|unit|suite' })
Say ("  every address like column on Estimates: " + ($contact -join ", "))

# ---- places: what is already known --------------------------------------
$places = @{}
if (Test-Path -LiteralPath $PlacesFile) {
  try { foreach ($p in (Import-Csv -LiteralPath $PlacesFile)) { $places[$p.key] = $p } }
  catch { Say ("Could not read {0}; every address will be looked up again." -f $PlacesFile) "Yellow" }
}
$sha = [Security.Cryptography.SHA1]::Create()
function KeyOf($street, $city, $postal) {
  $s = ("{0}|{1}|{2}" -f $street, $city, $postal).ToLowerInvariant() -replace '[^a-z0-9|]', ''
  return (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)) | ForEach-Object { $_.ToString("x2") }) -join "")
}
# what OpenStreetMap is asked for: the street without a unit, suite or
# apartment, which it does not know and which makes it miss the building
function Street($a) {
  if (-not $a) { return $null }
  $s = $a -replace '(?i)\b(unit|suite|ste|apt|apartment|ph|penthouse)\.?\s*#?\s*[a-z0-9-]+\b', '' `
          -replace '#\s*[a-z0-9-]+', '' -replace '^\s*[a-z0-9]+\s*-\s*(?=\d)', '' -replace '\s*,\s*,', ',' `
          -replace '\s{2,}', ' '
  return $s.Trim(" ,".ToCharArray())
}
function PostalOf($p) {
  if (-not $p) { return $null }
  $s = ($p -replace '\s', '').ToUpperInvariant()
  if ($s -match '^[A-Z]\d[A-Z]\d[A-Z]\d$') { return $s.Substring(0, 3) + " " + $s.Substring(3) }
  return $null
}
$script:lastAsk = [datetime]::MinValue
$script:asked = 0
function Ask($query) {
  $wait = 1100 - ((Get-Date) - $script:lastAsk).TotalMilliseconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]$wait) }
  $script:lastAsk = Get-Date
  $script:asked++
  $u = $LookupUrl + "?format=jsonv2&limit=1&countrycodes=ca&" + (($query.Keys | ForEach-Object {
         $_ + "=" + [uri]::EscapeDataString([string]$query[$_]) }) -join "&")
  try {
    $r = Invoke-RestMethod -Method Get -Uri $u -UserAgent $UserAgent -TimeoutSec 30
    $hit = @($r) | Select-Object -First 1
    if ($hit -and $hit.lat) {
      return @{ lat = [double]::Parse([string]$hit.lat, $inv); lng = [double]::Parse([string]$hit.lon, $inv) }
    }
    return $null
  } catch {
    throw ("OpenStreetMap did not answer: " + $_.Exception.Message)
  }
}
function Place($street, $city, $postal, $prov) {
  $names = @{ ON = "Ontario"; QC = "Quebec"; BC = "British Columbia"; AB = "Alberta"; MB = "Manitoba"
              SK = "Saskatchewan"; NS = "Nova Scotia"; NB = "New Brunswick"; NL = "Newfoundland and Labrador"
              PE = "Prince Edward Island"; ONT = "Ontario" }
  $p2 = if ($prov) { ($prov -replace '[^A-Za-z]', '').ToUpperInvariant() } else { "" }
  $state = if (-not $prov) { "Ontario" } elseif ($names.ContainsKey($p2)) { $names[$p2] } else { $prov }
  if ($street -and $city) {
    $hit = Ask ([ordered]@{ street = $street; city = $city; state = $state })
    if ($hit) { $hit.by = "address"; return $hit }
    $hit = Ask ([ordered]@{ q = ("{0}, {1}, {2}" -f $street, $city, $state) })
    if ($hit) { $hit.by = "address"; return $hit }
  }
  if ($postal) {
    $hit = Ask ([ordered]@{ postalcode = $postal })
    if ($hit) { $hit.by = "postal"; return $hit }
  }
  return $null
}
function Keep($key, $hit) {
  $places[$key] = [pscustomobject]@{
    key = $key
    lat = $(if ($hit) { $hit.lat.ToString("R", $inv) } else { "" })
    lng = $(if ($hit) { $hit.lng.ToString("R", $inv) } else { "" })
    placed_by = $(if ($hit) { $hit.by } else { "" })
    tried_on = (Get-Date).ToString("yyyy-MM-dd")
  }
}
function SavePlaces {
  try {
    $dir = Split-Path -Parent $PlacesFile
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $places.Values | Select-Object key, lat, lng, placed_by, tried_on |
      Export-Csv -LiteralPath $PlacesFile -NoTypeInformation -Encoding UTF8
  } catch { Say ("Could not save {0}: {1}" -f $PlacesFile, $_.Exception.Message) "Yellow" }
}
function Known($key) {
  if (-not $places.ContainsKey($key)) { return $false }
  $p = $places[$key]
  if ($p.lat) { return $true }
  try { return ((Get-Date) - [datetime]::ParseExact($p.tried_on, "yyyy-MM-dd", $inv)).TotalDays -lt $RetryNotFoundDays }
  catch { return $false }
}

# ---- the showrooms ------------------------------------------------------
$rooms = @()
foreach ($s in $Showrooms) {
  $bits = $s -split '\|'
  if ($bits.Count -lt 3) { continue }
  $k = KeyOf $bits[1] $bits[2] ""
  if (-not (Known $k) -or -not $places[$k].lat) {
    try { Keep $k (Place $bits[1] $bits[2] $null $null) } catch { Say $_.Exception.Message "Red"; break }
  }
  $p = $places[$k]
  if ($p -and $p.lat) {
    $rooms += [pscustomobject]@{ name = $bits[0]; lat = [double]::Parse($p.lat, $inv); lng = [double]::Parse($p.lng, $inv) }
  }
}
Say ""
Say "THE SHOWROOMS" "Cyan"
foreach ($s in $Showrooms) {
  $n = ($s -split '\|')[0]
  $r = @($rooms | Where-Object { $_.name -eq $n })
  if ($r.Count) { Say ("  {0,-12} placed at {1:N5}, {2:N5}" -f $n, $r[0].lat, $r[0].lng) "Green" }
  else          { Say ("  {0,-12} NOT placed" -f $n) "Red" }
}
if (-not $rooms.Count) { Say "  OpenStreetMap could not be reached or found none of them. Check the server can open https://nominatim.openstreetmap.org" "Red" }

# ---- the customers: placed from the list, then looked up ---------------
$toLook = 0; $placed = 0; $postalOnly = 0; $notFound = 0; $noAddress = 0; $waiting = 0
$stopped = ""
foreach ($r in $rows) {
  $street = Street $r.address
  $postal = PostalOf $r.postal
  if (-not ($street -and $r.city) -and -not $postal) { $noAddress++; continue }
  $k = KeyOf $street $r.city $postal
  if (-not (Known $k)) {
    $toLook++
    if ($WhatIfPreference -or $stopped) { $waiting++; continue }
    if (((Get-Date) - $started).TotalMinutes -ge $MaxMinutes) { $stopped = "time"; $waiting++; continue }
    try { Keep $k (Place $street $r.city $postal $r.prov) }
    catch { $stopped = $_.Exception.Message; $waiting++; continue }
    if ($script:asked % 50 -eq 0) { SavePlaces }
  }
  $p = $places[$k]
  if ($p.lat) {
    $r.lat = [double]::Parse($p.lat, $inv); $r.lng = [double]::Parse($p.lng, $inv); $r.placed_by = $p.placed_by
    $placed++; if ($p.placed_by -eq "postal") { $postalOnly++ }
  } else { $notFound++ }
}
if (-not $WhatIfPreference) { SavePlaces }

Say ""
Say "PLACING THE ADDRESSES" "Cyan"
Say ("  {0} placed ({1} of them by postal code only), {2} not found, {3} with no address, {4} still to look up" -f `
     $placed, $postalOnly, $notFound, $noAddress, $waiting)
if ($WhatIfPreference) {
  $mins = [Math]::Ceiling($toLook * 1.3 / 60)
  Say ("  A SEND would look up {0} address(es) not looked up before, about {1} minute(s) at one a second." -f $toLook, $mins)
}
if ($stopped -eq "time") { Say ("  Stopped looking up after {0} minutes. The next run carries on." -f $MaxMinutes) "Yellow" }
elseif ($stopped)        { Say ("  Stopped looking up: " + $stopped) "Yellow" }

if ($WhatIfPreference) {
  Say ""
  Say "This is what would be sent. Nothing has been." "Cyan"
  exit 0
}

# ---- send it ---------------------------------------------------------------
if (-not $Key) { Stop-Badly "No key. Set GIDC_KPI_KEY on this machine, or pass -Key. Use -WhatIf to see the counts without one." }

$counts = [ordered]@{
  read = $read; dealer = $skipDealer; wholesale = $skipWholesale; no_colour = $skipNoColour
  customers = $rows.Count; placed = $placed; postal_only = $postalOnly; not_found = $notFound
  no_address = $noAddress; waiting = $waiting; since = $since.ToString("yyyy-MM-dd")
}
$send = @($rows | ForEach-Object {
  [ordered]@{ estimate_id = $_.estimate_id; order_no = $_.order_no; name = $_.name; address = $_.address
              city = $_.city; postal = $_.postal; created_on = $_.created_on; measure_on = $_.measure_on
              showroom_on = $_.showroom_on; sold_on = $_.sold_on; lat = $_.lat; lng = $_.lng; placed_by = $_.placed_by } })
$body = @{ customers = $send; showrooms = @($rooms); counts = $counts } | ConvertTo-Json -Depth 5 -Compress
$headers = @{ "apikey" = $Anon; "Authorization" = "Bearer $Anon"
              "x-gidc-key" = $Key; "Content-Type" = "application/json" }
try {
  $res = Invoke-RestMethod -Method Post -Uri "$Url/functions/v1/sales-map-sync" -Headers $headers `
           -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 120
} catch {
  $detail = ""
  try {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $detail = $reader.ReadToEnd(); $reader.Close()
  } catch { }
  if (-not $detail -and $_.ErrorDetails) { $detail = $_.ErrorDetails.Message }
  Say ("Supabase would not take it: " + $_.Exception.Message) "Red"
  if ($detail) { Say ""; Say "What the far end said:" "Yellow"; Say $detail }
  exit 1
}
Say ""
Say ("Sent {0} customer(s). Loaded {1}, {2} showroom(s). ok" -f $rows.Count, $res.loaded, $res.showrooms) "Green"
if ($res.dropped) { foreach ($d in $res.dropped) { Say ("    dropped: " + $d) "Yellow" } }

try {
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  $line = "{0}  customers {1}  placed {2}  not found {3}  still to look up {4}  loaded {5}" -f `
          (Get-Date).ToString("yyyy-MM-dd HH:mm"), $rows.Count, $placed, $notFound, $waiting, $res.loaded
  Add-Content -LiteralPath (Join-Path $LogDir "sales-map-sync.log") -Value $line
} catch { }
