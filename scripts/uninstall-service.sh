#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="ollama-status"

usage() {
  cat <<EOF
Usage: ./scripts/uninstall-service.sh [options]

Options:
  --name NAME       Service name. Default: ollama-status
  -h, --help        Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      SERVICE_NAME="${2:?Missing value for --name}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

uninstall_launchd() {
  local label="com.${SERVICE_NAME}"
  local plist_path="${HOME}/Library/LaunchAgents/${label}.plist"
  local domain="gui/$(id -u)"

  launchctl bootout "$domain" "$plist_path" >/dev/null 2>&1 || true
  rm -f "$plist_path"
  echo "Removed launchd service: $label"
}

uninstall_systemd() {
  if [[ "${EUID}" -eq 0 ]]; then
    systemctl disable --now "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    echo "Removed system service: ${SERVICE_NAME}.service"
  else
    systemctl --user disable --now "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
    rm -f "${HOME}/.config/systemd/user/${SERVICE_NAME}.service"
    systemctl --user daemon-reload
    echo "Removed user service: ${SERVICE_NAME}.service"
  fi
}

case "$(uname -s)" in
  Darwin)
    uninstall_launchd
    ;;
  Linux)
    uninstall_systemd
    ;;
  *)
    echo "Unsupported OS: $(uname -s)." >&2
    exit 1
    ;;
esac
