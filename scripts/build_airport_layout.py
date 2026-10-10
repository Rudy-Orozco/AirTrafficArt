"""Download detailed airport layouts from OpenStreetMap for the 3D airport view.

Reads the presets from frontend/airports.json, queries the Overpass API for the
runways, taxiways, aprons, terminals, hangars and aircraft stands around each
one, and writes frontend/public/basemaps/<CODE>-layout.json.

    python3 scripts/build_airport_layout.py            # every preset
    python3 scripts/build_airport_layout.py LAX ATL    # just these
"""

import json
import sys
import time

from build_basemap import AIRPORTS_FILE, OUT_DIR, ROOT, bounding_box, geometry, overpass, simplify, stitch

# Big enough for DFW's ~4 nm of runways; matches DIORAMA.radiusNm in src/config.ts.
RADIUS_NM = 2.6
# ~2 m: the layout is drawn much larger than the basemap, so keep more detail.
SIMPLIFY_TOLERANCE_DEG = 0.00002
COORD_DECIMALS = 5
DEFAULT_RUNWAY_WIDTH_M = 45
METERS_PER_LEVEL = 4
DEFAULT_HEIGHTS_M = {"terminal": 15, "hangar": 12}


def compact(points: list[tuple[float, float]]) -> list[list[float]]:
    simplified = simplify(points, SIMPLIFY_TOLERANCE_DEG)
    return [[round(x, COORD_DECIMALS), round(y, COORD_DECIMALS)] for x, y in simplified]


def meters(value: str | None) -> float | None:
    """Parse OSM lengths like "61", "9 m" or "30 ft"."""
    if not value:
        return None
    text = value.strip().lower()
    try:
        if text.endswith("ft"):
            return float(text[:-2].strip()) * 0.3048
        return float(text.removesuffix("m").strip())
    except ValueError:
        return None


def height(tags: dict, kind: str) -> float:
    h = meters(tags.get("height"))
    if h is None and tags.get("building:levels"):
        levels = meters(tags["building:levels"])
        h = levels * METERS_PER_LEVEL if levels else None
    return round(h or DEFAULT_HEIGHTS_M[kind], 1)


def rings(element: dict) -> list[list[tuple[float, float]]]:
    if element["type"] == "relation":
        outers = [geometry(m) for m in element.get("members", []) if m.get("role") == "outer"]
        return [r for r in stitch(outers) if len(r) > 2]
    ring = geometry(element)
    return [ring] if len(ring) > 2 else []


def build(code: str, preset: dict) -> None:
    lat, lon = preset["lat"], preset["lon"]
    bbox = "{:.4f},{:.4f},{:.4f},{:.4f}".format(*bounding_box(lat, lon, RADIUS_NM))
    print(f"{code}: fetching airport layout around {lat}, {lon} ({RADIUS_NM} nm)…")

    elements = overpass(f"""
        [out:json][timeout:180][bbox:{bbox}];
        (
          way["aeroway"~"^(runway|taxiway|taxilane|apron|terminal|hangar|parking_position)$"];
          relation["aeroway"~"^(apron|terminal|hangar)$"];
          node["aeroway"="parking_position"];
        );
        out geom;
    """)

    runways, taxiways, aprons, buildings, stands = [], [], [], [], []
    for el in elements:
        tags = el.get("tags", {})
        kind = tags.get("aeroway")
        if el["type"] == "node":
            stands.append({"ref": tags.get("ref", ""), "lat": el["lat"], "lon": el["lon"]})
        elif kind == "parking_position":
            # Stands drawn as a lead-in line: the aircraft parks at its end.
            points = geometry(el)
            if points:
                end = points[-1]
                stands.append({"ref": tags.get("ref", ""), "lat": end[1], "lon": end[0]})
        elif kind == "runway":
            runways.append({
                "ref": tags.get("ref", ""),
                "widthM": meters(tags.get("width")) or DEFAULT_RUNWAY_WIDTH_M,
                "line": compact(geometry(el)),
            })
        elif kind in ("taxiway", "taxilane"):
            taxiways.append(compact(geometry(el)))
        elif kind == "apron":
            aprons += [compact(r) for r in rings(el)]
        elif kind in ("terminal", "hangar"):
            buildings += [{"kind": kind, "heightM": height(tags, kind), "ring": compact(r)} for r in rings(el)]

    layout = {
        "attribution": "© OpenStreetMap contributors",
        "runways": runways,
        "taxiways": taxiways,
        "aprons": aprons,
        "buildings": buildings,
        "stands": stands,
    }
    out_file = OUT_DIR / f"{code}-layout.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(layout, separators=(",", ":")))
    print(
        f"{code}: wrote {out_file.relative_to(ROOT)} ({out_file.stat().st_size / 1024:.0f} KB): "
        f"{len(runways)} runways, {len(taxiways)} taxiways, {len(aprons)} aprons, "
        f"{len(buildings)} buildings, {len(stands)} stands"
    )


def main() -> None:
    presets = json.loads(AIRPORTS_FILE.read_text())
    codes = [c.upper() for c in sys.argv[1:]] or list(presets)
    unknown = [c for c in codes if c not in presets]
    if unknown:
        sys.exit(f"Not in {AIRPORTS_FILE.relative_to(ROOT)}: {', '.join(unknown)}")
    for i, code in enumerate(codes):
        if i:
            time.sleep(5)  # Be polite to the shared Overpass server between queries.
        build(code, presets[code])


if __name__ == "__main__":
    main()
