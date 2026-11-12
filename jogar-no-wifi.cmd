@echo off
chcp 65001 >nul
title Grand Line Tactics - Servidor Wi-Fi (LAN)
node "%~dp0scripts\lan-server.js" --open
pause
