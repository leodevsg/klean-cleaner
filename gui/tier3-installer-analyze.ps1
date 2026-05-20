[CmdletBinding()]
param(
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Continue'
$logFile = "$PSScriptRoot\tier3-analyze.log"
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

Write-Host "Building set of MSI/MSP files referenced by installed products & patches..." -ForegroundColor Cyan

# Collect LocalPackage paths from per-user UserData hive
$needed = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)

$userDataRoot = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Installer\UserData'
if (Test-Path $userDataRoot) {
    Get-ChildItem $userDataRoot -ErrorAction SilentlyContinue | ForEach-Object {
        $sid = $_

        # Products -> InstallProperties.LocalPackage points to the cached .msi
        $productsKey = Join-Path $sid.PSPath 'Products'
        if (Test-Path $productsKey) {
            Get-ChildItem $productsKey -ErrorAction SilentlyContinue | ForEach-Object {
                $ipKey = Join-Path $_.PSPath 'InstallProperties'
                if (Test-Path $ipKey) {
                    $lp = (Get-ItemProperty $ipKey -Name LocalPackage -ErrorAction SilentlyContinue).LocalPackage
                    if ($lp) { [void]$needed.Add([IO.Path]::GetFileName($lp)) }
                }
            }
        }

        # Patches -> .LocalPackage points to the cached .msp
        $patchesKey = Join-Path $sid.PSPath 'Patches'
        if (Test-Path $patchesKey) {
            Get-ChildItem $patchesKey -ErrorAction SilentlyContinue | ForEach-Object {
                $lp = (Get-ItemProperty $_.PSPath -Name LocalPackage -ErrorAction SilentlyContinue).LocalPackage
                if ($lp) { [void]$needed.Add([IO.Path]::GetFileName($lp)) }
            }
        }
    }
}

Write-Host "Referenced packages: $($needed.Count) files"
Write-Host ""

# Now enumerate actual files in C:\Windows\Installer
$installerPath = 'C:\Windows\Installer'
Write-Host "Scanning $installerPath ..." -ForegroundColor Cyan
$allFiles = Get-ChildItem -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue -File |
    Where-Object { $_.Extension -in '.msi','.msp' }

$totalCount = $allFiles.Count
$totalBytes = ($allFiles | Measure-Object Length -Sum).Sum

$orphans = $allFiles | Where-Object { -not $needed.Contains($_.Name) }
$orphanCount = $orphans.Count
$orphanBytes = ($orphans | Measure-Object Length -Sum).Sum

$keptCount = $totalCount - $orphanCount
$keptBytes = $totalBytes - $orphanBytes

Write-Host ""
Write-Host "=========================== ANALYSIS ===========================" -ForegroundColor Green
Write-Host ("All MSI/MSP files     : {0,5}  ({1,8:N2} GB)" -f $totalCount, ($totalBytes/1GB))
Write-Host ("  In-use (KEEP)       : {0,5}  ({1,8:N2} GB)" -f $keptCount, ($keptBytes/1GB))
Write-Host ("  Orphan (RECLAIMABLE): {0,5}  ({1,8:N2} GB)" -f $orphanCount, ($orphanBytes/1GB)) -ForegroundColor Yellow
Write-Host "================================================================"
Write-Host ""

# Save orphan list for the move script
$orphanList = "$PSScriptRoot\tier3-orphans.txt"
$orphans | Sort-Object Length -Descending | ForEach-Object {
    "{0}`t{1}" -f $_.FullName, $_.Length
} | Set-Content -Path $orphanList -Encoding UTF8
Write-Host "Orphan list saved to: $orphanList"

# Show top 20 biggest orphans
Write-Host ""
Write-Host "Top 20 biggest orphan files:" -ForegroundColor Cyan
$orphans | Sort-Object Length -Descending | Select-Object -First 20 |
    Select-Object Name, @{N='MB';E={[math]::Round($_.Length/1MB,1)}}, LastWriteTime |
    Format-Table -AutoSize

Stop-Transcript | Out-Null
Write-Host ""
if (-not $NonInteractive) {
    Read-Host "Press Enter to close"
}
