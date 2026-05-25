const path = require("node:path");
const os = require("node:os");
require("dotenv").config();
const express = require("express");

const app = express();

const PORT = Number(process.env.PORT || 3030);
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
const SYSTEM_URL = process.env.SYSTEM_URL ? process.env.SYSTEM_URL.replace(/\/$/, "") : "";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 3000);

let lastCpuSample = readCpuSample();

app.disable("x-powered-by");

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: 0,
}));

app.get("/api/status", async (_req, res) => {
  const checkedAt = new Date().toISOString();
  const system = await readConfiguredSystemStatus();

  try {
    const response = await fetch(`${OLLAMA_URL}/api/ps`, {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        checkedAt,
        system,
        message: "Ollama responded with an error",
        status: response.status,
      });
    }

    const data = await response.json();

    return res.json({
      ok: true,
      checkedAt,
      system,
      models: Array.isArray(data.models) ? data.models : [],
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      checkedAt,
      system,
      message: "Cannot connect to Ollama",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get("/api/system", (_req, res) => {
  res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    system: readLocalSystemStatus("local"),
  });
});

async function readConfiguredSystemStatus() {
  if (!SYSTEM_URL) {
    return readLocalSystemStatus("local");
  }

  try {
    const response = await fetch(`${SYSTEM_URL}/api/system`, {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`System endpoint responded with ${response.status}`);
    }

    const data = await response.json();

    if (!data.system) {
      throw new Error("System endpoint did not return system data");
    }

    return {
      ...data.system,
      source: "remote",
      sourceUrl: SYSTEM_URL,
    };
  } catch (error) {
    return {
      ok: false,
      source: "remote",
      sourceUrl: SYSTEM_URL,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readLocalSystemStatus(source) {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const currentCpuSample = readCpuSample();
  const cpuUsagePercent = calculateCpuUsage(lastCpuSample, currentCpuSample);
  lastCpuSample = currentCpuSample;

  return {
    ok: true,
    source,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptimeSeconds: os.uptime(),
    cpu: {
      model: cpus[0]?.model || "Unknown CPU",
      cores: cpus.length,
      usagePercent: cpuUsagePercent,
      loadAverage: os.loadavg(),
    },
    memory: {
      totalBytes: totalMemory,
      freeBytes: freeMemory,
      usedBytes: usedMemory,
      usedPercent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
    },
  };
}

function readCpuSample() {
  return os.cpus().reduce(
    (sample, cpu) => {
      sample.idle += cpu.times.idle;
      sample.total += Object.values(cpu.times).reduce((sum, time) => sum + time, 0);
      return sample;
    },
    { idle: 0, total: 0 },
  );
}

function calculateCpuUsage(previous, current) {
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;

  if (totalDelta <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

app.listen(PORT, () => {
  console.log(`Ollama status dashboard running on http://localhost:${PORT}`);
  console.log(`Using Ollama URL: ${OLLAMA_URL}`);
  console.log(`Using system metrics: ${SYSTEM_URL || "local machine"}`);
});
