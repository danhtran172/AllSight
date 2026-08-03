@echo off
cd /d "%~dp0"
npm.cmd start

if errorlevel 1 (
  echo.
  echo Khong the khoi dong MasterVision. Nhan phim bat ky de dong cua so nay.
  pause >nul
)
