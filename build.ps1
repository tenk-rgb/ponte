# Publishes Ponte as a self-contained win-x64 app and builds the installer.
# Requires the .NET 10 SDK and Inno Setup 6 (winget install JRSoftware.InnoSetup).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$publish = Join-Path $root 'artifacts\publish'

if (Test-Path $publish) { Remove-Item -Recurse -Force $publish }
dotnet publish "$root\src\Ponte\Ponte.csproj" -c Release -r win-x64 --self-contained true -o $publish -p:DebugType=none
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

$iscc = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 not found. Install it with: winget install JRSoftware.InnoSetup' }

& $iscc "$root\installer\Ponte.iss"
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup failed' }
Get-ChildItem "$root\artifacts\*.exe" | Select-Object Name, Length
