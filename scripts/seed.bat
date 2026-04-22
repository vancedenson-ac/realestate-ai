@echo off
REM realtrust — Seed DB (mock data). Schema must be applied first (init-db.bat).
setlocal
cd /d "%~dp0\.."
echo [seed] Ensuring app roles...
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/01-roles.sql
if errorlevel 1 (
  echo [seed] Roles failed. Ensure: docker compose up -d db
  exit /b 1
)
echo [seed] Ensuring schema...
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/02-schema.sql
if errorlevel 1 (
  echo [seed] Schema failed. Run scripts\init-db.bat first and ensure: docker compose up -d db
  exit /b 1
)
echo [seed] Seeding...
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/03-seed.sql
if errorlevel 1 ( echo [seed] Seed failed. & exit /b 1 )
echo [seed] Done.
