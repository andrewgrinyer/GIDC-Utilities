# =====================================================================
#  GIDC  ·  Access door lookup lists, read only   (measurement app 2.68)
#
#  Andrew, 24 Nov 2026: a contract imported into Access from the
#  measurement app's workbook came in as handle Alexandria with Century
#  trim, when it was Latitude with Collins.
#
#  The workbook turns each name into an Access number on its hidden Data
#  sheet (handle, trim, handle style, finish, handle type, door type) and
#  on its Door Styles sheet. This prints Access's own lists, so every
#  number in the workbook can be checked against them, and the handle
#  numbers on the most recent door orders, so the order that came in
#  wrong can be seen.
#
#  It only reads Access (Mode=Read). It prints no customer names.
#
#      .\gidc-access-door-lookups.ps1
# =====================================================================
param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [int]    $RecentOrders = 40
)
$ErrorActionPreference = "Stop"
function Say($msg, $colour = "Gray") { Write-Host $msg -ForegroundColor $colour }

Say ("GIDC Access door lookups, read only, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
if (-not (Test-Path -LiteralPath $Database)) { Say "Cannot see the database at $Database" "Red"; exit 1 }
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read"); $opened = $true; break } catch { }
}
if (-not $opened) { Say "Could not open the database read only." "Red"; exit 1 }

# every table name (adSchemaTables = 20), user tables only
$tables = @()
$rs = $cn.OpenSchema(20)
while (-not $rs.EOF) {
  if ([string]$rs.Fields.Item("TABLE_TYPE").Value -eq "TABLE") { $tables += [string]$rs.Fields.Item("TABLE_NAME").Value }
  $rs.MoveNext()
}
$rs.Close()

function Dump($table, $sql, $max) {
  Say ""
  Say "===== $table =====" "Yellow"
  try { $r = $cn.Execute($sql) } catch { Say "  could not read: $($_.Exception.Message)"; return }
  $names = @(); for ($i = 0; $i -lt $r.Fields.Count; $i++) { $names += [string]$r.Fields.Item($i).Name }
  Say ($names -join " | ")
  $n = 0
  while (-not $r.EOF -and $n -lt $max) {
    $vals = @()
    for ($i = 0; $i -lt $r.Fields.Count; $i++) {
      $v = $r.Fields.Item($i).Value
      $vals += if ($v -eq $null -or $v -is [System.DBNull]) { "" } else { ([string]$v) -replace "[\r\n|]+", " " }
    }
    Say ($vals -join " | ")
    $r.MoveNext(); $n++
  }
  $r.Close()
  Say "  ($n rows)"
}

# the lookup lists the workbook's numbers point at
$look = @($tables | Where-Object { $_ -match '^def_' -and $_ -match 'Door|Handle|Trim|Colou?r|Finish|Style' } | Sort-Object)
Say ("Lookup tables found: " + ($look -join ", "))
foreach ($t in $look) { Dump $t "select * from [$t]" 500 }

# the handle numbers on the newest door orders (numbers only, no names)
if ($tables -contains "DoorOrders") {
  $cols = @(); $r = $cn.Execute("select * from [DoorOrders] where 1=0")
  for ($i = 0; $i -lt $r.Fields.Count; $i++) { $cols += [string]$r.Fields.Item($i).Name }; $r.Close()
  $id = $cols[0]
  $want = @($id) + @($cols | Where-Object { $_ -match '^(OrderID|EstimateID|DoorOpeningNumber|DoorTypeID|DoorHandleTypeID|DoorHandleID|DoorTrimStyleID|DoorHandleStyleID|DoorHandleFinishID|DoorProductTypeID|DoorPaintColourID)$' -and $_ -ne $id })
  Say ""
  Say ("DoorOrders columns: " + ($cols -join ", "))
  Dump "DoorOrders, newest $RecentOrders" ("select top $RecentOrders " + (($want | ForEach-Object { "[$_]" }) -join ", ") + " from [DoorOrders] order by [$id] desc") $RecentOrders
}
$cn.Close()
Say ""
Say "Done. Nothing in Access was changed." "Green"
