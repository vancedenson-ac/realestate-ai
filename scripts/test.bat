@echo off
REM realtrust — Run backend and frontend tests. Run from repo root or scripts\.
REM Backend: backend\ (pytest). Frontend: frontend\ (npm test).
REM Requires: Docker DB up for backend tests (scripts\init-db.bat then scripts\seed.bat).
setlocal
cd /d "%~dp0\.."
echo [test] Root: %CD%
echo.

echo [test] Backend: pytest in backend\
cd backend
where uv >nul 2>&1
if %errorlevel% equ 0 (
  uv run pytest %*
) else (
  python -m pytest %*
)
set BACKEND_ERR=%errorlevel%
cd ..

if %BACKEND_ERR% neq 0 (
  echo.
  echo [test] Backend tests failed with exit code %BACKEND_ERR%.
  exit /b %BACKEND_ERR%
)

echo.
echo [test] Frontend: npm run test in frontend\
cd frontend
call npm run test
set FRONTEND_ERR=%errorlevel%
cd ..

if %FRONTEND_ERR% neq 0 (
  echo.
  echo [test] Frontend tests failed with exit code %FRONTEND_ERR%.
  exit /b %FRONTEND_ERR%
)

echo.
echo [test] All tests passed.
exit /b 0
