"""Build the aircraft-type photo gallery from Wikimedia Commons.

Only public-domain, CC0 and CC BY images are accepted (never SA, NC or ND), so the photos can be
shown with a visible credit and stored with the app. For each ICAO type designator the best match
is downloaded as a Commons-generated 640 px thumbnail into ``web/public/type-photos`` together
with ``manifest.json`` (file, source page, author, licence), an ``ATTRIBUTIONS.md`` table and one
line per image in ``3rdparty_licenses.md``.

Usage (network access to commons.wikimedia.org required, about one request per second)::

    python scripts/build_type_photos.py [--limit N] [--only A320,B738] [--refresh]

Existing entries are kept unless ``--refresh`` is given, so the script is resumable.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "type-photos"
LICENSES = ROOT / "3rdparty_licenses.md"
API = "https://commons.wikimedia.org/w/api.php"
UA = (
    "LiveFlightsMap-gallery/1.0 (+https://github.com/MaciejZiel/live_flights_map; type photo gallery builder)"
)
THUMB_WIDTH = 640
PAUSE_S = 1.0

# (ICAO type designator, search phrase, class, alternative title tokens)
TYPES: list[tuple[str, str, str, tuple[str, ...]]] = [
    ("A318", "Airbus A318", "airliner", ()), ("A319", "Airbus A319", "airliner", ()),
    ("A320", "Airbus A320", "airliner", ()), ("A321", "Airbus A321", "airliner", ()),
    ("A19N", "Airbus A319neo", "airliner", ("a319251n", "a319-151n")), ("A20N", "Airbus A320neo", "airliner", ("a320271n", "a320251n", "a320-271n")),
    ("A21N", "Airbus A321neo", "airliner", ("a321271n", "a321251n", "a321-271n")), ("A306", "Airbus A300-600", "airliner", ("a300",)),
    ("A310", "Airbus A310", "airliner", ()), ("A332", "Airbus A330-200", "airliner", ("a330-243", "a330243")),
    ("A333", "Airbus A330-300", "airliner", ("a330-343", "a330343")), ("A338", "Airbus A330-800", "airliner", ("a330800", "a330-841")),
    ("A339", "Airbus A330-900", "airliner", ("a330900", "a330-941")), ("A343", "Airbus A340-300", "airliner", ()),
    ("A346", "Airbus A340-600", "airliner", ()), ("A359", "Airbus A350-900", "airliner", ()),
    ("A35K", "Airbus A350-1000", "airliner", ()), ("A388", "Airbus A380", "airliner", ("a380",)),
    ("A400", "Airbus A400M Atlas", "military", ("a400m",)), ("BCS1", "Airbus A220-100", "airliner", ("a220",)),
    ("BCS3", "Airbus A220-300", "airliner", ("a220",)),
    ("B712", "Boeing 717", "airliner", ()), ("B733", "Boeing 737-300", "airliner", ()), ("B734", "Boeing 737-400", "airliner", ()),
    ("B735", "Boeing 737-500", "airliner", ()), ("B737", "Boeing 737-700", "airliner", ()), ("B738", "Boeing 737-800", "airliner", ()),
    ("B739", "Boeing 737-900", "airliner", ()), ("B37M", "Boeing 737 MAX 7", "airliner", ("737-7", "737max7")),
    ("B38M", "Boeing 737 MAX 8", "airliner", ("737-8", "737max8")), ("B39M", "Boeing 737 MAX 9", "airliner", ("737-9", "737max9")),
    ("B744", "Boeing 747-400", "airliner", ()), ("B748", "Boeing 747-8", "airliner", ("747-8",)),
    ("B752", "Boeing 757-200", "airliner", ()), ("B753", "Boeing 757-300", "airliner", ()),
    ("B762", "Boeing 767-200", "airliner", ()), ("B763", "Boeing 767-300", "airliner", ()), ("B764", "Boeing 767-400", "airliner", ()),
    ("B772", "Boeing 777-200", "airliner", ()), ("B77L", "Boeing 777-200LR", "airliner", ()), ("B773", "Boeing 777-300", "airliner", ()),
    ("B77W", "Boeing 777-300ER", "airliner", ()), ("B788", "Boeing 787-8", "airliner", ()), ("B789", "Boeing 787-9", "airliner", ()),
    ("B78X", "Boeing 787-10", "airliner", ()), ("MD11", "McDonnell Douglas MD-11", "airliner", ("md-11", "md11")),
    ("MD82", "McDonnell Douglas MD-82", "airliner", ("md-82", "md82")), ("MD83", "McDonnell Douglas MD-83", "airliner", ("md-83", "md83")),
    ("DC10", "McDonnell Douglas DC-10", "airliner", ("dc-10",)), ("RJ85", "Avro RJ85", "regional", ("rj85",)),
    ("B463", "BAe 146-300", "regional", ("146",)), ("F100", "Fokker 100", "regional", ()), ("F70", "Fokker 70", "regional", ()),
    ("E170", "Embraer 170", "regional", ()), ("E75L", "Embraer 175", "regional", ("erj-175", "e175")), ("E75S", "Embraer 175", "regional", ("erj-175", "e175")),
    ("E190", "Embraer 190", "regional", ("erj-190",)), ("E195", "Embraer 195", "regional", ("erj-195",)),
    ("E290", "Embraer E190-E2", "regional", ("e190-e2", "e190e2")), ("E295", "Embraer E195-E2", "regional", ("e195-e2", "e195e2")),
    ("E135", "Embraer ERJ 135", "regional", ("erj-135", "erj135")), ("E145", "Embraer ERJ 145", "regional", ("erj-145", "erj145")),
    ("CRJ2", "Bombardier CRJ200", "regional", ("crj-200", "crj200")), ("CRJ7", "Bombardier CRJ700", "regional", ("crj-700", "crj700")),
    ("CRJ9", "Bombardier CRJ900", "regional", ("crj-900", "crj900")), ("CRJX", "Bombardier CRJ1000", "regional", ("crj-1000", "crj1000")),
    ("AT43", "ATR 42", "regional", ("atr-42", "atr42")), ("AT45", "ATR 42-500", "regional", ("atr-42", "atr42")),
    ("AT72", "ATR 72", "regional", ("atr-72", "atr72")), ("AT76", "ATR 72-600", "regional", ("atr-72", "atr72")),
    ("DH8D", "De Havilland Canada Dash 8 Q400", "regional", ("dash 8", "q400", "dhc-8")), ("DH8C", "De Havilland Canada Dash 8-300", "regional", ("dash 8", "dhc-8")),
    ("DH8B", "De Havilland Canada Dash 8-200", "regional", ("dash 8", "dhc-8")), ("SF34", "Saab 340", "regional", ("saab 340", "saab-340")),
    ("SB20", "Saab 2000", "regional", ("saab 2000",)), ("JS41", "BAe Jetstream 41", "regional", ("jetstream",)),
    ("D328", "Dornier 328", "regional", ("do 328", "do-328", "dornier 328")), ("B190", "Beechcraft 1900", "regional", ("1900",)),
    ("SU95", "Sukhoi Superjet 100", "airliner", ("superjet", "ssj")), ("T154", "Tupolev Tu-154", "airliner", ("tu-154", "tu154")),
    ("IL96", "Ilyushin Il-96", "airliner", ("il-96", "il96")), ("AN24", "Antonov An-24", "regional", ("an-24", "an24")),
    ("A124", "Antonov An-124", "military", ("an-124", "an124")), ("AN12", "Antonov An-12", "military", ("an-12", "an12")),
    ("IL76", "Ilyushin Il-76", "military", ("il-76", "il76")),
    ("C510", "Cessna Citation Mustang", "bizjet", ("mustang",)), ("C525", "Cessna CitationJet CJ1", "bizjet", ("citationjet", "cj1", "cj2", "cj3")),
    ("C56X", "Cessna Citation Excel", "bizjet", ("citation excel", "citation xls", "560xl")), ("C680", "Cessna Citation Sovereign", "bizjet", ("sovereign",)),
    ("C750", "Cessna Citation X", "bizjet", ("citation x",)), ("CL30", "Bombardier Challenger 300", "bizjet", ("challenger 300", "challenger 350")),
    ("CL60", "Bombardier Challenger 604", "bizjet", ("challenger 604", "challenger 605", "challenger 650")), ("GLEX", "Bombardier Global Express", "bizjet", ("global express", "global 6000")),
    ("GL5T", "Bombardier Global 5000", "bizjet", ("global 5000",)), ("GL7T", "Bombardier Global 7500", "bizjet", ("global 7500",)),
    ("GLF4", "Gulfstream IV", "bizjet", ("gulfstream iv", "g-iv", "g450")), ("GLF5", "Gulfstream V", "bizjet", ("gulfstream v", "g550", "g-v")),
    ("GLF6", "Gulfstream G650", "bizjet", ("g650", "g-vi")), ("G280", "Gulfstream G280", "bizjet", ("g280",)),
    ("FA7X", "Dassault Falcon 7X", "bizjet", ("falcon 7x",)), ("F900", "Dassault Falcon 900", "bizjet", ("falcon 900",)),
    ("F2TH", "Dassault Falcon 2000", "bizjet", ("falcon 2000",)), ("LJ35", "Learjet 35", "bizjet", ("learjet 35", "learjet 36")),
    ("LJ45", "Learjet 45", "bizjet", ("learjet 45",)), ("H25B", "Hawker 800", "bizjet", ("hawker 800", "hawker 900", "bae 125")),
    ("E50P", "Embraer Phenom 100", "bizjet", ("phenom 100",)), ("E55P", "Embraer Phenom 300", "bizjet", ("phenom 300",)),
    ("SF50", "Cirrus Vision SF50", "bizjet", ("sf50", "vision jet")), ("HDJT", "HondaJet", "bizjet", ("hondajet",)),
    ("PC24", "Pilatus PC-24", "bizjet", ("pc-24", "pc24")),
    ("C150", "Cessna 150", "ga", ("150",)), ("C152", "Cessna 152", "ga", ("152",)), ("C172", "Cessna 172", "ga", ("172",)),
    ("C182", "Cessna 182", "ga", ("182",)), ("C208", "Cessna 208 Caravan", "ga", ("208", "caravan")), ("C206", "Cessna 206", "ga", ("206",)),
    ("PA28", "Piper PA-28 Cherokee", "ga", ("pa-28", "pa28", "cherokee")), ("P28A", "Piper PA-28 Cherokee", "ga", ("pa-28", "pa28", "cherokee")),
    ("P28R", "Piper PA-28R Arrow", "ga", ("pa-28", "pa28", "arrow")), ("PA34", "Piper PA-34 Seneca", "ga", ("pa-34", "pa34", "seneca")),
    ("PA46", "Piper PA-46 Malibu", "ga", ("pa-46", "pa46", "malibu")), ("SR20", "Cirrus SR20", "ga", ("sr20",)), ("SR22", "Cirrus SR22", "ga", ("sr22",)),
    ("BE36", "Beechcraft Bonanza", "ga", ("bonanza",)), ("BE58", "Beechcraft Baron", "ga", ("baron",)), ("BE20", "Beechcraft King Air 200", "ga", ("king air",)),
    ("TBM9", "Daher TBM 900", "ga", ("tbm",)), ("PC12", "Pilatus PC-12", "ga", ("pc-12", "pc12")), ("DA40", "Diamond DA40", "ga", ("da40", "da-40")),
    ("DA42", "Diamond DA42", "ga", ("da42", "da-42")), ("TB20", "Socata TB 20 Trinidad", "ga", ("tb 20", "tb20", "tb-20")), ("M20P", "Mooney M20", "ga", ("m20", "mooney")),
    ("AA5", "Grumman American AA-5", "ga", ("aa-5", "aa5")), ("DHC6", "De Havilland Canada DHC-6 Twin Otter", "ga", ("twin otter", "dhc-6")),
    ("PC21", "Pilatus PC-21", "military", ("pc-21", "pc21")),
    ("EC35", "Eurocopter EC135", "helicopter", ("ec135", "ec 135", "h135")), ("EC45", "Eurocopter EC145", "helicopter", ("ec145", "ec 145", "h145")),
    ("AS50", "Eurocopter AS350 Ecureuil", "helicopter", ("as350", "as 350", "h125")), ("EC30", "Eurocopter EC130", "helicopter", ("ec130", "ec 130", "h130")),
    ("A109", "AgustaWestland AW109", "helicopter", ("aw109", "a109")), ("A139", "AgustaWestland AW139", "helicopter", ("aw139",)),
    ("H60", "Sikorsky UH-60 Black Hawk", "helicopter", ("uh-60", "black hawk")), ("R44", "Robinson R44", "helicopter", ("r44",)),
    ("R22", "Robinson R22", "helicopter", ("r22",)), ("B06", "Bell 206 JetRanger", "helicopter", ("bell 206", "jetranger")),
    ("B407", "Bell 407", "helicopter", ("bell 407",)), ("B412", "Bell 412", "helicopter", ("bell 412",)), ("S76", "Sikorsky S-76", "helicopter", ("s-76", "s76")),
    ("S92", "Sikorsky S-92", "helicopter", ("s-92", "s92")), ("NH90", "NHIndustries NH90", "helicopter", ("nh90", "nh-90")), ("H47", "Boeing CH-47 Chinook", "helicopter", ("ch-47", "chinook")),
    ("MI8", "Mil Mi-8", "helicopter", ("mi-8", "mi8")), ("EC55", "Eurocopter EC155", "helicopter", ("ec155", "ec 155")), ("AS65", "Eurocopter AS365 Dauphin", "helicopter", ("as365", "dauphin")),
    ("C130", "Lockheed C-130 Hercules", "military", ("c-130", "hercules")), ("C30J", "Lockheed Martin C-130J Super Hercules", "military", ("c-130j", "hercules")),
    ("C17", "Boeing C-17 Globemaster III", "military", ("c-17", "globemaster")), ("K35R", "Boeing KC-135 Stratotanker", "military", ("kc-135",)),
    ("B52", "Boeing B-52 Stratofortress", "military", ("b-52",)), ("F16", "General Dynamics F-16 Fighting Falcon", "military", ("f-16",)),
    ("EUFI", "Eurofighter Typhoon", "military", ("typhoon", "eurofighter")), ("E3TF", "Boeing E-3 Sentry", "military", ("e-3", "sentry")),
    ("P8", "Boeing P-8 Poseidon", "military", ("p-8", "poseidon")), ("C295", "CASA C-295", "military", ("c-295", "c295")), ("V22", "Bell Boeing V-22 Osprey", "military", ("v-22", "osprey")),
    ("TORN", "Panavia Tornado", "military", ("tornado",)), ("F18H", "McDonnell Douglas F/A-18 Hornet", "military", ("f/a-18", "f-18", "hornet")),
    ("A332M", "Airbus A330 MRTT", "military", ("mrtt",)),
]  # fmt: skip

BAD_WORDS = (
    "interior", "cockpit", "cabin", "seat", "engine", "model", "diagram", "drawing", "logo", "plan", "simulator",
    "museum", "wreck", "crash", "scrap", "lego", "toy", "painting", "cutaway", "panel", "gear", "detail",
    "construction", "factory", "assembly", "close-up", "closeup", "nose ", "cargo hold", "stamp", "poster",
)  # fmt: skip
ALLOWED_LICENSE = re.compile(r"^(cc by (\d\.\d)( [a-z]{2,3})?|cc0( 1\.0)?|public domain|pd[- ].*|cc-zero)$")
REJECT = ("sa", "nc", "nd", "gfdl", "fal", "copyrighted", "fair use", "free art")


def request(params: dict[str, str]) -> Any:
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def strip_html(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value))).strip()


def classify_license(meta: dict[str, Any]) -> tuple[str, str, str] | None:
    """(short name, SPDX id, licence url) when the image may be used with attribution, else None."""
    short = strip_html(str(meta.get("LicenseShortName", {}).get("value", ""))).lower()
    if not short or any(re.search(rf"(^|[ -]){bad}($|[ -])", short) for bad in REJECT):
        return None
    if str(meta.get("Restrictions", {}).get("value", "")).strip():
        return None
    if not ALLOWED_LICENSE.match(short):
        return None
    url = strip_html(str(meta.get("LicenseUrl", {}).get("value", "")))
    if short.startswith("cc by"):
        m = re.match(r"cc by (\d\.\d)", short)
        spdx = f"CC-BY-{m.group(1)}" if m else "CC-BY"
    elif short.startswith("cc0") or short == "cc-zero":
        spdx = "CC0-1.0"
    else:
        spdx = "LicenseRef-Public-Domain"
    return strip_html(str(meta["LicenseShortName"]["value"])), spdx, url


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def candidates(phrase: str) -> list[dict[str, Any]]:
    data = request(
        {
            "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6",
            "gsrsearch": f"{phrase} filetype:bitmap", "gsrlimit": "30", "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata", "iiurlwidth": str(THUMB_WIDTH),
            "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Restrictions|ImageDescription",
        }
    )  # fmt: skip
    pages = list(data.get("query", {}).get("pages", {}).values())
    pages.sort(key=lambda p: p.get("index", 0))
    return pages


def pick(code: str, phrase: str, tokens: tuple[str, ...], used: set[str]) -> dict[str, Any] | None:
    musts = {norm(phrase.split()[-1]) if not tokens else norm(phrase), *(norm(t) for t in tokens)}
    musts.add(norm(phrase))
    musts.add(norm(code))
    last = re.sub(r"(er|lr)$", "", norm(phrase.split()[-1]))
    if re.fullmatch(r"[a-z]?\d{6}", last):  # e.g. 737-800 -> "7378" also matches 737-8K5, 737-86N
        musts.add(last[:-2])
    for page in candidates(phrase):
        info = (page.get("imageinfo") or [{}])[0]
        title = str(page.get("title", ""))
        low = title.lower()
        if info.get("mime") != "image/jpeg" or title in used:
            continue
        w, h = int(info.get("width", 0)), int(info.get("height", 0))
        if w < 1400 or h < 700 or not (1.35 <= w / max(h, 1) <= 2.4):
            continue
        if any(b in low for b in BAD_WORDS):
            continue
        ntitle = norm(title)
        if not any(m and m in ntitle for m in musts):
            continue
        lic = classify_license(info.get("extmetadata", {}))
        if lic is None:
            continue
        author = strip_html(str(info.get("extmetadata", {}).get("Artist", {}).get("value", "")))
        author = re.sub(r"(Unknown author)+", "Unknown author", author)
        if not author and lic[1] != "LicenseRef-Public-Domain":
            continue
        return {"title": title, "info": info, "license": lic, "author": author or "Unknown (public domain)"}
    return None


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if not data.startswith(b"\xff\xd8"):
        raise ValueError("not a JPEG")
    dest.write_bytes(data)


def write_outputs(manifest: dict[str, dict[str, Any]]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8"
    )
    rows = ["# Type photo attributions", "", "Images from Wikimedia Commons, public domain, CC0 or CC BY only. Resized by Commons to 640 px wide.", "",
            "| Type | Image | Author | Licence |", "| --- | --- | --- | --- |"]  # fmt: skip
    for code in sorted(manifest):
        m = manifest[code]
        rows.append(
            f"| {code} | [{m['title']}]({m['source_url']}) | {m['author'].replace('|', '/')} | [{m['license']}]({m['license_url']}) |"
        )
    (OUT / "ATTRIBUTIONS.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
    lines = LICENSES.read_text(encoding="utf-8").splitlines()
    keep = [ln for ln in lines if "commons.wikimedia.org/wiki/File:" not in ln]
    for code in sorted(manifest):
        m = manifest[code]
        keep.append(
            f"| {m['source_url']} | {m['title']} (type photo for {code}, by {m['author'].replace('|', '/')}) | {m['spdx']} | {m['license_url'] or m['source_url']} |"
        )
    LICENSES.write_text("\n".join(keep) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    mpath = OUT / "manifest.json"
    manifest: dict[str, dict[str, Any]] = (
        json.loads(mpath.read_text("utf-8")) if mpath.exists() and not args.refresh else {}
    )
    only = {c for c in args.only.split(",") if c}
    used = {m["title"] for m in manifest.values()}
    done = 0
    for code, phrase, klass, tokens in TYPES:
        if only and code not in only:
            continue
        if code in manifest:
            continue
        if args.limit and done >= args.limit:
            break
        try:
            found = pick(code, phrase, tokens, used)
            time.sleep(PAUSE_S)
            if not found:
                print(f"{code}: no suitable free image", file=sys.stderr)
                continue
            dest = OUT / f"{code}.jpg"
            download(found["info"]["thumburl"], dest)
            time.sleep(PAUSE_S)
        except (OSError, ValueError) as exc:
            print(f"{code}: {exc}", file=sys.stderr)
            time.sleep(5)
            continue
        short, spdx, lic_url = found["license"]
        manifest[code] = {
            "file": f"{code}.jpg", "class": klass, "title": found["title"],
            "source_url": found["info"].get("descriptionurl", ""), "author": found["author"],
            "license": short, "spdx": spdx, "license_url": lic_url,
        }  # fmt: skip
        used.add(found["title"])
        done += 1
        print(f"{code}: {found['title']} ({short})")
        write_outputs(manifest)
    write_outputs(manifest)
    print(f"{len(manifest)} types in gallery")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
