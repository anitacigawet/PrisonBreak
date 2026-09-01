@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo.
echo ============================================================
echo    PrisonBreak - local release launcher
echo ============================================================
echo.
echo This launcher prepares a fresh checkout, builds it, and starts
echo the optimized local server. The first run needs internet access
echo to install Node and Python packages.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js 22 or newer is required.
  goto :failed
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 (
  echo ERROR: Node.js 22 or newer is required. Found Node.js %NODE_MAJOR%.
  goto :failed
)

set "PNPM_COMMAND=pnpm"
where pnpm >nul 2>nul
if errorlevel 1 (
  where corepack >nul 2>nul
  if errorlevel 1 (
    echo ERROR: pnpm 10 is required. Install pnpm or enable Corepack.
    goto :failed
  )
  set "PNPM_COMMAND=corepack pnpm"
)

if not exist ".venv-rag\Scripts\python.exe" (
  echo [1/5] Creating the local Python environment...
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 -m venv .venv-rag
  ) else (
    where python >nul 2>nul
    if errorlevel 1 (
      echo ERROR: Python 3.11 or newer is required.
      goto :failed
    )
    python -m venv .venv-rag
  )
  if errorlevel 1 goto :failed
) else (
  echo [1/5] Using the existing local Python environment.
)

".venv-rag\Scripts\python.exe" -c "import sys; raise SystemExit(sys.version_info[:2] < (3, 11))"
if errorlevel 1 (
  echo ERROR: The local Python environment must use Python 3.11 or newer.
  echo Delete .venv-rag and run this launcher again with a newer Python installed.
  goto :failed
)

echo [2/5] Installing Python retrieval dependencies...
".venv-rag\Scripts\python.exe" -m pip install --disable-pip-version-check -r server\rag\requirements.txt
if errorlevel 1 goto :failed

echo [3/5] Installing Node.js dependencies...
call %PNPM_COMMAND% install --frozen-lockfile
if errorlevel 1 goto :failed

if not exist ".env" (
  echo [4/5] Creating .env from the documented local defaults...
  copy /Y ".env.example" ".env" >nul
) else (
  echo [4/5] Keeping the existing local .env file.
)

set "PRISONBREAK_PYTHON=%CD%\.venv-rag\Scripts\python.exe"

echo [5/5] Building PrisonBreak...
call %PNPM_COMMAND% build
if errorlevel 1 goto :failed

echo.
echo PrisonBreak is ready. Open the localhost URL printed below.
echo Close this window or press Ctrl+C to stop it.
echo.
call %PNPM_COMMAND% start
set "EXIT_CODE=%errorlevel%"
goto :stopped

:failed
set "EXIT_CODE=%errorlevel%"
if "%EXIT_CODE%"=="0" set "EXIT_CODE=1"
echo.
echo PrisonBreak could not be prepared or started.

:stopped
echo.
echo Server stopped with exit code %EXIT_CODE%.
echo Press any key to close this window.
pause >nul
endlocal & exit /b %EXIT_CODE%
