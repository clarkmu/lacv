#!/usr/bin/env bash
set -Eeuo pipefail

# Tests for deploy.sh and deploy/backup-db.sh. Nothing touches Docker or any
# real deployment:
# - a throwaway bare repository stands in for origin, with a deployment
#   checkout cloned from it;
# - a stub `docker` on PATH records every call, answers ps/inspect/port, and
#   runs `docker compose exec db ...` against a throwaway PostgreSQL database,
#   so pg_dump -Fc and pg_restore --list really run;
# - a stub `curl` answers the gateway health checks.
#
# Needs git, psql, pg_dump, pg_restore, createdb and dropdb, with PGHOST,
# PGPORT and PGUSER pointing at a server where that user may create databases:
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres deploy/tests/test_deploy.sh
# LACV_TEST_ONLY=<test name> runs one test; LACV_TEST_VERBOSE=1 prints each run's output.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lacv-deploy-test.XXXXXX")"
WORK="$(cd "$WORK" && pwd -P)"
TEST_DB="lacv_deploy_test_$$"
CHECKOUT="$WORK/home/code/lacv"
ORIGIN="$WORK/remote/lacv.git"
SOURCE="$WORK/source"
STATE="$WORK/state"
BACKUPS="$WORK/home/lacv-backups"
OLD_HEAD="20261030_0004"
NEW_HEAD="20261101_0005"
passed=0
failed=0

cleanup() {
    dropdb --if-exists "$TEST_DB" >/dev/null 2>&1 || true
    rm -rf -- "$WORK"
}
trap cleanup EXIT

# ----- Fixtures ------------------------------------------------------------------

make_stubs() {
    mkdir -p "$WORK/bin"
    cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "$STUB_STATE/calls.log"
if [[ "$1" == inspect ]]; then
    case "$3" in
        *Health*) printf '%s\n' "${STUB_DB_HEALTH:-healthy}" ;;
        *) cat "$STUB_STATE/backend_state" 2>/dev/null || printf 'running\n' ;;
    esac
    exit 0
fi
[[ "$1" == compose ]] || exit 0
shift
command="$1"
shift
case "$command" in
    version) printf 'Docker Compose version stub\n' ;;
    config) printf 'db\nbackend\nfrontend\ngateway\n' ;;
    ps)
        if [[ "$*" == *--services* ]]; then
            printf '%s\n' ${STUB_RUNNING_SERVICES:-db backend frontend gateway}
        elif [[ "$*" == *-q* ]]; then
            service="${*: -1}"
            [[ "$service" == db && -n "${STUB_NO_DB:-}" ]] && exit 0
            printf 'cid-%s\n' "$service"
        else
            printf 'NAME   SERVICE   STATUS\nlacv-db-1   db   running (healthy)\n'
        fi
        ;;
    up)
        if [[ "$*" == *" backend"* ]]; then
            [[ -z "${STUB_BACKEND_EXIT:-}" ]] || printf 'exited\n' > "$STUB_STATE/backend_state"
            [[ -z "${STUB_MIGRATE_TO:-}" ]] || psql -X -q -d "$STUB_DB" -c "UPDATE alembic_version SET version_num = '$STUB_MIGRATE_TO'"
        fi
        ;;
    port) printf '0.0.0.0:8443\n' ;;
    logs) printf '(stub log for %s)\n' "${*: -1}" ;;
    exec)
        [[ "$1" == -T ]] && shift
        service="$1"
        shift
        case "$service" in
            db)
                export POSTGRES_USER="$PGUSER" POSTGRES_DB="$STUB_DB"
                if [[ -n "${STUB_PGDUMP_FAIL:-}" && "$*" == *pg_dump* ]]; then
                    printf 'pg_dump: error: stub failure\n' >&2
                    exit 1
                fi
                exec "$@"
                ;;
            backend)
                cat > /dev/null
                exit "${STUB_BACKEND_HEALTH_RC:-0}"
                ;;
        esac
        ;;
esac
STUB
    cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$STUB_STATE/calls.log"
[[ "${STUB_GATEWAY_RC:-0}" == 0 ]] || exit "$STUB_GATEWAY_RC"
printf '{"status":"ok"} <div id="root"></div>\n'
STUB
    chmod +x "$WORK/bin/docker" "$WORK/bin/curl"
}

make_repositories() {
    git init -q --bare "$ORIGIN"
    git -C "$ORIGIN" symbolic-ref HEAD refs/heads/main
    git clone -q "$REPO_DIR" "$SOURCE"
    git -C "$SOURCE" checkout -q -B main
    # Deploy the working-tree versions of the tooling under test.
    mkdir -p "$SOURCE/deploy"
    cp "$REPO_DIR/deploy.sh" "$SOURCE/deploy.sh"
    cp "$REPO_DIR/deploy/backup-db.sh" "$SOURCE/deploy/backup-db.sh"
    git -C "$SOURCE" add deploy.sh deploy/backup-db.sh
    git -C "$SOURCE" -c user.name=test -c user.email=test@example.com commit -q -m "deploy tooling under test" || true
    git -C "$SOURCE" remote set-url origin "$ORIGIN"
    git -C "$SOURCE" push -q origin main
    git clone -q "$ORIGIN" "$CHECKOUT"
    BASE_COMMIT="$(git -C "$CHECKOUT" rev-parse HEAD)"

    cat > "$SOURCE/backend/alembic/versions/20261101_0005_test.py" <<'PY'
"""test migration

Revision ID: 20261101_0005
Revises: 20261030_0004
"""
revision = "20261101_0005"
down_revision = "20261030_0004"
PY
    git -C "$SOURCE" add backend/alembic/versions/20261101_0005_test.py
    git -C "$SOURCE" -c user.name=test -c user.email=test@example.com commit -q -m "Add test migration"
    git -C "$SOURCE" push -q origin main
    TARGET_COMMIT="$(git -C "$SOURCE" rev-parse HEAD)"
}

make_database() {
    createdb -T template0 "$TEST_DB"
    psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_DB" -f "$REPO_DIR/database/schema.sql" -f "$REPO_DIR/database/seed.sql"
}

# Put the checkout, database and stub state back to "deployed at BASE_COMMIT".
reset_world() {
    git -C "$CHECKOUT" checkout -q main
    git -C "$CHECKOUT" reset -q --hard "$BASE_COMMIT"
    git -C "$CHECKOUT" clean -q -fd
    psql -X -q -d "$TEST_DB" -c "UPDATE alembic_version SET version_num = '$OLD_HEAD'"
    rm -rf -- "$STATE" "$BACKUPS"
    mkdir -p "$STATE"
    unset STUB_NO_DB STUB_PGDUMP_FAIL STUB_BACKEND_EXIT STUB_MIGRATE_TO STUB_GATEWAY_RC STUB_BACKEND_HEALTH_RC STUB_RUNNING_SERVICES LACV_BACKUP_DIR
}

# ----- Helpers -------------------------------------------------------------------

run_deploy() {
    set +e
    output="$(cd "$CHECKOUT" && HOME="$WORK/home" ./deploy.sh "$@" 2>&1)"
    rc=$?
    set -e
    calls="$(cat "$STATE/calls.log" 2>/dev/null || true)"
}

check() {
    local description="$1"
    shift
    if "$@"; then
        return 0
    fi
    printf '    FAILED: %s\n' "$description"
    test_ok=false
}

contains() { [[ "$1" == *"$2"* ]]; }
lacks() { [[ "$1" != *"$2"* ]]; }
line_of() { grep -n -F -- "$2" <<< "$1" | head -n 1 | cut -d: -f1; }
before() {
    local first second
    first="$(line_of "$1" "$2")"
    second="$(line_of "$1" "$3")"
    [[ -n "$first" && -n "$second" && "$first" -lt "$second" ]]
}
backups() { find "$BACKUPS" -type f 2>/dev/null | sort; }

run_test() {
    local name="$1"
    test_ok=true
    reset_world
    "$name"
    if [[ "$test_ok" == true ]]; then
        passed=$((passed + 1))
        printf 'ok    %s\n' "$name"
        [[ -z "${LACV_TEST_VERBOSE:-}" ]] || printf '%s\n' "$output" | sed 's/^/      | /'
    else
        failed=$((failed + 1))
        printf 'FAIL  %s\n' "$name"
        printf '%s\n' "$output" | sed 's/^/      | /' | tail -n 40
    fi
}

# ----- Tests ---------------------------------------------------------------------

test_tooling_has_no_destructive_commands() {
    output="$(grep -n -E 'git (clean|reset)|down -v|volume rm|--volumes|pg_restore (-d|--dbname|--clean)|DROP DATABASE|alembic downgrade|sudo ' "$REPO_DIR/deploy.sh" "$REPO_DIR/deploy/backup-db.sh" | grep -v -E '^[^:]+:[0-9]+:[[:space:]]*#' || true)"
    check "no destructive commands in the tooling" [ -z "$output" ]
    check "deploy.sh parses" bash -n "$REPO_DIR/deploy.sh"
    check "backup-db.sh parses" bash -n "$REPO_DIR/deploy/backup-db.sh"
}

test_dry_run_reports_plan_and_changes_nothing() {
    run_deploy --dry-run
    check "exit 0" [ "$rc" -eq 0 ]
    check "shows branch" contains "$output" "Branch:  main"
    check "shows incoming commit" contains "$output" "Add test migration"
    check "shows new migration file" contains "$output" "backend/alembic/versions/20261101_0005_test.py"
    check "shows target head" contains "$output" "Target Alembic head: $NEW_HEAD"
    check "shows database revision" contains "$output" "Database revision:   $OLD_HEAD"
    check "says a migration will run" contains "$output" "WILL run 'alembic upgrade head' ($OLD_HEAD -> $NEW_HEAD)"
    check "checkout not moved" [ "$(git -C "$CHECKOUT" rev-parse HEAD)" == "$BASE_COMMIT" ]
    check "no compose up" lacks "$calls" "compose up"
    check "no build" lacks "$calls" "compose build"
    check "no pg_dump" lacks "$calls" "pg_dump"
    check "no backups" [ -z "$(backups)" ]
}

test_refuses_dirty_tree() {
    touch "$CHECKOUT/stray-file"
    run_deploy
    check "fails" [ "$rc" -ne 0 ]
    check "explains" contains "$output" "Git working tree is not clean"
    check "lists the file" contains "$output" "stray-file"
    check "no fetch-dependent work" lacks "$calls" "compose up"
    check "file kept" [ -f "$CHECKOUT/stray-file" ]
}

test_refuses_other_branch() {
    git -C "$CHECKOUT" switch -q -c feature
    run_deploy
    check "fails" [ "$rc" -ne 0 ]
    check "explains" contains "$output" "not the production branch 'main'"
    check "no compose up" lacks "$calls" "compose up"
}

test_refuses_diverged_branch() {
    git -C "$CHECKOUT" -c user.name=test -c user.email=test@example.com commit -q --allow-empty -m "local only"
    local local_head
    local_head="$(git -C "$CHECKOUT" rev-parse HEAD)"
    run_deploy
    check "fails" [ "$rc" -ne 0 ]
    check "explains" contains "$output" "fast-forward is impossible"
    check "local commit kept" [ "$(git -C "$CHECKOUT" rev-parse HEAD)" == "$local_head" ]
    check "no compose up" lacks "$calls" "compose up"
}

test_refuses_to_initialize_a_database() {
    export STUB_NO_DB=1
    run_deploy
    check "fails" [ "$rc" -ne 0 ]
    check "explains" contains "$output" "never initializes a database"
    check "db not started" lacks "$calls" "compose up -d --no-deps db"
    check "checkout not moved" [ "$(git -C "$CHECKOUT" rev-parse HEAD)" == "$BASE_COMMIT" ]
}

test_successful_deploy() {
    export STUB_MIGRATE_TO="$NEW_HEAD"
    run_deploy
    check "exit 0" [ "$rc" -eq 0 ]
    check "fast-forwarded" [ "$(git -C "$CHECKOUT" rev-parse HEAD)" == "$TARGET_COMMIT" ]
    check "db checked before build" before "$calls" "compose up -d --no-deps db" "compose build backend frontend gateway"
    check "build before backup" before "$calls" "compose build" "pg_dump"
    check "backup before backend" before "$calls" "pg_dump" "compose up -d --no-deps --force-recreate backend"
    check "backup verified" before "$calls" "pg_restore --list" "compose up -d --no-deps --force-recreate backend"
    check "backend before frontend" before "$calls" "force-recreate backend" "force-recreate frontend"
    check "frontend before gateway" before "$calls" "force-recreate frontend" "force-recreate gateway"
    check "gateway health checked" contains "$calls" "/api/health"
    check "one backup" [ "$(backups | wc -l | tr -d ' ')" == 1 ]
    local backup
    backup="$(backups | head -n 1)"
    check "backup name" contains "$backup" "/lacv-backups/lacv-"
    check "backup labelled with commit" contains "$backup" "pre-deploy-$(git -C "$CHECKOUT" rev-parse --short HEAD).dump"
    check "backup is a readable archive" [ "$(pg_restore --list "$backup" | grep -c 'TABLE DATA public samples')" -ge 1 ]
    check "backup is private" [ "$(ls -l "$backup" | cut -c1-10)" == "-rw-------" ]
    check "summary revisions" contains "$output" "Alembic revision:  $OLD_HEAD -> $NEW_HEAD"
    check "summary backup" contains "$output" "Backup:            $backup"
    check "summary commit" contains "$output" "Add test migration"
}

test_redeploy_same_commit() {
    git -C "$CHECKOUT" merge -q --ff-only "origin/main"
    psql -X -q -d "$TEST_DB" -c "UPDATE alembic_version SET version_num = '$NEW_HEAD'"
    run_deploy
    check "exit 0" [ "$rc" -eq 0 ]
    check "says already at target" contains "$output" "already at the target commit"
    check "says no migration" contains "$output" "should not migrate"
    check "still backs up" [ -n "$(backups)" ]
}

test_backup_failure_stops_before_backend() {
    export STUB_PGDUMP_FAIL=1
    run_deploy
    check "fails" [ "$rc" -ne 0 ]
    check "pg_dump error shown" contains "$output" "pg_dump failed"
    check "backend untouched" lacks "$calls" "force-recreate backend"
    check "no partial backup left" [ -z "$(backups)" ]
    check "no restore" contains "$output" "No automatic database restore or rollback was attempted."
}

test_backup_dir_inside_checkout_is_refused() {
    export LACV_BACKUP_DIR="$CHECKOUT/backups"
    run_deploy
    check "fails" [ "$rc" -ne 0 ]
    check "explains" contains "$output" "inside the Git checkout"
    check "backend untouched" lacks "$calls" "force-recreate backend"
}

test_backend_exit_fails_with_logs_and_no_restore() {
    export STUB_BACKEND_EXIT=1
    run_deploy
    check "fails" [ "$rc" -ne 0 ]
    check "explains" contains "$output" "backend exited during startup"
    check "prints backend log" contains "$output" "(stub log for backend)"
    check "names the backup" contains "$output" "Pre-deployment backup: $BACKUPS/lacv-"
    check "no restore" contains "$output" "No automatic database restore or rollback was attempted."
    check "frontend not started" lacks "$calls" "force-recreate frontend"
    check "gateway not started" lacks "$calls" "force-recreate gateway"
    check "no restore command run" lacks "$calls" "pg_restore -d"
}

test_unmigrated_database_fails() {
    run_deploy
    check "fails" [ "$rc" -ne 0 ]
    check "explains" contains "$output" "Database revision is '$OLD_HEAD' after startup, expected '$NEW_HEAD'"
    check "frontend not started" lacks "$calls" "force-recreate frontend"
}

test_unhealthy_backend_times_out() {
    export STUB_BACKEND_HEALTH_RC=1 LACV_BACKEND_TIMEOUT=3
    run_deploy
    unset LACV_BACKEND_TIMEOUT
    check "fails" [ "$rc" -ne 0 ]
    check "explains" contains "$output" "did not become healthy within 3s"
    check "frontend not started" lacks "$calls" "force-recreate frontend"
}

test_gateway_failure_is_reported() {
    export STUB_MIGRATE_TO="$NEW_HEAD" STUB_GATEWAY_RC=22
    run_deploy
    check "fails" [ "$rc" -ne 0 ]
    check "explains" contains "$output" "Gateway health checks failed"
    check "prints gateway log" contains "$output" "(stub log for gateway)"
}

test_stopped_service_is_reported() {
    export STUB_MIGRATE_TO="$NEW_HEAD" STUB_RUNNING_SERVICES="db backend gateway"
    run_deploy
    check "fails" [ "$rc" -ne 0 ]
    check "explains" contains "$output" "Service 'frontend' is not running."
}

test_backup_helper_standalone() {
    local path
    set +e
    path="$(cd "$CHECKOUT" && HOME="$WORK/home" deploy/backup-db.sh --label manual 2>/dev/null)"
    rc=$?
    output="$(cd "$CHECKOUT" && HOME="$WORK/home" deploy/backup-db.sh --label 'bad/label' 2>&1)"
    local bad_rc=$?
    set -e
    check "exit 0" [ "$rc" -eq 0 ]
    check "prints the path" [ -s "$path" ]
    check "labelled" contains "$path" "-manual.dump"
    check "rejects unsafe label" [ "$bad_rc" -ne 0 ]
    check "explains label" contains "$output" "Backup label may contain only"
}

# Last: it pushes a change to deploy.sh itself.
test_tooling_update_reexecs_new_script() {
    printf '\n# tooling change\n' >> "$SOURCE/deploy.sh"
    git -C "$SOURCE" -c user.name=test -c user.email=test@example.com commit -q -am "Change deploy tooling"
    git -C "$SOURCE" push -q origin main
    TARGET_COMMIT="$(git -C "$SOURCE" rev-parse HEAD)"
    export STUB_MIGRATE_TO="$NEW_HEAD"
    run_deploy
    check "exit 0" [ "$rc" -eq 0 ]
    check "re-executes" contains "$output" "restarting with the new deploy.sh"
    check "second run starts at target" contains "$output" "already at the target commit"
    check "deployed" [ "$(git -C "$CHECKOUT" rev-parse HEAD)" == "$TARGET_COMMIT" ]
    check "one backup" [ "$(backups | wc -l | tr -d ' ')" == 1 ]
}

# ----- Run -----------------------------------------------------------------------

for tool in git psql pg_dump pg_restore createdb dropdb; do
    command -v "$tool" >/dev/null 2>&1 || { printf 'Missing %s\n' "$tool" >&2; exit 2; }
done
: "${PGUSER:?Set PGHOST, PGPORT and PGUSER for a PostgreSQL server where this user may create databases}"

make_stubs
make_repositories
make_database
export PATH="$WORK/bin:$PATH" STUB_STATE="$STATE" STUB_DB="$TEST_DB"

# LACV_TEST_ONLY=test_name runs one test; LACV_TEST_VERBOSE=1 prints every run's output.
for name in \
    test_tooling_has_no_destructive_commands \
    test_dry_run_reports_plan_and_changes_nothing \
    test_refuses_dirty_tree \
    test_refuses_other_branch \
    test_refuses_diverged_branch \
    test_refuses_to_initialize_a_database \
    test_successful_deploy \
    test_redeploy_same_commit \
    test_backup_failure_stops_before_backend \
    test_backup_dir_inside_checkout_is_refused \
    test_backend_exit_fails_with_logs_and_no_restore \
    test_unmigrated_database_fails \
    test_unhealthy_backend_times_out \
    test_gateway_failure_is_reported \
    test_stopped_service_is_reported \
    test_backup_helper_standalone \
    test_tooling_update_reexecs_new_script; do
    [[ -z "${LACV_TEST_ONLY:-}" || "$name" == "$LACV_TEST_ONLY" ]] || continue
    run_test "$name"
done

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
