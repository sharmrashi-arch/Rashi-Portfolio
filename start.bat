@echo off
title Rashi Portfolio - Server (band karne ke liye ye window close karein)
cd /d "%~dp0backend"

echo ==========================================================
echo   RASHI PORTFOLIO - SERVER
echo ==========================================================
echo   Portfolio : http://localhost:3000
echo   Admin     : http://localhost:3000/admin
echo   Blog      : http://localhost:3000/blog.html
echo.

REM ── Agar server pehle se chal raha hai to naya server mat chalao ──
netstat -ano | find "LISTENING" | find ":3000" >nul
if not errorlevel 1 goto already_running

echo   Server shuru ho raha hai...
echo.

REM ── Browser turant khol do ──
start "" http://localhost:3000

:run_server
echo [%time%] Server chal raha hai...
node server.js
echo.
echo   !! Server ruk gaya (crash ya band).
echo   !! 3 second baad APNE AAP dobara chalega.
echo   !! Band karna hai? Ye window CLOSE kar dein.
echo.
timeout /t 3 /nobreak >nul
goto run_server

:already_running
echo   Server pehle se chal raha hai - naya server nahi banaya.
echo   Sirf browser khol rahe hain...
echo.
start "" http://localhost:3000
timeout /t 2 /nobreak >nul
exit
