import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from flightmap.upstream import TokenBucket, UpstreamClient, UpstreamError


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        routes = {
            "/ok": (200, b'{"a": 1}'),
            "/empty201": (201, b""),
            "/bad": (200, b"<html>"),
            "/limited": (429, b"{}"),
        }
        status, body = routes.get(self.path, (404, b"{}"))
        self.send_response(status)
        if status == 429:
            self.send_header("Retry-After", "7")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        return


class UpstreamTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
        ).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.client = UpstreamClient("test/1.0 (+https://example.test)", timeout_s=3)

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.client.close()

    async def test_ok_and_post(self) -> None:
        self.assertEqual(await self.client.get_json(f"{self.base}/ok"), {"a": 1})
        self.assertEqual(await self.client.post_json(f"{self.base}/x", {"b": 2}), {"b": 2})

    async def test_empty_201_is_an_upstream_error_not_a_crash(self) -> None:
        with self.assertRaises(UpstreamError) as ctx:
            await self.client.get_json(f"{self.base}/empty201")
        self.assertEqual(ctx.exception.status, 201)

    async def test_invalid_json_and_http_errors(self) -> None:
        with self.assertRaises(UpstreamError):
            await self.client.get_json(f"{self.base}/bad")
        with self.assertRaises(UpstreamError) as ctx:
            await self.client.get_json(f"{self.base}/limited")
        self.assertEqual((ctx.exception.status, ctx.exception.retry_after), (429, 7.0))

    async def test_connection_refused_and_bad_scheme(self) -> None:
        with self.assertRaises(UpstreamError):
            await self.client.get_json("http://127.0.0.1:1/x")
        with self.assertRaises(UpstreamError):
            await self.client.get_json("file:///etc/passwd")


class TokenBucketTest(unittest.TestCase):
    def test_burst_then_wait(self) -> None:
        b = TokenBucket(rate=1.0, burst=2.0)
        self.assertTrue(b.try_take())
        self.assertTrue(b.try_take())
        self.assertFalse(b.try_take())
        self.assertGreater(b.wait_time(), 0.0)
