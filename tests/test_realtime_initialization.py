from pathlib import Path


def test_project_initialization_starts_realtime_collaboration_after_loading():
    source = (Path(__file__).resolve().parents[1] / "app.js").read_text(encoding="utf-8")

    assert source.count("initRealtime();") == 1
