[CmdletBinding()]
param(
    [string]$Action,
    [string]$Name,
    [string]$Hive,
    [string]$Enable
)

function Get-StartupPrograms {
    $results = @()
    
    function Scan-Key($path, $hive, $status) {
        $localResults = @()
        if (Test-Path $path) {
            try {
                $key = Get-Item -LiteralPath $path -ErrorAction Stop
                foreach ($valName in $key.GetValueNames()) {
                    $val = $key.GetValue($valName)
                    $localResults += [PSCustomObject]@{
                        name = $valName
                        command = $val
                        hive = $hive
                        status = $status
                    }
                }
            } catch {}
        }
        return $localResults
    }
    
    $results += Scan-Key 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' 'HKCU' 'Enabled'
    $results += Scan-Key 'HKCU:\Software\Klean\DisabledStartup' 'HKCU' 'Disabled'
    $results += Scan-Key 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' 'HKLM' 'Enabled'
    $results += Scan-Key 'HKLM:\Software\Klean\DisabledStartup' 'HKLM' 'Disabled'
    
    if ($results.Count -eq 0) {
        return "[]"
    }
    return $results | ConvertTo-Json -Compress
}

function Toggle-StartupProgram($targetName, $targetHive, $isEnable) {
    $runPath = if ($targetHive -eq 'HKCU') { 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' } else { 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' }
    $disPath = if ($targetHive -eq 'HKCU') { 'HKCU:\Software\Klean\DisabledStartup' } else { 'HKLM:\Software\Klean\DisabledStartup' }
    
    if (-not (Test-Path $disPath)) {
        try {
            New-Item -Path $disPath -Force -ErrorAction Stop | Out-Null
        } catch {
            Write-Output "ERROR: Failed to create registry path for disabled items."
            return
        }
    }
    
    if ($isEnable -eq 'true') {
        # Move from DisabledStartup to Run
        try {
            $val = (Get-ItemProperty -Path $disPath -Name $targetName -ErrorAction Stop).$targetName
            Set-ItemProperty -Path $runPath -Name $targetName -Value $val -Force -ErrorAction Stop
            Remove-ItemProperty -Path $disPath -Name $targetName -Force -ErrorAction Stop
            Write-Output "SUCCESS: Enabled $targetName"
        } catch {
            Write-Output "ERROR: Failed to enable $targetName. Make sure you run as administrator."
        }
    } else {
        # Move from Run to DisabledStartup
        try {
            $val = (Get-ItemProperty -Path $runPath -Name $targetName -ErrorAction Stop).$targetName
            Set-ItemProperty -Path $disPath -Name $targetName -Value $val -Force -ErrorAction Stop
            Remove-ItemProperty -Path $runPath -Name $targetName -Force -ErrorAction Stop
            Write-Output "SUCCESS: Disabled $targetName"
        } catch {
            Write-Output "ERROR: Failed to disable $targetName. Make sure you run as administrator."
        }
    }
}

function Get-SystemPerformance {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $totalRam = 0
    $usedRam = 0
    $percentRam = 0
    if ($os) {
        $totalRam = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
        $freeRam = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
        $usedRam = [math]::Round($totalRam - $freeRam, 2)
        $percentRam = [math]::Round(($usedRam / $totalRam) * 100)
    }
    
    $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | 
           Measure-Object -Property LoadPercentage -Average | 
           Select-Object -ExpandProperty Average
    if (-not $cpu) { $cpu = 0 }
    $cpuPercent = [math]::Round($cpu)
    
    $cpuName = (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1).Name
    $osName = $os.Caption
    $osVersion = $os.Version
    
    $obj = [PSCustomObject]@{
        cpuPercent = $cpuPercent
        ramTotalGb = $totalRam
        ramUsedGb = $usedRam
        ramPercent = $percentRam
        cpuModel = $cpuName
        osName = $osName
        osVersion = $osVersion
    }
    return $obj | ConvertTo-Json -Compress
}

# Action router
switch ($Action) {
    "GetStartup" { Get-StartupPrograms }
    "ToggleStartup" { Toggle-StartupProgram -targetName $Name -targetHive $Hive -isEnable $Enable }
    "GetSystem" { Get-SystemPerformance }
    default { Write-Output "ERROR: Unknown action." }
}
