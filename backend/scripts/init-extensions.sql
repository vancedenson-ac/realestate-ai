-- realtrust ai — Required PostgreSQL extensions (run on first DB init)
-- Mounted at /docker-entrypoint-initdb.d/01-extensions.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "postgis";
-- pg_stat_statements: enable when postgresql-contrib is installed (e.g. production)
-- CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
