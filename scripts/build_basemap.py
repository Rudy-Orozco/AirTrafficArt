"""Download a minimalist basemap from OpenStreetMap for the display area.

Reads the center and view radius from frontend/.env, queries the Overpass API for
lakes, rivers, freeways, runways and city names, simplifies the geometry, and
writes frontend/public/basemap.json. Re-run after changing the location:

    python3 scripts/build_basemap.py
"""

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "frontend" / ".env"
OUT_FILE = ROOT / "frontend" / "public" / "basemap.json"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# Cover a 9:16 portrait screen's corners, matching the fetch radius in vite.config.ts.
RADIUS_FACTOR = 2.1
# ~80 m: well under one pixel at typical zoom levels, so simplification is invisible.
SIMPLIFY_TOLERANCE_DEG = 0.0008
# Skip ponds and retention basins; keep lakes and reservoirs.
MIN_WATER_AREA_KM2 = 1.0
COORD_DECIMALS = 4


def read_env() -> dict[str, str]:
    env = {}
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def bounding_box(lat: float, lon: float, radius_nm: float) -> tuple[float, float, float, float]:
    d_lat = radius_nm / 60
    d_lon = radius_nm / (60 * math.cos(math.radians(lat)))
    return (lat - d_lat, lon - d_lon, lat + d_lat, lon + d_lon)


def overpass(query: str) -> list[dict]:
    body = urllib.parse.urlencode({"data": query}).encode()
    # Overpass rejects requests without a User-Agent.
    req = urllib.request.Request(OVERPASS_URL, data=body, headers={"User-Agent": "AirTrafficArt-basemap/0.1"})
    with urllib.request.urlopen(req, timeout=180) as res:
        return json.load(res)["elements"]


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker line simplification (iterative)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        (x1, y1), (x2, y2) = points[start], points[end]
        length = math.hypot(x2 - x1, y2 - y1)
        max_dist, index = 0.0, start
        for i in range(start + 1, end):
            x0, y0 = points[i]
            if length == 0:
                dist = math.hypot(x0 - x1, y0 - y1)
            else:
                dist = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1) / length
            if dist > max_dist:
                max_dist, index = dist, i
        if max_dist > tolerance:
            keep[index] = True
            stack += [(start, index), (index, end)]
    return [p for p, k in zip(points, keep) if k]


def stitch(segments: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """Join a multipolygon's outer member ways end-to-end into closed rings."""
    rings, open_segments = [], [s for s in segments if s]
    while open_segments:
        ring = list(open_segments.pop())
        while ring[0] != ring[-1]:
            for i, seg in enumerate(open_segments):
                if seg[0] == ring[-1]:
                    ring += seg[1:]
                elif seg[-1] == ring[-1]:
                    ring += seg[-2::-1]
                else:
                    continue
                open_segments.pop(i)
                break
            else:
                break  # Ring is clipped by the bounding box; keep what we have.
        rings.append(ring)
    return rings


def ring_area_km2(ring: list[tuple[float, float]]) -> float:
    lat0 = math.radians(ring[0][1])
    km_per_deg = 111.32
    area = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        area += (x1 * y2 - x2 * y1)
    return abs(area) / 2 * km_per_deg**2 * math.cos(lat0)


def geometry(element: dict) -> list[tuple[float, float]]:
    return [(p["lon"], p["lat"]) for p in element.get("geometry", [])]


def compact(points: list[tuple[float, float]]) -> list[list[float]]:
    simplified = simplify(points, SIMPLIFY_TOLERANCE_DEG)
    return [[round(x, COORD_DECIMALS), round(y, COORD_DECIMALS)] for x, y in simplified]


def main() -> None:
    env = read_env()
    lat, lon = float(env["VITE_CENTER_LAT"]), float(env["VITE_CENTER_LON"])
    radius_nm = float(env["VITE_VIEW_RADIUS_NM"]) * RADIUS_FACTOR
    bbox = "{:.4f},{:.4f},{:.4f},{:.4f}".format(*bounding_box(lat, lon, radius_nm))
    print(f"Fetching OpenStreetMap features around {lat}, {lon} ({radius_nm:.0f} nm)…")

    elements = overpass(f"""
        [out:json][timeout:180][bbox:{bbox}];
        (
          way["natural"="water"];
          relation["natural"="water"];
          way["waterway"="river"];
          way["highway"="motorway"];
          way["aeroway"="runway"];
        );
        out geom;
        node["place"="city"];
        out;
    """)

    water, rivers, highways, runways, cities = [], [], [], [], []
    for el in elements:
        tags = el.get("tags", {})
        if el["type"] == "node":
            cities.append({"name": tags.get("name", ""), "lat": el["lat"], "lon": el["lon"]})
        elif tags.get("natural") == "water":
            if el["type"] == "relation":
                outers = [geometry(m) for m in el.get("members", []) if m.get("role") == "outer"]
                rings = stitch(outers)
            else:
                rings = [geometry(el)]
            water += [compact(r) for r in rings if len(r) > 2 and ring_area_km2(r) >= MIN_WATER_AREA_KM2]
        elif tags.get("waterway") == "river":
            rivers.append(compact(geometry(el)))
        elif tags.get("highway") == "motorway":
            highways.append(compact(geometry(el)))
        elif tags.get("aeroway") == "runway":
            runways.append(compact(geometry(el)))

    basemap = {
        "attribution": "© OpenStreetMap contributors",
        "water": water,
        "rivers": rivers,
        "highways": highways,
        "runways": runways,
        "cities": cities,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(basemap, separators=(",", ":")))
    print(
        f"Wrote {OUT_FILE.relative_to(ROOT)} ({OUT_FILE.stat().st_size / 1024:.0f} KB): "
        f"{len(water)} lakes, {len(rivers)} river segments, {len(highways)} freeway segments, "
        f"{len(runways)} runways, {len(cities)} cities"
    )


if __name__ == "__main__":
    main()
