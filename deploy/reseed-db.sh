#!/usr/bin/env bash
set -Eeuo pipefail

# LACV database reseed for the DGX Spark (development data only)
# Run on the Spark from the deployment checkout (~/code/lacv):
#   deploy/reseed-db.sh        asks you to type the database name to confirm
#   deploy/reseed-db.sh --yes  no prompt
#
# Replaces everything in the Compose `db` database with database/schema.sql
# and database/seed.sql from this checkout:
#   1. back up the database (deploy/backup-db.sh --label before-reseed)
#   2. stop the backend
#   3. drop and recreate the database (UTF8, template0)
#   4. load schema.sql, then seed.sql
#   5. start the backend (its `alembic upgrade head` has nothing to do)
#   6. show the Alembic revision and a few row counts
#
# This permanently deletes the database's current data; the backup from step
# 1 is the only copy. It never deletes Docker volumes and never restores a
# backup on its own. To go back, restore the backup (README.md, "Restoring a
# backup").

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
assume_yes=false
backup_file=""
dropped=false

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --yes) assume_yes=true; shift ;;
        -h|--help) sed -n '4,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "Unknown argument: $1" ;;
    esac
done

on_error() {
    printf '\nReseed failed. ' >&2
    if [[ "$dropped" == true ]]; then
        printf 'The database may be empty or partly loaded.\n' >&2
    else
        printf 'The database was not changed.\n' >&2
    fi
    [[ -n "$backup_file" ]] && printf 'Backup taken before the reseed: %s\n' "$backup_file" >&2
    printf 'The backend may be stopped; start it with: docker compose start backend\n' >&2
}
trap on_error ERR

# psql inside the db container, as the container's own user and database.
db_psql() {
    docker compose exec -T db sh -c 'exec psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' psql "$@"
}

cd "$REPO_DIR"
command -v docker >/dev/null || die "docker is not available. Run this on the Spark, from ~/code/lacv."
[[ -f docker-compose.yml && -f database/schema.sql && -f database/seed.sql ]] || die "Run this from the LACV checkout."
[[ -n "$(docker compose ps -q db)" ]] || die "The db service is not running. Start it with: docker compose up -d db"

database="$(docker compose exec -T db sh -c 'printf %s "$POSTGRES_DB"')"
printf 'This replaces all data in the database "%s" with the seed data from %s.\n' "$database" "$(git rev-parse --short HEAD 2>/dev/null || echo 'this checkout')"
if [[ "$assume_yes" != true ]]; then
    read -r -p "Type the database name to continue: " answer
    [[ "$answer" == "$database" ]] || die "Not confirmed; nothing was changed."
fi

printf '\n[1/6] Backing up\n'
backup_file="$("$REPO_DIR/deploy/backup-db.sh" --label before-reseed | tail -n 1)"
[[ -s "$backup_file" ]] || die "The backup was not written; nothing was changed."

printf '[2/6] Stopping the backend\n'
docker compose stop backend

printf '[3/6] Recreating the database\n'
dropped=true
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" -E UTF8 -T template0 "$POSTGRES_DB"'

printf '[4/6] Loading schema.sql and seed.sql\n'
db_psql < database/schema.sql
db_psql < database/seed.sql

printf '[5/6] Starting the backend\n'
docker compose start backend

printf '[6/6] Checking\n'
db_psql -At -c "SELECT 'Alembic revision: ' || version_num FROM alembic_version" \
    -c "SELECT 'Batches: ' || count(*) FROM batches" \
    -c "SELECT 'Samples: ' || count(*) FROM samples" \
    -c "SELECT 'Assay executions: ' || count(*) FROM assay_executions"

trap - ERR
printf '\nDone. Backup of the previous data: %s\n' "$backup_file"
