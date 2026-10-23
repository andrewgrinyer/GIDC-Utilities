# =====================================================================
#  GIDC  ·  hourly dealer order sync
#
#  Reads the dealer orders out of Access and sends two things to the
#  portal for each one: the order status, and the package date it works
#  the estimated ship date out of.
#
#  START HERE. See what it would send, without sending anything:
#
#      .\gidc-dealer-sync.ps1 -WhatIf
#
#  Then, once that looks right:
#
#      .\gidc-dealer-sync.ps1
#
#  And hourly, in Task Scheduler:
#      powershell -ExecutionPolicy Bypass -File "C:\GIDC\gidc-dealer-sync.ps1"
#
#  WHAT IT NEEDS
#    The same GIDC_KPI_KEY the KPI import already uses. No new secret.
#
#  WHERE THE DATES LIVE, SINCE IT IS NOT OBVIOUS
#
#  There is no package date column anywhere in the back end. The
#  production dates are rows: def_ProductTypeDetails names them, and
#  ProductsSelectedDetails holds a value per order per name, with the
#  date in ProductTypeDetailValue_DateTime. So this looks the name up by
#  its wording rather than hard coding an id, and says which id it
#  found, which is also how you would change it to a different date.
#
#  WHAT IT WILL NOT DO
#    It only ever reads Access. It only sends orders whose last name
#    starts with one of the dealer tags, so no retail customer leaves
#    the building. It cannot move an order the portal has as a draft.
#
#  WHICH DEALERS
#    South Florida only as it stands. See -Tags below to add the others.
# =====================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $Url  = "https://baakegbtuygtldksmant.supabase.co",
  [string] $Anon = "sb_publishable_CSwwslH9Jt60-WK2fEJORw_k-R9n8Vj",
  [string] $Key  = $env:GIDC_KPI_KEY,
  [string] $LogDir = "C:\GIDC\logs",
  # THE TAGS, AS THEY ARE TYPED AT THE FRONT OF THE LAST NAME
  #
  # South Florida proved the matching on 15 October, so Cincinnati and
  # Closet Design are in as of 23:35 the same evening. 203 orders came
  # back for those two, almost all of them a plain surname with the
  # street number in the first name field, which is the shape the key
  # likes best.
  #
  # PITTSBURGH IS PIT AND NOT PITT
  #
  # Worth writing down, because I had it wrong for an hour. The portal
  # names those orders PITT DISANTI 837, so I looked for PITT in Access
  # and found only four retail customers called Pitts, Pittaway and
  # Pitt, concluded Pittsburgh was not in Access at all, and said so.
  # Andrew put me right: the tag is PIT.
  #
  # Which is also why the filter below is no longer trusted on its own.
  # It asks Access for names beginning PIT, and that catches Pittaway
  # and the rest as well, so every row is now checked against this list
  # properly before it is sent. See "the tag has to be one of ours".
  [string[]] $Tags = @("SFD", "CIN", "CDC", "PIT"),
  # THE PRODUCTION DATE THE SHIP DATE IS COUNTED FROM
  #
  # "Packaging Date", id 33, which is what def_ProductTypeDetails calls
  # it. I had this as "Package Date" and the script stopped rather than
  # guess, which is why it is right now. The others on that list, if the
  # four days should ever count from one of them instead: Door ETA,
  # Arrival Date, Schedule Cut Date, Scheduled Prime Date, Scheduled
  # Paint Date, Delivery Date.
  [string] $DateName = "Packaging Date"
)

$ErrorActionPreference = "Stop"
function Say($msg, $colour = "Gray") { Write-Host $msg -ForegroundColor $colour }
function Stop-Badly($msg) { Say $msg "Red"; exit 1 }

# ---- Access ---------------------------------------------------------
if (-not (Test-Path -LiteralPath $Database)) { Stop-Badly "Cannot see the database at $Database" }
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database"); $opened = $true; break } catch { }
}
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Stop-Badly ("Could not open the database. This is $bits PowerShell and needs a $bits Access engine. " +
              "Try C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe")
}
Say "Opened the Access back end"

# ---- which detail row is the package date ---------------------------
# By name, because the id means nothing to anybody and the name is what
# is on the screen. More than one product type can carry the same name,
# so every matching id counts.
$detailIds = @()
$rs = $cn.Execute("select ProductTypeDetailID, ProductTypeID, ProductTypeDetailName
                     from def_ProductTypeDetails
                    where ProductTypeDetailName = '$($DateName -replace "'","''")'")
while (-not $rs.EOF) {
  $detailIds += [int]$rs.Fields.Item(0).Value
  Say ("  '{0}' is detail id {1}, product type {2}" -f $DateName, $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value)
  $rs.MoveNext()
}
$rs.Close()
if (-not $detailIds.Count) {
  Say ("Nothing in def_ProductTypeDetails is called '{0}'. The names it does have:" -f $DateName) "Yellow"
  $rs = $cn.Execute("select ProductTypeDetailID, ProductTypeDetailName from def_ProductTypeDetails order by ProductTypeDetailID")
  while (-not $rs.EOF) {
    Say ("      {0,3}  {1}" -f $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value)
    $rs.MoveNext()
  }
  $rs.Close(); $cn.Close()
  Stop-Badly "Pass the right one with -DateName, in quotes."
}
$idList = ($detailIds | ForEach-Object { [int]$_ }) -join ","

# ---- the dealer orders ----------------------------------------------
# THE PACKAGING DATE COMES OUT OF A SUBQUERY, NOT A JOIN
#
# It was a left join to ProductsSelected and ProductsSelectedDetails,
# with the detail id tested in the ON clause. Access answered "Extra )
# in query expression ''", which is what it says when it cannot parse an
# ON clause carrying anything beyond a plain comparison.
#
# Filtering the detail id in the WHERE clause instead would have been
# worse: it turns the outer join inner and quietly drops every order
# that has no packaging date yet, which is most of them. A correlated
# subquery keeps the order list whole and returns null where there is no
# date, which is the truthful answer.
#
# No VBA functions anywhere in here, because none of them exist over
# OLEDB: no Nz, no DateValue, no Trim.
$tagWhere = ($Tags | ForEach-Object { "e.LastName like '$_%'" }) -join " or "
$sql = "select o.OrderID, o.OrderNo, o.OrderStatusID, e.LastName, e.FirstName,
               (select max(d.ProductTypeDetailValue_DateTime)
                  from ProductsSelectedDetails as d
                       inner join ProductsSelected as ps
                               on ps.ProductSelectedID = d.ProductSelectedID
                 where ps.OrderID = o.OrderID
                   and d.ProductTypeDetailID in ($idList)) as PackedOn
          from Estimates as e inner join Orders as o on o.OrderID = e.OrderID
         where $tagWhere"

$rows = @()
$TagSet = @($Tags | ForEach-Object { $_.ToUpper() })
$skippedTag = 0
$skippedName = 0
try { $rs = $cn.Execute($sql) } catch { $cn.Close(); Stop-Badly ("Access did not like the query: " + $_.Exception.Message) }
while (-not $rs.EOF) {
  $last  = [string]$rs.Fields.Item("LastName").Value
  $first = [string]$rs.Fields.Item("FirstName").Value
  $parts = @($last -split '\s+' | Where-Object { $_ -ne "" })
  if (-not $parts.Count) { $rs.MoveNext(); continue }
  $tag  = $parts[0].ToUpper()
  $rest = if ($parts.Count -gt 1) { ($parts[1..($parts.Count-1)] -join " ") } else { "" }

  # THE TAG HAS TO BE ONE OF OURS, EXACTLY
  #
  # Access is asked for names beginning PIT, which also answers with the
  # retail customers Pitts, Pittaway and Pitt. Their first word is not
  # PIT, it is PITTS, so they are dropped here rather than being sent to
  # the portal. A dealer order is a tag and then a surname, so a row
  # with nothing after the tag is dropped as well. Those two lines are
  # what keeps retail customers out of the dealer staging table.
  if ($TagSet -notcontains $tag) { $skippedTag++;  $rs.MoveNext(); continue }
  if (-not $rest)                { $skippedName++; $rs.MoveNext(); continue }
  # the street number is the digits at the front of the first name
  $numMatch = [regex]::Match($first, '^\D*(\d+)')
  $num = if ($numMatch.Success) { $numMatch.Groups[1].Value } else { "" }

  $packed = $null
  $pv = $rs.Fields.Item("PackedOn").Value
  if ($pv -ne $null -and "$pv" -ne "") {
    try { $packed = ([datetime]$pv).ToString("yyyy-MM-dd") } catch { }
  }

  $rows += [pscustomobject]@{
    order_id        = [int]$rs.Fields.Item("OrderID").Value
    order_no        = [string]$rs.Fields.Item("OrderNo").Value
    tag             = $tag
    last_name       = $rest
    street_number   = $num
    order_status_id = if ($rs.Fields.Item("OrderStatusID").Value -eq $null) { $null }
                      else { [int]$rs.Fields.Item("OrderStatusID").Value }
    packed_on       = $packed
  }
  $rs.MoveNext()
}
$rs.Close(); $cn.Close()

Say ("Read {0} dealer order(s) out of Access" -f $rows.Count) "Green"
$withDate = ($rows | Where-Object { $_.packed_on }).Count
Say ("  {0} of them have a {1}" -f $withDate, $DateName)
if ($skippedTag) {
  Say ("  {0} row(s) left where they were: the name starts like a dealer tag but is not one" -f $skippedTag)
}
if ($skippedName) {
  Say ("  {0} row(s) left where they were: a tag with no surname after it" -f $skippedName)
}
$noKey = ($rows | Where-Object { -not $_.street_number }).Count
if ($noKey) { Say ("  {0} have no street number, so they can only match on the name" -f $noKey) "Yellow" }

# what came back for each tag, which is the quickest way to see a tag
# that is spelled wrong: it reads nothing and says so
foreach ($t in $TagSet) {
  $n = ($rows | Where-Object { $_.tag -eq $t }).Count
  Say ("  {0}: {1} order(s)" -f $t, $n) $(if ($n) { "Gray" } else { "Yellow" })
}

# ---- -WhatIf: show it and stop --------------------------------------
if ($WhatIfPreference) {
  Say ""
  Say "This is what would be sent. Nothing has been." "Cyan"
  $rows | Sort-Object order_id |
    Format-Table order_id, order_no, tag, last_name, street_number, order_status_id, packed_on -AutoSize |
    Out-String -Width 160 | Write-Host
  exit 0
}

# ---- send it --------------------------------------------------------
if (-not $Key) { Stop-Badly "No key. Set GIDC_KPI_KEY on this machine, or pass -Key. Use -WhatIf to see the rows without one." }
if (-not $rows.Count) { Say "Nothing to send"; exit 0 }

$body = @{ orders = $rows } | ConvertTo-Json -Depth 5 -Compress
$headers = @{ "apikey" = $Anon; "Authorization" = "Bearer $Anon"
              "x-gidc-key" = $Key; "Content-Type" = "application/json" }
try {
  $res = Invoke-RestMethod -Method Post -Uri "$Url/functions/v1/dealer-sync" -Headers $headers -Body $body
} catch {
  # THE BODY IS THE POINT, NOT THE STATUS CODE
  # A 500 on its own says only that something went wrong at the far end.
  # The function answers with a sentence saying which step failed and
  # what the database said about it, and that body is sitting in the
  # exception, so it gets read out rather than thrown away.
  $detail = ""
  try {
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $detail = $reader.ReadToEnd()
    $reader.Close()
  } catch { }
  if (-not $detail -and $_.ErrorDetails) { $detail = $_.ErrorDetails.Message }
  Say ("The portal would not take it: " + $_.Exception.Message) "Red"
  if ($detail) { Say "" ; Say "What the far end said:" "Yellow" ; Say $detail }
  exit 1
}

Say ("Sent {0} order(s). {1} matched, {2} moved." -f $rows.Count, $res.matched, $res.changed) "Green"
if ($res.changes) {
  foreach ($c in $res.changes) {
    Say ("    {0}: {1} -> {2}{3}" -f $c.order_ref, $c.was, $c.now_is,
         $(if ($c.ship) { "  ships $($c.ship)" } else { "" }))
  }
}
if ($res.unmatched) { Say ("    {0} portal order(s) still need lining up by hand" -f $res.unmatched) "Yellow" }

# ---- a line in the log ----------------------------------------------
try {
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  $line = "{0}  read {1}  matched {2}  moved {3}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm"),
          $rows.Count, $res.matched, $res.changed
  Add-Content -LiteralPath (Join-Path $LogDir "dealer-sync.log") -Value $line
} catch { }
