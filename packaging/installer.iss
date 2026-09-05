; Inno Setup Script for PII Sentinel
; Produces a single standalone Windows Setup installer (.exe)

#define MyAppName "PII Sentinel"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Sentinel Security"
#define MyAppExeName "PIISentinel.exe"

[Setup]
AppId={{C8E79F32-441A-4D41-949B-5EE110825B8B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\dist_installer
OutputBaseFilename=PIISentinel_Setup_v1.0
SetupIconFile=assets\app_icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\PIISentinel\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
function CheckForJava(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/c where java.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
  if not Result then
  begin
    // Check if Eclipse Adoptium or Java directories exist
    Result := DirExists(ExpandConstant('{commonpf}\Eclipse Adoptium')) or
              DirExists(ExpandConstant('{commonpf}\Java')) or
              DirExists(ExpandConstant('{commonpf64}\Eclipse Adoptium')) or
              DirExists(ExpandConstant('{commonpf64}\Java'));
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if not CheckForJava() then
    begin
      MsgBox('Notice: Apache Tika requires a Java Runtime (Java 8+ or Eclipse Adoptium) to extract text from documents.' + #13#10 +
             'If Java is not installed, PII Sentinel can still inspect text/json files, but installing Eclipse Adoptium Temurin is recommended for PDF and Office documents.',
             mbInformation, MB_OK);
    end;
  end;
end;
