"""Runtime configuration, read only from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_CONTACT = "https://github.com/MaciejZiel/live_flights_map"


def _bool(raw: str | None, default: bool) -> bool:
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _base_path(raw: str) -> str:
    raw = raw.strip().strip("/")
    return f"/{raw}" if raw else ""


@dataclass(frozen=True, slots=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    base_path: str = ""
    data_dir: str = "./data"
    static_dir: str = ""
    demo_mode: bool = False
    gzip: bool = True
    adsblol_url: str = "https://api.adsb.lol"
    routes_url: str = "https://vrs-standing-data.adsb.lol"
    weather_url: str = "https://aviationweather.gov"
    trail_retention_s: float = 2700.0
    trail_min_interval_s: float = 10.0
    max_tile_age_s: float = 600.0
    prefetch_region: str = "35,72,-25,45"  # south,north,west,east in degrees; empty disables prefetching
    prefetch_idle_s: float = 900.0
    prefetch_always: bool = False
    upstream_budget_rps: float = 0.35
    tile_ttl_s: float = 10.0
    hot_window_s: float = 60.0
    evict_after_s: float = 600.0
    max_tiles_per_request: int = 800
    user_agent: str = field(default=f"LiveFlightsMap/1.0 (+{DEFAULT_CONTACT})")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        e = dict(os.environ) if env is None else env
        contact = e.get("USER_AGENT_CONTACT", DEFAULT_CONTACT)
        return cls(
            host=e.get("HOST", "127.0.0.1"),
            port=int(e.get("PORT", "8000")),
            base_path=_base_path(e.get("BASE_PATH", "")),
            data_dir=e.get("DATA_DIR", "./data"),
            static_dir=e.get("STATIC_DIR", ""),
            demo_mode=_bool(e.get("DEMO_MODE"), False),
            gzip=_bool(e.get("GZIP"), True),
            adsblol_url=e.get("ADSBLOL_URL", "https://api.adsb.lol").rstrip("/"),
            routes_url=e.get("ROUTES_URL", "https://vrs-standing-data.adsb.lol").rstrip("/"),
            weather_url=e.get("WEATHER_URL", "https://aviationweather.gov").rstrip("/"),
            trail_retention_s=float(e.get("TRAIL_RETENTION_S", "2700")),
            trail_min_interval_s=float(e.get("TRAIL_MIN_INTERVAL_S", "10")),
            max_tile_age_s=float(e.get("MAX_TILE_AGE_S", "600")),
            prefetch_region=e.get(
                "PREFETCH_REGION", "" if _bool(e.get("DEMO_MODE"), False) else "35,72,-25,45"
            ),
            prefetch_idle_s=float(e.get("PREFETCH_IDLE_S", "900")),
            prefetch_always=_bool(e.get("PREFETCH_ALWAYS"), False),
            upstream_budget_rps=float(
                e.get("UPSTREAM_BUDGET_RPS", "100" if _bool(e.get("DEMO_MODE"), False) else "0.35")
            ),
            tile_ttl_s=float(e.get("TILE_TTL_S", "10")),
            hot_window_s=float(e.get("HOT_WINDOW_S", "60")),
            evict_after_s=float(e.get("EVICT_AFTER_S", "600")),
            max_tiles_per_request=int(e.get("MAX_TILES_PER_REQUEST", "800")),
            user_agent=f"LiveFlightsMap/1.0 (+{contact})",
        )
