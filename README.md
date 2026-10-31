# LACV

LACV is a lightweight research LIMS for tracking samples, laboratory processes, assays, results, and storage history.

The platform is designed for branching laboratory workflows where one incoming sample can produce many derived samples over time. For example, a sample may be homogenized, split into aliquots, extracted into RNA, converted to cDNA, sent to qPCR, prepared for sequencing, moved through storage locations, consumed, or disposed. Every one of those physical tubes is a Sample, and LACV keeps the relationships explicit so users can follow the full lineage from the original sample to each derivative and assay.

LACV is not intended to recreate a full commercial LIMS such as Senaite or Benchling. The focus is a smaller, maintainable system for research labs that need practical sample lineage, process provenance, storage tracking, and assay result capture.

## What The Platform Does

- Tracks every physical laboratory object as a Sample: accession metadata (external ID, source, collection and received dates), type, label, quantity, concentration, status, storage location, consumed/disposed flags, and notes.
- Keeps one lineage tree: each Sample has at most one parent Sample and any number of child Samples. Children never inherit field values; only the parent link is set.
- Records process events that consume input Samples and create derived output Samples (homogenization, extraction, cDNA, library preparation, pooling).
- Treats aliquoting as a process: it records the aliquoting event, consumes quantity from the parent, and creates one derived Sample per aliquot.
- Tracks assays performed on Samples, including type, target, date, operator, status, QC status, and flexible result rows. An assay can also produce derived Samples (for example a sequencing library).
- Tracks each Sample's current storage location plus its storage movement and quantity history.
- Attaches data file references to Samples and assays.
- Groups root Samples into shipping batches and imports them from `.xlsx` files through a preview-and-confirm workflow. Derived Samples never belong to a batch.
- Makes the Sample page the central workspace: editable fields, parent and children, the lineage tree, the Sample's own processes and assays, storage and quantity history, files, and legacy identifiers.
- Finds a Sample by its code or by a legacy Material code printed on an older label.

## Domain Model

`Sample` is the single physical identity and the single lineage tree.

```text
Sample ──parent_sample_id──> Sample            (one parent, many children)
  ├─ Process Event (inputs) ──> derived Sample(s) (outputs)
  ├─ Assay ──> Assay Result(s)
  │       └─> derived Sample(s) (assay outputs)
  ├─ Storage Location / Storage Event(s)
  ├─ Quantity Event(s)
  └─ Data File(s)
```

Process input/output join tables preserve transformation provenance and support one-to-many splitting and many-to-one pooling. Each output Sample still has exactly one parent: the single input, or the input named explicitly for pooled processes. Shipping batches contain only root Samples.

### Retired Material records

Earlier versions kept a separate `materials` table alongside `samples`. Alembic revision `20261030_0004` folds it into Sample:

- A Material that was the inventory record of an existing Sample is merged into that Sample. Its quantity, concentration, storage, type, label and status move onto the Sample, and its notes are kept, labelled with the Material code.
- A Material that was a real derivative with no Sample of its own becomes a derived Sample that keeps the Material code as its sample code.
- Process inputs/outputs, quantity events, assays, storage events and data files are retargeted to the Sample.
- `legacy_material_records` keeps every original Material row (as JSON) and its code, so old labels can still be looked up.
- Ambiguous identities stop the migration instead of being merged. Run the read-only audit first (see below).

## Database Diagram

<img src="database/ord_diagram.svg" alt="LACV database relational diagram" />

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, TanStack Query
- Routing: React Router
- Backend: FastAPI, SQLAlchemy, Pydantic, Alembic, psycopg
- Database: PostgreSQL 17
- Deployment: Docker Compose
- TLS: browser to gateway is HTTPS; gateway to FastAPI is also HTTPS. The local certificate is self-signed for development.

## Run Locally

```bash
cp .env.example .env
docker compose up --build
```

Open:

```text
https://localhost:8443
```

Because the development gateway certificate is self-signed, the browser will show a certificate warning. For a real deployment, replace the generated development certificate with a certificate from your ingress or reverse proxy, such as Let's Encrypt, OpenShift Route TLS, or AWS ALB/ACM.

API docs are available through the same encrypted origin:

```text
https://localhost:8443/api/docs
```

## Encryption Model

The React application is a static browser application, so there is no frontend-server process making API calls. The user's browser calls `/api` over HTTPS. The gateway then proxies to FastAPI over HTTPS on the private Docker network. This means both network hops are encrypted in this starter.

## Current UI Scope

- Batch list, batch detail, sample batch template download, and `.xlsx` import confirmation of root samples.
- Sample list with filtering, sorting, and open-by-code (including legacy Material codes).
- Sample workspace: inline field editing (Enter or leaving a field saves, Esc cancels), lineage tree, child samples, process history, assays, storage and quantity history, files, and legacy identifiers.
- Sample actions: create root sample, add child sample, aliquot, record a process (homogenization, RNA extraction, reverse transcription, library preparation, other), send to assay, delete when nothing depends on the sample.
- Assay list, assay detail, QC status, result entry, and derived samples produced by an assay.
- Storage location list, creation, detail, and editing.

## Deploying On The DGX Spark

The DGX runs the stack from the checkout at `~/code/lacv`, on the production branch `main` (origin's default branch). Deploy from that directory:

```bash
cd ~/code/lacv && ./deploy.sh
```

See what a deployment would do without changing anything (only `git fetch` runs; no builds, no container changes, no database writes):

```bash
cd ~/code/lacv && ./deploy.sh --dry-run
```

`deploy.sh` runs these steps and stops at the first failure:

1. Checks that it is in the LACV repository on `main` with a clean working tree. It refuses otherwise and never cleans, resets, stashes or discards anything.
2. Fetches origin and shows the current commit, the target commit and the incoming commits. Only fast-forwards are allowed; if local `main` has diverged it stops.
3. Shows the target Alembic head, any new migration files, and the database's current revision, and says whether backend startup will migrate.
4. Starts the existing `db` container if needed and waits until PostgreSQL is healthy. It refuses to create a database that does not exist yet, because a new `db` volume would load `schema.sql` and the seed data.
5. Fast-forwards the checkout. If the update changes `deploy.sh` or `deploy/backup-db.sh`, it re-runs itself with the new version.
6. Builds the backend, frontend and gateway images while the running containers keep serving.
7. Backs up the database (see below). No backup, no deployment.
8. Recreates the backend, whose startup runs `alembic upgrade head`. It waits for the backend's `/health`, fails if the container exits or never becomes healthy, and checks that the database is now at the target Alembic head.
9. Recreates the frontend, then the gateway (nginx resolves the other containers when it starts), checks that all four services are running, and checks `https://127.0.0.1:8443/api/health` and the frontend page through the gateway.

It ends with the deployed commit, the Alembic revision before and after, the backup file, and the service health. Settings: `LACV_DEPLOY_BRANCH` (production branch), `LACV_BACKUP_DIR` (default `~/lacv-backups`), `LACV_BACKEND_TIMEOUT` (seconds to wait for migration and health, default 300).

### Backups

Every deployment first runs `deploy/backup-db.sh`, which can also be run on its own at any time:

```bash
cd ~/code/lacv && deploy/backup-db.sh --label manual
```

It writes `~/lacv-backups/lacv-<UTC timestamp>-<label>.dump` with `pg_dump -Fc`, outside the Git checkout, readable only by you. It fails if `pg_dump` fails or the file is empty, and keeps the file only after `pg_restore --list` can read it. Old backups are never deleted automatically.

### When a deployment fails

The script prints the failing step, `docker compose ps`, the recent backend log (and gateway log for health failures), the database's current Alembic revision, the checkout commit and the backup file. It does not restore the database, roll back containers or downgrade Alembic. A failed migration rolls back its own transaction, but a migration that succeeded is not undone by running older containers, so deciding what to do is an operator action.

### Restoring a backup

Only do this deliberately, after reading the failure output. It replaces the whole database:

```bash
cd ~/code/lacv
pg_restore --list ~/lacv-backups/<file>.dump | head
docker compose stop backend gateway
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --exit-on-error' < ~/lacv-backups/<file>.dump
```

Then run the code that matches the restored schema (the commit printed as the previous checkout), for example `git switch --detach <previous commit>` followed by `docker compose up -d --build backend frontend gateway`. Switch back to `main` before the next `./deploy.sh`.

## Migrating An Existing Database

The backend runs `alembic upgrade head` when it starts, so deploying a version with new migrations migrates the database. `./deploy.sh` takes a backup first and reports the revision change.

The Sample-centric migration (`20261030_0004`) needs to be merged into `main` before `./deploy.sh` deploys it. Before deploying it, run the read-only identity audit against the database with the current deployed image, mounting this checkout's backend code:

```bash
docker compose run --rm --no-deps -v "$PWD/backend:/src" -w /src backend python scripts/legacy_identity_audit.py --out /src/identity-audit
```

The reports land in `backend/identity-audit/`. `summary.md` must show no ambiguous materials and no derived samples whose batch differs from their root sample's batch; otherwise the migration will refuse to run and change nothing.

## Tests

Backend tests need a PostgreSQL server where the test user may create databases. Each test creates and drops its own database.

```bash
cd backend
pip install -r requirements-dev.txt
LACV_TEST_DATABASE_URL=postgresql+psycopg://lims:lims_dev_password@localhost:5432/postgres pytest
```

Frontend tests run in Node with a simulated browser (Vitest and jsdom). They need Node 22.12 or newer:

```bash
cd frontend
npm test
```

Migration tests start from the pre-migration schema and seed data kept in `backend/tests/fixtures/` and run the real Alembic upgrade.

The deployment script has its own tests. They use a throwaway Git origin and a stub `docker`, and run the real `pg_dump`/`pg_restore` against a throwaway database, so they never touch Docker or a deployment:

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres deploy/tests/test_deploy.sh
```

## Design Rules

- Use `Sample` as the canonical term in the app. Every physical object is a Sample; there is no separate Material identity.
- Do not copy parent field values when creating child samples. Only the lineage relationship is automatic.
- Keep business logic in FastAPI and persistence in SQLAlchemy.
- Keep the frontend focused on rendering data, editing fields, and calling APIs.
- Prefer dense, practical laboratory workflows over dashboard or marketing-style UI.
