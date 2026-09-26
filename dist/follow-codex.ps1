param([switch]$Probe)
$ErrorActionPreference = 'Stop'

function Get-CodexWindow {
    @(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object {
        $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.Path -match '(?i)(\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\(ChatGPT|Codex)\.exe$|\\(Programs\\Codex|OpenAI\\Codex)\\(app\\)?Codex\.exe$)'
    })
}

if ($Probe) {
    @{ codexOpen = @(Get-CodexWindow).Count -gt 0 } | ConvertTo-Json -Compress
    exit
}

# One watcher per signed-in user, even after upgrades or repeated setting changes.
$watchMutex = [System.Threading.Mutex]::new($false, ('Local\CodexQuotaFloatFollow-' + [Environment]::UserName))
if (-not $watchMutex.WaitOne(0)) { $watchMutex.Dispose(); exit }
$wasOpen = $false
$configPath = Join-Path $PSScriptRoot 'codex-follow.json'
try {
    while (Test-Path -LiteralPath $configPath) {
        try {
            $settings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
            if (-not $settings.enabled) { break }
            if (-not (Test-Path -LiteralPath $settings.executable)) { break }
            $isOpen = @(Get-CodexWindow).Count -gt 0
            if ($isOpen -and -not $wasOpen) {
                $running = @(Get-Process -Name 'Codex Quota Float' -ErrorAction SilentlyContinue)
                if ($running.Count -eq 0) {
                    Start-Process -FilePath $settings.executable -ArgumentList '--follow-codex' -WindowStyle Hidden
                }
            }
            $wasOpen = $isOpen
        }
        catch {
            # A transient process exit or a settings write must not end the watcher.
        }
        Start-Sleep -Seconds 5
    }
}
finally { $watchMutex.ReleaseMutex(); $watchMutex.Dispose() }
