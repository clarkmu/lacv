# AGENTS.md

# LACV (Laboratory Analysis & Collection Vault)

This repository contains LACV, a lightweight Laboratory Information Management System (LIMS).

The goal is NOT to recreate Senaite or Benchling.

Instead, build a simple, maintainable LIMS focused on sample lineage, process tracking, and scientific usability.

---

# Technology Stack

Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- TanStack Router
- TanStack Query
- TanStack Table

Backend

- Python
- FastAPI
- SQLAlchemy
- Alembic
- Pydantic

Database

- PostgreSQL

Deployment

- Docker Compose
- Separate frontend/backend containers
- HTTPS reverse proxy

Do not introduce Next.js, Prisma, Drizzle, Django, Flask, or other frameworks unless explicitly requested.

---

# Repository Structure

```
frontend/
    React application only

backend/
    FastAPI application only

database/
    SQL migrations and seed data

docker-compose.yml

README.md
```

Frontend and backend are intentionally separated.

Business logic belongs in the backend.

---

# Naming

Use **Sample** everywhere.

Do NOT use "Specimen."

Correct:

Sample

Incorrect:

Specimen

Likewise:

sample_id
sample_code
parent_sample_id

---

# Domain Model

Primary entities:

- Batches (shipping batches of root Samples)
- Samples
- Sample Types
- Process Events
- Assays
- Assay Results
- Storage Locations
- Storage Events
- Data Files

Everything revolves around Samples.

Sample is the single canonical physical identity. Every physical laboratory object (an incoming tube, an aliquot, an extract, a library) is a Sample. There is no separate Material entity; inventory fields (quantity, concentration, storage location, consumed/disposed) live on Sample.

Aliquoting and other transformations are process events that create derived Samples.

An Assay is a reusable procedure (assay_definitions), defined once and never tied to one Sample. Recording an assay on a Sample creates an assay execution (the assays table): which assay, when, performed by, volume used, status and QC. An execution may have several Assay Results and may produce derived Samples. Keep the three levels distinct: definition ≠ execution ≠ result. Who performed it belongs on the execution, never on the definition.

"Material" in the lab's workflow means the Sample's type (sample_type_id), not a separate entity. subject_code identifies the study subject; aliquot_number tells apart one subject's tubes of one Material from one collection.

Legacy Material codes from before Material was folded into Sample are kept in legacy_material_records and remain searchable.

---

# Lineage

Samples may have

- one parent sample
- zero or more child samples

This is the only physical lineage tree.

Shipping batches contain only root Samples; derived Samples have no batch.

Children DO NOT inherit field values.

Creating a child only establishes the lineage relationship.

The user enters new values manually.

Never implement automatic inheritance unless explicitly requested.

---

# User Interface Philosophy

The application should feel like laboratory software, not an e-commerce website.

Priorities:

- fast
- information dense
- keyboard friendly
- spreadsheet-like editing
- minimal clicking

Avoid excessive whitespace.

Avoid oversized cards.

Avoid dashboard-style UIs.

Prefer tables.

---

# Sample Page

The Sample page is the central page of the application.

It should display:

- editable sample fields, including quantity, concentration, and storage
- parent sample
- child samples and the lineage tree
- the sample's own process history
- the sample's own assays
- storage and quantity history
- available quantity (starting quantity, remaining, percent remaining), computed in the backend from the Sample's own quantity ledger
- attached files

Show the selected Sample's own activity by default. Do not roll every descendant's assays and processes into the parent's view.

The page should support inline editing wherever practical.

---

# Tables

Use TanStack Table.

Requirements:

- sorting
- filtering
- pagination
- column visibility
- inline editing
- keyboard navigation

---

# API Design

REST endpoints.

Examples:

GET /api/samples

GET /api/samples?root_only=true (base Samples only: no parent Sample)

GET /api/samples/{id}

POST /api/samples

PUT /api/samples/{id}

DELETE /api/samples/{id}

Nested endpoints when appropriate.

Example:

GET /api/samples/{id}/children

GET /api/samples/{id}/lineage

POST /api/samples/{id}/aliquots

---

# Backend Rules

Business logic belongs in FastAPI.

React should never duplicate backend logic.

Validation belongs in Pydantic.

Database access belongs in SQLAlchemy.

---

# Frontend Rules

Frontend should:

- render data
- edit data
- call APIs

Frontend should NOT:

- implement business rules
- calculate lineage
- duplicate validation

---

# Database Rules

PostgreSQL is the canonical database.

Use Alembic for schema migrations.

Never edit production schemas manually.

---

# Docker

Development should start with

docker compose up

Production runs on the DGX Spark from ~/code/lacv and is deployed with

./deploy.sh

(./deploy.sh --dry-run shows the plan without changing anything). It backs up PostgreSQL before the backend starts, because backend startup runs alembic upgrade head. Keep deploy.sh conservative: fast-forward only, never git clean/reset, never delete volumes, never restore or downgrade the database automatically. See README.md, "Deploying On The DGX Spark".

The stack consists of:

- frontend
- backend
- postgres

---

# Code Style

Prefer readable code over clever code.

Prefer explicit names.

Keep functions small.

Avoid unnecessary abstraction.

Avoid premature optimization.

---

# UI Style

Use Tailwind.

Use shadcn/ui as the component foundation, layered like this:

- frontend/src/components/ui/: shadcn primitives (added with the shadcn CLI, then owned and adjusted here)
- frontend/src/components/common.tsx and frontend/src/components/sample/: LACV components (StatusBadge, SampleTypeLabel, PageHeader, Panel, SampleIdentity, SpecimenState, SampleLineage, SampleActivity, ...)
- frontend/src/pages/: workflows composed from LACV components

Theme tokens (slate surfaces, indigo accent, IBM Plex Sans/Mono) live in frontend/src/index.css. Do not add a second styling system.

Keep the UI clean.

Avoid decorative gradients.

Avoid animations unless they improve usability.

Accessibility matters.

Dark mode support is desirable.

---

# Future Features

Potential future work:

- authentication
- user permissions
- audit history
- barcode support
- label printing
- freezer maps
- inventory management
- ELN integration
- instrument integrations
- AI assistant

Design with these in mind, but do not implement them unless requested.

---

# When Unsure

Prefer the simpler solution.

Do not introduce additional frameworks.

Do not add unnecessary dependencies.

If there are multiple reasonable implementations, choose the one that is easiest to maintain.