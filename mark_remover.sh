#!/usr/bin/env bash
# ------------------------------------------------------------
# watermarks-remover service starter
# ------------------------------------------------------------
# This script launches the local HTTP service that powers the
# `remove-ai-marks` skill. The service is a tiny Python HTTP server
# (service/scripts/server.py) which listens on 127.0.0.1:8765 by default.
#
# Prerequisites
# --------------
# 1. Python 3.10+ must be available (the code uses the "|" union type
#    syntax). If your system default is older, you can install a newer
#    version via Homebrew:
#       brew install python@3.11
#    and ensure the `python3` in the PATH points to that version.
# 2. All Python dependencies are standard-library only – no extra pip
#    packages are required.
#
# Usage
# -----
#   ./start_watermarks_service.sh [--host <address>] [--port <port>]
#
# Options:
#   --host   IP address to bind (default: 127.0.0.1)
#   --port   TCP port (default: 8765)
#
# Example:
#   ./start_watermarks_service.sh --host 0.0.0.0 --port 8080
#   # Service will be reachable at http://0.0.0.0:8080
#
# After the service is running you can invoke the skill from Antigravity:
#   /remove-ai-marks /path/to/file.pdf
# or use the CLI helpers, e.g.:
#   python watermarks-remover-main/service/scripts/clean_file.py \
#       /path/to/input.pdf -o /path/to/output_clean.pdf
# ------------------------------------------------------------

# Change to the directory that contains the service code
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}/watermarks-remover-main"
cd "${PROJECT_ROOT}" || { echo "Failed to cd into ${PROJECT_ROOT}"; exit 1; }

# Default values
HOST="127.0.0.1"
PORT="8765"

# Parse optional arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --host)
      HOST="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--host <address>] [--port <port>]"
      exit 1
      ;;
  esac
done

# Detect a Python binary >= 3.10
PYTHON_BIN=""
for cmd in python3 python /Users/nitinsingh/miniconda3/bin/python3 /Users/nitinsingh/miniconda3/bin/python /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if command -v "$cmd" >/dev/null 2>&1; then
    if "$cmd" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      PYTHON_BIN="$cmd"
      break
    fi
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "Error: No Python >= 3.10 found. Please ensure Python 3.10+ is installed and in your PATH."
  exit 1
fi

# Start the service
echo "Starting watermarks-remover service on ${HOST}:${PORT} using $("$PYTHON_BIN" --version 2>&1)..."
"$PYTHON_BIN" service/scripts/server.py --host "${HOST}" --port "${PORT}"