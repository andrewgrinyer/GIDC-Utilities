# =====================================================================
#  GIDC  ·  what CallRail says, beside what Access says
#
#  Before first time callers come from CallRail instead of being keyed
#  into AdCampaignCalls by hand, the two figures need setting side by
#  side. If they disagree, the leads line steps up or down on the day we
#  switch, and we should know that now rather than wonder about it in
#  November.
#
#  It reads only. It changes nothing, writes nothing to the dashboard,
#  and never prints your API key or a customer's phone number.
#
#  BEFORE YOU RUN IT
#    1. In CallRail: your name, top right, then Account, then
#       Integrations, then API Keys. Create one.
#    2. Put it on this machine, once, in an elevated PowerShell:
#
#         [Environment]::SetEnvironmentVariable(
#           'GIDC_CALLRAIL_KEY', 'the-key-callrail-gave-you', 'Machine')
#
#       Then close that window and open a new one, or it will not see it.
#       Do not paste the key into an email or a chat, including to me.
#
#  HOW TO RUN IT
#        .\gidc-callrail-check.ps1
#
#  It writes gidc-callrail-result.txt beside itself. Send me that.
# =====================================================================

param(
  [string] $Key      = $env:GIDC_CALLRAIL_KEY,
  [string] $Account  = $env:GIDC_CALLRAIL_ACCOUNT,   # optional, it finds it
  [string] $Database = "\\SVR-GDDC\GIDC Database\Grinyer_be.accdb",
  [int]    $Days     = 120,
  [string] $OutFile  = "",
  [switch] $NoPause
)

$ErrorActionPreference = "Stop"

# Windows Server still offers an older handshake first and CallRail will
# not take it. Saying so here saves a confusing "unable to connect".
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

if (-not $OutFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $OutFile = Join-Path $here "gidc-callrail-result.txt"
}

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
    Write-Host "Send me that file. It has no key in it." -ForegroundColor Cyan
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

Out2 ("GIDC, CallRail beside Access, {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) "Cyan"
Out2

if (-not $Key) {
  Out2 "No CallRail key on this machine." "Red"
  Out2 "Set GIDC_CALLRAIL_KEY as above, open a new window, and run this again."
  Finish 1
}

# The key goes in a header and nowhere else. Nothing below ever prints
# $Key, and the saved file is built only from the lines above.
$headers = @{ "Authorization" = ('Token token="' + $Key + '"') }

function Ask($path, $what) {
  $uri = "https://api.callrail.com/v3/$path"
  try {
    return Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 60
  } catch {
    $said = $_.Exception.Message
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $said = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
    } catch { }
    # A 401 here means the key, so say that rather than the raw text.
    if ("$said" -match '401|[Uu]nauthor') {
      Out2 ("Could not " + $what + ": CallRail refused the key.") "Red"
      Out2 "   Check it was copied whole, and that it has not been revoked."
    } else {
      Out2 ("Could not " + $what + ": " + $said) "Red"
    }
    return $null
  }
}

# =====================================================================
# 1. WHICH ACCOUNT
# =====================================================================
Out2 "1. THE ACCOUNT" "Cyan"
if (-not $Account) {
  $acc = Ask "a.json" "list the accounts"
  if (-not $acc) { Finish 1 }
  foreach ($a in $acc.accounts) {
    Out2 ("      {0}   {1}" -f $a.id, $a.name) "Green"
  }
  if ($acc.accounts.Count -eq 1) {
    $Account = $acc.accounts[0].id
    Out2 ("   Using that one.")
  } else {
    $Account = $acc.accounts[0].id
    Out2 ("   More than one. Using the first. Tell me if that is the wrong one.") "Yellow"
  }
} else {
  Out2 ("      using the account you passed in: {0}" -f $Account)
}

# =====================================================================
# 2. WHICH COMPANIES AND NUMBERS ARE ON IT
# =====================================================================
# If the showrooms are separate companies in CallRail, the total across
# the account may not be the number you have in mind.
Out2
Out2 "2. THE COMPANIES ON THAT ACCOUNT" "Cyan"
$co = Ask "a/$Account/companies.json?per_page=250" "list the companies"
if ($co) {
  Out2 ("      {0,-38} {1}" -f "company", "status")
  foreach ($c in $co.companies) {
    Out2 ("      {0,-38} {1}" -f $c.name, $c.status)
  }
  Out2 ("   {0} in total." -f $co.total_records)
}

# =====================================================================
# 3. FIRST TIME CALLERS, DAY BY DAY
# =====================================================================
$to   = (Get-Date).Date
$from = $to.AddDays(-1 * $Days)
$f    = $from.ToString("yyyy-MM-dd")
$t    = $to.ToString("yyyy-MM-dd")

Out2
Out2 ("3. FIRST TIME CALLERS FROM CALLRAIL, {0} to {1}" -f $f, $t) "Cyan"
Out2 "   This is the figure that would feed the dashboard."

$series = Ask ("a/$Account/calls/timeseries.json?start_date=$f&end_date=$t" +
               "&fields=first_time_callers,total_calls&time_zone=America/Toronto") `
              "read the daily figures"

$byMonth = @{}
if ($series) {
  Out2
  Out2 "   the last 21 days, one line each:"
  Out2 ("      {0,-12} {1,10} {2,12}" -f "day", "first time", "all calls")
  $rows = @($series.data)
  $tail = if ($rows.Count -gt 21) { $rows[($rows.Count - 21)..($rows.Count - 1)] } else { $rows }
  foreach ($d in $tail) {
    Out2 ("      {0,-12} {1,10} {2,12}" -f $d.date, $d.first_time_callers, $d.total_calls)
  }
  foreach ($d in $rows) {
    $m = "$($d.date)".Substring(0, 7)
    if (-not $byMonth.ContainsKey($m)) { $byMonth[$m] = 0 }
    $byMonth[$m] = $byMonth[$m] + [int]$d.first_time_callers
  }
  Out2
  Out2 ("   and the whole stretch: {0} first time callers, {1} calls." -f
        $series.total_results.first_time_callers, $series.total_results.total_calls) "Green"
}

# =====================================================================
# 4. WHAT ACCESS HAS BEEN SAYING FOR THE SAME MONTHS
# =====================================================================
# AdCampaignCalls.CountFirstTimeCallers is what the dashboard uses today.
# If it was keyed in from a CallRail report, the two columns below should
# be close. Where they are not, the switch will show as a step.
Out2
Out2 "4. THE SAME MONTHS, CALLRAIL BESIDE ACCESS" "Cyan"

$fromStamp = "#" + $from.ToString("MM/dd/yyyy") + "#"
$accessByMonth = @{}
$opened = $false
if (Test-Path -LiteralPath $Database) {
  $cn = New-Object -ComObject ADODB.Connection
  foreach ($ver in @("16.0", "12.0")) {
    try {
      $cn.Open("Provider=Microsoft.ACE.OLEDB.$ver;Data Source=$Database;Mode=Read")
      $opened = $true
      break
    } catch { }
  }
  if ($opened) {
    try {
      $rs = $cn.Execute(
        "select Format(AdCampaignCallDate,'yyyy-mm') as m,
                sum(CountFirstTimeCallers) as v
           from AdCampaignCalls
          where AdCampaignCallDate >= $fromStamp
          group by Format(AdCampaignCallDate,'yyyy-mm')")
      while (-not $rs.EOF) {
        $v = $rs.Fields.Item(1).Value
        if ($null -eq $v -or $v -is [System.DBNull]) { $v = 0 }
        $accessByMonth["$($rs.Fields.Item(0).Value)"] = [int]$v
        $rs.MoveNext()
      }
      $rs.Close()
    } catch {
      Out2 ("      could not read AdCampaignCalls: " + $_.Exception.Message) "Yellow"
    }
    $cn.Close()
  } else {
    Out2 "      could not open the database, so this is CallRail only." "Yellow"
  }
} else {
  Out2 "      cannot see the database at that path, so this is CallRail only." "Yellow"
}

$months = @($byMonth.Keys + $accessByMonth.Keys | Sort-Object -Unique)
if ($months.Count) {
  Out2 ("      {0,-10} {1,10} {2,10} {3,12}" -f "month", "CallRail", "Access", "difference")
  foreach ($m in $months) {
    $a = if ($byMonth.ContainsKey($m))       { $byMonth[$m] }       else { 0 }
    $b = if ($accessByMonth.ContainsKey($m)) { $accessByMonth[$m] } else { 0 }
    $gap = $a - $b
    $colour = if ([Math]::Abs($gap) -le [Math]::Max(3, $b * 0.1)) { "Green" } else { "Yellow" }
    Out2 ("      {0,-10} {1,10} {2,10} {3,12}" -f $m, $a, $b, $gap) $colour
  }
  Out2
  Out2 "   Green means the two agree closely enough that switching will not"
  Out2 "   show as a step. Yellow means they do not, and it is worth knowing"
  Out2 "   why before we switch. A part month at either end is expected to"
  Out2 "   differ and is not a problem."
}

Out2
Out2 "Done. Nothing was changed and nothing was sent anywhere." "Green"
Finish 0
