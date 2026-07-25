#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/docker.env"
ENV_EXAMPLE="$SCRIPT_DIR/docker.env.example"

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Command not found: $1"
}

sanitize_slug() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

resolve_existing() {
  local key="$1"
  if [ -f "$ENV_FILE" ]; then
    local line
    line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
    if [ -n "$line" ]; then
      decode_env_value "${line#*=}"
      return 0
    fi
  fi
  printf '%s' ""
}

resolve_example() {
  local key="$1"
  if [ -f "$ENV_EXAMPLE" ]; then
    local line
    line="$(grep -E "^${key}=" "$ENV_EXAMPLE" | tail -n 1 || true)"
    if [ -n "$line" ]; then
      decode_env_value "${line#*=}"
      return 0
    fi
  fi
  printf '%s' ""
}

decode_env_value() {
  local value="${1:-}"

  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
    value="${value//\\\\/\\}"
    value="${value//\\n/$'\n'}"
    value="${value//\\r/$'\r'}"
    value="${value//\\t/$'\t'}"
    value="${value//\\\"/\"}"
    printf '%s' "$value"
    return 0
  fi

  if [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
    value="${value//\'\"\'\"\'/\'}"
  fi

  printf '%s' "$value"
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
    return 0
  fi

  tr -dc 'a-f0-9' </dev/urandom | head -c 48 || true
}

quote_env_value() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '"%s"' "$value"
}

load_value() {
  local key="$1"
  local default="${2:-}"
  local value="${!key:-}"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi

  value="$(resolve_existing "$key")"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi

  printf '%s' "$default"
}

load_value_from_example() {
  local key="$1"
  local default="${2:-}"
  local value="${!key:-}"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi

  value="$(resolve_existing "$key")"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi

  value="$(resolve_example "$key")"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi

  printf '%s' "$default"
}

load_secret() {
  local key="$1"
  local existing
  existing="${!key:-}"
  if [ -n "$existing" ]; then
    printf '%s' "$existing"
    return 0
  fi

  existing="$(resolve_existing "$key")"
  if [ -n "$existing" ]; then
    printf '%s' "$existing"
    return 0
  fi

  generate_secret
}

load_secret_from_example() {
  local key="$1"
  local existing
  existing="${!key:-}"
  if [ -n "$existing" ]; then
    printf '%s' "$existing"
    return 0
  fi

  existing="$(resolve_existing "$key")"
  if [ -n "$existing" ]; then
    printf '%s' "$existing"
    return 0
  fi

  existing="$(resolve_example "$key")"
  if [ -n "$existing" ]; then
    printf '%s' "$existing"
    return 0
  fi

  generate_secret
}

write_env_file() {
  cat > "$ENV_FILE" <<EOF
COMPOSE_PROJECT_NAME=$(quote_env_value "$COMPOSE_PROJECT_NAME")
APP_INSTANCE_NAME=$(quote_env_value "$APP_INSTANCE_NAME")
PROXY_NETWORK_NAME=$(quote_env_value "$PROXY_NETWORK_NAME")
UPDATER_UID=$(quote_env_value "$UPDATER_UID")
UPDATER_GID=$(quote_env_value "$UPDATER_GID")
DOCKER_GID=$(quote_env_value "$DOCKER_GID")
UPDATER_SSH_DIR=$(quote_env_value "$UPDATER_SSH_DIR")

NODE_ENV=production
APP_HOST=$(quote_env_value "$APP_HOST")
PORT=$(quote_env_value "$PORT")
AUTO_MIGRATE_ON_START=true
DISABLE_BACKGROUND_SERVICES=$(quote_env_value "$DISABLE_BACKGROUND_SERVICES")
DISABLE_WHATSAPP=$(quote_env_value "$DISABLE_WHATSAPP")
WA_SESSION_BASE_DIR=$(quote_env_value "$WA_SESSION_BASE_DIR")

JWT_SECRET=$(quote_env_value "$JWT_SECRET")
KIRIMDEV_WEBHOOK_SECRET=$(quote_env_value "$KIRIMDEV_WEBHOOK_SECRET")
KIRIMDEV_WEBHOOK_SECRET_PREVIOUS=$(quote_env_value "$KIRIMDEV_WEBHOOK_SECRET_PREVIOUS")
KIRIM_WEBHOOK_SECRET=$(quote_env_value "$KIRIM_WEBHOOK_SECRET")
KIRIM_WEBHOOK_SECRET_PREVIOUS=$(quote_env_value "$KIRIM_WEBHOOK_SECRET_PREVIOUS")
DIGIFLAZZ_WEBHOOK_SECRET=$(quote_env_value "$DIGIFLAZZ_WEBHOOK_SECRET")
API_KEY=$(quote_env_value "$API_KEY")
APP_UPDATE_SERVICE_URL=http://app-updater:3140
APP_UPDATE_TOKEN=$(quote_env_value "$APP_UPDATE_TOKEN")
APP_UPDATE_REPO_URL=$(quote_env_value "$APP_UPDATE_REPO_URL")
APP_UPDATE_GIT_REMOTE=$(quote_env_value "$APP_UPDATE_GIT_REMOTE")
APP_UPDATE_GIT_BRANCH=$(quote_env_value "$APP_UPDATE_GIT_BRANCH")
APP_UPDATE_COMPOSE_FILE=$(quote_env_value "$APP_UPDATE_COMPOSE_FILE")
APP_UPDATE_ENV_FILE=$(quote_env_value "$APP_UPDATE_ENV_FILE")

DB_HOST=mariadb
DB_PORT=3306
DB_NAME=$(quote_env_value "$DB_NAME")
DB_USER=$(quote_env_value "$DB_USER")
DB_PASSWORD=$(quote_env_value "$DB_PASSWORD")

MARIADB_ROOT_PASSWORD=$(quote_env_value "$MARIADB_ROOT_PASSWORD")
MARIADB_DATABASE=$(quote_env_value "$DB_NAME")
MARIADB_USER=$(quote_env_value "$DB_USER")
MARIADB_PASSWORD=$(quote_env_value "$DB_PASSWORD")

TRIPAY_MERCHANT_CODE=$(quote_env_value "$TRIPAY_MERCHANT_CODE")
TRIPAY_API_KEY=$(quote_env_value "$TRIPAY_API_KEY")
TRIPAY_PRIVATE_KEY=$(quote_env_value "$TRIPAY_PRIVATE_KEY")
EOF
}

ensure_dirs() {
  mkdir -p backend/uploads backend/whatsapp_session
}

ensure_proxy_network() {
  if docker network inspect "$PROXY_NETWORK_NAME" >/dev/null 2>&1; then
    log "Proxy network exists: $PROXY_NETWORK_NAME"
    return 0
  fi

  log "Creating proxy network: $PROXY_NETWORK_NAME"
  docker network create "$PROXY_NETWORK_NAME" >/dev/null
}

main() {
  require_cmd docker

  if ! docker compose version >/dev/null 2>&1; then
    die "Docker Compose plugin tidak tersedia."
  fi

  if [ ! -f "$ENV_EXAMPLE" ]; then
    die "Template env tidak ditemukan: $ENV_EXAMPLE"
  fi

  local folder_slug
  folder_slug="$(sanitize_slug "$(basename "$SCRIPT_DIR")")"
  [ -n "$folder_slug" ] || folder_slug="app"

  APP_INSTANCE_NAME="$(load_value APP_INSTANCE_NAME "$folder_slug")"
  APP_INSTANCE_NAME="$(sanitize_slug "$APP_INSTANCE_NAME")"
  [ -n "$APP_INSTANCE_NAME" ] || APP_INSTANCE_NAME="app"

  COMPOSE_PROJECT_NAME="$(load_value COMPOSE_PROJECT_NAME "rizbill_${APP_INSTANCE_NAME}")"
  COMPOSE_PROJECT_NAME="$(sanitize_slug "$COMPOSE_PROJECT_NAME")"
  [ -n "$COMPOSE_PROJECT_NAME" ] || COMPOSE_PROJECT_NAME="rizbill-${APP_INSTANCE_NAME}"

  PROXY_NETWORK_NAME="$(load_value PROXY_NETWORK_NAME "proxy-network")"
  PROXY_NETWORK_NAME="$(sanitize_slug "$PROXY_NETWORK_NAME")"
  [ -n "$PROXY_NETWORK_NAME" ] || PROXY_NETWORK_NAME="proxy-network"

  UPDATER_UID="$(load_value UPDATER_UID "$(id -u)")"
  UPDATER_GID="$(load_value UPDATER_GID "$(id -g)")"
  if command -v getent >/dev/null 2>&1; then
    DOCKER_GID_DEFAULT="$(getent group docker | awk -F: '{print $3}' | head -n 1)"
  else
    DOCKER_GID_DEFAULT=""
  fi
  DOCKER_GID="$(load_value DOCKER_GID "${DOCKER_GID_DEFAULT:-0}")"
  UPDATER_SSH_DIR="$(load_value UPDATER_SSH_DIR "${HOME}/.ssh")"

  APP_HOST="$(load_value APP_HOST "0.0.0.0")"
  PORT="$(load_value PORT "3002")"
  WA_SESSION_BASE_DIR="$(load_value WA_SESSION_BASE_DIR "/app/whatsapp_sessions/${APP_INSTANCE_NAME}")"

  DB_NAME="$(load_value DB_NAME "${APP_INSTANCE_NAME}_db")"
  DB_USER="$(load_value DB_USER "$DB_NAME")"
  DB_PASSWORD="$(load_secret DB_PASSWORD)"
  MARIADB_ROOT_PASSWORD="$(load_secret MARIADB_ROOT_PASSWORD)"
  JWT_SECRET="$(load_secret JWT_SECRET)"

  DISABLE_BACKGROUND_SERVICES="$(load_value DISABLE_BACKGROUND_SERVICES "false")"
  DISABLE_WHATSAPP="$(load_value DISABLE_WHATSAPP "false")"

  KIRIMDEV_WEBHOOK_SECRET="$(load_value KIRIMDEV_WEBHOOK_SECRET "")"
  KIRIMDEV_WEBHOOK_SECRET_PREVIOUS="$(load_value KIRIMDEV_WEBHOOK_SECRET_PREVIOUS "")"
  KIRIM_WEBHOOK_SECRET="$(load_value KIRIM_WEBHOOK_SECRET "")"
  KIRIM_WEBHOOK_SECRET_PREVIOUS="$(load_value KIRIM_WEBHOOK_SECRET_PREVIOUS "")"
  DIGIFLAZZ_WEBHOOK_SECRET="$(load_value DIGIFLAZZ_WEBHOOK_SECRET "")"
  API_KEY="$(load_value API_KEY "")"
  APP_UPDATE_TOKEN="$(load_secret_from_example APP_UPDATE_TOKEN)"
  APP_UPDATE_REPO_URL="$(load_value_from_example APP_UPDATE_REPO_URL "https://github.com/berbagibaik1202/rizbillsinglepub.git")"
  APP_UPDATE_GIT_REMOTE="$(load_value_from_example APP_UPDATE_GIT_REMOTE "origin")"
  APP_UPDATE_GIT_BRANCH="$(load_value_from_example APP_UPDATE_GIT_BRANCH "main")"
  APP_UPDATE_COMPOSE_FILE="$(load_value_from_example APP_UPDATE_COMPOSE_FILE "docker-compose.vps.yml")"
  APP_UPDATE_ENV_FILE="$(load_value_from_example APP_UPDATE_ENV_FILE "docker.env")"
  TRIPAY_MERCHANT_CODE="$(load_value TRIPAY_MERCHANT_CODE "")"
  TRIPAY_API_KEY="$(load_value TRIPAY_API_KEY "")"
  TRIPAY_PRIVATE_KEY="$(load_value TRIPAY_PRIVATE_KEY "")"

  write_env_file
  ensure_dirs

  log "docker.env ready at: $ENV_FILE"
  log "Instance: $APP_INSTANCE_NAME"
  log "Project: $COMPOSE_PROJECT_NAME"
  log "Database: $DB_NAME"
  log "NPM upstream hostname: $APP_INSTANCE_NAME"
  log "NPM upstream port: 3002"
  log "WhatsApp session dir: $WA_SESSION_BASE_DIR"

  ensure_proxy_network

  local compose_args=(--env-file docker.env -f docker-compose.vps.yml up -d --build)
  if [ "${START_PROXY_MANAGER:-false}" = "true" ]; then
    compose_args+=(--profile proxy)
    log "Proxy profile enabled."
  fi

  docker compose "${compose_args[@]}"

  log "Install complete."
  log "Check status with: docker compose --env-file docker.env -f docker-compose.vps.yml ps"
}

main "$@"
