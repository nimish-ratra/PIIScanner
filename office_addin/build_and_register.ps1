<#
.SYNOPSIS
    Builds and registers the PII Sentinel Office Add-in for Microsoft Word and Microsoft Excel.

.DESCRIPTION
    1. Compiles PIISentinelAddin.csproj using MSBuild.
    2. Registers the COM assembly with RegAsm.exe /codebase.
    3. Writes Word and Excel Add-in registration keys into HKCU.

.PARAMETER Unregister
    If specified, unregisters the COM assembly and removes Office Add-in registry keys.
#>

param (
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectFile = Join-Path $ScriptDir "PIISentinelAddin.csproj"
$DllPath = Join-Path $ScriptDir "bin\Release\PIISentinel.OfficeAddin.dll"
$RegAsm64 = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe"
$RegAsm32 = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\RegAsm.exe"
$MSBuild = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe"

$WordKey = "HKCU:\Software\Microsoft\Office\Word\Addins\PIISentinel.OfficeAddin"
$ExcelKey = "HKCU:\Software\Microsoft\Office\Excel\Addins\PIISentinel.OfficeAddin"

if ($Unregister) {
    Write-Host "Unregistering PII Sentinel Office Add-in..." -ForegroundColor Yellow

    if (Test-Path $WordKey) { Remove-Item -Path $WordKey -Recurse -Force; Write-Host "Removed Word Add-in registration." }
    if (Test-Path $ExcelKey) { Remove-Item -Path $ExcelKey -Recurse -Force; Write-Host "Removed Excel Add-in registration." }

    if (Test-Path $DllPath) {
        if (Test-Path $RegAsm64) { & $RegAsm64 /unregister $DllPath | Out-Null }
        if (Test-Path $RegAsm32) { & $RegAsm32 /unregister $DllPath | Out-Null }
        Write-Host "COM registration removed." -ForegroundColor Green
    }
    Write-Host "Unregistration complete." -ForegroundColor Green
    exit 0
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Building PII Sentinel Office Add-in (Word & Excel)..." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Compile
& $MSBuild $ProjectFile /p:Configuration=Release /t:Rebuild /verbosity:minimal
if ($LASTEXITCODE -ne 0) {
    Write-Error "MSBuild compilation failed."
    exit $LASTEXITCODE
}

if (-not (Test-Path $DllPath)) {
    Write-Error "Compiled assembly not found at $DllPath"
    exit 1
}

Write-Host "`n[SUCCESS] Assembly compiled at: $DllPath" -ForegroundColor Green

# 2. Register COM for Current User (No Admin Rights Required)
Write-Host "Registering COM assembly for Current User (HKCU\Software\Classes)..." -ForegroundColor Cyan
$RegFileTemp = Join-Path $ScriptDir "bin\Release\addin_temp.reg"
$RegFileUser = Join-Path $ScriptDir "bin\Release\addin_user.reg"

& $RegAsm64 $DllPath /codebase /regfile:$RegFileTemp | Out-Null
if (Test-Path $RegFileTemp) {
    # Convert HKEY_CLASSES_ROOT to HKEY_CURRENT_USER\Software\Classes for per-user registration
    $regContent = Get-Content $RegFileTemp -Raw
    $regContentUser = $regContent -replace 'HKEY_CLASSES_ROOT', 'HKEY_CURRENT_USER\Software\Classes'
    [System.IO.File]::WriteAllText($RegFileUser, $regContentUser, [System.Text.Encoding]::Unicode)
    
    # Import into Windows Registry
    & reg.exe import $RegFileUser | Out-Null
    Remove-Item $RegFileTemp -Force -ErrorAction SilentlyContinue
    Write-Host "COM registered in HKCU\Software\Classes successfully." -ForegroundColor Green
}

# 3. Add Office Registry Keys
Write-Host "Registering Office Add-in keys under HKCU..." -ForegroundColor Cyan

$Targets = @($WordKey, $ExcelKey)
foreach ($key in $Targets) {
    if (-not (Test-Path $key)) {
        New-Item -Path $key -Force | Out-Null
    }
    Set-ItemProperty -Path $key -Name "FriendlyName" -Value "PII Sentinel Real-Time Save Guard" -Type String
    Set-ItemProperty -Path $key -Name "Description" -Value "Air-gapped pre-save data loss prevention and Microsoft Purview classification guard" -Type String
    Set-ItemProperty -Path $key -Name "LoadBehavior" -Value 3 -Type DWord
    Set-ItemProperty -Path $key -Name "CommandLineSafe" -Value 1 -Type DWord
}

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "PII Sentinel Office Add-in Registered Successfully!" -ForegroundColor Green
Write-Host "Word Registry:  $WordKey" -ForegroundColor Gray
Write-Host "Excel Registry: $ExcelKey" -ForegroundColor Gray
Write-Host "LoadBehavior:   3 (Load at startup)" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Green
