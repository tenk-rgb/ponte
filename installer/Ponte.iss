; Inno Setup script for Ponte. Build with: build.ps1 (publishes, then compiles this file)
#define AppName "Ponte"
#define AppVersion "1.4.0"
#define PublishDir "..\artifacts\publish"

[Setup]
AppId={{6C0E7C52-7E4B-4C59-9E0A-3A0E8B0C5D21}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Ruan Rodrigues Fermino
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\artifacts
OutputBaseFilename=Ponte-Setup-{#AppVersion}
SetupIconFile=..\src\Ponte\ponte.ico
UninstallDisplayIcon={app}\Ponte.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\Ponte.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Ponte.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Ponte.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
