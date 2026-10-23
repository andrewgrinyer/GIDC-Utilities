# =====================================================================
#  GIDC  ·  look at the Access back end and report two things
#
#  WHY THIS EXISTS
#
#  Two of the dashboard numbers need a name out of your database that I
#  have not seen: which appointment type means Showroom, and which field
#  holds the salesperson. Guessing either would put a wrong figure on the
#  dashboard, which is worse than no figure, so this reads them out
#  instead.
#
#  WHAT IT DOES
#    Opens the back end read only, lists names, prints the two answers,
#    and saves the same text to a file beside itself. It reads no
#    figures, changes nothing, and sends nothing anywhere.
#
#  HOW TO RUN IT
#    Right click the file and choose Run with PowerShell, or in a
#    PowerShell window:
#        .\gidc-explore.ps1
#
#    If the back end is somewhere else:
#        .\gidc-explore.ps1 -Database "D:\wherever\Grinyer_be.accdb"
#
#  WHAT TO DO WITH THE RESULT
#    It writes gidc-explore-result.txt next to itself. Send me that file
#    and I will pin the two settings into the nightly import.
# =====================================================================

param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile  = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-explore-result.txt"
}

# Everything printed is also kept, so the file you send me is exactly
# what you saw rather than a retyping of it.
$script:lines = New-Object System.Collections.Generic.List[string]
# ---- what never gets printed ----------------------------------------
# def_Employees turned out to hold passwords as readable text. Dumping
# whole rows put twenty of them into a file that then travelled through a
# chat. Nothing that looks like a credential or a personal contact detail
# leaves this script again, whichever table it turns up in. The column is
# still named, so you can see it exists; only the value is withheld.
# Over inclusive on purpose. Withholding a column that turns out to be
# harmless costs one more look; printing one that is not cannot be undone.
$HIDE = 'pass|pwd|secret|token|apikey|api_key|hash|salt|credential|' +
        'username|user_name|login|account|' +
        'phone|mobile|cell|email|fax|' +
        'address|postal|zip|' +
        '^sin$|socialinsurance|insurance|licence|license|birth|dob|' +
        'salary|wage|rate|comm(ission)?str'
function Hidden($column) { return ($column -match $HIDE) }

function Out2($text = "", $colour = "Gray") {
  Write-Host $text -ForegroundColor $colour
  $script:lines.Add([string]$text)
}
function Finish($code) {
  try {
    [System.IO.File]::WriteAllLines($OutFile, $script:lines)
    Write-Host ""
    Write-Host ("Saved to {0}" -f $OutFile) -ForegroundColor Cyan
    Write-Host "Send me that file." -ForegroundColor Cyan
  } catch {
    Write-Host ("Could not save the file: " + $_.Exception.Message) -ForegroundColor Red
  }
  if (-not $NoPause) {
    Write-Host ""
    Write-Host "Press Enter to close." -ForegroundColor DarkGray
    try { [void](Read-Host) } catch { }
  }
  exit $code
}

Out2 ("GIDC back end, looked at {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
Out2 ("Database: {0}" -f $Database)
Out2 ("PowerShell: {0}, {1}" -f $PSVersionTable.PSVersion,
        $(if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }))
Out2

if (-not (Test-Path -LiteralPath $Database)) {
  Out2 ("Cannot see the database at that path. Check the path, or that this " +
        "machine can reach the share.") "Red"
  Finish 1
}

# ---- open it ---------------------------------------------------------
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try {
    $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read")
    $opened = $true
    break
  } catch { }
}
if (-not $opened) {
  # Almost always the wrong word length rather than a real fault: a 64 bit
  # PowerShell cannot drive a 32 bit Access engine or the other way round.
  $bits = if ([Environment]::Is64BitProcess) { "64 bit" } else { "32 bit" }
  $other = if ([Environment]::Is64BitProcess) {
             "C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
           } else {
             "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
           }
  Out2 ("Could not open the database. This is $bits PowerShell and it needs a " +
        "$bits Access engine.") "Red"
  Out2 ("Try the other PowerShell:") "Yellow"
  Out2 ("  $other -ExecutionPolicy Bypass -File `"$PSCommandPath`"") "Yellow"
  Finish 1
}
Out2 "Opened it, read only." "Green"
Out2

# ---- the names in it -------------------------------------------------
$tables = @()
try {
  $rs = $cn.OpenSchema(20)                      # adSchemaTables
  while (-not $rs.EOF) {
    if ($rs.Fields.Item("TABLE_TYPE").Value -eq "TABLE") {
      $tables += [string]$rs.Fields.Item("TABLE_NAME").Value
    }
    $rs.MoveNext()
  }
  $rs.Close()
} catch {
  Out2 ("Could not list the tables: " + $_.Exception.Message) "Red"
  $cn.Close()
  Finish 1
}
Out2 ("{0} tables." -f $tables.Count)

# Asking the engine for a column list came back empty on the server,
# which runs PowerShell 5.1, and that made this file report "nothing
# found" twice over. Asking the table itself for no rows and reading the
# column names off the answer works on both.
function ColumnsOf($t) {
  $out = @()
  try {
    $rs = $cn.Execute("select * from [$t] where 1=0")
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
      $out += [string]$rs.Fields.Item($i).Name
    }
    $rs.Close()
    if ($out.Count) { return $out }
  } catch { }
  try {
    $rs = $cn.OpenSchema(4, @($null, $null, $t))  # adSchemaColumns
    while (-not $rs.EOF) {
      $out += [string]$rs.Fields.Item("COLUMN_NAME").Value
      $rs.MoveNext()
    }
    $rs.Close()
  } catch { }
  return $out
}

# =====================================================================
# 1. THE SHOWROOM APPOINTMENT TYPE
# =====================================================================
Out2
Out2 "1. THE SHOWROOM APPOINTMENT TYPE" "Cyan"
Out2 "   Booked appointments counts AutoApptID 1 and 2 together, which are"
Out2 "   Initial Visit and Showroom. These are the types as your database"
Out2 "   has them. I need the number against Showroom."
$found = $false
foreach ($t in ($tables | Where-Object { $_ -match 'appt|appointment' })) {
  $cols = ColumnsOf $t
  $idc  = $cols | Where-Object { $_ -match '^(AutoApptID|ApptTypeID|AppointmentTypeID)$' } |
          Select-Object -First 1
  if (-not $idc) { $idc = $cols | Where-Object { $_ -match 'ApptID|AppointmentID' } | Select-Object -First 1 }
  $txt  = $cols | Where-Object { $_ -match 'Desc|Name|Type|Title|Label' } | Select-Object -First 1
  if (-not $idc -or -not $txt) { continue }
  # A lookup is small. Anything long is the appointments themselves, not
  # the list of kinds, so it is left alone.
  try {
    $cnt = $cn.Execute("select count(*) from [$t]")
    $howMany = [int]$cnt.Fields.Item(0).Value
    $cnt.Close()
  } catch { continue }
  if ($howMany -gt 60) { continue }
  try {
    $rs = $cn.Execute("select [$idc], [$txt] from [$t] order by [$idc]")
    if ($rs.EOF) { $rs.Close(); continue }
    Out2 ("   table {0}, column {1}:" -f $t, $idc) "Green"
    while (-not $rs.EOF) {
      Out2 ("      {0,4}  {1}" -f $rs.Fields.Item(0).Value, $rs.Fields.Item(1).Value)
      $rs.MoveNext()
    }
    $rs.Close()
    $found = $true
  } catch { }
}
if (-not $found) {
  Out2 "   Nothing that looks like a list of appointment types." "Yellow"
  Out2 "   These are the tables with appointment in the name:"
  foreach ($t in ($tables | Where-Object { $_ -match 'appt|appointment' })) {
    Out2 ("      {0}: {1}" -f $t, ((ColumnsOf $t) -join ", "))
  }
}

# =====================================================================
# 2. THE SALESPERSON
# =====================================================================
Out2
Out2 "2. THE SALESPERSON" "Cyan"
Out2 "   Any field that looks like it records who sold the order. I need"
Out2 "   the right one, and the lookup its IDs point at if it is an ID."
$any = $false
foreach ($t in @("Orders", "Estimates")) {
  foreach ($c in (ColumnsOf $t)) {
    # Wide on purpose. The first version of this wanted something like
    # SalesPersonID and the real field is SalesAssociateSoldID, so the
    # file said "nothing obvious" while looking straight at the answer.
    if ($c -match 'sales|sold|employee|staff|designer|consultant|associate') {
      Out2 ("   {0}.{1}" -f $t, $c) "Green"
      $any = $true
      # A few real values say more than the column name does: a name or an
      # ID is obvious once you see three of them.
      if (-not (Hidden $c)) {
        try {
          $rs = $cn.Execute("select distinct top 6 [$c] from [$t] where [$c] is not null")
          $vals = @()
          while (-not $rs.EOF) { $vals += [string]$rs.Fields.Item(0).Value; $rs.MoveNext() }
          $rs.Close()
          if ($vals.Count) { Out2 ("      holds: {0}" -f ($vals -join ", ")) }
        } catch { }
      }
    }
  }
}
if (-not $any) {
  Out2 "   Nothing obvious. All the columns on both tables:" "Yellow"
  foreach ($t in @("Orders", "Estimates")) {
    Out2 ("      {0}: {1}" -f $t, ((ColumnsOf $t) -join ", "))
  }
}

Out2
Out2 "   and the lookups those IDs probably point at:"
$lk = $tables | Where-Object { $_ -match 'employee|staff|salesperson|salesrep|sales_?people|users|people|designer' }
if ($lk) {
  foreach ($t in $lk) { Out2 ("      {0}: {1}" -f $t, ((ColumnsOf $t) -join ", ")) }
} else {
  Out2 "      none found by name." "Yellow"
}

$cn.Close()
Out2
Out2 "Done. Nothing was changed and nothing was sent." "Green"
Finish 0
