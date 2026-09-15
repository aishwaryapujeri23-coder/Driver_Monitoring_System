"""Shared pytest fixtures — an isolated in-memory SQLite DB per test run."""

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_driver_monitoring.db")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app

TEST_DB_URL = "sqlite:///./test_driver_monitoring.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function", autouse=True)
def _fresh_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def auth_headers(client: TestClient) -> dict:
    """Registers a user and returns Authorization headers for it."""
    resp = client.post(
        "/api/auth/register",
        json={"email": "driver@example.com", "username": "driver1", "password": "secretpass"},
    )
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
