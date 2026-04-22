@echo off
REM realtrust — Initialize DB (schema). Run from repo root: docker compose up -d db first.
setlocal
cd /d "%~dp0\.."
echo [init-db] Root: %CD%
echo [init-db] Waiting for Postgres...
set RETRIES=0
:wait_db
docker compose exec -T db pg_isready -U realtrust -d realtrust >nul 2>&1
if errorlevel 1 (
  set /a RETRIES+=1
  if %RETRIES% geq 30 (
    echo [init-db] Postgres did not become ready. Run: docker compose up -d db
    exit /b 1
  )
  timeout /t 2 /nobreak >nul
  goto wait_db
)
echo [init-db] Ensuring app roles...
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/01-roles.sql
if errorlevel 1 ( echo [init-db] Roles failed. & exit /b 1 )
echo [init-db] Applying schema...
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/02-schema.sql
if errorlevel 1 ( echo [init-db] Schema failed. & exit /b 1 )
echo [init-db] Done. Run scripts\seed.bat to load mock data.
