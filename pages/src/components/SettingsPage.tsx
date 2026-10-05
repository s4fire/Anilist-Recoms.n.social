import { useState } from 'react'
import { Check, Palette, ShieldCheck, Unplug } from 'lucide-react'
import { callEdgeFunction, EdgeFunctionError } from '../lib/edgeFunctions'
import { themes, useTheme } from './ThemeProvider'

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectMessage, setDisconnectMessage] = useState('')
  const [disconnectError, setDisconnectError] = useState('')

  async function disconnect() {
    setDisconnecting(true)
    setDisconnectMessage('')
    setDisconnectError('')
    try {
      await callEdgeFunction<{ ok: true }>('anilist-disconnect')
      setDisconnectMessage('AniList list access is disconnected. Sign in with AniList again whenever you want to reconnect.')
    } catch (reason) {
      const error = reason instanceof EdgeFunctionError ? reason : new EdgeFunctionError('AniList list access could not be disconnected just now.')
      setDisconnectError(error.message)
    } finally {
      setDisconnecting(false)
    }
  }

  return <div className="settings-page">
    <div className="page-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h1>Settings<span className="heading-period">.</span></h1><p>Choose how ARNS feels and manage its AniList connection.</p></div><span className="heading-stamp"><Palette size={17} />Preferences</span></div>
    <section className="settings-panel" aria-labelledby="theme-title">
      <div className="settings-panel-heading"><span className="settings-icon"><Palette size={17} /></span><div><h2 id="theme-title">Theme</h2><p>Ink is the default. Your choice is remembered on this device.</p></div></div>
      <div className="theme-grid">
        {themes.map((option) => <button key={option.id} type="button" className={`theme-option ${theme === option.id ? 'theme-option-active' : ''}`} data-theme={option.id} aria-pressed={theme === option.id} onClick={() => setTheme(option.id)}>
          <div className="theme-preview" aria-hidden="true"><span className="theme-preview-brand">ARNS</span><span className="theme-preview-line" /><span className="theme-preview-pill" /><span className="theme-preview-dot" /></div>
          <span className="theme-option-copy"><strong>{option.label}{theme === option.id && <Check size={14} />}</strong><small>{option.detail}</small><span>{option.description}</span></span>
        </button>)}
      </div>
    </section>

    <section className="settings-panel connection-panel" aria-labelledby="list-access-title">
      <div className="settings-panel-heading"><span className="settings-icon"><ShieldCheck size={17} /></span><div><h2 id="list-access-title">AniList list access</h2><p>ARNS stores an encrypted AniList token only to add recommendations to Planning.</p></div></div>
      <p className="settings-body-copy">When you choose “Add to my AniList,” ARNS adds that anime to Planning and nothing else. Your token stays on the server in encrypted form; it is never sent to this browser.</p>
      <button className="button button-outline" onClick={() => void disconnect()} disabled={disconnecting}><Unplug size={15} />{disconnecting ? 'Disconnecting…' : 'Disconnect AniList list access'}</button>
      {disconnectMessage && <p className="settings-result settings-success" role="status">{disconnectMessage}</p>}
      {disconnectError && <p className="settings-result settings-error" role="alert">{disconnectError}</p>}
    </section>
  </div>
}
