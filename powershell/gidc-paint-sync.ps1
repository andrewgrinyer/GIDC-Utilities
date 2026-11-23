# =====================================================================
#  GIDC  ·  hourly paint schedule sync
#
#  Andrew, 19 November: the Paint tool on the tools site needs to know
#  how many doors of each colour are to be primed and painted each day.
#  This reads that out of the Access production schedule and sends it to
#  Supabase through the paint-sync edge function. The page does the
#  gallons, the stock and the orders; this only says what is scheduled.
#
#  START HERE. See what it would send, without sending anything:
#
#      .\gidc-paint-sync.ps1 -WhatIf
#
#  Then, once that looks right:
#
#      .\gidc-paint-sync.ps1
#
#  And hourly, set up by gidc-schedule-paint-sync.ps1.
#
#  WHAT IT NEEDS
#    The same GIDC_KPI_KEY the KPI import and dealer sync already use.
#
#  WHERE THINGS LIVE IN ACCESS
#    The dates are rows, like the packaging date the dealer sync reads:
#    def_ProductTypeDetails names them ("Scheduled Prime Date" and
#    "Scheduled Paint Date") and ProductsSelectedDetails holds the value
#    per order, in ProductTypeDetailValue_DateTime.
#    The doors are DoorOrders, one row per door line, DoorQuantity doors
#    on each, DoorProductTypeID 1 being interior doors.
#    The colour is on the door line. Found by gidc-paint-probe.ps1 on
#    19 November: DoorOrders.DoorPaintColourName is the name as typed
#    (Extra White on 4623 lines, Chantilly on a dozen, Oxford White and
#    the like for custom), DoorPaintColourCode the maker's code (OC-65,
#    SW 7042), and DoorPaintColourID points at def_DoorColours (1 Custom
#    Colour, 2 Extra White, 3 Pure White, 4 Alabaster, 5 Pearly; there is
#    no id for Chantilly Lace). So the typed name is used, the code is
#    added for a custom colour so Ashley can order it, and the id is used
#    only when no name was typed. Supabase decides which stocked colour a
#    name is (paint_colour_of in sql/paint.sql), so Chantily, Chantilly
#    Lae and Katie Chantilly all land on Chantilly Lace.
#
#    Bifolds: a bifold line is DoorQuantity doors, as entered. Bifolds
#    are 27 lines in the whole history, so this is not worth a rule.
#
#  WHAT IT SENDS
#    One line per order and colour: Access OrderID, OrderNo, the last
#    name on the estimate (the job, as the shop knows it), the colour as
#    typed, how many doors, and the two dates. Only orders with a prime
#    or paint date from two weeks ago to four months ahead.
#
#  WHAT IT WILL NOT DO
#    It only ever reads Access, with Mode=Read.
# =====================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $Url  = "https://baakegbtuygtldksmant.supabase.co",
  [string] $Anon = "sb_publishable_CSwwslH9Jt60-WK2fEJORw_k-R9n8Vj",
  [string] $Key  = $env:GIDC_KPI_KEY,
  [string] $LogDir = "C:\GIDC\logs",

  # THE COLOUR OF A DOOR LINE, as the probe found it (see above)
  [string] $ColourColumn = "DoorPaintColourName",
  [string] $CodeColumn   = "DoorPaintColourCode",
  [string] $IdColumn     = "DoorPaintColourID",
  [string] $ColourTable  = "def_DoorColours",

  # Which door product types are painted. 1 is Interior Doors.
  [int[]]  $ProductTypes = @(1),

  [string] $PrimeName = "Scheduled Prime Date",
  [string] $PaintName = "Scheduled Paint Date",

  # Days already passed that Access may still correct. Anything older is
  # left as Supabase has it, so finished jobs keep their paint used.
  [int] $DaysBack  = 14,
  [int] $DaysAhead = 120
)

$ErrorActionPreference = "Stop"
function Say($msg, $colour = "Gray") { Write-Host $msg -ForegroundColor $colour }
function Stop-Badly($msg) { Say $msg "Red"; exit 1 }
$inv = [Globalization.CultureInfo]::InvariantCulture


# ---- Access, read only ---------------------------------------------------
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

function Rows($sql) {
  $out = New-Object System.Collections.Generic.List[object]
  try { $rs = $cn.Execute($sql) } catch { $cn.Close(); Stop-Badly ("Access did not like a query: " + $_.Exception.Message + "`n" + $sql) }
  while (-not $rs.EOF) {
    $h = @{}
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $h[$rs.Fields.Item($i).Name] = $rs.Fields.Item($i).Value }
    $out.Add($h)
    $rs.MoveNext()
  }
  $rs.Close()
  return , $out
}
function Blank($v) { return ($null -eq $v -or $v -is [DBNull] -or "$v" -eq "") }
function Day($v) { if (Blank $v) { return $null }; try { return ([datetime]$v).ToString("yyyy-MM-dd") } catch { return $null } }

# ---- which detail rows are the two dates ----------------------------------
function DetailIds($name) {
  $ids = @()
  foreach ($r in (Rows ("select ProductTypeDetailID from def_ProductTypeDetails where ProductTypeDetailName = '" + ($name -replace "'", "''") + "'"))) {
    $ids += [int]$r["ProductTypeDetailID"]
  }
  if (-not $ids.Count) { $cn.Close(); Stop-Badly "Nothing in def_ProductTypeDetails is called '$name'." }
  Say ("  '{0}' is detail id {1}" -f $name, ($ids -join ", "))
  return $ids
}
$primeIds = DetailIds $PrimeName
$paintIds = DetailIds $PaintName
$allIds = (@($primeIds) + @($paintIds)) -join ","

# ---- the orders with a date in the window -----------------------------------
$today = (Get-Date).Date
$keep  = $today.AddDays(-$DaysBack)
$lo = $keep.ToString("MM/dd/yyyy", $inv)
$hi = $today.AddDays($DaysAhead + 1).ToString("MM/dd/yyyy", $inv)
$orderIds = @()
foreach ($r in (Rows "select distinct ps.OrderID
                         from ProductsSelectedDetails as d
                              inner join ProductsSelected as ps on ps.ProductSelectedID = d.ProductSelectedID
                        where d.ProductTypeDetailID in ($allIds)
                          and d.ProductTypeDetailValue_DateTime >= #$lo#
                          and d.ProductTypeDetailValue_DateTime < #$hi#")) {
  if (-not (Blank $r["OrderID"])) { $orderIds += [int]$r["OrderID"] }
}
Say ("{0} order(s) have a prime or paint date from {1} to {2}" -f $orderIds.Count,
     $keep.ToString("yyyy-MM-dd"), $today.AddDays($DaysAhead).ToString("yyyy-MM-dd"))

# ---- dates, doors and names, a couple of hundred orders at a time ------------
$prime = @{}; $paint = @{}; $names = @{}; $doorRows = @()
$types = ($ProductTypes | ForEach-Object { [int]$_ }) -join ","

for ($i = 0; $i -lt $orderIds.Count; $i += 200) {
  $chunk = ($orderIds[$i..([Math]::Min($i + 199, $orderIds.Count - 1))]) -join ","

  foreach ($r in (Rows "select ps.OrderID, d.ProductTypeDetailID, d.ProductTypeDetailValue_DateTime as V
                          from ProductsSelectedDetails as d
                               inner join ProductsSelected as ps on ps.ProductSelectedID = d.ProductSelectedID
                         where ps.OrderID in ($chunk) and d.ProductTypeDetailID in ($allIds)")) {
    $day = Day $r["V"]
    if (-not $day) { continue }
    $id = [int]$r["OrderID"]
    $set = if ($primeIds -contains [int]$r["ProductTypeDetailID"]) { $prime } else { $paint }
    if (-not $set.ContainsKey($id) -or $set[$id] -lt $day) { $set[$id] = $day }
  }

  foreach ($r in (Rows "select o.OrderID, o.OrderNo, e.LastName
                          from Estimates as e inner join Orders as o on o.OrderID = e.OrderID
                         where o.OrderID in ($chunk)")) {
    $names[[int]$r["OrderID"]] = @{ no = [string]$r["OrderNo"]; job = [string]$r["LastName"] }
  }

  # Name, code and listed colour together; combined below, because
  # Access over OLEDB has no Nz or Trim to do it in the query.
  foreach ($r in (Rows "select dr.OrderID, dr.[$ColourColumn] as Nm, dr.[$CodeColumn] as Cd,
                               c.DoorColourName as Listed, sum(dr.DoorQuantity) as Doors
                          from DoorOrders as dr left join [$ColourTable] as c on c.DoorColourID = dr.[$IdColumn]
                         where dr.OrderID in ($chunk) and dr.DoorProductTypeID in ($types)
                         group by dr.OrderID, dr.[$ColourColumn], dr.[$CodeColumn], c.DoorColourName")) {
    $doorRows += $r
  }
}
$cn.Close()

# ---- the colour of a line ------------------------------------------------------
# Words that mean nothing has been decided yet. "Null" is typed in as text
# on 55 lines, TBD on 34.
$NOTHING = '^(null|tbd|n/?a|none|0|00-00|1|xyz)?$'
function Clean($v) { if (Blank $v) { return "" }; $t = ([string]$v).Trim(); if ($t -match $NOTHING) { return "" }; return $t }
function ColourOf($r) {
  $name = Clean $r["Nm"]; $code = Clean $r["Cd"]; $listed = Clean $r["Listed"]
  if (-not $name -and $listed -and $listed -ne "Custom Colour") { $name = $listed }
  if (-not $name -and $code) { $name = $code; $code = "" }
  if (-not $name) { return "" }
  # The code goes with a custom colour, so the order says exactly what
  # to buy. A stocked colour is left as named.
  $stocked = ($name -replace '[^A-Za-z]', '').ToLower() -match 'extrawhite|purewhite|alabaster|pearly|chantil'
  if ($code -and -not $stocked -and $name -notmatch [regex]::Escape($code) -and $code -notmatch 'do ?not ?prime') { $name = "$name ($code)" }
  return $name
}

# ---- one line per order and colour ------------------------------------------
$byKey = [ordered]@{}
foreach ($r in $doorRows) {
  $id = [int]$r["OrderID"]
  $doors = if (Blank $r["Doors"]) { 0 } else { [double]$r["Doors"] }
  if ($doors -le 0) { continue }
  $p1 = $prime[$id]; $p2 = $paint[$id]
  if (-not $p1 -and -not $p2) { continue }
  $colour = ColourOf $r
  $k = "$id|" + $colour.ToLower()
  if ($byKey.Contains($k)) { $byKey[$k].doors += $doors; continue }
  $byKey[$k] = [pscustomobject]@{
    order_id = $id
    order_no = if ($names.ContainsKey($id)) { $names[$id].no } else { $null }
    job      = if ($names.ContainsKey($id)) { $names[$id].job } else { $null }
    colour   = $colour
    doors    = $doors
    prime_on = $p1
    paint_on = $p2
  }
}
$lines = @($byKey.Values)
Say ("{0} line(s) to send, {1} door(s)" -f $lines.Count, (($lines | Measure-Object doors -Sum).Sum)) "Green"
$noColour = @($lines | Where-Object { -not $_.colour })
if ($noColour.Count) { Say ("  {0} line(s) have no colour typed" -f $noColour.Count) "Yellow" }

# ---- -WhatIf: show it and stop ---------------------------------------------
if ($WhatIfPreference) {
  Say ""
  Say "Doors per colour:" "Cyan"
  $lines | Group-Object colour | Sort-Object Name |
    ForEach-Object { Say ("  {0,-30} {1,6}" -f $(if ($_.Name) { $_.Name } else { "(none typed)" }), (($_.Group | Measure-Object doors -Sum).Sum)) }
  Say ""
  Say "Doors to paint per day, next three weeks:" "Cyan"
  $lines | Where-Object { $_.paint_on -and $_.paint_on -ge $today.ToString("yyyy-MM-dd") -and
                          $_.paint_on -le $today.AddDays(21).ToString("yyyy-MM-dd") } |
    Group-Object paint_on | Sort-Object Name |
    ForEach-Object { Say ("  {0}  {1,5}" -f $_.Name, (($_.Group | Measure-Object doors -Sum).Sum)) }
  Say ""
  Say "This is what would be sent. Nothing has been." "Cyan"
  exit 0
}

# ---- send it ------------------------------------------------------------------
if (-not $Key) { Stop-Badly "No key. Set GIDC_KPI_KEY on this machine, or pass -Key. Use -WhatIf to see the lines without one." }

$body = @{ keep_before = $keep.ToString("yyyy-MM-dd"); lines = @($lines) } | ConvertTo-Json -Depth 5 -Compress
$headers = @{ "apikey" = $Anon; "Authorization" = "Bearer $Anon"
              "x-gidc-key" = $Key; "Content-Type" = "application/json" }
try {
  $res = Invoke-RestMethod -Method Post -Uri "$Url/functions/v1/paint-sync" -Headers $headers `
           -Body ([Text.Encoding]::UTF8.GetBytes($body))
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
Say ("Sent {0} line(s). Loaded {1}, replaced {2}." -f $lines.Count, $res.added, $res.removed) "Green"
if ($res.dropped) { foreach ($d in $res.dropped) { Say ("    dropped: " + $d) "Yellow" } }

# ---- a line in the log ----------------------------------------------------------
try {
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  $line = "{0}  orders {1}  lines {2}  loaded {3}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm"),
          $orderIds.Count, $lines.Count, $res.added
  Add-Content -LiteralPath (Join-Path $LogDir "paint-sync.log") -Value $line
} catch { }
