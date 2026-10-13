import pathlib
import shutil
import tempfile
import unittest

from flightmap.app import CONTENT_SECURITY_POLICY, create_app
from flightmap.config import Settings

from .asgi import asgi_get

PUBLIC = pathlib.Path(__file__).resolve().parents[2] / "web" / "public"
EXPECTED = {
    "favicon.svg": "image/svg+xml",
    "favicon-32.png": "image/png",
    "apple-touch-icon.png": "image/png",
}


class IconsTest(unittest.IsolatedAsyncioTestCase):
    async def test_icons_are_served_with_their_type_and_a_day_of_cache(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            for name in [*EXPECTED, "favicon.ico"]:
                shutil.copy(PUBLIC / name, d)
            app = create_app(
                Settings(demo_mode=True, data_dir="", prefetch_regions="off", gzip=False, static_dir=d)
            )
            for name, mime in EXPECTED.items():
                r = await asgi_get(app, f"/{name}")
                self.assertEqual(r.status, 200, name)
                self.assertTrue(r.headers["content-type"].startswith(mime), name)
                self.assertEqual(r.headers["cache-control"], "public, max-age=86400", name)
            ico = await asgi_get(app, "/favicon.ico")
            self.assertEqual(ico.status, 200)
            self.assertIn("icon", ico.headers["content-type"])
            self.assertEqual(ico.headers["cache-control"], "public, max-age=86400")

    def test_the_csp_allows_same_origin_icons_and_the_page_links_them(self) -> None:
        self.assertIn("img-src 'self'", CONTENT_SECURITY_POLICY)
        html = (PUBLIC.parent / "index.html").read_text()
        for name in [*EXPECTED, "favicon.ico"]:
            self.assertIn(f'href="{name}"', html)
        self.assertIn('name="theme-color"', html)

    def test_the_ico_holds_16_32_and_48_pixel_images(self) -> None:
        data = (PUBLIC / "favicon.ico").read_bytes()
        count = int.from_bytes(data[4:6], "little")
        sizes = sorted(data[6 + 16 * i] for i in range(count))
        self.assertEqual(sizes, [16, 32, 48])
