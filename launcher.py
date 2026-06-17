"""
Ledger Lever — Windows launcher entry point.

Starts the FastAPI/uvicorn server and opens the browser.
Works both in development (python launcher.py) and as a PyInstaller bundle.
"""
import os
import sys
import threading
import time
import webbrowser

import uvicorn

HOST = "127.0.0.1"
PORT = 8000
URL = f"http://{HOST}:{PORT}"


def _open_browser():
    # Give uvicorn a moment to bind before opening the browser.
    time.sleep(2)
    webbrowser.open(URL)


if __name__ == "__main__":
    # When frozen by PyInstaller, sys._MEIPASS is the temp extraction dir.
    if getattr(sys, "frozen", False):
        base_dir = sys._MEIPASS  # type: ignore[attr-defined]
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))

    # Tell the app where to find bundled static frontend files.
    os.environ.setdefault("LEDGER_STATIC_DIR", os.path.join(base_dir, "frontend_dist"))

    # SQLite database lives next to the exe (user's AppData or install dir).
    if getattr(sys, "frozen", False):
        data_dir = os.path.join(os.path.expanduser("~"), "LedgerLever")
        os.makedirs(data_dir, exist_ok=True)
        os.environ.setdefault("LEDGER_DB_PATH", os.path.join(data_dir, "portfolio.db"))

    threading.Thread(target=_open_browser, daemon=True).start()

    uvicorn.run(
        "backend.app.main:app",
        host=HOST,
        port=PORT,
        log_level="warning",
    )
