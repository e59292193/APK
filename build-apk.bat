@echo off
chcp 65001 >nul
title MOMO Corn - APK 一键打包工具
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1"
pause
