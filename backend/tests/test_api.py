"""Tests for session lifecycle, analytics, and general API health."""

from fastapi.testclient import TestClient


def test_health_check(client: TestClient):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_start_session_requires_auth(client: TestClient):
    resp = client.post("/api/sessions")
    assert resp.status_code == 401


def test_start_and_stop_session_flow(client: TestClient, auth_headers: dict):
    start_resp = client.post("/api/sessions", headers=auth_headers)
    assert start_resp.status_code == 201
    session_id = start_resp.json()["id"]
    assert start_resp.json()["status"] == "active"

    stop_payload = {
        "blink_count": 42,
        "yawn_count": 2,
        "eye_closure_events": 1,
        "drowsiness_events": 1,
        "distraction_events": 2,
        "phone_detection_count": 1,
        "total_drowsiness_duration": 3.2,
        "total_distraction_duration": 5.5,
        "longest_eye_closure": 2.1,
        "longest_distraction": 3.0,
        "risk_score_samples": [10, 20, 60, 15],
        "maximum_risk_level": "HIGH",
        "events": [
            {"event_type": "YAWN", "confidence": 0.9, "duration_seconds": 1.5, "severity": "WARNING"}
        ],
        "alerts": [
            {
                "alert_type": "DROWSINESS_ALERT",
                "level": "DANGER",
                "message": "Eyes closed too long",
                "reasons": ["Eyes closed for 2.4s"],
            }
        ],
    }
    stop_resp = client.post(f"/api/sessions/{session_id}/stop", json=stop_payload, headers=auth_headers)
    assert stop_resp.status_code == 200
    body = stop_resp.json()
    assert body["status"] == "completed"
    assert body["blink_count"] == 42
    assert body["average_risk_score"] == 26.25  # mean of [10, 20, 60, 15]
    assert body["maximum_risk_level"] == "HIGH"


def test_cannot_stop_session_twice(client: TestClient, auth_headers: dict):
    session_id = client.post("/api/sessions", headers=auth_headers).json()["id"]
    minimal_stop = {"risk_score_samples": [10], "maximum_risk_level": "LOW"}
    client.post(f"/api/sessions/{session_id}/stop", json=minimal_stop, headers=auth_headers)
    second = client.post(f"/api/sessions/{session_id}/stop", json=minimal_stop, headers=auth_headers)
    assert second.status_code == 400


def test_cannot_access_other_users_session(client: TestClient, auth_headers: dict):
    session_id = client.post("/api/sessions", headers=auth_headers).json()["id"]

    other_token = client.post(
        "/api/auth/register",
        json={"email": "other@example.com", "username": "other", "password": "otherpass1"},
    ).json()["access_token"]
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp = client.get(f"/api/sessions/{session_id}", headers=other_headers)
    assert resp.status_code == 404


def test_list_sessions_returns_only_own_sessions(client: TestClient, auth_headers: dict):
    client.post("/api/sessions", headers=auth_headers)
    client.post("/api/sessions", headers=auth_headers)
    resp = client.get("/api/sessions", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_analytics_summary_empty_state(client: TestClient, auth_headers: dict):
    resp = client.get("/api/analytics/summary", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_sessions"] == 0
    assert body["highest_risk_level"] == "SAFE"


def test_analytics_summary_after_completed_session(client: TestClient, auth_headers: dict):
    session_id = client.post("/api/sessions", headers=auth_headers).json()["id"]
    stop_payload = {
        "blink_count": 10,
        "yawn_count": 1,
        "drowsiness_events": 1,
        "distraction_events": 0,
        "phone_detection_count": 0,
        "risk_score_samples": [30, 40],
        "maximum_risk_level": "MEDIUM",
    }
    client.post(f"/api/sessions/{session_id}/stop", json=stop_payload, headers=auth_headers)

    resp = client.get("/api/analytics/summary", headers=auth_headers)
    body = resp.json()
    assert body["total_sessions"] == 1
    assert body["total_yawns"] == 1
    assert body["highest_risk_level"] == "MEDIUM"


def test_calibration_is_saved_and_scoped_to_logged_in_user(client: TestClient, auth_headers: dict):
    profile = {
        "ear_baseline": 0.31, "ear_std": 0.02, "mar_baseline": 0.22, "mar_std": 0.04,
        "head_yaw_baseline": 1.2, "head_pitch_baseline": -2.0, "head_roll_baseline": 0.5,
        "sample_count": 120,
    }
    saved = client.put("/api/calibration", json=profile, headers=auth_headers)
    assert saved.status_code == 200
    assert saved.json()["ear_baseline"] == 0.31
    loaded = client.get("/api/calibration", headers=auth_headers)
    assert loaded.status_code == 200
    assert loaded.json()["sample_count"] == 120
