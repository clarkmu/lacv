# Custom LIMS starter

A lightweight lineage-oriented LIMS starter built around the current Research Sample Tracker schema.

## Stack

- Frontend: React + TypeScript + Vite + Tailwind CSS + TanStack Query + TanStack Table
- Routing: React Router (kept separate from data/state concerns for a smaller dependency surface)
- Backend: FastAPI + SQLAlchemy + psycopg
- Database: PostgreSQL 17
- Deployment: Docker Compose
- TLS: browser -> gateway is HTTPS; gateway -> FastAPI is also HTTPS. The local certificate is self-signed for development.

## Domain rules already implemented

- `sample` is the canonical term (not specimen).
- Samples may have a parent sample and offspring samples.
- Materials may have a parent material and offspring materials.
- Creating offspring does **not** inherit/copy parent properties. Only the parent relationship is set automatically.
- `/sample/:id` exposes clickable parent and offspring lineage.
- Sample fields are directly editable row-by-row from the detail page.

## Run

```bash
cp .env.example .env
docker compose up --build
```

Open:

```text
https://localhost:8443
```

Because the development gateway certificate is self-signed, the browser will show a certificate warning. For a real deployment, replace the generated development certificate with a certificate from your ingress/reverse proxy (for example Let's Encrypt, OpenShift Route TLS, AWS ALB/ACM, etc.).

API docs are available through the same encrypted origin:

```text
https://localhost:8443/api/docs
```

## Encryption model

The React application is a static browser application, so there is no frontend-server process making API calls. The user's browser calls `/api` over HTTPS. The gateway then proxies to FastAPI over HTTPS on the private Docker network. This means both network hops are encrypted in this starter.

## Current UI scope

- Sample list/data-grid view
- Sample detail workspace
- Inline/row-level editing
- Parent/offspring navigation
- Create offspring sample without inheritance
- Material lineage API endpoints

The remaining schema tables (process events, assays, results, storage events, and data files) are included in `database/schema.sql` and ready for their UI/API layers as the workflow is defined.
