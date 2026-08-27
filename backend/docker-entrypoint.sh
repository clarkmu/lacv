#!/bin/sh
set -eu
mkdir -p /tmp/lims-certs
openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
  -keyout /tmp/lims-certs/backend.key \
  -out /tmp/lims-certs/backend.crt \
  -subj "/CN=backend" \
  -addext "subjectAltName=DNS:backend" >/dev/null 2>&1
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 \
  --ssl-keyfile /tmp/lims-certs/backend.key \
  --ssl-certfile /tmp/lims-certs/backend.crt
