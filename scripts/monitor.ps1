# Live view of the GitHub watcher and its public job data. Reads only; uses your gh login.
# Run: .\scripts\monitor.ps1        Stop with Ctrl+C.
param(
    [int]$RefreshSeconds = 15,
    [switch]$Once
)

$repo = 'Roushan-2104/internship-alerts'
$feedUrl = "https://raw.githubusercontent.com/$repo/main/data/jobs.json"
$ist = [TimeZoneInfo]::FindSystemTimeZoneById('India Standard Time')

function Format-Ist([datetime]$time) {
    [TimeZoneInfo]::ConvertTimeFromUtc($time.ToUniversalTime(), $ist).ToString('dd MMM, hh:mm:ss tt')
}

function Format-Age([datetime]$time) {
    $age = (Get-Date).ToUniversalTime() - $time.ToUniversalTime()
    if ($age.TotalMinutes -lt 1) { return 'just now' }
    if ($age.TotalHours -lt 1) { return ('{0} min ago' -f [int][math]::Floor($age.TotalMinutes)) }
    return ('{0}h {1}m ago' -f [int][math]::Floor($age.TotalHours), $age.Minutes)
}

function Get-RunColor($run) {
    if ($run.status -ne 'completed') { return 'Yellow' }
    if ($run.conclusion -eq 'success') { return 'Green' }
    return 'Red'
}

function Show-Monitor {
    $lines = New-Object System.Collections.ArrayList
    $add = { param($text, $color = 'Gray') [void]$lines.Add(@{ Text = $text; Color = $color }) }

    & $add 'INTERNSHIP ALERTS - LIVE MONITOR' 'White'
    & $add ('Updated {0} IST. Refreshes every {1}s. Ctrl+C to stop.' -f (Format-Ist (Get-Date)), $RefreshSeconds) 'DarkGray'
    & $add ''

    & $add 'WATCHER RUNS (GitHub)' 'White'
    $runs = $null
    try {
        $raw = gh run list --repo $repo --limit 6 --json databaseId,event,status,conclusion,createdAt 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'gh failed' }
        $runs = @($raw | Out-String | ConvertFrom-Json)
    } catch {
        & $add '  Could not reach GitHub. Will retry.' 'Red'
    }

    if ($runs) {
        foreach ($run in $runs) {
            $state = if ($run.status -eq 'completed') { $run.conclusion } else { $run.status }
            $how = if ($run.event -eq 'schedule') { 'GitHub timer' } else { 'started by request' }
            & $add ('  {0}  {1,-14} {2,-19} {3}' -f (Format-Ist ([datetime]$run.createdAt)), $state, $how, (Format-Age ([datetime]$run.createdAt))) (Get-RunColor $run)
        }
        $active = $runs | Where-Object { $_.status -ne 'completed' } | Select-Object -First 1
        if ($active) {
            & $add ''
            & $add 'RUN IN PROGRESS' 'Yellow'
            try {
                $detail = gh run view $active.databaseId --repo $repo --json jobs 2>$null | Out-String | ConvertFrom-Json
                foreach ($step in $detail.jobs[0].steps) {
                    $mark = if ($step.status -ne 'completed') { '...' } elseif ($step.conclusion -eq 'success') { 'ok ' } elseif ($step.conclusion -eq 'skipped') { '-  ' } else { 'X  ' }
                    $color = if ($mark -eq 'X  ') { 'Red' } elseif ($mark -eq '...') { 'Yellow' } else { 'Gray' }
                    & $add ('  {0} {1}' -f $mark, $step.name) $color
                }
            } catch {
                & $add '  Waiting for step details.' 'DarkGray'
            }
        }
    }

    & $add ''
    & $add 'JOB DATA (what Apps Script reads)' 'White'
    try {
        $feed = Invoke-RestMethod -Uri $feedUrl -TimeoutSec 20
        $updated = [datetime]$feed.generatedAt
        $ageMinutes = ((Get-Date).ToUniversalTime() - $updated.ToUniversalTime()).TotalMinutes
        $color = if ($ageMinutes -le 45) { 'Green' } elseif ($ageMinutes -le 120) { 'Yellow' } else { 'Red' }
        & $add ('  Last updated {0} IST ({1})' -f (Format-Ist $updated), (Format-Age $updated)) $color
        foreach ($source in $feed.sources.PSObject.Properties) {
            $sourceState = if ($source.Value.ok) { 'OK    ' } else { 'FAILED' }
            $sourceColor = if ($source.Value.ok) { 'Green' } else { 'Red' }
            & $add ('  {0} {1}: {2} job(s) {3}' -f $sourceState, $source.Name, $source.Value.count, $source.Value.error) $sourceColor
        }
        $open = @($feed.jobs | Where-Object { $_.open })
        & $add ''
        & $add ('OPEN JOBS ({0})' -f $open.Count) 'White'
        foreach ($job in $open) {
            $deadline = if ($job.deadline) { $job.deadline } else { 'no deadline listed' }
            $flag = if ($job.priority) { 'PRIORITY ' } else { '' }
            $jobColor = if ($job.priority) { 'Cyan' } else { 'Gray' }
            & $add ('  {0}{1} | {2}' -f $flag, $job.title, $deadline) $jobColor
        }
    } catch {
        & $add '  Could not read job data. Will retry.' 'Red'
    }

    & $add ''
    & $add 'Students and emails are private, so they only appear on your status page.' 'DarkGray'

    if (-not $Once) { Clear-Host }
    foreach ($line in $lines) { Write-Host $line.Text -ForegroundColor $line.Color }
}

while ($true) {
    Show-Monitor
    if ($Once) { break }
    Start-Sleep -Seconds $RefreshSeconds
}
