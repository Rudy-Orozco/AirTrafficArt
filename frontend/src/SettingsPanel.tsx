import { useEffect, useId, useState } from 'react'
import { DIORAMA, MAP } from './config'
import {
  getSetting,
  LOCK_SETTING,
  needsReload,
  resetSettings,
  setSetting,
  SETTING_TABS,
  TERRAIN_SETTING,
  VIEW_SETTING,
  useSettingsVersion,
  type Setting,
} from './settings'

/**
 * Gear button in the top-right corner that opens a panel for changing the
 * settings in config.ts while the app runs. Changes apply immediately (a few,
 * like the airport, after a reload) and are remembered in this browser.
 */
export function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState(loadTab)
  useSettingsVersion()
  const activeTab = SETTING_TABS[tab] ?? SETTING_TABS[0]

  const chooseTab = (index: number) => {
    setTab(index)
    try {
      localStorage.setItem(TAB_KEY, String(index))
    } catch {
      // Not remembered; harmless.
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const locked = DIORAMA.locked
  const is3d = MAP.view === '3d'
  const terrain = MAP.terrain
  return (
    <>
      <button
        type="button"
        className={`toolbar-button terrain-button${terrain ? ' is-on' : ''}`}
        aria-label={terrain ? 'Hide terrain' : 'Show terrain'}
        aria-pressed={terrain}
        title={terrain ? 'Hide terrain' : 'Show terrain'}
        onClick={() => setSetting(TERRAIN_SETTING, !terrain)}
      >
        <MountainIcon />
      </button>
      <button
        type="button"
        className={`toolbar-button view-button${is3d ? ' is-3d' : ''}`}
        aria-label={is3d ? 'Switch to 2D map' : 'Switch to 3D map'}
        title={is3d ? 'Switch to the flat 2D map' : 'Switch to the 3D map'}
        onClick={() => setSetting(VIEW_SETTING, is3d ? '2d' : '3d')}
      >
        {is3d ? '2D' : '3D'}
      </button>
      <button
        type="button"
        className={`toolbar-button lock-button${locked ? ' is-locked' : ''}`}
        aria-label={locked ? 'Unlock 3D view' : 'Lock 3D view'}
        aria-pressed={locked}
        title={locked ? 'Unlock the 3D view' : 'Lock the 3D view in place'}
        onClick={() => setSetting(LOCK_SETTING, !locked)}
      >
        <LockIcon locked={locked} />
      </button>
      <button
        type="button"
        className={`toolbar-button settings-button${open ? ' is-open' : ''}`}
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <GearIcon />
      </button>
      {open && (
        <aside className="settings-panel" aria-label="Settings">
          <header className="settings-header">
            <h2>Settings</h2>
            <button type="button" className="settings-close" aria-label="Close settings" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
            {SETTING_TABS.map((t, i) => (
              <button
                key={t.title}
                type="button"
                role="tab"
                aria-selected={t === activeTab}
                className={`settings-tab${t === activeTab ? ' is-active' : ''}`}
                onClick={() => chooseTab(i)}
              >
                {t.title}
              </button>
            ))}
          </nav>
          <div className="settings-body" role="tabpanel" aria-label={activeTab.title}>
            {activeTab.groups.map((group) => (
              <section key={group.title} className="settings-group">
                <h3>{group.title}</h3>
                {group.settings.map((s) => (
                  <SettingRow key={s.path} setting={s} />
                ))}
                {group.action && (
                  <button type="button" className="settings-action" onClick={group.action.run}>
                    {group.action.label}
                  </button>
                )}
              </section>
            ))}
          </div>
          <footer className="settings-footer">
            {needsReload() && (
              <button type="button" className="settings-action is-primary" onClick={() => window.location.reload()}>
                Reload to apply
              </button>
            )}
            <button type="button" className="settings-action" onClick={resetSettings}>
              Reset all to defaults
            </button>
          </footer>
        </aside>
      )}
    </>
  )
}

/** The last tab opened, remembered in this browser. */
const TAB_KEY = 'settingsTab'

function loadTab(): number {
  try {
    const saved = Number(localStorage.getItem(TAB_KEY))
    return Number.isInteger(saved) && saved >= 0 && saved < SETTING_TABS.length ? saved : 0
  } catch {
    return 0
  }
}

function SettingRow({ setting }: { setting: Setting }) {
  const id = useId()
  const value = getSetting(setting)
  return (
    <div className="settings-row">
      <label htmlFor={id}>
        {setting.label}
        {setting.reload && <span className="settings-note"> · reload</span>}
        {setting.hint && <small>{setting.hint}</small>}
      </label>
      <Control id={id} setting={setting} value={value} />
    </div>
  )
}

function Control({ id, setting, value }: { id: string; setting: Setting; value: unknown }) {
  switch (setting.type) {
    case 'toggle':
      return (
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="settings-switch"
          checked={Boolean(value)}
          onChange={(e) => setSetting(setting, e.target.checked)}
        />
      )
    case 'color':
      return <input id={id} type="color" value={String(value)} onChange={(e) => setSetting(setting, e.target.value)} />
    case 'select':
      return (
        <select id={id} value={String(value)} onChange={(e) => setSetting(setting, e.target.value)}>
          {setting.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    case 'range': {
      const scale = setting.scale ?? 1
      const shown = Number(value) / scale
      return (
        <span className="settings-range">
          <input
            id={id}
            type="range"
            min={setting.min / scale}
            max={setting.max / scale}
            step={setting.step / scale}
            value={shown}
            onChange={(e) => setSetting(setting, Math.round(Number(e.target.value) * scale * 1000) / 1000)}
          />
          <output htmlFor={id}>
            {formatNumber(shown)}
            {setting.unit && ` ${setting.unit}`}
          </output>
        </span>
      )
    }
  }
}

function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '')
}

function MountainIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 19 9 8l4 6 3-4 6 9z" />
    </svg>
  )
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      {/* Open: the shackle swings up and off to the left. */}
      <path d={locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-1.9'} />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
