[Setup]
AppName=Ledger Lever
AppVersion=0.1.1
AppPublisher=SentientByte
DefaultDirName={autopf}\LedgerLever
DefaultGroupName=Ledger Lever
OutputBaseFilename=LedgerLever-Setup-v0.1.1
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\LedgerLever.exe
PrivilegesRequired=lowest

[Files]
Source: "dist\LedgerLever\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\Ledger Lever"; Filename: "{app}\LedgerLever.exe"
Name: "{userdesktop}\Ledger Lever"; Filename: "{app}\LedgerLever.exe"

[Run]
Filename: "{app}\LedgerLever.exe"; Description: "Launch Ledger Lever"; Flags: nowait postinstall skipifsilent
