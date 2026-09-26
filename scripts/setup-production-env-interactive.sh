#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env}"
TMP_FILE=""
trap '[[ -n "${TMP_FILE:-}" ]] && rm -f "$TMP_FILE"' EXIT

command -v openssl >/dev/null || { echo "openssl is required."; exit 1; }
command -v curl >/dev/null || { echo "curl is required."; exit 1; }

clear_screen() { printf '\033[2J\033[H'; }
pause() { read -r -p "Press Enter to continue..." _; }

header() {
  clear_screen
  printf 'Harly Production Setup\n'
  printf '======================\n'
  printf 'Step %s of 5 — %s\n\n' "$1" "$2"
}

ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; }

ask() {
  local label="$1" var="$2" value=""
  while [[ -z "$value" ]]; do read -r -p "$label: " value; done
  printf -v "$var" '%s' "$value"
}

ask_default() {
  local label="$1" default="$2" var="$3" value=""
  read -r -p "$label [$default]: " value
  printf -v "$var" '%s' "${value:-$default}"
}

ask_secret() {
  local label="$1" var="$2" value=""
  while [[ -z "$value" ]]; do
    read -r -s -p "$label: " value
    printf '\n'
  done
  printf -v "$var" '%s' "$value"
}

yesno() {
  local label="$1" answer=""
  read -r -p "$label [Y/n]: " answer
  [[ -z "$answer" || "$answer" =~ ^[Yy]$ ]]
}

urlencode() {
  local value="$1" out="" i c hex
  LC_ALL=C
  for ((i=0; i<${#value}; i++)); do
    c="${value:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) printf -v hex '%%%02X' "'$c"; out+="$hex" ;;
    esac
  done
  printf '%s' "$out"
}

quote_env() {
  local v="$1"
  v="${v//\\/\\\\}"; v="${v//\"/\\\"}"; v="${v//$'\n'/\\n}"
  printf '"%s"' "$v"
}

# STEP 1 — HOSTNAME
while true; do
  header 1 "Hostname"
  ask "Hostname (example: volunteer.keepyjalive.org)" HOST
  HOST="${HOST#https://}"; HOST="${HOST#http://}"; HOST="${HOST%%/*}"
  APP_URL="https://${HOST}"

  printf '\nChecking DNS...\n'
  DNS_OK=0
  if command -v getent >/dev/null 2>&1; then
    getent ahosts "$HOST" >/dev/null 2>&1 && DNS_OK=1
  elif command -v dig >/dev/null 2>&1; then
    [[ -n "$(dig +short "$HOST" 2>/dev/null)" ]] && DNS_OK=1
  elif command -v host >/dev/null 2>&1; then
    host "$HOST" >/dev/null 2>&1 && DNS_OK=1
  else
    fail "Install getent, dig, or host so DNS can be validated."
    pause; continue
  fi

  if (( DNS_OK == 0 )); then
    fail "$HOST does not resolve in DNS."
    pause; continue
  fi

  ok "DNS resolves."
  if curl -fsSIL --connect-timeout 5 --max-time 10 "$APP_URL" >/dev/null 2>&1; then
    ok "HTTPS responds."
  else
    warn "DNS works, but HTTPS is not responding yet."
  fi
  printf '\nURL: %s\n\n' "$APP_URL"
  yesno "Use this hostname?" && break
done

# STEP 2 — DATABASE
while true; do
  header 2 "PostgreSQL Database"
  if ! command -v psql >/dev/null 2>&1; then
    fail "psql is required to test the database."
    exit 1
  fi

  ask "Database host" DB_HOST
  ask_default "Database port" "5432" DB_PORT
  ask "Database name" DB_NAME
  ask "Database user" DB_USER
  ask_secret "Database password" DB_PASSWORD
  ask_default "SSL mode" "require" DB_SSLMODE

  EU="$(urlencode "$DB_USER")"
  EP="$(urlencode "$DB_PASSWORD")"
  ED="$(urlencode "$DB_NAME")"
  DATABASE_URL="postgresql://${EU}:${EP}@${DB_HOST}:${DB_PORT}/${ED}?sslmode=${DB_SSLMODE}&connect_timeout=8"

  printf '\nTesting database...\n'
  if [[ "$(psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c 'SELECT 1;' 2>/dev/null || true)" != "1" ]]; then
    fail "Could not connect and run SELECT 1."
    pause; continue
  fi

  ok "Database connection works."
  ok "Credentials work."
  ok "SELECT 1 succeeded."
  printf '\n%s:%s / %s / %s\n\n' "$DB_HOST" "$DB_PORT" "$DB_NAME" "$DB_USER"
  yesno "Use this database?" && break
done

# STEP 3 — S3
while true; do
  header 3 "S3 Object Storage"
  if ! command -v aws >/dev/null 2>&1; then
    fail "AWS CLI is required to validate S3-compatible storage."
    exit 1
  fi

  ask "S3 endpoint" S3_ENDPOINT
  S3_ENDPOINT="${S3_ENDPOINT%/}"
  ask "S3 region" S3_REGION
  ask "Bucket name" S3_BUCKET
  ask "Access key ID" S3_ACCESS_KEY_ID
  ask_secret "Secret access key" S3_SECRET_ACCESS_KEY

  printf '\nTesting S3 credentials and bucket...\n'
  if ! AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
       AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
       AWS_DEFAULT_REGION="$S3_REGION" \
       aws s3api head-bucket --bucket "$S3_BUCKET" \
         --endpoint-url "$S3_ENDPOINT" >/dev/null 2>&1; then
    fail "S3 validation failed."
    pause; continue
  fi

  ok "S3 credentials work."
  ok "Bucket is accessible."
  printf '\n%s / %s / %s\n\n' "$S3_ENDPOINT" "$S3_REGION" "$S3_BUCKET"
  yesno "Use this S3 configuration?" && break
done

# STEP 4 — SECRETS
header 4 "Application Secrets"
printf 'Generating authentication secret...\n\n'
BETTER_AUTH_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
ok "BETTER_AUTH_SECRET generated."
printf '\nThe secret is hidden and will be written directly to the environment file.\n\n'
pause

# STEP 5 — SAVE
while true; do
  header 5 "Save Configuration"
  printf 'Hostname : %s\n' "$HOST"
  printf 'Database : %s:%s/%s\n' "$DB_HOST" "$DB_PORT" "$DB_NAME"
  printf 'S3 bucket: %s\n' "$S3_BUCKET"
  printf 'Output   : %s\n\n' "$ENV_FILE"

  if ! yesno "Create $ENV_FILE?"; then
    echo "Cancelled."
    exit 0
  fi

  if [[ -e "$ENV_FILE" ]]; then
    read -r -p "$ENV_FILE exists. Replace it? [y/N]: " answer
    [[ "$answer" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }
    cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d%H%M%S)"
  fi

  umask 077
  TMP_FILE="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"

  {
    printf '# Harly production environment\n\n'
    printf '# Application\n'
    printf 'HOSTNAME=%s\n' "$(quote_env "$HOST")"
    printf 'HARLY_URL=%s\n' "$(quote_env "$APP_URL")"
    printf 'NEXT_PUBLIC_APP_URL=%s\n' "$(quote_env "$APP_URL")"
    printf 'BETTER_AUTH_URL=%s\n\n' "$(quote_env "$APP_URL")"

    printf '# Authentication\n'
    printf 'BETTER_AUTH_SECRET=%s\n\n' "$(quote_env "$BETTER_AUTH_SECRET")"

    printf '# PostgreSQL\n'
    printf 'DB_HOST=%s\n' "$(quote_env "$DB_HOST")"
    printf 'DB_PORT=%s\n' "$(quote_env "$DB_PORT")"
    printf 'DB_NAME=%s\n' "$(quote_env "$DB_NAME")"
    printf 'DB_USER=%s\n' "$(quote_env "$DB_USER")"
    printf 'DB_SSLMODE=%s\n' "$(quote_env "$DB_SSLMODE")"
    printf 'DATABASE_URL=%s\n\n' "$(quote_env "$DATABASE_URL")"

    printf '# S3\n'
    printf 'S3_ENDPOINT=%s\n' "$(quote_env "$S3_ENDPOINT")"
    printf 'S3_REGION=%s\n' "$(quote_env "$S3_REGION")"
    printf 'S3_BUCKET=%s\n' "$(quote_env "$S3_BUCKET")"
    printf 'S3_ACCESS_KEY_ID=%s\n' "$(quote_env "$S3_ACCESS_KEY_ID")"
    printf 'S3_SECRET_ACCESS_KEY=%s\n' "$(quote_env "$S3_SECRET_ACCESS_KEY")"
  } > "$TMP_FILE"

  mv "$TMP_FILE" "$ENV_FILE"
  TMP_FILE=""
  chmod 600 "$ENV_FILE"

  clear_screen
  printf 'Harly Production Setup\n'
  printf '======================\n\n'
  ok "Setup complete."
  ok "$ENV_FILE created."
  ok "DNS validated."
  ok "Database tested."
  ok "S3 tested."
  ok "Authentication secret generated."
  printf '\nYou can now deploy Harly using %s.\n' "$ENV_FILE"
  break
done
