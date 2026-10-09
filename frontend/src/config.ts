const env = import.meta.env

export const CENTER = {
  lat: Number(env.VITE_CENTER_LAT ?? 33.9425),
  lon: Number(env.VITE_CENTER_LON ?? -118.4081),
}

/** Nautical miles from the center to the edge of the screen's short side. */
export const VIEW_RADIUS_NM = Number(env.VITE_VIEW_RADIUS_NM ?? 30)

export const POLL_MS = Number(env.VITE_POLL_MS ?? 5000)
