# =====================================================================
#  GIDC  ·  Find handle numbers in Access, read only   (26 Nov 2026)
#
#  Prints every Access lookup list about handles and trims, and says
#  whether Merano and Seville are in them and with what number, so the
#  workbook and the measurement app can send the right number.
#  It only reads Access (Mode=Read) and prints no customer data.
# =====================================================================
param([string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
      [string[]] $Find = @("Merano", "Seville"))
$ErrorActionPreference = "Stop"
function Say($m, $c = "Gray") { Write-Host $m -ForegroundColor $c }
Say ("GIDC find handle numbers, read only, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
if (-not (Test-Path -LiteralPath $Database)) { Say "Cannot see the database at $Database" "Red"; exit 1 }
$cn = New-Object -ComObject ADODB.Connection; $ok = $false
foreach ($v in @("16.0", "12.0")) { try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$v;Data Source=$Database;Mode=Read"); $ok = $true; break } catch { } }
if (-not $ok) { Say "Could not open the database read only." "Red"; exit 1 }
$tables = @(); $rs = $cn.OpenSchema(20)
while (-not $rs.EOF) { if ([string]$rs.Fields.Item("TABLE_TYPE").Value -eq "TABLE") { $tables += [string]$rs.Fields.Item("TABLE_NAME").Value }; $rs.MoveNext() }
$rs.Close()
$look = @($tables | Where-Object { $_ -match '^def_' -and $_ -match 'Handle|Trim' } | Sort-Object)
Say ("Handle lookup tables: " + ($look -join ", "))
$found = @{}; foreach ($f in $Find) { $found[$f] = @() }
foreach ($t in $look) {
  Say ""; Say "===== $t =====" "Yellow"
  $r = $cn.Execute("select * from [$t]")
  $names = @(); for ($i = 0; $i -lt $r.Fields.Count; $i++) { $names += [string]$r.Fields.Item($i).Name }
  Say ($names -join " | ")
  while (-not $r.EOF) {
    $vals = @(); for ($i = 0; $i -lt $r.Fields.Count; $i++) { $v = $r.Fields.Item($i).Value; $vals += if ($v -eq $null -or $v -is [System.DBNull]) { "" } else { ([string]$v) -replace "[\r\n|]+", " " } }
    $line = $vals -join " | "
    $hit = $Find | Where-Object { $line -match $_ }
    if ($hit) { Say $line "Green"; foreach ($h in $hit) { $found[$h] += "$t : $line" } } else { Say $line }
    $r.MoveNext()
  }
  $r.Close()
}
$cn.Close()
Say ""; Say "===== RESULT =====" "Cyan"
foreach ($f in $Find) {
  if ($found[$f].Count) { foreach ($x in $found[$f]) { Say "$f FOUND in $x" "Green" } }
  else { Say "$f is NOT in any Access handle list. It has to be added in Access before it can upload." "Red" }
}
Say ""; Say "Done. Nothing in Access was changed." "Green"
