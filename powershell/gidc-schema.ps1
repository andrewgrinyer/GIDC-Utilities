# =====================================================================
#  GIDC  ·  what is in the Access backend
#
#  Reads the structure of an Access database and writes it to a text
#  file on your Desktop: every table and saved query, every column and
#  its type, how many rows each holds, and for date columns how far
#  back the history goes.
#
#  It reads nothing else. No customer names, no addresses, no figures
#  leave the machine. Open the file and check it before you send it.
#
#  Nothing to install: it uses the Access engine already on the machine.
#  It goes straight to \\SVR-GDDC\GIDC Database\Grinyer_be and only asks
#  you to find it if that is not where it is.
#
#  TO RUN
#    Right click this file and choose Run with PowerShell.
#
#    If Windows says running scripts is disabled, or nothing happens,
#    open PowerShell and run this instead, with the real path:
#        powershell -ExecutionPolicy Bypass -File "C:\path\gidc-schema.ps1"
#
#    If the file came down from a browser, Windows may have it blocked:
#    right click it, Properties, and tick Unblock at the bottom.
# =====================================================================

$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Host ""
  Write-Host $msg -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

# ---- find the database ----------------------------------------------
# The back end lives on the server. The extension is not written down
# anywhere I can see, so the likely ones are tried in turn, and if none
# of them is there it falls back to asking.
$tries = @(
  "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  "\\SVR-GDDC\GIDC Database\Grinyer_be.mdb",
  "\\SVR-GDDC\GIDC Database\Grinyer_be"
)

$db = $null
foreach ($t in $tries) {
  if (Test-Path -LiteralPath $t) { $db = $t; break }
}

if (-not $db) {
  Write-Host ""
  Write-Host "Could not find it at \\SVR-GDDC\GIDC Database\Grinyer_be" -ForegroundColor Yellow
  Write-Host "Pick it by hand instead." -ForegroundColor Yellow
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  $pick = New-Object System.Windows.Forms.OpenFileDialog
  $pick.Title  = "Choose the Access database"
  $pick.Filter = "Access database (*.accdb;*.mdb)|*.accdb;*.mdb|All files (*.*)|*.*"
  try { $pick.InitialDirectory = "\\SVR-GDDC\GIDC Database" } catch { }
  if ($pick.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "Nothing chosen. Stopping."
    exit
  }
  $db = $pick.FileName
}
$out = Join-Path ([Environment]::GetFolderPath("Desktop")) "gidc-schema.txt"

Write-Host ""
Write-Host "Reading $db" -ForegroundColor Cyan

# ---- open it, trying both engine versions ---------------------------
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try {
    $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$db")
    $opened = $true
    Write-Host "Opened with the Access engine $ver" -ForegroundColor DarkGray
    break
  } catch { }
}
if (-not $opened) {
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  Fail @"
Could not open the database.

This is running as $bits PowerShell, so it needs a $bits Access engine.
The usual cause is that Office is the other one.

Try the other PowerShell and run it again:
   64 bit   C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
   32 bit   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe

If neither works, the machine has no Access engine on it. Installing the
Microsoft Access Database Engine 2016 Redistributable fixes that, or run
this on a machine that has Access itself.

If the database has a password on it, take a copy and remove the password
from the copy first.
"@
}

# OLE DB reports types as numbers, so give them names worth reading
$T = @{ 2="Integer"; 3="Long"; 4="Single"; 5="Double"; 6="Currency"; 7="Date";
        11="Yes/No"; 17="Byte"; 72="GUID"; 128="Binary"; 130="Text";
        131="Decimal"; 135="DateTime"; 139="Decimal"; 202="Text"; 203="Memo";
        204="Binary"; 205="Attachment" }

$lines = @()
$lines += "GIDC Access backend"
$lines += "read " + (Get-Date -Format "yyyy-MM-dd HH:mm")
$lines += "file " + $db
$lines += ""

# ---- every table and saved query ------------------------------------
$items = @()
$rs = $cn.OpenSchema(20)                       # 20 = tables, including queries
while (-not $rs.EOF) {
  $n = $rs.Fields.Item("TABLE_NAME").Value
  $k = $rs.Fields.Item("TABLE_TYPE").Value
  if ($n -notlike "MSys*" -and $n -notlike "~*") { $items += ,@($n, $k) }
  $rs.MoveNext()
}
$rs.Close()

if ($items.Count -eq 0) { Fail "Opened it, but found no tables. Is this the right file?" }

Write-Host ("Found {0} tables and queries. Working through them..." -f $items.Count)

foreach ($it in $items) {
  $name = $it[0]
  $kind = $it[1]
  $rows = "?"
  try {
    $r = $cn.Execute("select count(*) from [$name]")
    $rows = $r.Fields.Item(0).Value
    $r.Close()
  } catch { }

  $lines += ""
  $lines += "$name  [$kind]  $rows rows"

  try {
    $rc = $cn.OpenSchema(4, @($null, $null, $name, $null))   # 4 = columns
    while (-not $rc.EOF) {
      $col = $rc.Fields.Item("COLUMN_NAME").Value
      $num = [int]$rc.Fields.Item("DATA_TYPE").Value
      $typ = if ($T.ContainsKey($num)) { $T[$num] } else { "type $num" }
      $line = "    {0,-32} {1}" -f $col, $typ

      # for dates, the earliest and latest. It says how much history there
      # is to pull across. No names, no addresses, no figures.
      if ($num -eq 7 -or $num -eq 135) {
        try {
          $d  = $cn.Execute("select min([$col]), max([$col]) from [$name]")
          $lo = $d.Fields.Item(0).Value
          $hi = $d.Fields.Item(1).Value
          $d.Close()
          if ($lo -or $hi) {
            $line += "   ({0} to {1})" -f $lo, $hi
          }
        } catch { }
      }
      $lines += $line
      $rc.MoveNext()
    }
    $rc.Close()
  } catch {
    $lines += "    (could not read the columns: " + $_.Exception.Message + ")"
  }
}

$cn.Close()

$lines | Set-Content -Encoding UTF8 $out

Write-Host ""
Write-Host "Written to $out" -ForegroundColor Green
Write-Host "Opening it now. Have a look through before sending it on."
Write-Host ""
Start-Process notepad.exe $out
