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
    
    # Detailed hardware properties
    $cpuProc = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    $cpuName = if ($cpuProc) { $cpuProc.Name } else { "Unknown Processor" }
    $cpuCores = if ($cpuProc) { $cpuProc.NumberOfCores } else { 0 }
    $cpuThreads = if ($cpuProc) { $cpuProc.NumberOfLogicalProcessors } else { 0 }
    $cpuSpeed = if ($cpuProc) { [math]::Round($cpuProc.MaxClockSpeed / 1000, 2) } else { 0 }
    
    $ramSpeed = 0
    try {
        $mem = Get-CimInstance Win32_PhysicalMemory -ErrorAction SilentlyContinue | Measure-Object -Property Speed -Maximum
        if ($mem -and $mem.Maximum) { $ramSpeed = $mem.Maximum }
    } catch {}
    
    $gpu = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -First 1
    $gpuName = if ($gpu) { $gpu.Name } else { "N/A" }
    
    $osName = $os.Caption
    $osVersion = $os.Version
    $osBuild = $os.BuildNumber
    $osArch = $os.OSArchitecture
    
    $uptimeStr = "Unknown"
    if ($os -and $os.LastBootUpTime) {
        $diff = (Get-Date) - $os.LastBootUpTime
        $uptimeStr = "$($diff.Days)d $($diff.Hours)h $($diff.Minutes)m"
    }
    
    $ipAddress = "N/A"
    try {
        $ip = Get-NetIPAddress -InterfaceAddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue | 
              Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | 
              Select-Object -First 1
        if ($ip) { $ipAddress = $ip.IPAddress }
    } catch {}
    
    # Drives list
    $drives = @()
    try {
        $driveInstances = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue
        foreach ($d in $driveInstances) {
            $dSize = [math]::Round($d.Size / 1GB, 2)
            $dFree = [math]::Round($d.FreeSpace / 1GB, 2)
            $dUsed = [math]::Round($dSize - $dFree, 2)
            $dPercent = if ($dSize -gt 0) { [math]::Round(($dUsed / $dSize) * 100) } else { 0 }
            $drives += [PSCustomObject]@{
                id = $d.DeviceID
                totalGb = $dSize
                freeGb = $dFree
                usedGb = $dUsed
                percentUsed = $dPercent
            }
        }
    } catch {}
    
    # Top memory processes
    $processes = @()
    try {
        $procList = Get-Process | Sort-Object WorkingSet64 -Descending -ErrorAction SilentlyContinue | Select-Object -First 5
        foreach ($p in $procList) {
            $cpuSec = 0
            try {
                if ($p.CPU) { $cpuSec = [math]::Round($p.CPU, 1) }
            } catch {}
            $processes += [PSCustomObject]@{
                id = $p.Id
                name = $p.Name
                ramMb = [math]::Round($p.WorkingSet64 / 1MB, 1)
                cpuTime = $cpuSec
            }
         }
    } catch {}

    $obj = [PSCustomObject]@{
        cpuPercent = $cpuPercent
        ramTotalGb = $totalRam
        ramUsedGb = $usedRam
        ramPercent = $percentRam
        cpuModel = $cpuName
        cpuCores = $cpuCores
        cpuThreads = $cpuThreads
        cpuSpeed = $cpuSpeed
        ramSpeed = $ramSpeed
        gpuModel = $gpuName
        osName = $osName
        osVersion = $osVersion
        osBuild = $osBuild
        osArch = $osArch
        uptime = $uptimeStr
        ipAddress = $ipAddress
        drives = $drives
        processes = $processes
    }
    return $obj | ConvertTo-Json -Depth 5 -Compress
}

function Kill-ProcessByPID($targetId) {
    try {
        $id = [int]$targetId
        Stop-Process -Id $id -Force -ErrorAction Stop
        Write-Output "SUCCESS: Terminated process with PID $id"
    } catch {
        Write-Output "ERROR: Failed to terminate process with PID $targetId. $_"
    }
}

# Action router
switch ($Action) {
    "GetStartup" { Get-StartupPrograms }
    "ToggleStartup" { Toggle-StartupProgram -targetName $Name -targetHive $Hive -isEnable $Enable }
    "GetSystem" { Get-SystemPerformance }
    "KillProcess" { Kill-ProcessByPID -targetId $Name }
    default { Write-Output "ERROR: Unknown action." }
}
