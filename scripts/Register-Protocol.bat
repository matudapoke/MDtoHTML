@echo off
rem ===============================================================
rem  Register-Protocol.bat
rem  Register the "mdtohtml://" custom URL protocol under HKCU.
rem  No admin rights required.
rem
rem  Usage:
rem    Double click. The refresh button in generated HTML pages will
rem    then call MDtoHTML.bat with the original markdown file path.
rem ===============================================================
setlocal

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

for %%I in ("%SCRIPT_DIR%\..") do set "PROJECT_ROOT=%%~fI"
set "BAT_PATH=%PROJECT_ROOT%\MDtoHTML.bat"

if not exist "%BAT_PATH%" (
    echo ERROR: MDtoHTML.bat not found at:
    echo   %BAT_PATH%
    pause
    exit /b 1
)

rem Escape backslashes for .reg format (single \ -> double \\)
set "BAT_PATH_ESC=%BAT_PATH:\=\\%"

set "REG_FILE=%TEMP%\mdtohtml-register.reg"

> "%REG_FILE%" echo REGEDIT4
>> "%REG_FILE%" echo.
>> "%REG_FILE%" echo [HKEY_CURRENT_USER\Software\Classes\mdtohtml]
>> "%REG_FILE%" echo @="URL:MDtoHTML Protocol"
>> "%REG_FILE%" echo "URL Protocol"=""
>> "%REG_FILE%" echo.
>> "%REG_FILE%" echo [HKEY_CURRENT_USER\Software\Classes\mdtohtml\shell]
>> "%REG_FILE%" echo.
>> "%REG_FILE%" echo [HKEY_CURRENT_USER\Software\Classes\mdtohtml\shell\open]
>> "%REG_FILE%" echo.
>> "%REG_FILE%" echo [HKEY_CURRENT_USER\Software\Classes\mdtohtml\shell\open\command]
>> "%REG_FILE%" echo @="\"%BAT_PATH_ESC%\" \"%%1\""

reg import "%REG_FILE%" >nul 2>&1
set "RESULT=%ERRORLEVEL%"
del "%REG_FILE%" >nul 2>&1

if not "%RESULT%"=="0" (
    echo.
    echo Registration failed. ErrorLevel=%RESULT%
    pause
    exit /b %RESULT%
)

echo Registered mdtohtml:// protocol successfully.
echo   Command: "%BAT_PATH%" "%%1"
echo.
echo You can now use the refresh button in generated HTML pages.
echo The first time, your browser will ask which app to open the link with.
echo.
pause
endlocal
