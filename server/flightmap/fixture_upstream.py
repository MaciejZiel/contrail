"""Fixture upstream HTTP server: synthetic data shaped exactly like ADSB.lol responses.

End-to-end tests point the unmodified server at this process via ``ADSBLOL_URL``.
Run: ``python -m flightmap.fixture_upstream --port 9100``.
"""

from __future__ import annotations

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .demo import DemoTraffic

_ROUTE = re.compile(r"^/routes/([A-Z0-9]{2})/([A-Z0-9]+)\.json$")
_HEX = re.compile(r"^/v2/hex/([0-9a-fA-F]{6})$")
_POINT = re.compile(r"^/v2/point/(-?\d+(?:\.\d+)?)/(-?\d+(?:\.\d+)?)/(\d+)$")


def make_handler(traffic: DemoTraffic) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/healthz":
                self._send(200, b'{"ok":true}')
                return
            r = _ROUTE.match(self.path)
            if r:
                payload = traffic.route_payload(r[2])
                if payload is None:
                    self._send(404, b"Not Found", "text/html")
                else:
                    self._send(200, json.dumps(payload).encode())
                return
            h = _HEX.match(self.path)
            if h:
                rec = traffic.by_hex(h[1])
                self._send(200, json.dumps({"ac": [rec] if rec else [], "total": 1 if rec else 0}).encode())
                return
            m = _POINT.match(self.path)
            if m:
                payload = traffic.point(float(m[1]), float(m[2]), float(m[3]))
                self._send(200, json.dumps(payload).encode())
                return
            self._send(404, b'{"error":"not found"}')

        def log_message(self, format: str, *args: Any) -> None:
            return

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9100)
    parser.add_argument("--flights", type=int, default=5000)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(DemoTraffic(args.flights)))
    server.serve_forever()


if __name__ == "__main__":
    main()
