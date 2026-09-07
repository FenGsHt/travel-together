from pathlib import Path


def test_notification_center_exposes_a_settings_entrypoint():
    source = (Path(__file__).resolve().parents[1] / "index.html").read_text(encoding="utf-8")

    assert 'id="notification-settings"' in source
    assert 'id="notification-settings-dialog"' in source
