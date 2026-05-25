#!/usr/bin/env bash
set -euo pipefail

ISMC_BIN="${ISMC_BIN:-}"
TEMP_SENSOR_BIN="${TEMP_SENSOR_BIN:-}"

read_ismc_temperature() {
  [[ -n "$ISMC_BIN" && -x "$ISMC_BIN" ]] || return 1

  "$ISMC_BIN" -o table temp 2>/dev/null \
    | awk '
      /°?[[:space:]]*C/ {
        for (i = 1; i <= NF; i += 1) {
          if ($i ~ /^-?[0-9]+(\.[0-9]+)?$/ && $(i + 1) ~ /^°?C$/ && (max == "" || $i + 0 > max)) {
            max = $i + 0;
          }
        }
      }

      END {
        if (max != "") {
          printf "%.1f C\n", max;
          exit 0;
        }

        exit 1;
      }
    '
}

read_apple_sensors_temperature() {
  [[ -n "$TEMP_SENSOR_BIN" && -x "$TEMP_SENSOR_BIN" ]] || return 1

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
}

if [[ -z "$ISMC_BIN" ]]; then
  for candidate in \
    "${HOME}/go/bin/iSMC" \
    "${HOME}/.local/bin/iSMC" \
    "/opt/homebrew/bin/iSMC" \
    "/usr/local/bin/iSMC"; do
    if [[ -x "$candidate" ]]; then
      ISMC_BIN="$candidate"
      break
    fi
  done
fi

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

read_ismc_temperature && exit 0
read_apple_sensors_temperature && exit 0

echo "No supported macOS temperature helper returned a value" >&2
exit 1
