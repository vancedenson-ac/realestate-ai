-- realtrust ai — Roles for local dev/test (06-authorization-and-data-access)
-- IMPORTANT: CREATE/ALTER ROLE cannot run inside a transaction block.
-- Run before 02-schema.sql.

-- For deterministic local runs, reset this role each time.
DROP ROLE IF EXISTS app_user;
CREATE ROLE app_user
  LOGIN
  PASSWORD 'realtrust'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

-- Allow app_user to connect to the dev DB.
GRANT CONNECT ON DATABASE realtrust TO app_user;

