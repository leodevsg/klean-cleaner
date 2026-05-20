[CmdletBinding()]
param(
    [switch]$NonInteractive,
    [switch]$Force
)

$ErrorActionPreference = 'Continue'
$logFile = "$PSScriptRoot\tier3-move.log"
Start-Transcript -Path $logFile -Append | Out-Null

# Verify elevation
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: must run as Administrator" -ForegroundColor Red
    Stop-Transcript | Out-Null
    if (-not $NonInteractive) {
        Read-Host "Press Enter to exit"
    }
    exit 1
}

$orphanList = "$PSScriptRoot\tier3-orphans.txt"
if (-not (Test-Path $orphanList)) {
    Write-Host "Orphan list not found. Run tier3-installer-analyze.ps1 first." -ForegroundColor Red
    Stop-Transcript | Out-Null
    Read-Host "Press Enter to exit"
    exit 1
}

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$quarantine = "D:\InstallerQuarantine-$stamp"
New-Item -ItemType Directory -Path $quarantine -Force | Out-Null
Write-Host "Quarantine folder: $quarantine" -ForegroundColor Cyan

$entries = Get-Content $orphanList -Encoding UTF8 | Where-Object { $_.Trim() }
Write-Host "Files to move: $($entries.Count)"

$freeBefore = [math]::Round((Get-PSDrive C).Free/1GB, 2)
Write-Host "C: free before: $freeBefore GB"

if (-not $NonInteractive -and -not $Force) {
    $confirm = Read-Host "Type MOVE to proceed (anything else cancels)"
    if ($confirm -ne 'MOVE') {
        Write-Host "Cancelled."
        Stop-Transcript | Out-Null
        Read-Host "Press Enter to exit"
        exit 0
    }
} else {
    Write-Host "Non-interactive / Force mode: proceeding with MOVE."
}

$moved = 0
$failed = 0
$movedBytes = 0L
foreach ($line in $entries) {
    $parts = $line -split "`t"
    $src = $parts[0]
    if (-not (Test-Path -LiteralPath $src)) { continue }
    $dst = Join-Path $quarantine ([IO.Path]::GetFileName($src))
    try {
        $size = (Get-Item -LiteralPath $src).Length
        Move-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop
        $moved++
        $movedBytes += $size
    } catch {
        $failed++
        Write-Host "  FAIL: $src - $_" -ForegroundColor Yellow
    }
}

$freeAfter = [math]::Round((Get-PSDrive C).Free/1GB, 2)
$freed = [math]::Round($freeAfter - $freeBefore, 2)

Write-Host ""
Write-Host "=========================== RESULT ===========================" -ForegroundColor Green
Write-Host "Moved      : $moved files ($([math]::Round($movedBytes/1GB,2)) GB)"
Write-Host "Failed     : $failed files"
Write-Host "C: free was: $freeBefore GB"
Write-Host "C: free now: $freeAfter GB"
Write-Host "FREED      : $freed GB"
Write-Host "=============================================================="
Write-Host ""
Write-Host "Quarantine kept at: $quarantine"
Write-Host "If everything works fine for 7+ days, you can delete that folder permanently."
Write-Host "If something breaks: copy files back to C:\Windows\Installer\ to restore."

Stop-Transcript | Out-Null
Write-Host ""
if (-not $NonInteractive) {
    Read-Host "Press Enter to close"
}
