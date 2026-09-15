@echo off
REM ============================================================
REM Driver Monitoring System — one-command Windows startup
REM
REM What this does:
REM   1. Creates a virtual environment in backend\venv (first run only)
REM   2. Installs/updates dependencies
REM   3. Copies .env.example to .env (first run only)
REM   4. Starts the FastAPI server (which also serves the frontend)
REM   5. Opens your browser to the app
REM ============================================================

cd /d "%~dp0backend"

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

echo Installing dependencies (this can take a few minutes the first time)...
pip install -r requirements.txt

if not exist .env (
    echo Creating .env from template...
    copy .env.example .env
)

echo.
echo ============================================================
echo  Starting Driver Monitoring System at http://localhost:8000
echo  Press CTRL+C to stop the server.
echo ============================================================
echo.

start "" http://localhost:8000

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
