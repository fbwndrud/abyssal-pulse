#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Neon Pulse — local launcher.

Run with uv (recommended — handles Python version automatically):
    uv run play.py

Or with plain Python 3:
    python3 play.py

Starts a tiny HTTP server so the audio files can load, then opens your browser.
"""
import http.server, socketserver, webbrowser, os, sys

PORT = 8765
os.chdir(os.path.dirname(os.path.abspath(__file__)))

Handler = http.server.SimpleHTTPRequestHandler
# Quiet the per-request log lines
Handler.log_message = lambda *a, **k: None

try:
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
except OSError:
    # Port in use — try a couple of alternates
    for p in (8766, 8767, 8080, 8000):
        try:
            httpd = socketserver.TCPServer(("127.0.0.1", p), Handler)
            PORT = p
            break
        except OSError:
            continue
    else:
        print("Could not bind any local port. Close other servers and retry.")
        sys.exit(1)

url = f"http://127.0.0.1:{PORT}/index.html"
print(f"\n  Neon Pulse running at {url}")
print(f"  Press Ctrl+C to stop.\n")

try:
    webbrowser.open(url)
except Exception:
    pass

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\n  stopped.")
