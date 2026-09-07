import os
import sys
from pathlib import Path

import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("FLASK_SECRET_KEY", "test-flask-secret")
os.environ.setdefault("SITE_ACCESS_TOKEN", "test-access-token")

import app as backend_app  # noqa: E402
import user_manager  # noqa: E402


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(backend_app, "PROJECTS_FILE", tmp_path / "projects.json")
    monkeypatch.setattr(backend_app, "PROJECTS_LOCK_FILE", tmp_path / "projects.lock")
    monkeypatch.setattr(backend_app, "NOTIFICATIONS_FILE", tmp_path / "notifications.json")
    monkeypatch.setattr(user_manager, "USERS_FILE", tmp_path / "users.json")

    backend_app.app.config.update(TESTING=True, SECRET_KEY="test-flask-secret")
    with backend_app.app.test_client() as test_client:
        yield test_client


def test_access_key_login_provides_identity_for_project_and_notifications(client):
    login = client.post("/api/auth/verify", json={"token": "test-access-token"})
    assert login.status_code == 200

    project = client.post("/api/projects", json={"name": "滇南周末"})
    assert project.status_code == 200
    project_body = project.get_json()
    assert project_body["members"][0]["role"] == "owner"

    members = client.get(f"/api/projects/{project_body['id']}/members")
    assert members.status_code == 200
    assert members.get_json()["members"][0]["displayName"]

    unread_count = client.get("/api/notifications/unread-count")
    assert unread_count.status_code == 200
    assert unread_count.get_json() == {"count": 0}
