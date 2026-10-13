"""Aircraft state record shared by providers, the tile cache and the codec."""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum


class Category(IntEnum):
    """Coarse category used to choose a map icon."""

    UNKNOWN = 0
    LIGHT = 1
    JET = 2
    HEAVY = 3
    ROTORCRAFT = 4
    GLIDER = 5
    GROUND = 6
    OTHER = 7


FLAG_GROUND = 1
FLAG_MILITARY = 2
FLAG_NON_ADSB = 4  # MLAT / TIS-B / other derived positions
FLAG_EMERGENCY = 8


@dataclass(slots=True)
class Aircraft:
    hex: int  # 24-bit ICAO address
    lat: float
    lon: float
    callsign: str = ""
    registration: str = ""
    type_code: str = ""
    category: Category = Category.UNKNOWN
    altitude_ft: int | None = None  # barometric; None when unknown
    on_ground: bool = False
    ground_speed_kt: float | None = None
    track_deg: float | None = None
    vertical_rate_fpm: int | None = None
    squawk: int | None = None  # decimal reading of the 4 octal digits, e.g. 7700
    military: bool = False
    non_adsb: bool = False
    emergency: bool = False
    position_age_s: float = 0.0  # age of the position at fetch time

    @property
    def hex_str(self) -> str:
        return f"{self.hex:06x}"
