const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
require("dotenv").config();
const express = require("express");

const app = express();
const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 3030);
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
const SYSTEM_URL = process.env.SYSTEM_URL ? process.env.SYSTEM_URL.replace(/\/$/, "") : "";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 3000);
const TEMPERATURE_COMMAND = process.env.TEMPERATURE_COMMAND || "";

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

app.get("/api/system", async (_req, res) => {
  res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    system: await readLocalSystemStatus("local"),
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

async function readLocalSystemStatus(source) {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const currentCpuSample = readCpuSample();
  const cpuUsagePercent = calculateCpuUsage(lastCpuSample, currentCpuSample);
  lastCpuSample = currentCpuSample;
  const [memoryPressure, temperature] = await Promise.all([
    readMemoryPressure(totalMemory, freeMemory),
    readTemperature(),
  ]);

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
      pressure: memoryPressure,
    },
    temperature,
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

async function readMemoryPressure(totalMemory, freeMemory) {
  if (os.platform() === "darwin") {
    try {
      const { stdout } = await execFileAsync("memory_pressure", ["-Q"], { timeout: 1200 });
      const freeMatch = stdout.match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/i);

      if (freeMatch) {
        const pressurePercent = clampPercent(100 - Number(freeMatch[1]));

        return {
          percent: pressurePercent,
          label: labelPressure(pressurePercent),
          source: "memory_pressure",
        };
      }
    } catch (_error) {
      // Fall back to used memory when macOS memory_pressure is unavailable.
    }
  }

  const usedPercent = totalMemory > 0 ? ((totalMemory - freeMemory) / totalMemory) * 100 : 0;

  return {
    percent: clampPercent(usedPercent),
    label: labelPressure(usedPercent),
    source: "memory_used",
  };
}

async function readTemperature() {
  const platform = os.platform();

  if (TEMPERATURE_COMMAND) {
    const configuredTemperature = await readTemperatureCommand(
      "sh",
      ["-c", TEMPERATURE_COMMAND],
      /(-?\d+(?:\.\d+)?)/,
      "custom",
    );

    if (configuredTemperature.available) {
      return configuredTemperature;
    }
  }

  if (platform === "darwin") {
    return await firstAvailableTemperature([
      () => readTemperatureCommand("osx-cpu-temp", [], /(-?\d+(?:\.\d+)?)\s*°?\s*C/i, "osx-cpu-temp"),
      () => readTemperatureCommand("istats", ["cpu", "temp", "--value-only"], /(-?\d+(?:\.\d+)?)/, "istats"),
      () => readTemperatureCommand(
        "powermetrics",
        ["--samplers", "thermal", "-n", "1", "-i", "1000"],
        /(?:CPU|GPU|die|package)[^:\n]*temperature:\s*(-?\d+(?:\.\d+)?)/i,
        "powermetrics",
      ),
    ]);
  }

  if (platform === "linux") {
    return await readLinuxTemperature();
  }

  if (platform === "win32") {
    return await readWindowsTemperature();
  }

  return unavailableTemperature();
}

async function firstAvailableTemperature(readers) {
  for (const read of readers) {
    const result = await read();

    if (result.available) {
      return result;
    }
  }

  return unavailableTemperature();
}

async function readTemperatureCommand(command, args, pattern, source) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 1800 });
    const match = stdout.match(pattern);

    if (!match) {
      return unavailableTemperature(source);
    }

    const celsius = Number(match[1]);

    if (!Number.isFinite(celsius)) {
      return unavailableTemperature(source);
    }

    return {
      available: true,
      celsius,
      source,
    };
  } catch (_error) {
    return unavailableTemperature(source);
  }
}

async function readLinuxTemperature() {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", "cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null"], {
      timeout: 1200,
    });
    const values = stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => (value > 1000 ? value / 1000 : value));

    if (values.length === 0) {
      return unavailableTemperature("thermal_zone");
    }

    return {
      available: true,
      celsius: Math.max(...values),
      source: "thermal_zone",
    };
  } catch (_error) {
    return unavailableTemperature("thermal_zone");
  }
}

async function readWindowsTemperature() {
  try {
    const { stdout } = await execFileAsync(
      "wmic",
      ["/namespace:\\\\root\\wmi", "PATH", "MSAcpi_ThermalZoneTemperature", "get", "CurrentTemperature", "/value"],
      { timeout: 1800 },
    );
    const values = [...stdout.matchAll(/CurrentTemperature=(\d+)/gi)]
      .map((match) => Number(match[1]) / 10 - 273.15)
      .filter((value) => Number.isFinite(value));

    if (values.length === 0) {
      return unavailableTemperature("wmic");
    }

    return {
      available: true,
      celsius: Math.max(...values),
      source: "wmic",
    };
  } catch (_error) {
    return unavailableTemperature("wmic");
  }
}

function unavailableTemperature(source = "") {
  return {
    available: false,
    celsius: null,
    source,
  };
}

function labelPressure(percent) {
  if (!Number.isFinite(percent)) {
    return "unknown";
  }

  if (percent >= 85) {
    return "critical";
  }

  if (percent >= 70) {
    return "high";
  }

  if (percent >= 50) {
    return "moderate";
  }

  return "normal";
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

app.listen(PORT, () => {
  console.log(`Ollama status dashboard running on http://localhost:${PORT}`);
  console.log(`Using Ollama URL: ${OLLAMA_URL}`);
  console.log(`Using system metrics: ${SYSTEM_URL || "local machine"}`);
});
