# =====================================================================
#  GIDC  ·  what the dealer portal needs to know about Access
#
#  Read only. It writes nothing anywhere and sends nothing out. It looks
#  at the back end and answers four questions:
#
#    1. Which table and field carry the order status, and what are the
#       statuses called.
#    2. Where the customer name sits, and what shape a dealer order's
#       name is in: the dealer ID in the last name and the street number
#       in the first name.
#    3. Which field holds the packaging date.
#    4. How many orders look like dealer orders today.
#
#  NO CUSTOMER DETAILS COME OUT OF IT.
#
#  Names, addresses, phone numbers and emails are never printed. Where a
#  name has to be described, only its shape is shown: the dealer tag at
#  the front, then the number of words and letters after it, so
#  "SFD Carlton" prints as "SFD + 1 word of 7". That is enough to write
#  the matching rule and nothing more.
#
#  HOW TO RUN IT
#      powershell -ExecutionPolicy Bypass -File .\gidc-dealer-probe.ps1
#
#  It saves gidc-dealer-probe-result.txt beside itself. Send me that.
# =====================================================================

[CmdletBinding()]
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile,
  # the dealer tags as they are typed into the last name field
  [string[]] $Tags = @("CIN", "CDC", "SFD")
)

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-dealer-probe-result.txt"
}

# Columns whose contents never print, whatever table they are in.
$HIDE = 'pass|pwd|secret|token|apikey|hash|salt|credential|' +
        'username|user_name|login|account|' +
        'phone|mobile|cell|email|fax|address|postal|zip|' +
        'firstname|lastname|surname|clientname|customername|' +
        'commission|salary|rate|wage'
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
  } catch {
    Write-Host ("Could not save: {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
  exit $code
}

# ---- open it --------------------------------------------------------
if (-not (Test-Path -LiteralPath $Database)) {
  Out2 ("Cannot see the database at {0}" -f $Database) "Red"; Finish 1
}
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database"); $opened = $true; break } catch { }
}
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Out2 ("Could not open the database. This is {0} PowerShell and needs a {0} Access engine. Try the other one: C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -f $bits) "Red"
  Finish 1
}
Out2 ("GIDC dealer probe  ·  {0}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm"))
Out2 ("database: {0}" -f $Database)
Out2 ""

# ---- the tables and their columns -----------------------------------
# Only the ones this job could possibly need, so the file stays short.
$WANT = 'order|customer|client|estimate|pack|ship|deal'
$tables = @()
try {
  $rs = $cn.OpenSchema(20)          # adSchemaTables
  while (-not $rs.EOF) {
    $t = [string]$rs.Fields.Item("TABLE_NAME").Value
    $k = [string]$rs.Fields.Item("TABLE_TYPE").Value
    if ($k -eq "TABLE" -and $t -notlike "MSys*") { $tables += $t }
    $rs.MoveNext()
  }
  $rs.Close()
} catch { Out2 ("Could not list the tables: {0}" -f $_.Exception.Message) "Red"; Finish 1 }

function ColumnsOf($table) {
  $cols = @()
  try {
    $r = $cn.Execute("select * from [$table] where 1=0")
    for ($i = 0; $i -lt $r.Fields.Count; $i++) { $cols += [string]$r.Fields.Item($i).Name }
    $r.Close()
  } catch { }
  return $cols
}

Out2 "TABLES THAT MIGHT MATTER" "Cyan"
$interesting = $tables | Where-Object { $_ -match $WANT }
foreach ($t in $interesting) {
  $cols = ColumnsOf $t
  if (-not $cols.Count) { continue }
  Out2 ("  {0}  ({1} columns)" -f $t, $cols.Count) "White"
  Out2 ("      {0}" -f ($cols -join ", "))
}
Out2 ""

# ---- the status list ------------------------------------------------
# Whatever table holds the words behind OrderStatusID.
Out2 "ORDER STATUSES, AS THE DATABASE SPELLS THEM" "Cyan"
$statusTables = $tables | Where-Object { $_ -match 'orderstatus|status' }
$found = $false
foreach ($t in $statusTables) {
  $cols = ColumnsOf $t
  $id  = $cols | Where-Object { $_ -match 'id$' } | Select-Object -First 1
  $txt = $cols | Where-Object { $_ -notmatch 'id$' -and $_ -notmatch $HIDE } | Select-Object -First 1
  if (-not $id -or -not $txt) { continue }
  Out2 ("  {0}: {1} -> {2}" -f $t, $id, $txt) "White"
  try {
    $r = $cn.Execute("select [$id], [$txt] from [$t] order by [$id]")
    while (-not $r.EOF) {
      Out2 ("      {0,4}  {1}" -f $r.Fields.Item(0).Value, $r.Fields.Item(1).Value)
      $r.MoveNext()
    }
    $r.Close(); $found = $true
  } catch { Out2 ("      could not read it: {0}" -f $_.Exception.Message) "Red" }
}
if (-not $found) { Out2 "  no status lookup table found" "Yellow" }
Out2 ""

# ---- anything that looks like a packaging date ----------------------
Out2 "FIELDS THAT LOOK LIKE A PACKING OR SHIPPING DATE" "Cyan"
foreach ($t in $interesting) {
  foreach ($c in (ColumnsOf $t)) {
    if ($c -match 'pack|crate|palle|ship|dispatch|complete' -and $c -match 'date|on$|when') {
      $n = 0
      try {
        $r = $cn.Execute("select count(*) from [$t] where [$c] is not null")
        $n = [int]$r.Fields.Item(0).Value; $r.Close()
      } catch { }
      Out2 ("  {0}.{1}   {2} row(s) have one" -f $t, $c, $n)
    }
  }
}
Out2 ""

# ---- what a dealer order's name looks like --------------------------
# The shape only: the tag, then how many words and letters follow, and
# whether the first name field is all digits. No name is printed.
Out2 "THE SHAPE OF A DEALER ORDER'S NAME" "Cyan"
$custTable = $tables | Where-Object { $_ -match '^customers?$|^clients?$' } | Select-Object -First 1
if (-not $custTable) {
  $custTable = $tables | Where-Object { (ColumnsOf $_) -match 'lastname|surname' } | Select-Object -First 1
}
if (-not $custTable) {
  Out2 "  could not find a customer table" "Yellow"
} else {
  $cols  = ColumnsOf $custTable
  $last  = $cols | Where-Object { $_ -match 'lastname|surname' }  | Select-Object -First 1
  $first = $cols | Where-Object { $_ -match 'firstname|forename' } | Select-Object -First 1
  $key   = $cols | Where-Object { $_ -match 'id$' } | Select-Object -First 1
  Out2 ("  {0}: key {1}, last name {2}, first name {3}" -f $custTable, $key, $last, $first) "White"
  foreach ($tag in $Tags) {
    $n = 0
    try {
      $r = $cn.Execute("select count(*) from [$custTable] where [$last] like '$tag%'")
      $n = [int]$r.Fields.Item(0).Value; $r.Close()
    } catch { }
    Out2 ("  {0,-5} {1} customer record(s)" -f $tag, $n)
  }
  # the shape of the most recent twenty, with nothing readable in it
  try {
    $q = ($Tags | ForEach-Object { "[$last] like '$_%'" }) -join " or "
    $r = $cn.Execute("select top 20 [$last], [$first] from [$custTable] where $q order by [$key] desc")
    Out2 "  the last twenty, as shapes:"
    while (-not $r.EOF) {
      $l = [string]$r.Fields.Item(0).Value
      $f = [string]$r.Fields.Item(1).Value
      $parts = @($l -split '\s+' | Where-Object { $_ -ne "" })
      $tag   = if ($parts.Count) { $parts[0] } else { "" }
      $rest  = if ($parts.Count -gt 1) { $parts[1..($parts.Count-1)] } else { @() }
      $restShape = ($rest | ForEach-Object { "{0} letters" -f $_.Length }) -join " + "
      $fShape = if ($f -match '^\s*$') { "empty" }
                elseif ($f -match '^\d+$') { "all digits, {0} of them" -f $f.Trim().Length }
                elseif ($f -match '^\d') { "starts with digits then more" }
                else { "no digits at the front, {0} characters" -f $f.Trim().Length }
      Out2 ("      last: {0,-6} + {1,-22}   first: {2}" -f $tag, ($restShape -replace '^$','nothing'), $fShape)
      $r.MoveNext()
    }
    $r.Close()
  } catch { Out2 ("  could not read the shapes: {0}" -f $_.Exception.Message) "Red" }
}
Out2 ""

# ---- and how those customers reach an order -------------------------
Out2 "HOW A CUSTOMER REACHES AN ORDER" "Cyan"
foreach ($t in @("Orders","Estimates")) {
  if ($tables -notcontains $t) { Out2 ("  no {0} table" -f $t) "Yellow"; continue }
  $cols = ColumnsOf $t
  $links = $cols | Where-Object { $_ -match 'customerid|clientid|estimateid|orderid' }
  Out2 ("  {0}: {1}" -f $t, ($links -join ", "))
  $dates = $cols | Where-Object { $_ -match 'date|on$' }
  if ($dates) { Out2 ("      dates on it: {0}" -f ($dates -join ", ")) }
  $stat = $cols | Where-Object { $_ -match 'status' }
  if ($stat) { Out2 ("      status columns: {0}" -f ($stat -join ", ")) }
}

$cn.Close()
Out2 ""
Out2 "Done. Nothing was changed and no customer details are in this file." "Green"
Finish 0
