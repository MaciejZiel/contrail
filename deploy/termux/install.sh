#!/data/data/com.termux/files/usr/bin/sh
# Run by hand on every deploy or update (needs network): creates the virtualenv, installs the pure-Python
# requirements and builds the web app. The service itself (start.sh) never touches the network at boot.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/server"
[ -d .venv ] || python -m venv .venv
. .venv/bin/activate
pip install --quiet -r requirements.txt
cd "$ROOT/web"
npm ci
npm run build
echo "installed; restart the service (kill the running start.sh, the supervisor starts it again)"
