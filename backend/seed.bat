@echo off
REM realtrust ai — Seed database with mock data (state machine + users, orgs, transactions, properties)
REM Requires: docker compose up -d db. Applies schema first if needed (idempotent).

setlocal
cd /d "%~dp0"
set "ROOT=%CD%"

echo [seed] Ensuring schema exists...
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/02-schema.sql
if errorlevel 1 (
  echo [seed] Schema apply failed. Ensure db is up (run init-db.bat or: docker compose up -d db).
  exit /b 1
)

echo [seed] Seeding realtrust DB...
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/03-seed.sql
if errorlevel 1 (
  echo [seed] Seed failed.
  exit /b 1
)
echo [seed] Done.
