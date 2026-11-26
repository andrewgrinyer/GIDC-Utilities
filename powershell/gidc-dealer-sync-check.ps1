# =====================================================================
#  GIDC  ·  why are dealer statuses not moving?
#
#  Read only. Changes nothing, sends nothing, prints no names, no
#  addresses and not the key. Run it on SVR-GDDC and paste back what it
#  says:
#
#      powershell -ExecutionPolicy Bypass -File "C:\GIDC\gidc-dealer-sync-check.ps1"
# =====================================================================

param([string] $LogDir = "C:\GIDC\logs", [string] $Folder = "C:\GIDC")

function Say($msg, $colour = "Gray") { Write-Host $msg -ForegroundColor $colour }

Say "1. Is the sync script where the task would look?" "Cyan"
$s = Join-Path $Folder "gidc-dealer-sync.ps1"
if (Test-Path -LiteralPath $s) { Say ("   yes, {0}, changed {1}" -f $s, (Get-Item $s).LastWriteTime) }
else { Say ("   NO, nothing at {0}" -f $s) "Red" }

Say "2. Is there a scheduled task that runs it?" "Cyan"
$tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
  ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -match "dealer-sync" })
if (-not $tasks.Count) { Say "   NO. Nothing on this machine runs gidc-dealer-sync.ps1. That alone explains it." "Red" }
foreach ($t in $tasks) {
  $i = $t | Get-ScheduledTaskInfo
  Say ("   {0}  state {1}  last run {2}  result {3}  next {4}" -f $t.TaskName, $t.State, $i.LastRunTime, $i.LastTaskResult, $i.NextRunTime)
  Say ("   runs as {0}" -f $t.Principal.UserId)
}

Say "3. Is the key set where a scheduled task can see it?" "Cyan"
$m = [Environment]::GetEnvironmentVariable("GIDC_KPI_KEY", "Machine")
$u = [Environment]::GetEnvironmentVariable("GIDC_KPI_KEY", "User")
Say ("   machine: {0}   this user only: {1}" -f $(if ($m) { "set, $($m.Length) characters" } else { "NOT SET" }),
                                               $(if ($u) { "set" } else { "not set" }))

Say "4. The last ten lines of the sync's own log" "Cyan"
$log = Join-Path $LogDir "dealer-sync.log"
if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 10 | ForEach-Object { Say "   $_" } }
else { Say "   no log at all, so it has never finished a run that sent anything" "Yellow" }

Say ""
Say "Paste all of this back. Nothing was changed." "Green"
