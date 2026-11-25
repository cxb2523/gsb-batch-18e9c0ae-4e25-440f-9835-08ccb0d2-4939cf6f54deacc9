@echo off
title ROOFTOP SNIPER: LAST LIGHT
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and run this again.
  echo Or open offline\index.html directly in Chrome/Edge after running "npm run build:offline".
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install
)
echo Starting game server. Your browser will open automatically.
echo Close this window to stop the game.
call npm start
