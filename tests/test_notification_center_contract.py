from pathlib import Path


def test_notification_center_uses_backend_created_at_timestamp():
    source = (Path(__file__).resolve().parents[1] / "app.js").read_text(encoding="utf-8")

    assert "formatTime(notif.createdAt)" in source
