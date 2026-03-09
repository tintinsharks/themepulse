#!/usr/bin/env python3
"""Tiny local HTTP server that triggers AI analysis on demand.
Listens on localhost:7829. POST /trigger kicks off run-ai-analysis.sh.
GET /status returns whether a run is in progress + last log lines.
"""

import http.server
import json
import subprocess
import threading
import os
import time

PORT = 7829
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "run-ai-analysis.sh")
LOG = os.path.expanduser("~/Library/Logs/ai-analysis.log")

running = False
last_trigger = None


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        global running, last_trigger
        if self.path == "/trigger":
            if running:
                self._json(409, {"ok": False, "error": "Already running"})
                return
            running = True
            last_trigger = time.time()
            threading.Thread(target=self._run, daemon=True).start()
            self._json(200, {"ok": True, "message": "AI analysis triggered"})
        else:
            self._json(404, {"error": "Not found"})

    def do_GET(self):
        if self.path == "/status":
            tail = ""
            try:
                result = subprocess.run(["tail", "-5", LOG], capture_output=True, text=True, timeout=5)
                tail = result.stdout
            except Exception:
                pass
            self._json(200, {
                "running": running,
                "last_trigger": last_trigger,
                "log_tail": tail,
            })
        else:
            self._json(404, {"error": "Not found"})

    def _json(self, code, data):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _run(self):
        global running
        try:
            subprocess.run(["/bin/bash", SCRIPT], timeout=1800)
        except Exception:
            pass
        finally:
            running = False

    def log_message(self, format, *args):
        pass  # suppress request logs


if __name__ == "__main__":
    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"AI analysis trigger server on http://localhost:{PORT}")
    server.serve_forever()
