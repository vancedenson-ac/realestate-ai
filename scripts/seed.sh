#!/usr/bin/env sh
# realtrust — Seed DB (mock data). Schema must be applied first (init-db.sh).
set -e
cd "$(dirname "$0")/.."
echo "[seed] Ensuring app roles..."
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/01-roles.sql || {
  echo "[seed] Roles failed. Ensure: docker compose up -d db"
  exit 1
}
echo "[seed] Ensuring schema..."
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/02-schema.sql || {
  echo "[seed] Schema failed. Run scripts/init-db.sh first and ensure: docker compose up -d db"
  exit 1
}
echo "[seed] Seeding..."
docker compose exec -T db psql -U realtrust -d realtrust -f /scripts/03-seed.sql || {
  echo "[seed] Seed failed."
  exit 1
}
echo "[seed] Done."
