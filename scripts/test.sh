#!/usr/bin/env sh
# realtrust — Run backend and frontend tests. Run from repo root: ./scripts/test.sh
# Backend: backend/ (pytest). Frontend: frontend/ (npm test).
# Requires: Docker DB up for backend tests (./scripts/init-db.sh then ./scripts/seed.sh).
set -e
cd "$(dirname "$0")/.."
echo "[test] Root: $(pwd)"
echo

echo "[test] Backend: pytest in backend/"
cd backend
if command -v uv >/dev/null 2>&1; then
  uv run pytest "$@"
else
  python -m pytest "$@"
fi
BACKEND_ERR=$?
cd ..

if [ "$BACKEND_ERR" -ne 0 ]; then
  echo
  echo "[test] Backend tests failed with exit code $BACKEND_ERR."
  exit "$BACKEND_ERR"
fi

echo
echo "[test] Frontend: npm run test in frontend/"
cd frontend
npm run test
FRONTEND_ERR=$?
cd ..

if [ "$FRONTEND_ERR" -ne 0 ]; then
  echo
  echo "[test] Frontend tests failed with exit code $FRONTEND_ERR."
  exit "$FRONTEND_ERR"
fi

echo
echo "[test] All tests passed."
exit 0
