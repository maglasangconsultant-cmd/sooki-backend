# Sooki App - Startup Guide

## Problem Fixed
The connection timeout errors you were experiencing were caused by:
1. **MongoDB Atlas Connection Issues** - Your app was trying to connect to MongoDB Atlas cloud database, which can have network connectivity issues
2. **Services Not Auto-Starting** - When you restart your PC, the backend server doesn't automatically start

## Solution Implemented

### 1. Local MongoDB Setup
- Changed database connection from MongoDB Atlas to local MongoDB
- This eliminates network connectivity issues
- Faster response times and more reliable connection

### 2. Easy Startup Script
Created `start_services.bat` that you can run to start all services at once.

## How to Use

### Option 1: Quick Start (Recommended)
1. Double-click `start_services.bat` in this folder
2. The script will automatically:
   - Check if MongoDB is running
   - Start the backend server
   - Show you the status

### Option 2: Manual Start
1. Make sure MongoDB service is running:
   ```
   net start MongoDB
   ```
2. Start the backend server:
   ```
   cd d:\projects\sooki_experiment\lib\backend
   node app.js
   ```

### Option 3: Auto-Start on Windows Login
1. Press `Win + R`, type `shell:startup`, press Enter
2. Copy `start_services.bat` to this folder
3. The services will start automatically when you log in

## MongoDB Installation (If Needed)
If you don't have MongoDB installed locally:
1. Download from: https://www.mongodb.com/try/download/community
2. Install with default settings
3. MongoDB service should start automatically

## Troubleshooting
- If you get "MongoDB service not found", install MongoDB locally
- If port 3000 is busy, close other applications using that port
- Check Windows Firewall if connection issues persist

## Your App Benefits
✅ No more connection timeouts  
✅ Faster database responses  
✅ Works offline  
✅ No dependency on internet connection  
✅ Easy startup process