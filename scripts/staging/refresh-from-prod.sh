#!/usr/bin/env bash
# scripts/staging/refresh-from-prod.sh
# Run ON the Coolify server (178.105.107.141). Dumps prod, restores into the
# staging DB, then anonymizes recipient PII so every send lands on controlled
# test targets. Fail-fast and fail-closed: refuses to touch any DB whose name
# does not contain "staging".
#
# Required env:
#   STAGING_DB_CONTAINER   e.g. qdu8dzxr7ujoe9v7ui5rbkhx
#   STAGING_DB_USER        staging postgres user
#   STAGING_DB_NAME        must contain "staging" (e.g. linkedinsi_staging)
#   STAGING_APP_CONTAINER  running staging app container (t.../<ts>) — used to
#                          run the anonymizer with the app's env (DATABASE_URL,
#                          STAGING_TEST_PHONE, STAGING_TEST_LINKEDIN_URLS)
set -euo pipefail

PROD_CONTAINER="mqmzh509lai59q2hkyhpr0yj"
PROD_USER="linkedinsi"; PROD_DB="linkedinsi"
STAGING_CONTAINER="${STAGING_DB_CONTAINER:?set STAGING_DB_CONTAINER}"
STAGING_USER="${STAGING_DB_USER:?set STAGING_DB_USER}"
STAGING_DB="${STAGING_DB_NAME:?set STAGING_DB_NAME}"
APP_CONTAINER="${STAGING_APP_CONTAINER:?set STAGING_APP_CONTAINER}"

# --- fail-closed guards ------------------------------------------------------
case "$STAGING_DB" in
  *staging*) ;;
  *) echo "❌ refusing: STAGING_DB_NAME '$STAGING_DB' does not contain 'staging'"; exit 1 ;;
esac
if [ "$STAGING_CONTAINER" = "$PROD_CONTAINER" ]; then
  echo "❌ refusing: STAGING_DB_CONTAINER equals the prod DB container"; exit 1
fi

# --- version compatibility: restore target must be >= dump source ------------
prod_major=$(docker exec "$PROD_CONTAINER" psql -U "$PROD_USER" -d "$PROD_DB" -tAc "show server_version_num" | cut -c1-2)
staging_major=$(docker exec "$STAGING_CONTAINER" psql -U "$STAGING_USER" -d "$STAGING_DB" -tAc "show server_version_num" | cut -c1-2)
if [ "$staging_major" -lt "$prod_major" ]; then
  echo "❌ refusing: staging Postgres $staging_major < prod Postgres $prod_major (restore would fail)"; exit 1
fi

DUMP="/tmp/prod-refresh-$$.dump"
trap 'rm -f "$DUMP"' EXIT

echo "→ dumping prod ($PROD_CONTAINER/$PROD_DB)"
docker exec "$PROD_CONTAINER" pg_dump -U "$PROD_USER" -d "$PROD_DB" -Fc > "$DUMP"

echo "→ resetting staging schema ($STAGING_CONTAINER/$STAGING_DB)"
docker exec "$STAGING_CONTAINER" psql -U "$STAGING_USER" -d "$STAGING_DB" \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "→ restoring into staging"
docker exec -i "$STAGING_CONTAINER" pg_restore -U "$STAGING_USER" -d "$STAGING_DB" \
  --no-owner --no-acl < "$DUMP"

echo "→ anonymizing (guarded — anonymize.ts refuses non-staging DATABASE_URL)"
docker exec -e STAGING_ANONYMIZE_CONFIRM=1 \
  "$APP_CONTAINER" sh -c 'cd /app && npx tsx scripts/staging/anonymize.ts'

echo "→ verifying PII was rerouted"
leaked=$(docker exec "$STAGING_CONTAINER" psql -U "$STAGING_USER" -d "$STAGING_DB" \
  -tAc "select count(*) from \"Contact\" where email is not null and email not like 'ariel+%@triolla.io'")
if [ "$leaked" != "0" ]; then
  echo "❌ $leaked contact emails were NOT rerouted — investigate before using staging"; exit 1
fi

echo "✅ staging refreshed from prod (anonymized, verified)"
