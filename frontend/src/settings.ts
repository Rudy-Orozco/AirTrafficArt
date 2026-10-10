import { useSyncExternalStore } from 'react'
import { AIRPORT, CONFIG_DEFAULTS, getConfigValue, loadSavedSettings, PRESETS, setConfigValue, SETTINGS_KEY } from './config'

/**
 * The settings panel's catalogue: which config values it offers and how. Values
 * live in config.ts; changes are applied to those objects in place and saved in
 * this browser (see the end of config.ts).
 */
export type Setting = {
  /** Path into config.ts, e.g. "MAP.radar.opacity", or "AIRPORT". */
  path: string
  label: string
  hint?: string
  /** Takes effect only after the page reloads. */
  reload?: boolean
} & (
  | { type: 'toggle' }
  | { type: 'color' }
  | { type: 'select'; options: { value: string; label: string }[] }
  | {
      type: 'range'
      min: number
      max: number
      step: number
      /** Shown divided by this, e.g. 1000 to show milliseconds as seconds. */
      scale?: number
      unit?: string
    }
)

/** Also toggled by the 2D/3D button next to the settings button. */
export const VIEW_SETTING: Setting = {
  path: 'MAP.view',
  label: 'Map view',
  type: 'select',
  options: [
    { value: '2d', label: '2D (flat)' },
    { value: '3d', label: '3D (tilted, with altitude)' },
  ],
}

/** Also toggled by the terrain button in the toolbar. */
export const TERRAIN_SETTING: Setting = {
  path: 'MAP.terrain',
  label: 'Terrain',
  hint: 'Hill shading in 2D, relief in 3D',
  type: 'toggle',
}

/** Also toggled by the lock button next to the settings button. */
export const LOCK_SETTING: Setting = {
  path: 'DIORAMA.locked',
  label: 'Lock position',
  hint: 'No moving, resizing or rotating',
  type: 'toggle',
}

const SECONDS = { scale: 1000, unit: 's' }
const MINUTES = { scale: 60_000, unit: 'min' }
const HOURS = { scale: 3_600_000, unit: 'h' }

/** A titled block of settings, optionally with a button (e.g. a reset) under it. */
export interface SettingGroup {
  title: string
  settings: Setting[]
  action?: { label: string; run: () => void }
}

/** The panel's tabs, each a few groups. */
export const SETTING_TABS: { title: string; groups: SettingGroup[] }[] = [
  {
    title: 'Map',
    groups: [
      {
        title: 'View',
        settings: [
          VIEW_SETTING,
          TERRAIN_SETTING,
          { path: 'MAP.terrainShading', label: 'Terrain shading', type: 'range', min: 0.1, max: 1.5, step: 0.05 },
          { path: 'MAP.ringSpacingNm', label: 'Range ring spacing', type: 'range', min: 5, max: 50, step: 5, unit: 'nm' },
        ],
      },
      {
        title: 'Aircraft',
        settings: [
          { path: 'MAP.planeSize', label: 'Size on the 2D map', type: 'range', min: 4, max: 20, step: 1, unit: 'px' },
          { path: 'MAP.arrivalColor', label: 'Arrivals', type: 'color' },
          { path: 'MAP.departureColor', label: 'Departures', type: 'color' },
          { path: 'MAP.otherColor', label: 'Other traffic', type: 'color' },
          { path: 'MAP.otherOpacity', label: 'Other traffic opacity', hint: 'White aircraft, labels and trails, in every view', type: 'range', min: 0, max: 1, step: 0.05 },
          { path: 'MAP.showPredictions', label: 'Show predicted positions', hint: 'Debug overlay for arrivals and departures', type: 'toggle' },
        ],
      },
      {
        title: 'Labels',
        settings: [
          { path: 'MAP.showLabels', label: 'Show labels', type: 'toggle' },
          { path: 'MAP.labelSize', label: 'Text size', type: 'range', min: 8, max: 20, step: 1, unit: 'px' },
          { path: 'MAP.hideCrowdedLabels', label: 'Hide crowded labels', hint: 'Background traffic only', type: 'toggle' },
          { path: 'MAP.labelLeaderLength', label: 'Leader line length', type: 'range', min: 0, max: 80, step: 2, unit: 'px' },
        ],
      },
      {
        title: 'Trails',
        settings: [
          { path: 'MAP.trailSeconds', label: 'Length', type: 'range', min: 0, max: 600, step: 10, unit: 's' },
          { path: 'MAP.trailWidth', label: 'Width', hint: '2D map', type: 'range', min: 0.5, max: 5, step: 0.25, unit: 'px' },
          { path: 'MAP.trailOpacity', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.05 },
          { path: 'MAP.trailSmoothing', label: 'Smoothing', type: 'range', min: 0, max: 16, step: 1 },
        ],
      },
      {
        title: 'Weather radar',
        settings: [
          { path: 'MAP.radar.enabled', label: 'Show radar', type: 'toggle', reload: true },
          { path: 'MAP.radar.opacity', label: 'Opacity', type: 'range', min: 0.05, max: 1, step: 0.05 },
          { path: 'MAP.radar.hideLightEchoes', label: 'Hide light echoes', hint: 'Show only rain and storms', type: 'toggle', reload: true },
        ],
      },
    ],
  },
  {
    title: '3D Map',
    groups: [
      {
        title: 'Aircraft',
        settings: [
          { path: 'MAP3D.planeSize', label: 'Size', hint: 'At the starting camera distance', type: 'range', min: 3, max: 30, step: 1, unit: 'px' },
          { path: 'MAP3D.fixedScreenSize', label: 'Same size at any zoom', hint: 'Off: aircraft grow as you zoom in', type: 'toggle' },
          { path: 'MAP3D.altitudeScale', label: 'Altitude exaggeration', hint: 'Terrain too', type: 'range', min: 1, max: 12, step: 0.5, unit: '×' },
        ],
      },
      {
        title: 'Trails',
        settings: [
          { path: 'MAP3D.showCurtains', label: 'Curtains', hint: 'Shade from each trail down to the ground', type: 'toggle' },
          { path: 'MAP3D.curtainOpacity', label: 'Curtain opacity', type: 'range', min: 0.02, max: 0.5, step: 0.02 },
        ],
      },
      {
        title: 'Routes',
        settings: [
          { path: 'MAP3D.showRoutes', label: 'Route lines', hint: 'Toward each flight’s origin or destination', type: 'toggle' },
          { path: 'MAP3D.routeLengthNm', label: 'Length', type: 'range', min: 20, max: 500, step: 10, unit: 'nm' },
        ],
      },
      { title: 'Camera', settings: [], action: { label: 'Reset camera', run: resetMapCamera } },
    ],
  },
  {
    title: 'Airport',
    groups: [
      {
        title: '3D airport view',
        settings: [
          { path: 'DIORAMA.enabled', label: 'Show', type: 'toggle' },
          LOCK_SETTING,
          { path: 'DIORAMA.showBox', label: 'Box outline', type: 'toggle' },
          { path: 'DIORAMA.boxHeight', label: 'Box height', type: 'range', min: 0.05, max: 0.5, step: 0.01 },
          { path: 'DIORAMA.buildingHeightScale', label: 'Building height', hint: 'Times real height', type: 'range', min: 1, max: 10, step: 0.5, unit: '×' },
        ],
        action: { label: 'Reset position, size and angle', run: () => resetDioramaPlacement() },
      },
      {
        title: 'Aircraft',
        settings: [
          { path: 'DIORAMA.planeScale', label: 'Size', hint: 'Times real size', type: 'range', min: 1, max: 12, step: 0.5, unit: '×' },
          { path: 'DIORAMA.minPlaneLengthM', label: 'Smallest aircraft', hint: 'So light aircraft stay visible', type: 'range', min: 0, max: 200, step: 10, unit: 'm' },
          { path: 'DIORAMA.models3d', label: '3D models', hint: 'Off draws flat silhouettes', type: 'toggle' },
          { path: 'DIORAMA.maxHeightFt', label: 'Show airborne below', type: 'range', min: 500, max: 5000, step: 100, unit: 'ft' },
          { path: 'DIORAMA.parkedOpacity', label: 'Parked opacity', type: 'range', min: 0.1, max: 1, step: 0.05 },
          { path: 'DIORAMA.keepParkedMs', label: 'Keep parked aircraft', hint: 'After their transponder goes quiet', type: 'range', min: 1_800_000, max: 12 * 3_600_000, step: 1_800_000, ...HOURS },
        ],
      },
      {
        title: 'Backdrop',
        settings: [
          { path: 'DIORAMA.backdropBlur', label: 'Blur', hint: 'Blurs the map behind the airport', type: 'range', min: 0, max: 24, step: 1, unit: 'px' },
          { path: 'DIORAMA.backdropDarkness', label: 'Darkness', hint: 'Fades the map behind the airport', type: 'range', min: 0, max: 1, step: 0.05 },
          { path: 'DIORAMA.backdropFeather', label: 'Feather', hint: 'How gradually it fades in from the edge', type: 'range', min: 0, max: 60, step: 2, unit: 'px' },
        ],
      },
    ],
  },
  {
    title: 'Board',
    groups: [
      {
        title: 'Flights',
        settings: [
          { path: 'BOARD.rowsPerPage', label: 'Rows per page', type: 'range', min: 3, max: 15, step: 1 },
          { path: 'BOARD.pageMs', label: 'Page time', type: 'range', min: 3000, max: 30_000, step: 1000, ...SECONDS },
          { path: 'BOARD.landedLingerMs', label: 'Keep landed flights', type: 'range', min: 0, max: 15 * 60_000, step: 60_000, ...MINUTES },
          { path: 'BOARD.approachNm', label: '"Approach" within', type: 'range', min: 2, max: 40, step: 1, unit: 'nm' },
          { path: 'BOARD.use24Hour', label: '24-hour clock', type: 'toggle' },
        ],
      },
      {
        title: 'ATIS',
        settings: [{ path: 'ATIS.lineMs', label: 'Line time', type: 'range', min: 2000, max: 20_000, step: 500, ...SECONDS }],
      },
    ],
  },
  {
    title: 'General',
    groups: [
      {
        title: 'Airport',
        settings: [
          {
            path: 'AIRPORT',
            label: 'Airport',
            type: 'select',
            options: Object.entries(PRESETS).map(([code, p]) => ({ value: code, label: `${code} · ${p.name}` })),
            reload: true,
          },
        ],
      },
      {
        title: 'Data',
        settings: [
          { path: 'FEED.pollMs', label: 'Update every', hint: 'adsb.lol rate-limits faster than ~10 s', type: 'range', min: 5000, max: 60_000, step: 1000, ...SECONDS },
        ],
      },
    ],
  },
]

/** Every setting in the panel. */
const ALL_SETTINGS = SETTING_TABS.flatMap((tab) => tab.groups.flatMap((g) => g.settings))

/** Sent to put the 3D view back in its corner at its starting size and angle. */
export const RESET_DIORAMA_EVENT = 'airportDiorama:reset'

/** Back to its corner at its starting size; the angle too, unless `keepAngle`. */
export function resetDioramaPlacement({ keepAngle = false } = {}) {
  window.dispatchEvent(new CustomEvent(RESET_DIORAMA_EVENT, { detail: { keepAngle } }))
}

/** Sent to put the 3D map's camera back to its starting view. */
export const RESET_CAMERA_EVENT = 'map3d:resetCamera'

export function resetMapCamera() {
  window.dispatchEvent(new Event(RESET_CAMERA_EVENT))
}

// ---- Store ------------------------------------------------------------------------

let saved = loadSavedSettings()
let version = 0
const listeners = new Set<() => void>()

/** Bumped on every change, so the map canvases know to redraw what they cache. */
export function settingsVersion() {
  return version
}

/** Re-renders the calling component whenever a setting changes. */
export function useSettingsVersion() {
  return useSyncExternalStore(subscribe, settingsVersion)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function changed() {
  version++
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved))
  } catch {
    // Storage unavailable (private window): the change still applies until reload.
  }
  for (const listener of listeners) listener()
}

/** The value the panel shows: what's saved (it may be waiting for a reload), else the default. */
export function getSetting(setting: Setting): unknown {
  if (setting.path in saved) return saved[setting.path]
  return defaultValue(setting)
}

function defaultValue(setting: Setting): unknown {
  if (setting.path === 'AIRPORT') {
    const fromEnv = (import.meta.env.VITE_AIRPORT ?? 'DFW').toUpperCase()
    return fromEnv in PRESETS ? fromEnv : 'DFW'
  }
  return getConfigValue(setting.path, CONFIG_DEFAULTS)
}

export function setSetting(setting: Setting, value: unknown) {
  saved = { ...saved, [setting.path]: value }
  if (!setting.reload) setConfigValue(setting.path, value)
  changed()
}

/** Back to the defaults in config.ts (and .env for the airport). */
export function resetSettings() {
  for (const s of ALL_SETTINGS) if (!s.reload) setConfigValue(s.path, defaultValue(s))
  saved = {}
  changed()
}

/** Settings changed since the page loaded that only apply after a reload. */
export function needsReload(): boolean {
  return ALL_SETTINGS.some((s) => {
    if (!s.reload) return false
    // ?airport= in the URL wins over the saved airport, so reloading wouldn't change it.
    if (s.path === 'AIRPORT' && new URLSearchParams(window.location.search).has('airport')) return false
    const running = s.path === 'AIRPORT' ? AIRPORT : getConfigValue(s.path)
    return getSetting(s) !== running
  })
}
