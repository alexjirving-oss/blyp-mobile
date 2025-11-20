@echo off
echo Setting up Android environment...
set ANDROID_SDK_ROOT=%LOCALAPPDATA%\Android\Sdk
set PATH=%PATH%;%ANDROID_SDK_ROOT%\platform-tools
set PATH=%PATH%;%ANDROID_SDK_ROOT%\emulator

echo Checking devices...
adb devices

echo Setting up port forwarding...
adb reverse tcp:8081 tcp:8081

echo Starting Expo...
cd /d "C:\Users\Alex\369369369"
call npm start