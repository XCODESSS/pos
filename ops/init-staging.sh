#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
  --set tenant_password="$STAGING_DB_PASSWORD" <<'SQL'
CREATE ROLE tenant_stage LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'tenant_password';
CREATE DATABASE tenant_stage OWNER tenant_stage;
REVOKE CONNECT ON DATABASE tenant_stage FROM PUBLIC;
GRANT CONNECT ON DATABASE tenant_stage TO tenant_stage;
SQL
