@echo off
REM realtrust ai — Initialize database: start Postgres + MinIO, create schema
REM Run from backend\realtrust-ai (or set REALTRUST_ROOT)

setlocal
cd /d "%~dp0\.."
set "ROOT=%CD%"

echo [init-db] Root: %ROOT%

REM 1. Start stack
echo [init-db] Starting db and minio...
docker compose up -d db minio
if errorlevel 1 (
  echo [init-db] docker compose failed
  exit /b 1
)

REM 2. Wait for Postgres
echo [init-db] Waiting for Postgres...
set RETRIES=0
:wait_db
docker compose exec -T db pg_isready -U realtrust -d realtrust >nul 2>&1
if errorlevel 1 (
  set /a RETRIES+=1
  if %RETRIES% geq 30 (
    echo [init-db] Postgres did not become ready
    exit /b 1
  )
  timeout /t 2 /nobreak >nul
  goto wait_db
)
echo [init-db] Postgres is ready.

REM 3. Run roles then schema (extensions applied by docker-entrypoint-initdb.d on first start)
REM 01-roles.sql creates app_user (required for 02-schema grants). Use -f so file is read inside container.
echo [init-db] Applying roles (01-roles.sql)...
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/01-roles.sql
if errorlevel 1 (
  echo [init-db] Roles apply failed
  exit /b 1
)
echo [init-db] Applying schema (02-schema.sql)...
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/02-schema.sql
if errorlevel 1 (
  echo [init-db] Schema apply failed
  exit /b 1
)

echo [init-db] Done. Run seed.bat to load mock data.
