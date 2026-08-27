# LACV

LACV is a lightweight research LIMS for tracking samples, physical materials, laboratory processes, assays, results, and storage history.

The platform is designed for branching laboratory workflows where one incoming sample can produce many derived materials over time. For example, a sample may be homogenized, split into aliquots, extracted into RNA, converted to cDNA, sent to qPCR, prepared for sequencing, moved through storage locations, consumed, or disposed. LACV keeps those relationships explicit so users can follow the full lineage from the original sample to each derivative material and assay.

LACV is not intended to recreate a full commercial LIMS such as Senaite or Benchling. The focus is a smaller, maintainable system for research labs that need practical sample/material lineage, process provenance, storage tracking, and assay result capture.

## What The Platform Does

- Tracks samples with accession metadata such as external ID, type, source, collection date, received date, status, and notes.
- Tracks materials as first-class physical lab objects with their own IDs, type, label, quantity, concentration, status, storage location, and notes.
- Supports sample and material parent/offspring relationships without automatically inheriting child field values.
- Records process events that transform input materials into output materials.
- Provides lab-oriented actions such as creating child materials, aliquoting, homogenization, extraction, cDNA creation, sequencing-library creation, storage moves, and assay submission.
- Creates aliquots in bulk while recording the aliquoting process event and output material records.
- Tracks assays performed on materials, including assay type, target, date, operator, status, QC status, and flexible result rows.
- Tracks current material storage location plus storage movement history.
- Provides searchable and sortable list pages for batches, samples, materials, assays, and storage locations.
- Imports sample batches from `.xlsx` files through a preview-and-confirm workflow.
- Shows a sample-level material lineage workspace with clickable materials and assays.

## Domain Model

The core object is `Material`. Samples represent the accessioned source records, while materials represent physical lab objects that can be labeled, stored, transformed, split, analyzed, consumed, or disposed.

```text
Sample
  -> Material
       -> Process Event -> output Material(s)
       -> Assay -> Assay Result(s)
       -> Storage Location / Storage Event(s)
```

Process input/output join tables preserve transformation provenance and allow future workflows such as one-to-many splitting and many-to-one pooling. A direct `parent_material_id` is also stored for fast tree rendering.

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

- Batch list, batch detail, sample batch template download, and `.xlsx` import confirmation.
- Sample list, sample creation, sample detail editing, sample offspring creation, and sample-level material lineage workspace.
- Material list, material creation, material detail editing, material offspring creation, material aliquoting, process-event creation, storage movement, storage history, quantity history, and assay creation from a material.
- Assay list, assay detail, and assay result entry.
- Storage location list, creation, detail, and editing.

## Design Rules

- Use `Sample` as the canonical term in the app.
- Do not copy parent field values when creating offspring. Only the lineage relationship is automatic.
- Keep business logic in FastAPI and persistence in SQLAlchemy.
- Keep the frontend focused on rendering data, editing fields, and calling APIs.
- Prefer dense, practical laboratory workflows over dashboard or marketing-style UI.
