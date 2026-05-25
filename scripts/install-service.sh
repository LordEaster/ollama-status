#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="ollama-status"
PORT="3030"
OLLAMA_URL="http://localhost:11434"
SYSTEM_URL=""
REQUEST_TIMEOUT_MS="3000"

load_env_file() {
  local env_path="${PROJECT_DIR}/.env"

  if [[ ! -f "$env_path" ]]; then
    return
  fi

  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
    value="${value%\"}"
    value="${value#\"}"

    case "$key" in
      PORT)
        PORT="$value"
        ;;
      OLLAMA_URL)
        OLLAMA_URL="$value"
        ;;
      SYSTEM_URL)
        SYSTEM_URL="$value"
        ;;
      REQUEST_TIMEOUT_MS)
        REQUEST_TIMEOUT_MS="$value"
        ;;
    esac
  done < "$env_path"
}

load_env_file

usage() {
  cat <<EOF
Usage: ./scripts/install-service.sh [options]

Options:
  --port PORT                 Dashboard port. Default: 3030
  --ollama-url URL            Ollama API URL. Default: http://localhost:11434
  --system-url URL            Optional remote system metrics service URL
  --timeout-ms MS             Upstream request timeout. Default: 3000
  --name NAME                 Service name. Default: ollama-status
  -h, --help                  Show this help

Examples:
  ./scripts/install-service.sh --port 3030
  ./scripts/install-service.sh --port 3030 --ollama-url http://localhost:11434
  ./scripts/install-service.sh --port 3030 --ollama-url http://ollama-host.local:11434 --system-url http://ollama-host.local:3031
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="${2:?Missing value for --port}"
      shift 2
      ;;
    --ollama-url)
      OLLAMA_URL="${2:?Missing value for --ollama-url}"
      shift 2
      ;;
    --system-url)
      SYSTEM_URL="${2:?Missing value for --system-url}"
      shift 2
      ;;
    --timeout-ms)
      REQUEST_TIMEOUT_MS="${2:?Missing value for --timeout-ms}"
      shift 2
      ;;
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

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is required but was not found in PATH." >&2
  exit 1
fi

if [[ -z "$NPM_BIN" ]]; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

echo "Installing production dependencies..."
(cd "$PROJECT_DIR" && "$NPM_BIN" install --omit=dev)

xml_escape() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' \
          -e 's/</\&lt;/g' \
          -e 's/>/\&gt;/g' \
          -e 's/"/\&quot;/g'
}

install_launchd() {
  local label="com.${SERVICE_NAME}"
  local plist_path="${HOME}/Library/LaunchAgents/${label}.plist"
  local log_dir="${HOME}/Library/Logs"
  local domain="gui/$(id -u)"

  mkdir -p "$(dirname "$plist_path")" "$log_dir"

  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$label")</string>

  <key>WorkingDirectory</key>
  <string>$(xml_escape "$PROJECT_DIR")</string>

  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$NODE_BIN")</string>
    <string>$(xml_escape "${PROJECT_DIR}/server.js")</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>$(xml_escape "$PORT")</string>
    <key>OLLAMA_URL</key>
    <string>$(xml_escape "$OLLAMA_URL")</string>
    <key>SYSTEM_URL</key>
    <string>$(xml_escape "$SYSTEM_URL")</string>
    <key>REQUEST_TIMEOUT_MS</key>
    <string>$(xml_escape "$REQUEST_TIMEOUT_MS")</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$(xml_escape "${log_dir}/${SERVICE_NAME}.out.log")</string>

  <key>StandardErrorPath</key>
  <string>$(xml_escape "${log_dir}/${SERVICE_NAME}.err.log")</string>
</dict>
</plist>
EOF

  launchctl bootout "$domain" "$plist_path" >/dev/null 2>&1 || true
  launchctl bootstrap "$domain" "$plist_path"
  launchctl enable "${domain}/${label}"
  launchctl kickstart -k "${domain}/${label}"

  echo "Installed launchd service: $label"
  echo "Dashboard: http://localhost:${PORT}"
  echo "Logs: ${log_dir}/${SERVICE_NAME}.out.log and ${log_dir}/${SERVICE_NAME}.err.log"
}

systemd_escape_env() {
  printf '%s' "$1" | sed 's/"/\\"/g'
}

write_systemd_unit() {
  local service_path="$1"
  local install_target="$2"
  local user_line="$3"

  cat > "$service_path" <<EOF
[Unit]
Description=Ollama Status Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
Environment="PORT=$(systemd_escape_env "$PORT")"
Environment="OLLAMA_URL=$(systemd_escape_env "$OLLAMA_URL")"
Environment="SYSTEM_URL=$(systemd_escape_env "$SYSTEM_URL")"
Environment="REQUEST_TIMEOUT_MS=$(systemd_escape_env "$REQUEST_TIMEOUT_MS")"
ExecStart=${NODE_BIN} ${PROJECT_DIR}/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
${user_line}

[Install]
WantedBy=${install_target}
EOF
}

install_systemd() {
  if [[ "${EUID}" -eq 0 ]]; then
    local service_path="/etc/systemd/system/${SERVICE_NAME}.service"
    write_systemd_unit "$service_path" "multi-user.target" ""
    systemctl daemon-reload
    systemctl enable --now "${SERVICE_NAME}.service"
    echo "Installed system service: ${SERVICE_NAME}.service"
    echo "Status: systemctl status ${SERVICE_NAME}.service"
  else
    local user_dir="${HOME}/.config/systemd/user"
    local service_path="${user_dir}/${SERVICE_NAME}.service"
    mkdir -p "$user_dir"
    write_systemd_unit "$service_path" "default.target" ""
    systemctl --user daemon-reload
    systemctl --user enable --now "${SERVICE_NAME}.service"

    if command -v loginctl >/dev/null 2>&1; then
      loginctl enable-linger "$USER" >/dev/null 2>&1 || true
    fi

    echo "Installed user service: ${SERVICE_NAME}.service"
    echo "Status: systemctl --user status ${SERVICE_NAME}.service"
    echo "Note: user services need linger enabled to start before login. Tried: loginctl enable-linger ${USER}"
  fi

  echo "Dashboard: http://localhost:${PORT}"
}

case "$(uname -s)" in
  Darwin)
    install_launchd
    ;;
  Linux)
    install_systemd
    ;;
  *)
    echo "Unsupported OS: $(uname -s). Run with npm start or add a service manually." >&2
    exit 1
    ;;
esac
