@echo off
title DataCare Invoice ^& Quotation server
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this file again.
  pause & exit /b 1
)
if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install --omit=dev || (pause & exit /b 1)
)
if not exist .env (
  echo Missing server\.env - copy .env.example to .env and fill in the SQL Server password.
  pause & exit /b 1
)
node server.js
pause
