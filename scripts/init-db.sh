#!/usr/bin/env sh
# realtrust — Initialize DB (schema). Run from repo root: docker compose up -d db first.
set -e
cd "$(dirname "$0")/.."
echo "[init-db] Root: $(pwd)"
echo "[init-db] Waiting for Postgres..."
retries=0
until docker compose exec -T db pg_isready -U realtrust -d realtrust 2>/dev/null; do
  retries=$((retries + 1))
  if [ "$retries" -ge 30 ]; then
    echo "[init-db] Postgres did not become ready. Run: docker compose up -d db"
    exit 1
  fi
  sleep 2
done
echo "[init-db] Ensuring app roles..."
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/01-roles.sql || {
  echo "[init-db] Roles failed."
  exit 1
}
echo "[init-db] Applying schema..."
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/02-schema.sql || {
  echo "[init-db] Schema failed."
  exit 1
}
echo "[init-db] Done. Run scripts/seed.sh to load mock data."
