"""启动回归测试：确保 Flask-SocketIO 能在非 debug 模式下正常启动并响应 /api/health。

背景：生产 systemd 服务使用 `python3 app.py` 直接启动，而 Werkzeug >= 2.3
默认拒绝在 `debug=False` 时运行开发服务器，导致 /api/health 返回 502。
本测试在独立线程中实际启动服务，验证 allow_unsafe_werkzeug=True 生效。
"""
import os
import socket
import sys
import threading
import time
from contextlib import closing
from pathlib import Path
from urllib.request import urlopen

import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("FLASK_SECRET_KEY", "test-flask-secret")
os.environ.setdefault("SITE_ACCESS_TOKEN", "test-access-token")
# 明确非 debug，与生产一致
os.environ["FLASK_DEBUG"] = "false"


def _free_port():
    with closing(socket.socket(socket.AF_INET)) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    """让启动过程使用临时目录，避免污染仓库 data/。"""
    import app as backend_app
    import user_manager

    monkeypatch.setattr(backend_app, "DATA_DIR", tmp_path)
    monkeypatch.setattr(backend_app, "PROJECTS_FILE", tmp_path / "projects.json")
    monkeypatch.setattr(backend_app, "PROJECTS_LOCK_FILE", tmp_path / "projects.lock")
    monkeypatch.setattr(backend_app, "NOTIFICATIONS_FILE", tmp_path / "notifications.json")
    monkeypatch.setattr(
        backend_app,
        "NOTIFICATION_PREFERENCES_FILE",
        tmp_path / "notification_preferences.json",
        raising=False,
    )
    monkeypatch.setattr(user_manager, "USERS_FILE", tmp_path / "users.json")
    return tmp_path


def test_server_starts_and_serves_health_when_debug_is_false(data_dir):
    """模拟生产：debug=False 时服务能启动并返回 JSON。"""
    import app as backend_app
    from websocket_handler import socketio

    port = _free_port()
    started = threading.Event()
    failure = {}

    def _run():
        try:
            # 与 __main__ 一致的启动方式
            socketio.run(
                backend_app.app,
                host="127.0.0.1",
                port=port,
                debug=False,
                allow_unsafe_werkzeug=True,
                use_reloader=False,
            )
        except Exception as exc:  # pragma: no cover - 失败时便于诊断
            failure["error"] = repr(exc)
        finally:
            started.set()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    # 等待服务可访问，最多 10 秒
    deadline = time.time() + 10
    last_error = None
    while time.time() < deadline:
        try:
            with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as resp:
                assert resp.status == 200
                body = resp.read().decode("utf-8")
                assert '"status"' in body and '"ok"' in body
                return
        except Exception as exc:
            last_error = exc
            time.sleep(0.2)

    pytest.fail(
        f"/api/health did not respond within 10s on port {port}: {last_error!r}"
        f" | server failure: {failure}"
    )
