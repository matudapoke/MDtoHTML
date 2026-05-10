@echo off
rem ===============================================================
rem  MDtoHTML.bat
rem  Entry point. No Japanese characters in this file (encoding-safe).
rem  Usage:
rem    - Double click           : show file picker dialog
rem    - Drag and drop a .md    : convert that file
rem    - Open with this program : convert the associated file
rem ===============================================================
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%scripts\Convert-MDtoHTML.ps1"

if "%~1"=="" (
	powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%PS_SCRIPT%"
) else (
	powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%PS_SCRIPT%" -MarkdownPath "%~1"
)

endlocal
