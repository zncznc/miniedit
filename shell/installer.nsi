Unicode true

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APPNAME "MiniEdit"
!define VERSION "1.5.0"
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
  ; 显式清掉重启标记：本安装包不需要重启，任何情况下都不该弹这句
  SetRebootFlag false

  ; 旧版还开着会占住 exe。先请它正常退出（关窗时会写恢复快照），
  ; 这样覆盖文件永远成功，不需要 /REBOOTOK，也就不会提示重启。
  nsExec::Exec "taskkill /IM ${EXE}"
  Pop $0
  Sleep 700

  SetOutPath "$INSTDIR"
  File "target\release\MiniEdit.exe"
  File "target\release\WebView2Loader.dll"

  SetOutPath "$INSTDIR\web"
  File "..\index.html"
  SetOutPath "$INSTDIR\web\css"
  File "..\css\app.css"
  SetOutPath "$INSTDIR\web\js"
  File "..\js\*.js"
  File "..\js\*.mjs"
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
  nsExec::Exec "taskkill /IM ${EXE}"
  Pop $0
  Sleep 700

  Delete "$DESKTOP\MiniEdit.lnk"
  Delete "$SMPROGRAMS\MiniEdit\MiniEdit.lnk"
  Delete "$SMPROGRAMS\MiniEdit\卸载 MiniEdit.lnk"
  RMDir "$SMPROGRAMS\MiniEdit"

  RMDir /r "$INSTDIR\web"
  ; 旧版本把 WebView2 的缓存写在了 exe 旁边，卸载时要一并清掉
  RMDir /r "$INSTDIR\MiniEdit.exe.WebView2"
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\MiniEdit"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiniEdit"
SectionEnd
