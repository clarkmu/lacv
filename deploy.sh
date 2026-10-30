#!/usr/bin/env bash
set -Eeuo pipefail

# LACV deployer for the DGX Spark
# Run on the DGX from the deployment checkout (~/code/lacv):
#   ./deploy.sh            deploy the production branch
#   ./deploy.sh --dry-run  show current vs target state; change nothing
#
# Steps: fetch, fast-forward the production branch, check PostgreSQL, build
# images, back up the database (pg_dump -Fc), recreate the backend (its
# startup runs `alembic upgrade head`), verify the migration and health, then
# recreate the frontend and gateway and run the gateway health checks.
#
# It never runs git clean/reset, never deletes volumes, never seeds or
# restores the database, and never downgrades Alembic. If a deployment fails
# after the backend started, restoring the backup is a manual operator action
# (README.md, "Restoring a backup").
#
# Settings (environment):
#   LACV_DEPLOY_BRANCH     production branch (default: origin's default branch)
#   LACV_BACKUP_DIR        backup directory (default: ~/lacv-backups)
#   LACV_BACKEND_TIMEOUT   seconds to wait for backend migration + health (default: 300)

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REQUIRED_SERVICES="db backend frontend gateway"
DEPLOY_TOOLING="deploy.sh deploy/backup-db.sh"
BACKEND_TIMEOUT="${LACV_BACKEND_TIMEOUT:-300}"
DB_TIMEOUT=120
TOTAL_STEPS=9

dry_run=false
step="starting"
containers_touched=false
deployed=false
backup_file=""
branch=""
current_commit=""
target_commit=""
db_revision_before=""
db_revision_after=""
target_head=""

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

say() {
    printf '%s\n' "$*"
}

begin_step() {
    step="$2"
    printf '\n[%s/%s] %s\n' "$1" "$TOTAL_STEPS" "$2"
}

compose() {
    docker compose "$@"
}

usage() {
    sed -n '4,23p' "$REPO_DIR/deploy.sh" | sed 's/^# \{0,1\}//'
}

# ----- Failure reporting ------------------------------------------------------

on_exit() {
    local rc=$?
    if [[ $rc -eq 0 || "$dry_run" == true || "$deployed" == true ]]; then
        return
    fi
    printf '\nDEPLOYMENT FAILED during: %s (exit %s)\n' "$step" "$rc" >&2
    if [[ "$containers_touched" == true ]]; then
        printf '\n--- docker compose ps ---\n' >&2
        compose ps -a >&2 || true
        printf '\n--- Recent backend log ---\n' >&2
        compose logs --no-color --tail 80 backend >&2 || true
        if [[ "$step" == *gateway* || "$step" == *health* ]]; then
            printf '\n--- Recent gateway log ---\n' >&2
            compose logs --no-color --tail 30 gateway >&2 || true
        fi
        printf '\nDatabase revision now: %s\n' "$(db_revision 2>/dev/null || printf 'unknown')" >&2
    fi
    if [[ -n "$current_commit" && -n "$target_commit" ]]; then
        printf 'Git checkout: %s (was %s)\n' "$(git rev-parse --short HEAD 2>/dev/null || printf '?')" "${current_commit:0:12}" >&2
    fi
    if [[ -n "$backup_file" ]]; then
        printf 'Pre-deployment backup: %s\n' "$backup_file" >&2
    fi
    printf 'No automatic database restore or rollback was attempted.\n' >&2
    if [[ "$containers_touched" == true ]]; then
        printf 'If the migration changed the schema, restoring the backup is a manual decision; see README.md, "Restoring a backup".\n' >&2
    fi
}

# ----- Checks -----------------------------------------------------------------

acquire_lock() {
    command -v flock >/dev/null 2>&1 || {
        say "Note: flock is not available; concurrent deployments are not prevented."
        return
    }
    local lock_file="${XDG_RUNTIME_DIR:-/tmp}/lacv-deploy.lock"
    exec 9>"$lock_file"
    flock -n 9 || die "Another LACV deployment is running (lock: $lock_file)."
}

check_repository() {
    cd "$REPO_DIR"
    command -v git >/dev/null 2>&1 || die "git is not installed."
    command -v docker >/dev/null 2>&1 || die "docker is not installed."
    docker compose version >/dev/null 2>&1 || die "docker compose is not available (or this user cannot reach the Docker daemon)."

    local toplevel
    toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || die "$REPO_DIR is not a Git repository."
    [[ "$(cd "$toplevel" && pwd -P)" == "$REPO_DIR" ]] || die "deploy.sh must live at the repository root."

    local file
    for file in docker-compose.yml backend/Dockerfile backend/docker-entrypoint.sh backend/alembic.ini backend/alembic/versions deploy/backup-db.sh; do
        [[ -e "$file" ]] || die "Missing $file; this does not look like the LACV repository."
    done
    local origin_url
    origin_url="$(git remote get-url origin 2>/dev/null)" || die "No 'origin' remote is configured."
    [[ "$origin_url" =~ /lacv(\.git)?/?$ ]] || die "origin ($origin_url) is not the LACV repository."

    local services service
    services=" $(compose config --services | tr '\n' ' ') "
    for service in $REQUIRED_SERVICES; do
        [[ "$services" == *" $service "* ]] || die "docker-compose.yml has no '$service' service."
    done
}

check_clean_tree() {
    local status
    status="$(git status --porcelain --untracked-files=normal)"
    if [[ -n "$status" ]]; then
        printf '\nGit working tree is not clean:\n' >&2
        git status --short >&2
        die "Commit, stash, or remove these changes yourself before deploying. Nothing was changed."
    fi
}

resolve_branch() {
    branch="${LACV_DEPLOY_BRANCH:-}"
    if [[ -z "$branch" ]]; then
        branch="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
        branch="${branch#origin/}"
    fi
    if [[ -z "$branch" ]] && git show-ref --verify --quiet refs/remotes/origin/main; then
        branch="main"
    fi
    [[ -n "$branch" ]] || die "Cannot determine the production branch; set LACV_DEPLOY_BRANCH."

    local checked_out
    checked_out="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
    [[ "$checked_out" == "$branch" ]] \
        || die "The checkout is on '${checked_out:-detached HEAD}', not the production branch '$branch'. Run 'git switch $branch' first."
}

plan_update() {
    git fetch --quiet origin || die "git fetch origin failed."
    git show-ref --verify --quiet "refs/remotes/origin/$branch" || die "origin has no branch '$branch'."
    current_commit="$(git rev-parse HEAD)"
    target_commit="$(git rev-parse "refs/remotes/origin/$branch")"

    say "Branch:  $branch"
    say "Current: $(git log -1 --format='%h %s (%an, %ad)' --date=short "$current_commit")"
    say "Target:  $(git log -1 --format='%h %s (%an, %ad)' --date=short "$target_commit")"

    if [[ "$current_commit" == "$target_commit" ]]; then
        say "The checkout is already at the target commit; this will rebuild and redeploy it."
    elif git merge-base --is-ancestor "$current_commit" "$target_commit"; then
        say "Incoming commits ($(git rev-list --count "$current_commit..$target_commit")):"
        git log --oneline --no-decorate -n 30 "$current_commit..$target_commit" | sed 's/^/  /'
    else
        die "Local '$branch' has commits that are not on origin/$branch, so a fast-forward is impossible. Resolve this by hand; nothing was changed."
    fi
}

# Alembic heads of the target commit, read from the migration files in Git.
target_alembic_heads() {
    local revisions="" downs="" file content
    for file in $(git ls-tree --name-only "$target_commit" backend/alembic/versions/); do
        [[ "$file" == *.py ]] || continue
        content="$(git show "$target_commit:$file")"
        revisions="$revisions $(printf '%s\n' "$content" | sed -n -E "s/^revision[^=]*=[[:space:]]*[\"']([^\"']+)[\"'].*/\1/p")"
        downs="$downs $(printf '%s\n' "$content" | sed -n -E "s/^down_revision[^=]*=[[:space:]]*[\"']([^\"']+)[\"'].*/\1/p")"
    done
    local revision heads=""
    for revision in $revisions; do
        [[ " $downs " == *" $revision "* ]] || heads="$heads $revision"
    done
    printf '%s\n' "${heads# }"
}

db_container_running() {
    [[ -n "$(compose ps -q db 2>/dev/null)" ]]
}

# Read-only. Credentials come from the db container's own environment.
db_revision() {
    compose exec -T db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -X -q -t -A' <<'SQL'
SELECT CASE
    WHEN to_regclass('alembic_version') IS NULL THEN '(none)'
    ELSE COALESCE((xpath('/row/v/text()', query_to_xml('SELECT string_agg(version_num, '','') AS v FROM alembic_version', false, true, '')))[1]::text, '(none)')
END;
SQL
}

report_migrations() {
    target_head="$(target_alembic_heads)"
    [[ -n "$target_head" ]] || die "No Alembic revisions found in the target commit."
    [[ "$target_head" != *" "* ]] || die "The target commit has several Alembic heads ($target_head); 'alembic upgrade head' would fail."

    local new_files
    new_files="$(git diff --name-only --diff-filter=A "$current_commit" "$target_commit" -- backend/alembic/versions/ | grep '\.py$' || true)"
    say "Target Alembic head: $target_head"
    if [[ -n "$new_files" ]]; then
        say "New migrations in this update:"
        printf '%s\n' "$new_files" | sed 's/^/  /'
    else
        say "No new migration files in this update."
    fi

    if db_container_running; then
        db_revision_before="$(db_revision)" || die "Could not read the Alembic revision from the database."
        say "Database revision:   $db_revision_before"
        if [[ "$db_revision_before" == "$target_head" ]]; then
            say "Database is already at the target head; backend startup should not migrate."
        else
            say "Backend startup WILL run 'alembic upgrade head' ($db_revision_before -> $target_head)."
        fi
    else
        db_revision_before="unknown (db not running)"
        say "Database revision:   unknown (the db service is not running)"
    fi
}

# ----- Deployment steps ---------------------------------------------------------

ensure_database() {
    [[ -n "$(compose ps -a -q db)" ]] \
        || die "No existing db container. deploy.sh never initializes a database (that would load schema.sql and seed data); set up a new installation by hand."
    compose up -d --no-deps db
    containers_touched=true
    local container waited=0 health
    container="$(compose ps -q db)"
    [[ -n "$container" ]] || die "The db service did not start."
    while true; do
        health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")"
        [[ "$health" == "healthy" ]] && break
        [[ "$health" != "none" ]] || die "The db container has no healthcheck; refusing to continue."
        (( waited < DB_TIMEOUT )) || die "PostgreSQL did not become healthy within ${DB_TIMEOUT}s (status: $health)."
        sleep 2
        waited=$((waited + 2))
    done
    say "PostgreSQL is healthy."
    db_revision_before="$(db_revision)" || die "Could not read the Alembic revision from the database."
}

fast_forward() {
    if [[ "$current_commit" == "$target_commit" ]]; then
        say "Already at $(git rev-parse --short HEAD)."
        return
    fi
    git merge --ff-only --quiet "$target_commit" || die "Fast-forward failed; nothing was merged."
    say "Checkout fast-forwarded to $(git rev-parse --short HEAD)."

    local tooling_changed
    tooling_changed="$(git diff --name-only "$current_commit" "$target_commit" -- $DEPLOY_TOOLING)"
    if [[ -n "$tooling_changed" && -z "${LACV_DEPLOY_REEXEC:-}" ]]; then
        say "The deployment tooling changed in this update; restarting with the new deploy.sh."
        deployed=true  # nothing has failed; do not print a failure report on exec
        export LACV_DEPLOY_REEXEC=1
        exec "$REPO_DIR/deploy.sh"
    fi
}

build_images() {
    # Building does not stop or replace the running containers.
    compose build backend frontend gateway
}

back_up_database() {
    backup_file="$("$REPO_DIR/deploy/backup-db.sh" --label "pre-deploy-$(git rev-parse --short HEAD)" | tail -n 1)"
    [[ -n "$backup_file" && -s "$backup_file" ]] || die "Backup failed; the backend was not touched."
}

wait_for_backend() {
    local container waited=0 state
    while true; do
        container="$(compose ps -a -q backend)"
        [[ -n "$container" ]] || die "The backend container does not exist."
        state="$(docker inspect -f '{{.State.Status}}' "$container")"
        case "$state" in
            exited|dead) die "The backend exited during startup (migration or server failure)." ;;
            restarting) die "The backend is restarting (crash loop) during startup." ;;
        esac
        if [[ "$state" == "running" ]] && backend_healthy; then
            break
        fi
        (( waited < BACKEND_TIMEOUT )) || die "The backend did not become healthy within ${BACKEND_TIMEOUT}s."
        sleep 3
        waited=$((waited + 3))
    done
    say "Backend is running and /health answers ok."
}

# The backend's own /health endpoint, inside its container (uvicorn only starts
# after `alembic upgrade head` succeeds). Its TLS certificate is self-signed.
backend_healthy() {
    compose exec -T backend python - >/dev/null 2>&1 <<'PY'
import json, ssl, sys, urllib.request
context = ssl.create_default_context()
context.check_hostname = False
context.verify_mode = ssl.CERT_NONE
with urllib.request.urlopen("https://127.0.0.1:8000/health", context=context, timeout=5) as response:
    sys.exit(0 if json.load(response).get("status") == "ok" else 1)
PY
}

start_backend() {
    compose up -d --no-deps --force-recreate backend
    wait_for_backend
    db_revision_after="$(db_revision)" || die "Could not read the Alembic revision after startup."
    [[ "$db_revision_after" == "$target_head" ]] \
        || die "Database revision is '$db_revision_after' after startup, expected '$target_head'."
    say "Database revision: $db_revision_before -> $db_revision_after"
}

start_frontend_and_gateway() {
    compose up -d --no-deps --force-recreate frontend
    # nginx resolves backend/frontend addresses when it starts, so the gateway
    # is recreated after both of them.
    compose up -d --no-deps --force-recreate gateway
}

check_services_running() {
    local running service
    running=" $(compose ps --status running --services | tr '\n' ' ') "
    compose ps
    for service in $REQUIRED_SERVICES; do
        [[ "$running" == *" $service "* ]] || die "Service '$service' is not running."
    done
}

# Through the gateway, as a browser reaches the app: the API health endpoint
# and the frontend index page.
check_gateway() {
    local published port attempt
    published="$(compose port gateway 443 | tail -n 1)"
    port="${published##*:}"
    [[ "$port" =~ ^[0-9]+$ ]] || die "Could not find the gateway's published HTTPS port."
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if http_ok "https://127.0.0.1:$port/api/health" '"status":"ok"' && http_ok "https://127.0.0.1:$port/" '<div id="root">'; then
            say "Gateway https://localhost:$port: /api/health ok, frontend ok."
            gateway_url="https://localhost:$port"
            return
        fi
        sleep 2
    done
    die "Gateway health checks failed (https://127.0.0.1:$port/api/health and /)."
}

http_ok() {
    local url="$1" expected="$2" body
    if command -v curl >/dev/null 2>&1; then
        body="$(curl -fsSk --max-time 5 "$url")" || return 1
    else
        body="$(python3 -c 'import ssl, sys, urllib.request; print(urllib.request.urlopen(sys.argv[1], context=ssl._create_unverified_context(), timeout=5).read().decode())' "$url")" || return 1
    fi
    [[ "$body" == *"$expected"* ]]
}

# ----- Main ---------------------------------------------------------------------

main() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) dry_run=true ;;
            -h|--help) usage; exit 0 ;;
            *) die "Unknown argument: $1 (see ./deploy.sh --help)" ;;
        esac
        shift
    done
    trap on_exit EXIT

    printf '\n== LACV deploy%s ==\n' "$([[ "$dry_run" == true ]] && printf ' (dry run)')"
    printf 'Checkout: %s\n' "$REPO_DIR"

    begin_step 1 "Checking repository"
    check_repository
    acquire_lock
    check_clean_tree
    resolve_branch

    begin_step 2 "Fetching origin and planning update"
    plan_update

    begin_step 3 "Checking migrations"
    report_migrations

    if [[ "$dry_run" == true ]]; then
        printf '\nDry run: nothing was changed (only refs from origin were fetched).\n'
        printf 'A real run would fast-forward to %s, build backend/frontend/gateway, back up the\n' "${target_commit:0:12}"
        printf 'database to %s, recreate the backend (running migrations), then frontend and gateway.\n' "${LACV_BACKUP_DIR:-$HOME/lacv-backups}"
        if db_container_running; then
            printf '\nCurrent services:\n'
            compose ps
        fi
        return
    fi

    begin_step 4 "Checking PostgreSQL"
    ensure_database

    begin_step 5 "Fast-forwarding $branch"
    fast_forward

    begin_step 6 "Building images (running containers are untouched)"
    build_images

    begin_step 7 "Backing up the database"
    back_up_database

    begin_step 8 "Starting backend (runs alembic upgrade head)"
    start_backend

    begin_step 9 "Starting frontend and gateway; health checks"
    start_frontend_and_gateway
    check_services_running
    check_gateway

    deployed=true
    printf '\n== Deployment complete ==\n'
    printf 'Commit:            %s\n' "$(git log -1 --format='%h %s' HEAD)"
    printf 'Alembic revision:  %s -> %s\n' "$db_revision_before" "$db_revision_after"
    printf 'Backup:            %s\n' "$backup_file"
    printf 'Services:          %s running; %s\n' "$REQUIRED_SERVICES" "${gateway_url:-gateway} healthy"
}

# Everything above is parsed before anything runs, so the fast-forward cannot
# change the code this process is executing.
main "$@"
exit 0
