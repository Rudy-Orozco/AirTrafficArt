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

export const SETTING_GROUPS: { title: string; settings: Setting[] }[] = [
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
    title: 'Aircraft',
    settings: [
      { path: 'MAP.arrivalColor', label: 'Arrivals', type: 'color' },
      { path: 'MAP.departureColor', label: 'Departures', type: 'color' },
      { path: 'MAP.otherColor', label: 'Other traffic', type: 'color' },
      { path: 'MAP.otherOpacity', label: 'Other traffic opacity', type: 'range', min: 0, max: 1, step: 0.05 },
      { path: 'MAP.planeSize', label: 'Icon size', type: 'range', min: 4, max: 20, step: 1, unit: 'px' },
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
      { path: 'MAP.trailWidth', label: 'Width', type: 'range', min: 0.5, max: 5, step: 0.25, unit: 'px' },
      { path: 'MAP.trailOpacity', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.05 },
      { path: 'MAP.trailSmoothing', label: 'Smoothing', type: 'range', min: 0, max: 16, step: 1 },
    ],
  },
  {
    title: 'Map',
    settings: [
      { path: 'MAP.ringSpacingNm', label: 'Range ring spacing', type: 'range', min: 5, max: 50, step: 5, unit: 'nm' },
      { path: 'MAP.radar.enabled', label: 'Weather radar', type: 'toggle', reload: true },
      { path: 'MAP.radar.opacity', label: 'Radar opacity', type: 'range', min: 0.05, max: 1, step: 0.05 },
      { path: 'MAP.radar.hideLightEchoes', label: 'Hide light echoes', hint: 'Show only rain and storms', type: 'toggle', reload: true },
    ],
  },
  {
    title: '3D airport view',
    settings: [
      { path: 'DIORAMA.enabled', label: 'Show 3D view', type: 'toggle' },
      LOCK_SETTING,
      { path: 'DIORAMA.showBox', label: 'Show box outline', type: 'toggle' },
      { path: 'DIORAMA.backdropBlur', label: 'Backdrop blur', hint: 'Blurs the map behind the airport', type: 'range', min: 0, max: 24, step: 1, unit: 'px' },
      { path: 'DIORAMA.backdropDarkness', label: 'Backdrop darkness', hint: 'Fades the map behind the airport', type: 'range', min: 0, max: 1, step: 0.05 },
      { path: 'DIORAMA.backdropFeather', label: 'Backdrop feather', hint: 'How gradually it fades in from the edge', type: 'range', min: 0, max: 60, step: 2, unit: 'px' },
      { path: 'DIORAMA.maxHeightFt', label: 'Show aircraft below', type: 'range', min: 500, max: 5000, step: 100, unit: 'ft' },
      { path: 'DIORAMA.boxHeight', label: 'Box height', type: 'range', min: 0.05, max: 0.5, step: 0.01 },
      { path: 'DIORAMA.buildingHeightScale', label: 'Building height', hint: 'Times real height', type: 'range', min: 1, max: 10, step: 0.5, unit: '×' },
      { path: 'DIORAMA.models3d', label: '3D aircraft models', hint: 'Off draws flat silhouettes', type: 'toggle' },
      { path: 'DIORAMA.planeScale', label: 'Aircraft size', hint: 'Times real size', type: 'range', min: 1, max: 12, step: 0.5, unit: '×' },
      { path: 'DIORAMA.minPlaneLengthM', label: 'Smallest aircraft', hint: 'So light aircraft stay visible', type: 'range', min: 0, max: 200, step: 10, unit: 'm' },
      { path: 'DIORAMA.parkedOpacity', label: 'Parked aircraft opacity', type: 'range', min: 0.1, max: 1, step: 0.05 },
      { path: 'DIORAMA.keepParkedMs', label: 'Keep parked aircraft', hint: 'After their transponder goes quiet', type: 'range', min: 1_800_000, max: 12 * 3_600_000, step: 1_800_000, ...HOURS },
    ],
  },
  {
    title: 'Board',
    settings: [
      { path: 'BOARD.use24Hour', label: '24-hour clock', type: 'toggle' },
      { path: 'BOARD.rowsPerPage', label: 'Rows per page', type: 'range', min: 3, max: 15, step: 1 },
      { path: 'BOARD.pageMs', label: 'Page time', type: 'range', min: 3000, max: 30_000, step: 1000, ...SECONDS },
      { path: 'BOARD.landedLingerMs', label: 'Keep landed flights', type: 'range', min: 0, max: 15 * 60_000, step: 60_000, ...MINUTES },
      { path: 'BOARD.approachNm', label: '"Approach" within', type: 'range', min: 2, max: 40, step: 1, unit: 'nm' },
      { path: 'ATIS.lineMs', label: 'ATIS line time', type: 'range', min: 2000, max: 20_000, step: 500, ...SECONDS },
    ],
  },
  {
    title: 'Data',
    settings: [
      { path: 'FEED.pollMs', label: 'Update every', hint: 'adsb.lol rate-limits faster than ~10 s', type: 'range', min: 5000, max: 60_000, step: 1000, ...SECONDS },
    ],
  },
]

/** Sent to put the 3D view back in its corner at its starting size and angle. */
export const RESET_DIORAMA_EVENT = 'airportDiorama:reset'

export function resetDioramaPlacement() {
  window.dispatchEvent(new Event(RESET_DIORAMA_EVENT))
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
  for (const group of SETTING_GROUPS) {
    for (const s of group.settings) if (!s.reload) setConfigValue(s.path, defaultValue(s))
  }
  saved = {}
  changed()
}

/** Settings changed since the page loaded that only apply after a reload. */
export function needsReload(): boolean {
  return SETTING_GROUPS.some((g) =>
    g.settings.some((s) => {
      if (!s.reload) return false
      // ?airport= in the URL wins over the saved airport, so reloading wouldn't change it.
      if (s.path === 'AIRPORT' && new URLSearchParams(window.location.search).has('airport')) return false
      const running = s.path === 'AIRPORT' ? AIRPORT : getConfigValue(s.path)
      return getSetting(s) !== running
    }),
  )
}
