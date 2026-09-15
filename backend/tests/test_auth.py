"""Tests for register/login/me and password security."""

from fastapi.testclient import TestClient


def test_register_creates_user_and_returns_token(client: TestClient):
    resp = client.post(
        "/api/auth/register",
        json={"email": "new@example.com", "username": "newdriver", "password": "hunter2pass"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["access_token"]
    assert body["user"]["email"] == "new@example.com"


def test_register_duplicate_email_rejected(client: TestClient):
    payload = {"email": "dup@example.com", "username": "dup", "password": "hunter2pass"}
    client.post("/api/auth/register", json=payload)
    resp = client.post("/api/auth/register", json=payload)
    assert resp.status_code == 409


def test_login_with_correct_password_succeeds(client: TestClient):
    client.post(
        "/api/auth/register",
        json={"email": "login@example.com", "username": "loginuser", "password": "correctpass"},
    )
    resp = client.post(
        "/api/auth/login", json={"email": "login@example.com", "password": "correctpass"}
    )
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_login_with_wrong_password_rejected(client: TestClient):
    client.post(
        "/api/auth/register",
        json={"email": "wrong@example.com", "username": "wronguser", "password": "correctpass"},
    )
    resp = client.post(
        "/api/auth/login", json={"email": "wrong@example.com", "password": "incorrectpass"}
    )
    assert resp.status_code == 401


def test_me_requires_authentication(client: TestClient):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_returns_current_user(client: TestClient, auth_headers: dict):
    resp = client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == "driver@example.com"


def test_password_is_never_stored_in_plaintext(client: TestClient):
    from app.database import SessionLocal  # noqa: F401 — not used directly; see below
    from tests.conftest import TestingSessionLocal

    client.post(
        "/api/auth/register",
        json={"email": "hash@example.com", "username": "hashuser", "password": "plaintextpass"},
    )
    db = TestingSessionLocal()
    try:
        from app.models import User

        user = db.query(User).filter(User.email == "hash@example.com").first()
        assert user is not None
        assert user.hashed_password != "plaintextpass"
        assert user.hashed_password.startswith("$2b$")  # bcrypt hash prefix
    finally:
        db.close()
