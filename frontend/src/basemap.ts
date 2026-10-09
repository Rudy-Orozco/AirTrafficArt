/** [lon, lat] pairs, as written by scripts/build_basemap.py. */
export type Line = [number, number][]

export interface Basemap {
  attribution: string
  water: Line[]
  rivers: Line[]
  highways: Line[]
  runways: Line[]
  cities: { name: string; lat: number; lon: number }[]
}

export async function fetchBasemap(signal: AbortSignal): Promise<Basemap> {
  const res = await fetch('/basemap.json', { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
