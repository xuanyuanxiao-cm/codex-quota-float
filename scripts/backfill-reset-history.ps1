param([string]$Output = (Join-Path $PSScriptRoot '../dist/reset-history-seed.json'))
$ErrorActionPreference = 'Stop'
$start = [datetimeoffset]'2026-06-28T00:00:00Z'
$end = [datetimeoffset]'2026-09-28T23:59:59Z'
$lab = 'https://raw.githubusercontent.com/CRF2004/tibo-reset-lab/main'
$observatory = 'https://raw.githubusercontent.com/gussuri/codex-reset-observatory/main/data/resetHistory.ts'
$announcements = (Invoke-WebRequest "$lab/data/processed/reset_announcements.csv").Content | ConvertFrom-Csv
$sources = (Invoke-WebRequest "$lab/data/raw/sources.csv").Content | ConvertFrom-Csv
$records = @{}
foreach ($row in $announcements) {
    $source = $sources | Where-Object source_id -eq $row.source_id | Select-Object -First 1
    if (!$source -or $source.url -notmatch '^https://x\.com/thsottiaux/status/(\d{10,25})$') { continue }
    $id = $Matches[1]
    $at = [datetimeoffset]$row.announced_at_utc
    if ($at -lt $start -or $at -gt $end) { continue }
    $records[$id] = @{
        id=$id; url=$source.url; publishedAt=$at.ToUnixTimeMilliseconds(); text=$source.raw_text
        kind=$(if ($row.reset_type -match 'banked') { 'banked' } else { 'reset' })
        stage=$(if ($row.announcement_status -eq 'claimed_done') { 'completed' } else { 'announced' })
        eventId=$row.announcement_id; outcomeScope=$(if ($row.reset_type -eq 'hard_global') { 'broad' } else { 'unknown' })
        scope=$row.explicit_scope; archiveSource='Tibo Reset Lab · 社区历史存档'
        archiveUrl="$lab/data/processed/reset_announcements.csv"
    }
}
$raw = (Invoke-WebRequest $observatory).Content
$json = [regex]::Match($raw, 'LOCAL_RESET_HISTORY[^=]*=\s*(\[[\s\S]*?\n\]);').Groups[1].Value
if (!$json) { throw 'Upstream history format changed' }
$rows = $json | ConvertFrom-Json
foreach ($row in $rows) {
    if ($row.recordKind -notin @('confirmed_global','banked_distribution') -or $row.source_url -notmatch '^https://x\.com/thsottiaux/status/(\d{10,25})$') { continue }
    $id = $Matches[1]
    $at = [datetimeoffset]$(if ($row.completed_at) { $row.completed_at } else { $row.opened_at })
    if ($at -lt $start -or $at -gt $end) { continue }
    # Archive timestamps describe events, not necessarily the post's publication time.
    $records[$id] = @{
        id=$id; url=$row.source_url; publishedAt=$at.ToUnixTimeMilliseconds(); timestampBasis='archive-event'; communityCompletedAt=$at.ToUnixTimeMilliseconds()
        text=$(if ($row.summary -is [string]) { $row.summary } else { $row.summary.en })
        kind=$(if ($row.recordKind -eq 'banked_distribution') { 'banked' } else { 'reset' }); stage='completed'
        eventId=$row.id; outcomeScope=$(if ($row.recordKind -eq 'confirmed_global') { 'broad' } else { 'unknown' })
        scope=$row.scope; archiveSource='Codex Reset Observatory · 社区历史存档'; archiveUrl=$observatory
    }
}
$seed = @{ version=1; collectedAt=[datetimeoffset]::UtcNow.ToString('o'); requestedFrom=$start.ToString('o'); requestedTo=$end.ToString('o'); records=@($records.Values | Sort-Object publishedAt) }
$seed | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Output -Encoding utf8
Write-Output "Archived $($records.Count) source-linked records; coverage remains incomplete."
