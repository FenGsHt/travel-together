from pathlib import Path


def test_all_dialog_close_buttons_use_explicit_close_target_binding():
    html = (Path(__file__).resolve().parents[1] / "index.html").read_text(encoding="utf-8")
    script = (Path(__file__).resolve().parents[1] / "app.js").read_text(encoding="utf-8")

    assert 'data-close-dialog' in html
    assert "querySelectorAll('[data-close-dialog]')" in script
    assert "travelDetailDialog?.addEventListener('click'" in script
    assert 'if (clickedBackdrop) travelDetailDialog.close()' in script
