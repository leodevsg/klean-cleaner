[CmdletBinding()]
param(
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Continue'
$logFile = "$PSScriptRoot\cleanup-tier1-admin.log"
Start-Transcript -Path $logFile -Append | Out-Null

function Write-Step($msg) {
    Write-Host ""
    Write-Host "===== $msg =====" -ForegroundColor Cyan
}

function Get-DriveFree {
    $d = Get-PSDrive C
    return [math]::Round($d.Free/1GB, 2)
}

# Stop a service hard: try sc.exe stop (no wait), then taskkill /F on its PID if still up.
function Stop-ServiceHard($name, $timeoutSec = 15) {
    Write-Host "Stopping service: $name"
    & sc.exe stop $name | Out-Null
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
        $svc = Get-Service $name -ErrorAction SilentlyContinue
        if (-not $svc -or $svc.Status -eq 'Stopped') {
            Write-Host "  -> stopped cleanly"
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    # Force kill the underlying process
    try {
        $svcPid = (Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction Stop).ProcessId
        if ($svcPid -and $svcPid -gt 0) {
            Write-Host "  -> graceful stop timed out; force killing PID $svcPid"
            & taskkill.exe /F /PID $svcPid | Out-Null
            Start-Sleep -Seconds 1
            return $true
        }
    } catch {
        Write-Host "  -> could not resolve PID: $_" -ForegroundColor Yellow
    }
    return $false
}

# Verify elevation
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: Script must run as Administrator." -ForegroundColor Red
    Stop-Transcript | Out-Null
    if (-not $NonInteractive) {
        Read-Host "Press Enter to exit"
    }
    exit 1
}

$startFree = Get-DriveFree
Write-Host "C: free at start: $startFree GB"

# 1. Windows Update cache
Write-Step "Clearing Windows Update download cache"
$swPath = 'C:\Windows\SoftwareDistribution\Download'
if (Test-Path $swPath) {
    $beforeSize = (Get-ChildItem -LiteralPath $swPath -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum
    Write-Host "Cache size before: $([math]::Round($beforeSize/1MB,1)) MB"

    Stop-ServiceHard 'wuauserv' 15 | Out-Null

    $deleted = 0
    Get-ChildItem -LiteralPath $swPath -Force -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
            $deleted++
        } catch {}
    }
    Write-Host "Deleted $deleted top-level items"

    try { Start-Service wuauserv -ErrorAction Stop; Write-Host "wuauserv restarted" } catch { Write-Host "Could not restart wuauserv: $_" -ForegroundColor Yellow }
} else {
    Write-Host "Path not found, skipping"
}
Write-Host "Free now: $(Get-DriveFree) GB"

# 2. Windows Temp
Write-Step "Clearing C:\Windows\Temp"
$winTemp = 'C:\Windows\Temp'
if (Test-Path $winTemp) {
    $beforeSize = (Get-ChildItem -LiteralPath $winTemp -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum
    Write-Host "Size before: $([math]::Round($beforeSize/1MB,1)) MB"
    $errors = 0
    Get-ChildItem -LiteralPath $winTemp -Force -ErrorAction SilentlyContinue | ForEach-Object {
        try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop } catch { $errors++ }
    }
    Write-Host "Items locked/skipped: $errors (normal for in-use files)"
}
Write-Host "Free now: $(Get-DriveFree) GB"

# 3. Delivery Optimization cache
Write-Step "Clearing Delivery Optimization cache"
$doCache = 'C:\Windows\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache'
if (Test-Path $doCache) {
    $beforeSize = (Get-ChildItem -LiteralPath $doCache -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum
    Write-Host "DO cache size: $([math]::Round($beforeSize/1MB,1)) MB"
    Stop-ServiceHard 'DoSvc' 10 | Out-Null
    Get-ChildItem -LiteralPath $doCache -Force -ErrorAction SilentlyContinue | ForEach-Object {
        try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop } catch {}
    }
    try { Start-Service DoSvc -ErrorAction Stop } catch {}
} else {
    Write-Host "(no DO cache folder)"
}
Write-Host "Free now: $(Get-DriveFree) GB"

# 4. DISM analyze then component cleanup + ResetBase
Write-Step "DISM analyze component store (preview)"
& dism.exe /online /cleanup-image /analyzecomponentstore
Write-Host ""
Write-Step "DISM cleanup + ResetBase (5-15 min)"
Write-Host "WARNING: After ResetBase, installed Windows Updates cannot be uninstalled." -ForegroundColor Yellow
& dism.exe /online /cleanup-image /startcomponentcleanup /resetbase
Write-Host "Free now: $(Get-DriveFree) GB"

# 5. Empty Recycle Bin
Write-Step "Emptying Recycle Bin"
try {
    Clear-RecycleBin -Force -ErrorAction Stop
    Write-Host "Recycle Bin emptied."
} catch {
    Write-Host "Skip: $_"
}
Write-Host "Free now: $(Get-DriveFree) GB"

$endFree = Get-DriveFree
$freed = [math]::Round($endFree - $startFree, 2)
Write-Host ""
Write-Host "===== SUMMARY =====" -ForegroundColor Green
Write-Host "Free before: $startFree GB"
Write-Host "Free after : $endFree GB"
Write-Host "FREED      : $freed GB"

Stop-Transcript | Out-Null
Write-Host ""
if (-not $NonInteractive) {
    Read-Host "Press Enter to close"
}
