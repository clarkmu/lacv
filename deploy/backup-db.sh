#!/usr/bin/env bash
set -Eeuo pipefail

# LACV PostgreSQL backup
# Run from anywhere on the DGX:
#   deploy/backup-db.sh [--label LABEL]
#
# Writes a pg_dump custom-format archive (-Fc) of the Compose `db` service to
# $LACV_BACKUP_DIR (default ~/lacv-backups), outside the Git checkout, and
# prints the backup path as the last line of stdout. The archive is verified
# with pg_restore --list before it is kept.
#
# It never restores, drops, or modifies the database. Restoring is a manual
# operator action; see README.md, "Restoring a backup".

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
BACKUP_DIR="${LACV_BACKUP_DIR:-$HOME/lacv-backups}"
label=""

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --label)
            [[ $# -ge 2 ]] || die "--label needs a value."
            label="$2"
            shift 2
            ;;
        -h|--help)
            sed -n '4,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            die "Unknown argument: $1"
            ;;
    esac
done

[[ -z "$label" || "$label" =~ ^[A-Za-z0-9._-]+$ ]] \
    || die "Backup label may contain only letters, digits, '.', '_' and '-'."

cd "$REPO_DIR"
[[ -f docker-compose.yml ]] || die "Missing docker-compose.yml in $REPO_DIR."

[[ "$BACKUP_DIR" == /* ]] || die "LACV_BACKUP_DIR must be an absolute path."
umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
backup_dir_real="$(cd "$BACKUP_DIR" && pwd -P)"
case "$backup_dir_real/" in
    "$REPO_DIR"/*) die "Backup directory $backup_dir_real is inside the Git checkout; choose one outside it." ;;
esac

db_container="$(docker compose ps -q db)"
[[ -n "$db_container" ]] || die "The db service is not running; nothing to back up."

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$backup_dir_real/lacv-${timestamp}${label:+-$label}.dump"
partial_file="${backup_file}.partial"
[[ ! -e "$backup_file" && ! -e "$partial_file" ]] || die "Backup file already exists: $backup_file"

remove_partial() {
    rm -f -- "$partial_file"
}
trap remove_partial EXIT

printf 'Backing up database to %s ...\n' "$backup_file" >&2
# Credentials come from the db container's own environment; nothing is read
# from .env or passed on the command line.
docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$partial_file" \
    || die "pg_dump failed; no backup was written."
[[ -s "$partial_file" ]] || die "pg_dump produced an empty file; no backup was written."

toc_entries="$(docker compose exec -T db pg_restore --list < "$partial_file" | grep -c '^[0-9]' || true)"
[[ "$toc_entries" =~ ^[0-9]+$ && "$toc_entries" -gt 0 ]] \
    || die "pg_restore could not read the backup archive; no backup was written."

mv -- "$partial_file" "$backup_file"
trap - EXIT
size="$(du -h "$backup_file" | awk '{print $1}')"
printf 'Backup verified: %s (%s, %s archive entries)\n' "$backup_file" "$size" "$toc_entries" >&2
printf '%s\n' "$backup_file"
