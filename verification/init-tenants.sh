#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
  --set alpha_password="$VERIFY_ALPHA_DB_PASSWORD" --set beta_password="$VERIFY_BETA_DB_PASSWORD" <<'SQL'
CREATE ROLE tenant_alpha LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'alpha_password';
CREATE ROLE tenant_beta LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'beta_password';
CREATE DATABASE tenant_alpha OWNER tenant_alpha;
CREATE DATABASE tenant_beta OWNER tenant_beta;
REVOKE CONNECT ON DATABASE tenant_alpha FROM PUBLIC;
REVOKE CONNECT ON DATABASE tenant_beta FROM PUBLIC;
GRANT CONNECT ON DATABASE tenant_alpha TO tenant_alpha;
GRANT CONNECT ON DATABASE tenant_beta TO tenant_beta;
SQL
