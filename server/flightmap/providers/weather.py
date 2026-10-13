"""METAR and TAF from the Aviation Weather Center data API (US government data)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, cast

from ..upstream import BudgetExhausted, TokenBucket, UpstreamClient, UpstreamError

_ICAO = re.compile(r"^[A-Z0-9]{3,4}$")
_SM_TO_M = 1609.344


@dataclass(slots=True)
class Metar:
    icao: str
    observed_at: float
    raw: str
    temp_c: float | None = None
    dewpoint_c: float | None = None
    wind_dir: int | None = None
    wind_variable: bool = False
    wind_kt: float | None = None
    gust_kt: float | None = None
    visibility_m: int | None = None
    visibility_plus: bool = False  # the report says "more than"
    qnh_hpa: float | None = None
    clouds: list[dict[str, Any]] = field(default_factory=lambda: list[dict[str, Any]]())
    weather: str = ""
    flight_category: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "observed_at": self.observed_at, "raw": self.raw, "temp_c": self.temp_c, "dewpoint_c": self.dewpoint_c,
            "wind_dir": self.wind_dir, "wind_variable": self.wind_variable, "wind_kt": self.wind_kt,
            "gust_kt": self.gust_kt, "visibility_m": self.visibility_m, "visibility_plus": self.visibility_plus,
            "qnh_hpa": self.qnh_hpa, "clouds": self.clouds, "weather": self.weather,
            "flight_category": self.flight_category,
        }  # fmt: skip


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def parse_metar(item: dict[str, Any]) -> Metar | None:
    raw = item.get("rawOb")
    obs = _num(item.get("obsTime"))
    if not isinstance(raw, str) or obs is None:
        return None
    wdir = item.get("wdir")
    visib = item.get("visib")
    vis_m: int | None = None
    plus = False
    if isinstance(visib, str):
        plus = visib.endswith("+")
        try:
            vis_m = round(float(visib.rstrip("+")) * _SM_TO_M)
        except ValueError:
            vis_m = None
    elif (sm := _num(visib)) is not None:
        vis_m = round(sm * _SM_TO_M)
    clouds: list[dict[str, Any]] = []
    raw_clouds = item.get("clouds")
    if isinstance(raw_clouds, list):
        for c in cast(list[Any], raw_clouds):
            if isinstance(c, dict):
                cd = cast(dict[str, Any], c)
                clouds.append({"cover": str(cd.get("cover") or ""), "base_ft": _num(cd.get("base"))})
    return Metar(
        icao=str(item.get("icaoId") or ""),
        observed_at=obs,
        raw=raw,
        temp_c=_num(item.get("temp")),
        dewpoint_c=_num(item.get("dewp")),
        wind_dir=int(wdir) if isinstance(wdir, int | float) else None,
        wind_variable=wdir == "VRB",
        wind_kt=_num(item.get("wspd")),
        gust_kt=_num(item.get("wgst")),
        visibility_m=vis_m,
        visibility_plus=plus,
        qnh_hpa=_num(item.get("altim")),
        clouds=clouds,
        weather=str(item.get("wxString") or ""),
        flight_category=str(item.get("fltCat") or ""),
    )


async def _get_limited(client: UpstreamClient, bucket: TokenBucket | None, url: str) -> Any:
    """One request, or two when the first times out: every attempt takes a token from the bucket
    that keeps us under the Aviation Weather Center limit of 100 requests per minute."""
    for attempt in (1, 2):
        if bucket is not None and not bucket.try_take():
            raise BudgetExhausted("weather")
        try:
            return await client.get_json(url)
        except BudgetExhausted:
            raise
        except UpstreamError as exc:
            if attempt == 2 or exc.status is not None:  # only network errors and timeouts are retried
                raise
    raise UpstreamError("unreachable")


class WeatherProvider:
    name = "aviationweather.gov"

    def __init__(self, client: UpstreamClient, base_url: str, bucket: TokenBucket | None = None) -> None:
        self._client = client
        self._bucket = bucket
        self._base = base_url.rstrip("/")

    async def metar(self, icao: str) -> Metar | None:
        code = icao.upper()
        if not _ICAO.match(code):
            return None
        payload = await _get_limited(
            self._client, self._bucket, f"{self._base}/api/data/metar?ids={code}&format=json"
        )
        if not isinstance(payload, list):
            raise UpstreamError("unexpected METAR response shape")
        for item in cast(list[Any], payload):
            if isinstance(item, dict):
                m = parse_metar(cast(dict[str, Any], item))
                if m is not None:
                    return m
        return None

    async def taf(self, icao: str) -> str | None:
        code = icao.upper()
        if not _ICAO.match(code):
            return None
        payload = await _get_limited(
            self._client, self._bucket, f"{self._base}/api/data/taf?ids={code}&format=json"
        )
        if not isinstance(payload, list):
            raise UpstreamError("unexpected TAF response shape")
        for item in cast(list[Any], payload):
            if isinstance(item, dict):
                raw = cast(dict[str, Any], item).get("rawTAF")
                if isinstance(raw, str) and raw:
                    return raw
        return None
