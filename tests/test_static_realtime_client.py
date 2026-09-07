from pathlib import Path


def test_realtime_client_uses_the_socketio_browser_global_for_static_deployment():
    source = (Path(__file__).resolve().parents[1] / "src" / "realtime-client.js").read_text(
        encoding="utf-8"
    )

    assert "from 'socket.io-client'" not in source
    assert "window.io" in source
