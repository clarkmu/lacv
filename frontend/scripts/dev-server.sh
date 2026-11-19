#!/bin/sh
# The source-live development frontend (docker-compose.dev.yml): keep node_modules in step with package-lock.json, run Vite.
#
# node_modules lives in a named Docker volume that outlives the container, and `docker compose up` leaves a running
# container alone, so installing only when the container starts misses dependencies added while the stack is running
# (e.g. by a coding agent or a git pull). This script installs whenever package-lock.json differs from what was last
# installed into the volume, and keeps watching it: a changed lockfile is installed and Vite restarted, with no manual step.
set -eu

cd "$(dirname "$0")/.."
STAMP=node_modules/.lacv-installed-lockfile.sha256
POLL_SECONDS="${LACV_DEPENDENCY_POLL_SECONDS:-5}"

lockfile_hash() {
	cat package.json package-lock.json | sha256sum | cut -d ' ' -f 1
}

install_if_changed() {
	wanted="$(lockfile_hash)"
	if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$wanted" ]; then
		echo "[dev-server] package.json or package-lock.json changed: installing dependencies"
		npm install --no-audit --no-fund
		# npm install may normalise the lockfile; record what is now installed.
		lockfile_hash > "$STAMP"
		return 0
	fi
	return 1
}

vite_pid=""
start_vite() {
	# Vite itself (as `npm run dev` would run it), so this PID is the server and stopping it stops the server.
	./node_modules/.bin/vite --host 0.0.0.0 &
	vite_pid=$!
}
stop_vite() {
	if [ -n "$vite_pid" ] && kill -0 "$vite_pid" 2>/dev/null; then
		kill -TERM "$vite_pid" 2>/dev/null || true
		wait "$vite_pid" 2>/dev/null || true
	fi
	vite_pid=""
}
trap 'stop_vite; exit 0' TERM INT

install_if_changed || echo "[dev-server] dependencies match package-lock.json"
start_vite
while true; do
	sleep "$POLL_SECONDS" &
	wait $! || true
	if ! kill -0 "$vite_pid" 2>/dev/null; then
		echo "[dev-server] Vite exited; restarting"
		start_vite
		continue
	fi
	if install_if_changed; then
		echo "[dev-server] restarting Vite with the new dependencies"
		stop_vite
		start_vite
	fi
done
