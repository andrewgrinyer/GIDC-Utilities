# =====================================================================
#  GIDC  ·  find the daily table and see how far back it goes
#
#  Andrew, 20 October, 22:42: it is recorded and tracked daily in a
#  table in Access.
#
#  Then the history is real rather than worked out, which is the best
#  answer there was. A daily row is exactly the shape the dashboard
#  wants: one figure, one day, straight in.
#
#  WHAT THIS DOES
#
#  It finds the table without needing to be told its name, and it does
#  that by shape rather than by guessing at names. Any table with a date
#  column that holds roughly one row per day across a long stretch is a
#  daily record of something, whatever it happens to be called. Name
#  matching is still done as well, but only as a second opinion.
#
#  For every candidate it prints the columns, the row count, the first
#  and last day, how many days are covered, and the last fourteen days
#  row by row so I can see whether it is one row per day holding many
#  figures across the columns, or one row per figure per day.
#
#  That tells me three things I need before writing a line of import:
#  which table, which column is which figure, and how far back it runs.
#
#  WHAT IT PRINTS
#
#  Column names, row counts and dates. Values are printed only from
#  columns that hold numbers or dates. Anything whose name reads as
#  personal is counted and never shown, which is the same guard every
#  one of these scripts carries.
#
#  It reads only. It changes nothing and sends nothing.
#
#      powershell -ExecutionPolicy Bypass -File .\gidc-explore10.ps1
#
#  It writes gidc-explore10-result.txt beside itself. Send me that.
# =====================================================================

param(
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [string] $OutFile  = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"
if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-explore10-result.txt"
}

# Anything whose name reads as personal is never printed, only counted.
$HIDE = '(?i)(name|first|last|address|street|city|postal|zip|phone|mobile|cell|' +
        'fax|email|mail|password|pwd|notes?|comment|description|contact|' +
        'customer|client|price|cost|amount|total|commission|rate|wage|salary)'

$script:lines = New-Object System.Collections.Generic.List[string]
function Out2($text = "", $colour = "Gray") {
  Write-Host $text -ForegroundColor $colour
  $script:lines.Add([string]$text)
}
function Finish($code) {
  try {
    [System.IO.File]::WriteAllLines($OutFile, $script:lines)
    Write-Host ""; Write-Host ("Saved to {0}" -f $OutFile) -ForegroundColor Cyan
    Write-Host "Send me that file." -ForegroundColor Cyan
  } catch { Write-Host ("Could not save: " + $_.Exception.Message) -ForegroundColor Red }
  if (-not $NoPause) {
    Write-Host ""; Write-Host "Press Enter to close." -ForegroundColor DarkGray
    try { [void](Read-Host) } catch { }
  }
  exit $code
}

Out2 ("GIDC back end, finding the daily table, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
Out2 "Nothing is changed and nothing is sent."
Out2

if (-not (Test-Path -LiteralPath $Database)) { Out2 "Cannot see the database." "Red"; Finish 1 }
$cn = New-Object -ComObject ADODB.Connection
$opened = $false
foreach ($ver in @("16.0", "12.0")) {
  try { $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read"); $opened = $true; break } catch { }
}
if (-not $opened) { Out2 "Could not open the database." "Red"; Finish 1 }
Out2 "Opened it, read only." "Green"

function One($sql) {
  $rs = $null
  try {
    $rs = $cn.Execute($sql)
    if ($rs.EOF) { return $null }
    $v = $rs.Fields.Item(0).Value
    if ($null -eq $v -or $v -is [System.DBNull]) { return $null }
    return $v
  } catch { return $null }
  finally { if ($rs) { try { $rs.Close() } catch { } } }
}
# A date that came back as a date, or a word saying why not. Its own
# small thing because casting something unreadable to a date would stop
# the whole script on the one line meant to be tolerant.
function AsDay($v) {
  if ($null -eq $v) { return "none" }
  try { return ([datetime]$v).ToString("yyyy-MM-dd") } catch { return "unreadable" }
}
function Acc($d) { return "#" + $d.ToString("MM/dd/yyyy") + "#" }

# ---------------------------------------------------------------------
#  READ THE WHOLE SHAPE OF THE DATABASE ONCE
# ---------------------------------------------------------------------
# 7 adDate, 133 adDBDate, 135 adDBTimeStamp
$DATE_TYPES = @(7, 133, 135)
# 2 smallint, 3 int, 4 single, 5 double, 6 currency, 17 tinyint, 20 bigint,
# 131 decimal, 139 numeric
$NUM_TYPES  = @(2, 3, 4, 5, 6, 17, 20, 131, 139)

$tables = @()
try {
  $rs = $cn.OpenSchema(20)
  while (-not $rs.EOF) {
    $t  = [string]$rs.Fields.Item("TABLE_NAME").Value
    $ty = [string]$rs.Fields.Item("TABLE_TYPE").Value
    if ($ty -eq "TABLE" -and $t -notlike "MSys*") { $tables += $t }
    $rs.MoveNext()
  }
  $rs.Close()
} catch { Out2 ("Could not list the tables: " + $_.Exception.Message) "Red"; Finish 1 }

$colsOf = @{}
try {
  $rs = $cn.OpenSchema(4)
  while (-not $rs.EOF) {
    $t = [string]$rs.Fields.Item("TABLE_NAME").Value
    if ($tables -contains $t) {
      if (-not $colsOf.ContainsKey($t)) { $colsOf[$t] = @() }
      $colsOf[$t] += [pscustomobject]@{
        Name = [string]$rs.Fields.Item("COLUMN_NAME").Value
        Type = [int]$rs.Fields.Item("DATA_TYPE").Value
        Ord  = [int]$rs.Fields.Item("ORDINAL_POSITION").Value
      }
    }
    $rs.MoveNext()
  }
  $rs.Close()
} catch { Out2 ("Could not read the columns: " + $_.Exception.Message) "Red"; Finish 1 }

Out2 ("{0} tables, columns read for all of them." -f $tables.Count)

# ---------------------------------------------------------------------
#  1. WHICH TABLES LOOK LIKE A DAILY RECORD
# ---------------------------------------------------------------------
Out2
Out2 "1. TABLES THAT LOOK LIKE A DAILY RECORD" "Cyan"
Out2 "   Judged by shape, not by name: a date column, and roughly one row"
Out2 "   per day over a long stretch. Named like a log counts too, as a"
Out2 "   second opinion."
Out2

$cands = @()
foreach ($t in ($tables | Sort-Object)) {
  $cols  = $colsOf[$t]
  if (-not $cols) { continue }
  $dates = @($cols | Where-Object { $DATE_TYPES -contains $_.Type -and $_.Name -notmatch $HIDE })
  $named = $t -match '(?i)(daily|day|hist|audit|log|track|change|snap|stat|count|metric|kpi|dash|trend|total)'
  if ($dates.Count -eq 0 -and -not $named) { continue }

  $n = One "select count(*) from [$t]"
  if ($null -eq $n) { continue }

  $best = $null
  foreach ($d in $dates) {
    $days = One "select count(*) from (select distinct Int([$($d.Name)]) as x
                     from [$t] where [$($d.Name)] is not null) as d"
    if ($null -eq $days -or $days -lt 2) { continue }
    $lo = One "select min([$($d.Name)]) from [$t]"
    $hi = One "select max([$($d.Name)]) from [$t]"
    $span = 0
    try { $span = [int]([datetime]$hi - [datetime]$lo).TotalDays + 1 } catch { $span = 0 }
    # how much of the stretch between the first and last day has a row
    $fill = if ($span -gt 0) { [math]::Round(100.0 * $days / $span) } else { 0 }
    # worked out before the object rather than inside it: a branch sitting
    # in a hashtable literal is the kind of thing that parses on one
    # version of PowerShell and not the next
    $perDay = 0
    if ($days -gt 0) { $perDay = [math]::Round([double]$n / $days, 1) }
    $cand = [pscustomobject]@{
      Table = $t; Column = $d.Name; Rows = $n; Days = $days;
      Lo = (AsDay $lo); Hi = (AsDay $hi); Span = $span; Fill = $fill;
      PerDay = $perDay; Named = $named
    }
    if ($null -eq $best -or $cand.Days -gt $best.Days) { $best = $cand }
  }
  if ($best) { $cands += $best }
  elseif ($named -and $n -gt 0) {
    $cands += [pscustomobject]@{ Table = $t; Column = "(no usable date column)"; Rows = $n;
      Days = 0; Lo = "none"; Hi = "none"; Span = 0; Fill = 0; PerDay = 0; Named = $true }
  }
}

if ($cands.Count -eq 0) {
  Out2 "   Nothing has a date column with more than one day in it." "DarkYellow"
} else {
  Out2 ("   {0,-28} {1,-22} {2,8} {3,7} {4,6} {5,7} {6,11} {7,11}" -f
        "table", "date column", "rows", "days", "per day", "covered", "first", "last")
  foreach ($c in ($cands | Sort-Object -Property @{Expression={$_.Days}; Descending=$true})) {
    Out2 ("   {0,-28} {1,-22} {2,8} {3,7} {4,6} {5,6}% {6,11} {7,11}" -f
          $c.Table, $c.Column, $c.Rows, $c.Days, $c.PerDay, $c.Fill, $c.Lo, $c.Hi)
  }
  Out2
  Out2 "   per day near 1 and covered near 100 means one row for every day,"
  Out2 "   which is a daily record. A bigger per day means several rows a"
  Out2 "   day, which is a daily record of several figures and is just as"
  Out2 "   good. A low covered means it only writes on days something"
  Out2 "   happened, which matters: a missing day is not a nought."
}

# ---------------------------------------------------------------------
#  2. THE BEST FEW, IN DETAIL
# ---------------------------------------------------------------------
Out2
Out2 "2. WHAT IS ACTUALLY IN THE LIKELIEST ONES" "Cyan"
Out2 "   Columns, then the last fourteen days as they are stored. This is"
Out2 "   what tells me which column is which figure."
Out2

$top = @($cands | Where-Object { $_.Days -ge 10 } |
         Sort-Object -Property @{Expression={$_.Days}; Descending=$true} | Select-Object -First 6)
if ($top.Count -eq 0) { $top = @($cands | Sort-Object -Property @{Expression={$_.Rows}; Descending=$true} | Select-Object -First 3) }

foreach ($c in $top) {
  Out2
  Out2 ("   ---- {0} ----" -f $c.Table) "Green"
  $cols = $colsOf[$c.Table] | Sort-Object Ord
  $show = @()
  foreach ($col in $cols) {
    $kind = if ($DATE_TYPES -contains $col.Type) { "date" }
            elseif ($NUM_TYPES -contains $col.Type) { "number" }
            else { "text or other" }
    $hidden = $col.Name -match $HIDE
    Out2 ("        {0,-30} {1}{2}" -f $col.Name, $kind, $(if ($hidden) { ", not printed" } else { "" }))
    # only dates and numbers are ever printed, and never a hidden name
    if (-not $hidden -and ($DATE_TYPES -contains $col.Type -or $NUM_TYPES -contains $col.Type)) {
      $show += $col.Name
    }
  }
  if ($c.Column -eq "(no usable date column)" -or $show.Count -eq 0) { continue }

  # the last fortnight, straight out of the table
  $since = Acc ((Get-Date).Date.AddDays(-14))
  $pick  = ($show | Select-Object -First 12 | ForEach-Object { "[$_]" }) -join ", "
  Out2
  Out2 ("        the last fourteen days, by {0}:" -f $c.Column)
  Out2 ("        " + (($show | Select-Object -First 12) -join " | "))
  $rs = $null
  try {
    $rs = $cn.Execute("select $pick from [$($c.Table)] where [$($c.Column)] >= $since order by [$($c.Column)] desc")
    $n = 0
    while (-not $rs.EOF -and $n -lt 40) {
      $vals = @()
      for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
        $v = $rs.Fields.Item($i).Value
        if ($null -eq $v -or $v -is [System.DBNull]) { $vals += "." }
        elseif ($v -is [datetime]) { $vals += $v.ToString("yyyy-MM-dd") }
        else { $vals += "$v" }
      }
      Out2 ("        " + ($vals -join " | "))
      $rs.MoveNext(); $n++
    }
    if ($n -eq 0) { Out2 "        nothing in the last fortnight" "DarkYellow" }
  } catch {
    Out2 ("        could not be read: " + $_.Exception.Message) "DarkYellow"
  } finally { if ($rs) { try { $rs.Close() } catch { } } }
}

# ---------------------------------------------------------------------
#  3. TODAY'S TWO FIGURES, TO CHECK ANY OF IT AGAINST
# ---------------------------------------------------------------------
Out2
Out2 "3. WHAT THE TWO READINGS ARE RIGHT NOW" "Cyan"
Out2 "   So whichever column turns out to be which, there is a number to"
Out2 "   check it against. Your screen says 39 for the measurements."
Out2
Out2 ("      estimates at status 1, Initial Visit Booked:   {0}" -f (One "select count(*) from Estimates where EstimateStatusID = 1"))
Out2 ("      estimates at status 4, Showroom Booked:        {0}" -f (One "select count(*) from Estimates where EstimateStatusID = 4"))

# ---------------------------------------------------------------------
#  4. EVERY TABLE, SO I CAN SEE WHAT ELSE IS HERE
# ---------------------------------------------------------------------
Out2
Out2 "4. EVERY TABLE IN THE DATABASE" "Cyan"
Out2 "   names and row counts only"
Out2
foreach ($t in ($tables | Sort-Object)) {
  Out2 ("      {0,-40} {1,10}" -f $t, (One "select count(*) from [$t]"))
}

$cn.Close()
Out2
Out2 "Done. Nothing was changed and nothing was sent." "Green"
Finish 0
