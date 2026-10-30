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

## Migrating An Existing Database

Back up the database first. The backend runs `alembic upgrade head` when it starts, so deploying this version migrates the database.

Before deploying, run the read-only identity audit against the database with the current deployed image, mounting this checkout's backend code:

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

Migration tests start from the pre-migration schema and seed data kept in `backend/tests/fixtures/` and run the real Alembic upgrade.

## Design Rules

- Use `Sample` as the canonical term in the app. Every physical object is a Sample; there is no separate Material identity.
- Do not copy parent field values when creating child samples. Only the lineage relationship is automatic.
- Keep business logic in FastAPI and persistence in SQLAlchemy.
- Keep the frontend focused on rendering data, editing fields, and calling APIs.
- Prefer dense, practical laboratory workflows over dashboard or marketing-style UI.
