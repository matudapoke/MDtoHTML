@echo off
rem ===============================================================
rem  Unregister-Protocol.bat
rem  Remove the "mdtohtml://" custom URL protocol from HKCU.
rem ===============================================================
setlocal

reg delete "HKCU\Software\Classes\mdtohtml" /f >nul 2>&1
set "RESULT=%ERRORLEVEL%"

if "%RESULT%"=="0" (
    echo Unregistered mdtohtml:// protocol.
) else (
    echo Nothing to unregister, or deletion failed. ErrorLevel=%RESULT%
)

echo.
pause
endlocal
