@echo off
echo Starting Sooki App Services...
echo.

REM Check if MongoDB service is running
echo Checking MongoDB service...
net start | findstr -i "MongoDB" >nul
if %errorlevel% == 0 (
    echo ✅ MongoDB service is already running
) else (
    echo ❌ MongoDB service not found. Please install MongoDB locally or start the service manually.
    echo You can download MongoDB from: https://www.mongodb.com/try/download/community
    pause
    exit /b 1
)

echo.
echo Starting Node.js backend server...
cd /d "%~dp0"
node app.js

pause