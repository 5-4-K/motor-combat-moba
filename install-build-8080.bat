@echo off
cd /d "C:\Workstation\Personal\motor-combat-MOBA\Application"
if errorlevel 1 (
  echo Could not open C:\Workstation\Personal\motor-combat-MOBA\Application
  pause
  exit /b 1
)
call npm run install-build -- --port 8080 --yes
pause
