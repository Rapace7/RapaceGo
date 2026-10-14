@echo off
rem ============================================================
rem  RapaceGo dev instance WITH CDP debug port (9333).
rem  Just DOUBLE-CLICK this file. No typing needed.
rem
rem  Why a .bat instead of a pasted command line:
rem    - the project path contains spaces ("Git by Rapace"),
rem      which broke two pasted attempts already
rem    - "start" detaches the app: closing this console window
rem      will NOT kill the app, and the shell stays free
rem    - isolated --user-data-dir avoids fighting the profile
rem      of the portable release you use every day
rem
rem  ASCII only on purpose: cmd.exe parses .bat in the OEM
rem  codepage (GBK here); non-ASCII text would garble.
rem ============================================================
setlocal EnableExtensions

set ELECTRON_RUN_AS_NODE=

rem --- debug port: %1, default 9333 ---
rem 2026-10-14: made it a parameter. Reason: another app (Edge) had taken 9333,
rem so this script's app silently ran WITHOUT a debug port -- and the test
rem scripts then connected to that other app's page and reported nonsense
rem (e.g. "settings is not defined"). Pass a free port to avoid the clash.
set PORT=%~1
if "%PORT%"=="" set PORT=9333

rem --- normalize the project root (strip the trailing \dev\.. ) ---
pushd "%~dp0.."
set ROOT=%CD%
popd

set EXE=%ROOT%\node_modules\electron\dist\electron.exe
set LOG=%~dp0_cdp_start.log
set PROFILE=%~dp0_dbg_profile

echo. > "%LOG%"
echo [launcher] root    = %ROOT%>>"%LOG%"
echo [launcher] exe     = %EXE%>>"%LOG%"

if not exist "%EXE%" (
  echo [launcher] FAIL: electron.exe not found>>"%LOG%"
  echo.
  echo ERROR: electron.exe not found at:
  echo   %EXE%
  echo See dev\_cdp_start.log
  pause
  exit /b 1
)

echo [launcher] starting app with --remote-debugging-port=%PORT%>>"%LOG%"
start "" "%EXE%" "%ROOT%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%"

echo [launcher] waiting for port %PORT% ...>>"%LOG%"

rem --- poll the port for up to ~25s, log the verdict ---
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%PORT%'; $ok=$false; for($i=0;$i -lt 50;$i++){ try{ $r=Invoke-WebRequest -Uri ('http://127.0.0.1:'+$p+'/json/version') -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ $ok=$true; break } }catch{}; Start-Sleep -Milliseconds 500 }; if($ok){ Add-Content -Path '%LOG%' -Value ('[launcher] RESULT: PORT-'+$p+'-OK') } else { Add-Content -Path '%LOG%' -Value ('[launcher] RESULT: PORT-'+$p+'-DEAD') }"

findstr /C:"PORT-%PORT%-OK" "%LOG%" >nul
if %ERRORLEVEL%==0 (
  echo.
  echo   OK - debug port %PORT% is up.
  echo   Keep the RapaceGo window OPEN, then tell the assistant.
) else (
  echo.
  echo   PROBLEM - the app started but port %PORT% is not listening.
  echo   Details are in:  %LOG%
)

echo.
timeout /t 8 >nul
endlocal
