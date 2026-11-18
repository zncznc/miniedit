Unicode true

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APPNAME "MiniEdit"
!define VERSION "1.4.0"
!define PUBLISHER "MiniEdit"
!define EXE "MiniEdit.exe"

Name "${APPNAME} ${VERSION}"
OutFile "..\dist-shell\miniedit_${VERSION}_setup.exe"
InstallDir "$LOCALAPPDATA\Programs\MiniEdit"
InstallDirRegKey HKCU "Software\MiniEdit" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "${APPNAME} ${VERSION}"

!define MUI_ABORTWARNING
!define MUI_ICON "..\build\icon.ico"
!define MUI_UNICON "..\build\icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "启动 ${APPNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "安装" SecMain
  SetOutPath "$INSTDIR"
  File "target\release\miniedit-shell.exe"
  File "target\release\WebView2Loader.dll"
  Rename /REBOOTOK "$INSTDIR\miniedit-shell.exe" "$INSTDIR\${EXE}"

  SetOutPath "$INSTDIR\web"
  File "..\index.html"
  SetOutPath "$INSTDIR\web\css"
  File "..\css\app.css"
  SetOutPath "$INSTDIR\web\js"
  File "..\js\app.js"
  SetOutPath "$INSTDIR\web\js\core"
  File "..\js\core\*.mjs"
  SetOutPath "$INSTDIR\web\assets\samples"
  File "..\assets\samples\*"
  SetOutPath "$INSTDIR\web\assets\reference\syntax"
  File "..\assets\reference\syntax\*"
  SetOutPath "$INSTDIR\web\assets\reference\theme"
  File "..\assets\reference\theme\*"
  SetOutPath "$INSTDIR\web\assets\reference"
  File "..\assets\reference\setting.ini"

  WriteRegStr HKCU "Software\MiniEdit" "InstallDir" "$INSTDIR"

  CreateShortcut "$DESKTOP\MiniEdit.lnk" "$INSTDIR\${EXE}"
  CreateDirectory "$SMPROGRAMS\MiniEdit"
  CreateShortcut "$SMPROGRAMS\MiniEdit\MiniEdit.lnk" "$INSTDIR\${EXE}"
  CreateShortcut "$SMPROGRAMS\MiniEdit\卸载 MiniEdit.lnk" "$INSTDIR\uninstall.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiniEdit" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiniEdit" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiniEdit" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiniEdit" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiniEdit" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiniEdit" "EstimatedSize" $0
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiniEdit" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiniEdit" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\MiniEdit.lnk"
  Delete "$SMPROGRAMS\MiniEdit\MiniEdit.lnk"
  Delete "$SMPROGRAMS\MiniEdit\卸载 MiniEdit.lnk"
  RMDir "$SMPROGRAMS\MiniEdit"

  RMDir /r "$INSTDIR\web"
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\MiniEdit"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiniEdit"
SectionEnd
