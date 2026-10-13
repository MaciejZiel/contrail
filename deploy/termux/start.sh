#!/data/data/com.termux/files/usr/bin/sh
# Starts the API on 127.0.0.1. nginx serves the built web app and proxies /api to it.
set -eu
cd "$(dirname "$0")/../../server"
ENV_FILE="${FLIGHTMAP_ENV:-$HOME/.config/flightmap.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
mkdir -p "${DATA_DIR:-$HOME/flightmap-data}"
[ -d .venv ] || python -m venv .venv
. .venv/bin/activate
pip install --quiet -r requirements.txt
exec python -m flightmap
