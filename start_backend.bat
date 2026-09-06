@echo off
cd /d "%~dp0"

echo Starting goodjob backend...
python main.py

echo.
echo Backend exited.
pause
