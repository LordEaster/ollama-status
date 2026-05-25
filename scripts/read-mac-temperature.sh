#!/usr/bin/env bash
set -euo pipefail

TEMP_SENSOR_BIN="${TEMP_SENSOR_BIN:-}"

if [[ -z "$TEMP_SENSOR_BIN" ]]; then
  for candidate in \
    "${HOME}/apple_sensors/temp_sensor" \
    "/opt/homebrew/bin/temp_sensor" \
    "/usr/local/bin/temp_sensor"; do
    if [[ -x "$candidate" ]]; then
      TEMP_SENSOR_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$TEMP_SENSOR_BIN" || ! -x "$TEMP_SENSOR_BIN" ]]; then
  echo "temp_sensor binary not found" >&2
  exit 1
fi

"$TEMP_SENSOR_BIN" | awk -F, '
  NR == 2 {
    max = "";

    for (i = 1; i <= NF; i += 1) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i);

      if ($i ~ /^-?[0-9]+(\.[0-9]+)?$/ && (max == "" || $i + 0 > max)) {
        max = $i + 0;
      }
    }

    if (max != "") {
      printf "%.1f C\n", max;
      exit 0;
    }

    exit 1;
  }
'
