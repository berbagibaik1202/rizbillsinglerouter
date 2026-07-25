#!/bin/sh
set -eu

SERVICE_NAME="${WATCHDOG_SERVICE_NAME:-app}"
PROJECT_NAME="${WATCHDOG_PROJECT_NAME:-}"
INTERVAL_SECONDS="${WATCHDOG_INTERVAL_SECONDS:-30}"
GRACE_SECONDS="${WATCHDOG_GRACE_SECONDS:-30}"
DEBUG_MODE="${WATCHDOG_DEBUG:-false}"

log() {
    printf '%s [watchdog] %s\n' "$(date -Iseconds)" "$*"
}

debug() {
    if [ "$DEBUG_MODE" = "true" ]; then
        log "DEBUG: $*"
    fi
}

get_container_id() {
    if [ -n "$PROJECT_NAME" ]; then
        debug "Looking up container for project=${PROJECT_NAME}, service=${SERVICE_NAME}"
        docker ps -q \
            --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
            --filter "label=com.docker.compose.service=${SERVICE_NAME}" | head -n 1
    else
        debug "Looking up container for service=${SERVICE_NAME}"
        docker ps -q \
            --filter "label=com.docker.compose.service=${SERVICE_NAME}" | head -n 1
    fi
}

restart_container() {
    container_id="$1"
    status="$2"

    log "Container ${container_id} is ${status}. Restarting..."
    if docker restart "$container_id" >/dev/null 2>&1; then
        log "Container ${container_id} restarted."
    else
        log "Failed to restart container ${container_id}."
    fi

    sleep "$GRACE_SECONDS"
}

while true; do
    container_id="$(get_container_id || true)"

    if [ -z "$container_id" ]; then
        debug "App container not found yet. Waiting..."
        sleep "$INTERVAL_SECONDS"
        continue
    fi

    health_status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    debug "Container ${container_id} current status=${health_status}"

    case "$health_status" in
        healthy|starting)
            ;;
        unhealthy)
            restart_container "$container_id" "$health_status"
            ;;
        exited|dead)
            restart_container "$container_id" "$health_status"
            ;;
        "")
            log "Unable to read health status for ${container_id}. Will retry."
            ;;
        *)
            log "Container ${container_id} status=${health_status}. No action taken."
            ;;
    esac

    sleep "$INTERVAL_SECONDS"
done
