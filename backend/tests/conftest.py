"""Test fixtures backed by a real PostgreSQL server.

Set LACV_TEST_DATABASE_URL to a server URL whose user may create databases, e.g.
    LACV_TEST_DATABASE_URL=postgresql+psycopg://lims@127.0.0.1:5432/postgres
Each test gets its own throwaway database. Tests needing PostgreSQL are skipped
when the variable is unset.
"""
import os
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(BACKEND_DIR))

ADMIN_URL = os.getenv("LACV_TEST_DATABASE_URL")


def _libpq_url(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def _database_url(name: str) -> str:
    from sqlalchemy.engine import make_url

    return make_url(ADMIN_URL).set(database=name).render_as_string(hide_password=False)


@pytest.fixture
def make_database():
    """Create throwaway databases; all are dropped when the test ends."""
    if not ADMIN_URL:
        pytest.skip("LACV_TEST_DATABASE_URL is not set")
    import psycopg

    names = []

    def create() -> str:
        name = f"lacv_test_{uuid.uuid4().hex[:12]}"
        with psycopg.connect(_libpq_url(ADMIN_URL), autocommit=True) as connection:
            connection.execute(f'CREATE DATABASE "{name}" ENCODING UTF8 TEMPLATE template0')
        names.append(name)
        return _database_url(name)

    try:
        yield create
    finally:
        from sqlalchemy.orm import close_all_sessions

        close_all_sessions()
        with psycopg.connect(_libpq_url(ADMIN_URL), autocommit=True) as connection:
            for name in names:
                connection.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def run_sql(database_url: str, *statements_or_paths) -> None:
    import psycopg

    with psycopg.connect(_libpq_url(database_url), autocommit=True) as connection:
        for item in statements_or_paths:
            connection.execute(item.read_text() if isinstance(item, Path) else item)


def query(database_url: str, sql: str, params=None) -> list[tuple]:
    import psycopg

    with psycopg.connect(_libpq_url(database_url)) as connection:
        return connection.execute(sql, params).fetchall()


def alembic(database_url: str, command_name: str, revision: str) -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    try:
        getattr(command, command_name)(config, revision)
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous


def build_current_database(database_url: str) -> str:
    """The current schema and seed data, as a fresh docker compose database gets them."""
    run_sql(database_url, REPO_DIR / "database" / "schema.sql", REPO_DIR / "database" / "seed.sql")
    return database_url


def build_legacy_database(database_url: str) -> str:
    """The pre-Sample-centric shape (Alembic 20260826_0003) with the old seed data."""
    run_sql(database_url, FIXTURES_DIR / "legacy_0003_schema.sql", FIXTURES_DIR / "legacy_0003_seed.sql")
    alembic(database_url, "stamp", "20260826_0003")
    return database_url


@pytest.fixture
def current_database_url(make_database):
    return build_current_database(make_database())


@pytest.fixture
def legacy_database_url(make_database):
    return build_legacy_database(make_database())


@pytest.fixture
def client(current_database_url):
    with api_client(current_database_url) as test_client:
        yield test_client


@contextmanager
def api_client(database_url: str):
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.database import get_db
    from app.main import app

    engine = create_engine(database_url)
    TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db():
        session = TestSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
