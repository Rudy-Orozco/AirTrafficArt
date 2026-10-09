/** [lon, lat] pairs, as written by scripts/build_basemap.py. */
export type Line = [number, number][]

export interface Basemap {
  attribution: string
  water: Line[]
  /** Missing from maps built before coastlines were added. */
  coastlines?: Line[]
  rivers: Line[]
  highways: Line[]
  runways: Line[]
  cities: { name: string; lat: number; lon: number }[]
}

/** Each airport preset has its own map, built by scripts/build_basemap.py. */
export async function fetchBasemap(airport: string, signal: AbortSignal): Promise<Basemap> {
  const res = await fetch(`/basemaps/${airport}.json`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
