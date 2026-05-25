const statusPill = document.querySelector("#connection-pill");
const modelCount = document.querySelector("#model-count");
const checkedAt = document.querySelector("#checked-at");
const message = document.querySelector("#message");
const models = document.querySelector("#models");
const hostName = document.querySelector("#host-name");
const cpuUsage = document.querySelector("#cpu-usage");
const cpuMeter = document.querySelector("#cpu-meter");
const cpuCores = document.querySelector("#cpu-cores");
const cpuLoad = document.querySelector("#cpu-load");
const memoryUsage = document.querySelector("#memory-usage");
const memoryMeter = document.querySelector("#memory-meter");
const memoryFree = document.querySelector("#memory-free");
const memoryTotal = document.querySelector("#memory-total");
const hostUptime = document.querySelector("#host-uptime");
const hostPlatform = document.querySelector("#host-platform");
const hostArch = document.querySelector("#host-arch");

async function loadStatus() {
  try {
    const response = await fetch("./api/status", { cache: "no-store" });
    const data = await response.json();

    if (!data.ok) {
      renderOffline(data);
      return;
    }

    renderOnline(data);
  } catch (error) {
    renderOffline({
      checkedAt: new Date().toISOString(),
      message: "Dashboard request failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function renderOnline(data) {
  const loadedModels = Array.isArray(data.models) ? data.models : [];

  renderSystem(data.system);
  statusPill.textContent = "Online";
  statusPill.className = "pill ok";
  modelCount.textContent = String(loadedModels.length);
  checkedAt.textContent = formatDate(data.checkedAt);
  message.hidden = true;
  message.className = "message";

  if (loadedModels.length === 0) {
    models.innerHTML = '<article class="message">No model is currently loaded in Ollama memory.</article>';
    return;
  }

  models.innerHTML = loadedModels.map(renderModel).join("");
}

function renderOffline(data) {
  renderSystem(data.system);
  statusPill.textContent = "Offline";
  statusPill.className = "pill bad";
  modelCount.textContent = "-";
  checkedAt.textContent = formatDate(data.checkedAt);
  models.innerHTML = "";
  message.hidden = false;
  message.className = "message bad";
  message.textContent = [data.message, data.error].filter(Boolean).join(": ");
}

function renderSystem(system) {
  if (!system) {
    return;
  }

  if (system.ok === false) {
    hostName.textContent = system.sourceUrl ? `Remote unavailable: ${system.sourceUrl}` : "System metrics unavailable";
    cpuUsage.textContent = "-";
    cpuMeter.style.width = "0%";
    cpuCores.textContent = "-";
    cpuLoad.textContent = system.error || "-";
    memoryUsage.textContent = "-";
    memoryMeter.style.width = "0%";
    memoryFree.textContent = "-";
    memoryTotal.textContent = "-";
    hostUptime.textContent = "-";
    hostPlatform.textContent = "-";
    hostArch.textContent = "-";
    return;
  }

  const cpuPercent = clampPercent(system.cpu?.usagePercent);
  const memoryPercent = clampPercent(system.memory?.usedPercent);

  hostName.textContent = [system.hostname, system.source === "remote" ? "remote" : ""]
    .filter(Boolean)
    .join(" - ") || "-";
  cpuUsage.textContent = `${cpuPercent.toFixed(0)}%`;
  cpuMeter.style.width = `${cpuPercent}%`;
  cpuCores.textContent = formatValue(system.cpu?.cores);
  cpuLoad.textContent = Array.isArray(system.cpu?.loadAverage)
    ? system.cpu.loadAverage.map((value) => value.toFixed(2)).join(" / ")
    : "-";

  memoryUsage.textContent = `${memoryPercent.toFixed(0)}%`;
  memoryMeter.style.width = `${memoryPercent}%`;
  memoryFree.textContent = formatBytes(system.memory?.freeBytes);
  memoryTotal.textContent = formatBytes(system.memory?.totalBytes);

  hostUptime.textContent = formatDuration(system.uptimeSeconds);
  hostPlatform.textContent = formatValue(system.platform);
  hostArch.textContent = formatValue(system.arch);
}

function renderModel(model) {
  const details = model.details || {};

  return `
    <article class="model-card">
      <h2>${escapeHtml(model.model || model.name || "Unnamed model")}</h2>
      <div class="facts">
        ${fact("Family", details.family)}
        ${fact("Parameters", details.parameter_size)}
        ${fact("Quantization", details.quantization_level)}
        ${fact("Context length", model.context_length)}
        ${fact("VRAM", formatBytes(model.size_vram))}
        ${fact("Expires at", model.expires_at ? formatDate(model.expires_at) : null)}
      </div>
    </article>
  `;
}

function fact(label, value) {
  return `
    <div class="fact">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(formatValue(value))}</span>
    </div>
  `;
}

function formatValue(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return String(value);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(2)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "-";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadStatus();
setInterval(loadStatus, 3000);
