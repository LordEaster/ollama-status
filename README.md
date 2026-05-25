# Ollama Status

Read-only web dashboard for an Ollama machine.

It shows:

- Ollama connection status
- Models currently loaded in Ollama memory
- Model details from `GET /api/ps`, including VRAM size, context length, and expiry time when available
- Host CPU usage, load average, RAM usage, uptime, platform, architecture, and hostname

Ollama itself does not expose host CPU/RAM metrics. This app reads those metrics from the machine where this service runs, so install it on the same machine that runs Ollama when you want accurate host usage.

## Requirements

- Node.js 18 or newer
- npm
- Ollama running on the target machine

## Quick Start

For temporary local use:

```bash
npm install
cp .env.example .env
npm start
```

Open:

```text
http://localhost:3030
```

## Install As An Auto-Start Service

Recommended for the Ollama machine:

```bash
cp .env.example .env
./scripts/install-service.sh
```

The installer creates a native service:

- macOS: `launchd` user agent
- Linux: `systemd` service

The service starts after reboot and restarts automatically if it exits.

Open from another device on the same network:

```text
http://OLLAMA_MACHINE_IP:3030
```

Use a different port:

Edit `.env`:

```env
PORT=8090
```

Then reinstall/restart the service:

```bash
./scripts/install-service.sh
```

Remove the service:

```bash
./scripts/uninstall-service.sh
```

## Configuration

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3030` | Port for this dashboard |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL |
| `REQUEST_TIMEOUT_MS` | `3000` | Timeout for upstream API calls |
| `SYSTEM_URL` | empty | Optional URL for another Ollama Status instance exposing `/api/system` |

Create local config from the example:

```bash
cp .env.example .env
```

Then edit `.env` for your machine. `.env` is ignored by git.

The install script reads configuration from `.env`. Do not pass runtime config in the install command; keep it in one place.

The normal setup does not need `SYSTEM_URL`. Use it only if the dashboard and Ollama are intentionally split across machines.

## API

Dashboard status:

```bash
curl http://localhost:3030/api/status
```

Local system metrics:

```bash
curl http://localhost:3030/api/system
```

Ollama running models directly:

```bash
curl http://localhost:11434/api/ps
```

`/api/ps` means loaded in memory. It does not necessarily mean a model is actively generating at that exact moment.

## Security

Do not expose this dashboard publicly without authentication or a private network boundary. It is read-only, but it still reveals host details such as hostname, CPU/RAM usage, platform, and loaded model names.

For internet-facing use, put it behind a reverse proxy with authentication.

Example Nginx subpath proxy:

```nginx
location /ollama-status/ {
    proxy_pass http://OLLAMA_MACHINE_IP:3030/;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
