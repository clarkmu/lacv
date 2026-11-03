# LACV

LACV is a lightweight research LIMS for tracking samples, laboratory processes, assays, results, and storage history.

The platform is designed for branching laboratory workflows where one incoming sample can produce many derived samples over time. For example, a sample may be homogenized, split into aliquots, extracted into RNA, converted to cDNA, sent to qPCR, prepared for sequencing, moved through storage locations, consumed, or disposed. Every one of those physical tubes is a Sample, and LACV keeps the relationships explicit so users can follow the full lineage from the original sample to each derivative and assay.

LACV is not intended to recreate a full commercial LIMS such as Senaite or Benchling. The focus is a smaller, maintainable system for research labs that need practical sample lineage, process provenance, storage tracking, and assay result capture.

## What The Platform Does

- Tracks every physical laboratory object as a Sample: accession metadata (subject, external ID, aliquot number, source, collection and received dates), type (the "Material", e.g. Serum or Blood (RNA shield)), label, quantity, concentration, status, storage location, consumed/disposed flags, and notes.
- Keeps one lineage tree: each Sample has at most one parent Sample and any number of child Samples. Children never inherit field values; only the parent link is set.
- Records process events that consume input Samples and create derived output Samples (homogenization, extraction, cDNA, library preparation, pooling).
- Treats aliquoting as a process: it records the aliquoting event, consumes quantity from the parent, and creates one derived Sample per aliquot.
- Defines assays once as reusable procedures (type, target, kit, instrument, typical volume, and the one result each sample reports) and records executions of them: one execution (a run or plate) holds one or more Samples, each with zero or one result, plus the volume it used. An execution has a durable ID and an editable name, its date, performed by, status, QC and notes. Executions are created on the assay's page, row by row or from an `.xlsx` workbook (preview, then save), and results are entered there inline; the page shows the mean of the numeric results. An execution can also produce derived Samples (for example a sequencing library).
- Tracks each Sample's current storage location plus its storage movement and quantity history.
- Shows how much of each Sample remains: starting quantity minus removals from that Sample (process and aliquot inputs, amounts taken to create a child, volume used by assay executions, downward adjustments), from the Sample's own quantity ledger. Using a child never gives quantity back to its parent. If the ledger does not chain from the starting quantity to the current one, or mixes incompatible units, the Sample page says so and shows no percentage.
- Attaches data file references to Samples and assay executions.
- Groups root Samples into shipping batches and imports them from `.xlsx` files through a preview-and-confirm workflow. Derived Samples never belong to a batch. The Batch page edits its Samples as a table, row by row or several rows at once, and saves all changes or none.
- Makes the Sample page the central workspace: editable fields, parent and children, the lineage tree, the Sample's own processes and assays, storage and quantity history, files, and legacy identifiers.
- Finds a Sample by its code or by a legacy Material code printed on an older label.

## Domain Model

`Sample` is the single physical identity and the single lineage tree.

```text
Sample ──parent_sample_id──> Sample            (one parent, many children)
  ├─ Process Event (inputs) ──> derived Sample(s) (outputs)
  ├─ Assay execution sample (its result) ──> Assay execution ──> Assay definition
  │       └─> derived Sample(s) (assay outputs of the execution)
  ├─ Storage Location / Storage Event(s)
  ├─ Quantity Event(s)
  └─ Data File(s)
```

```text
Assay definition (reusable procedure: type, target, kit, instrument, typical volume, the one result it reports)
  └─ Assay execution (one run: ID, editable name, date, performed by, status, QC, notes)
       └─ Sample (once per execution) ──> zero or one result
```

An assay definition (`assay_definitions`) is the procedure, defined once, with its result specification (name, unit, number or text). An execution (`assay_executions`) is one run of it: `assay_execution_id` is its identity, and `execution_name` (generated as `<assay code>-NNN`, unique within the assay) is an editable label. Its Samples are rows of `assay_execution_samples`, unique per execution and Sample, each holding the Sample's result as `result_numeric` or `result_text` (both empty until entered). A Sample can take part in any number of executions, including several of the same assay. Volume used is that Sample's quantity-ledger row linked to the execution; data files and derived Samples belong to the execution. Migration `20261103_0007` converted the earlier one-Sample executions and their result rows into this shape, writing any result that no longer fits into the execution's notes.

`subject_code` is the study subject (participant) a Sample came from: a plain identifier, not a subject registry. `aliquot_number` tells apart the tubes received for one subject's collection of one Material (sample type); within a batch, two such tubes cannot share a number.

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

## Local Development Without Docker

The development Mac does not need Docker. Python, the backend packages and PostgreSQL 17 come from one Conda environment, `lacv` (`environment.yml`). Node comes from nvm, at Node 22.12 or newer (developed on 22.12.0; the production image builds with Node 24). JavaScript packages live in `frontend/node_modules` and are installed from `package-lock.json`.

| Piece | Where | Port |
| --- | --- | --- |
| PostgreSQL 17 (data, log, socket) | `~/.local/share/lacv/` (`pg/` is the cluster) | 15432, 127.0.0.1 only |
| Backend (FastAPI) | `conda run -n lacv uvicorn …` | 8000 |
| Frontend (Vite) | `npm run dev`, forwards `/api` to the backend | 5173 |

Commands below are run from the repository root unless a `cd` says otherwise.

**1. Create the Conda environment** (once; `conda env update -n lacv -f environment.yml --prune` after `environment.yml` changes):

```bash
conda env create -f environment.yml
```

**2. Create the PostgreSQL cluster** (once). Local connections only, no password:

```bash
mkdir -p ~/.local/share/lacv
conda run -n lacv initdb -D ~/.local/share/lacv/pg -U lims --auth=trust --encoding=UTF8 --locale=en_US.UTF-8
printf "\nport = 15432\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = '%s'\n" ~/.local/share/lacv >> ~/.local/share/lacv/pg/postgresql.conf
```

**3. Start PostgreSQL** (after a reboot, too):

```bash
conda run -n lacv pg_ctl -D ~/.local/share/lacv/pg -l ~/.local/share/lacv/postgres.log start
```

**4. Create and migrate the development database.** A new database gets `schema.sql` and the seed data, as a new Docker volume does; `alembic upgrade head` then applies any later migrations (on a new database it has nothing to do). The connection settings:

```bash
export PGHOST=127.0.0.1 PGPORT=15432 PGUSER=lims
export DATABASE_URL=postgresql+psycopg://lims@127.0.0.1:15432/research_sample_tracker
```

```bash
conda run -n lacv createdb research_sample_tracker
conda run -n lacv psql -v ON_ERROR_STOP=1 -d research_sample_tracker -f database/schema.sql -f database/seed.sql
(cd backend && conda run -n lacv alembic upgrade head)
```

For an existing development database, run only the `alembic upgrade head` line. To start over with fresh seed data, `conda run -n lacv dropdb research_sample_tracker` and repeat this step.

**5. Start the backend** (reloads on code changes):

```bash
cd backend
DATABASE_URL=postgresql+psycopg://lims@127.0.0.1:15432/research_sample_tracker conda run --no-capture-output -n lacv uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**6. Start the frontend** in another terminal, then open http://localhost:5173. The dev server forwards `/api` to the backend on port 8000, stripping the prefix as the production gateway does; set `LACV_API_URL` to use another backend. `npm run dev` listens on all interfaces, so the app is also reachable from your local network.

```bash
cd frontend
npm install
npm run dev
```

**7. Stop** the frontend and backend with Ctrl-C, then PostgreSQL:

```bash
conda run -n lacv pg_ctl -D ~/.local/share/lacv/pg stop
```

## Run With Docker Compose

Docker Compose is how production runs (see "Deploying On The DGX Spark"). On a machine with Docker it also runs the whole stack locally:

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

- Batch list with sample counts, sample batch template download, and `.xlsx` import confirmation of root samples.
- Sample list with filtering, sorting, and open-by-code (including legacy Material codes).
- Sample workspace: inline field editing (Enter or leaving a field saves, Esc cancels), lineage tree, child samples, process history, assays, storage and quantity history, files, and legacy identifiers.
- Sample actions: create root sample, add child sample, aliquot, record a process (homogenization, RNA extraction, reverse transcription, library preparation, other), record an assay, delete when nothing depends on the sample.
- Assays: the list of reusable assay definitions and creating one.
- The assay's page is its workspace: the procedure (read-only), the mean of the numeric results (blank and text results counted, never averaged), and every execution grouped by its ID, with one row per Sample and its result edited in place. Executions can be filtered, renamed, have their details edited, gain or lose Samples (a Sample whose volume was used stays). Links to an execution from elsewhere open `/assays/<id>#execution-<execution id>`.
- New execution, on the assay's page: a generated, editable name, date, performed by and notes, then a spreadsheet of Samples found by code, label or legacy code (each once), each with an optional result and volume used, saved together or not at all. Its rows can come from an `.xlsx` workbook (template download; a Samples sheet with sample_code, result, volume_used, volume_unit and an optional Execution sheet), previewed with every problem listed by sheet and row before anything is saved.
- Recording an assay from a Sample's page: choose an assay, date and time, performed by (suggestions from earlier names, or any new name), volume used (deducted from the Sample's availability) and an optional result; this creates a one-Sample execution that can be extended on the assay's page.
- Batch detail: the batch's root samples as an editable table (subject, Material, aliquot number, external ID, dates, quantity, storage, status), with values set on several selected rows at once, aliquot numbering in table order, and one all-or-nothing save.
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

Backend tests need a PostgreSQL server where the test user may create databases; the development cluster above works. Each test creates and drops its own database, so the development data is untouched.

```bash
cd backend
LACV_TEST_DATABASE_URL=postgresql+psycopg://lims@127.0.0.1:15432/postgres conda run -n lacv python -m pytest
```

Frontend tests run in Node with a simulated browser (Vitest and jsdom). They need Node 22.12 or newer. Type checking and the production build:

```bash
cd frontend
npm test
npx tsc -b
npm run build
```

Migration tests start from the pre-migration schema and seed data kept in `backend/tests/fixtures/` and run the real Alembic upgrade.

The deployment script has its own tests. They use a throwaway Git origin and a stub `docker`, and run the real `pg_dump`/`pg_restore` against a throwaway database, so they never touch Docker or a deployment:

```bash
PGHOST=127.0.0.1 PGPORT=15432 PGUSER=lims conda run -n lacv deploy/tests/test_deploy.sh
```

## Design Rules

- Use `Sample` as the canonical term in the app. Every physical object is a Sample; there is no separate Material identity.
- Do not copy parent field values when creating child samples. Only the lineage relationship is automatic.
- Keep business logic in FastAPI and persistence in SQLAlchemy.
- Keep the frontend focused on rendering data, editing fields, and calling APIs.
- Prefer dense, practical laboratory workflows over dashboard or marketing-style UI.
