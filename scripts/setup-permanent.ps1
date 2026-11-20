param(
    [switch]$Relaunch
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallScript = Join-Path $ScriptDir 'install-win.ps1'

Write-Host "=== [1/3] Enabling Windows Startup Daemon ===" -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File $InstallScript

Write-Host "`n=== [2/3] Adding --remote-debugging-port=0 to Antigravity Shortcuts ===" -ForegroundColor Cyan
$WshShell = New-Object -ComObject WScript.Shell
$SearchDirs = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('CommonDesktopDirectory'),
    [Environment]::GetFolderPath('StartMenu'),
    [Environment]::GetFolderPath('CommonStartMenu'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

$PatchedCount = 0
$FoundExe = $null

foreach ($dir in $SearchDirs) {
    $shortcuts = Get-ChildItem -Path $dir -Filter '*Antigravity*.lnk' -Recurse -ErrorAction SilentlyContinue
    foreach ($lnk in $shortcuts) {
        if ($lnk.Name -eq 'AntigravityCustomTheme.lnk') { continue }
        try {
            $sc = $WshShell.CreateShortcut($lnk.FullName)
            if ($sc.TargetPath -and $sc.TargetPath -match 'Antigravity\.exe$') {
                if (-not $FoundExe -and (Test-Path $sc.TargetPath)) {
                    $FoundExe = $sc.TargetPath
                }
                $argsStr = [string]$sc.Arguments
                if ($argsStr -notmatch '--remote-debugging-port') {
                    $sc.Arguments = ($argsStr.Trim() + ' --remote-debugging-port=0').Trim()
                    $sc.Save()
                    $PatchedCount++
                    Write-Host "  [+] Updated shortcut: $($lnk.FullName)" -ForegroundColor Green
                } else {
                    Write-Host "  [=] Already configured: $($lnk.FullName)" -ForegroundColor DarkGray
                }
            }
        } catch {
            Write-Warning "  [!] Could not update $($lnk.FullName): $($_.Exception.Message)"
        }
    }
}

if (-not $FoundExe) {
    $DefaultExe = Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'
    if (Test-Path $DefaultExe) { $FoundExe = $DefaultExe }
}

Write-Host "`n=== [3/3] Checking Active CDP Connection ===" -ForegroundColor Cyan
$PortCandidates = @(
    (Join-Path $env:APPDATA 'Antigravity\DevToolsActivePort'),
    (Join-Path $env:APPDATA 'antigravity\DevToolsActivePort'),
    (Join-Path $env:LOCALAPPDATA 'Antigravity\DevToolsActivePort')
)
$ActivePortFile = $PortCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($Relaunch -and $FoundExe) {
    Write-Host "  [*] Restarting Antigravity with --remote-debugging-port=0..." -ForegroundColor Yellow
    Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-Process -FilePath $FoundExe -ArgumentList '--remote-debugging-port=0'
    Write-Host "  [+] Antigravity relaunched! Custom theme will load automatically." -ForegroundColor Green
} elseif (-not $ActivePortFile) {
    Write-Host "  [!] Antigravity was opened without --remote-debugging-port=0." -ForegroundColor Yellow
    Write-Host "      Close Antigravity completely and reopen it from your Desktop / Taskbar / Start Menu icon!" -ForegroundColor Yellow
} else {
    Write-Host "  [+] DevToolsActivePort detected ($ActivePortFile). Theme is active!" -ForegroundColor Green
}

Write-Host "`nDone! Custom theme will now persist automatically across PC reboots." -ForegroundColor Cyan
