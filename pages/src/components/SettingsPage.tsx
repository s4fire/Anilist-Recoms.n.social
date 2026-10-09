import { useCallback, useEffect, useState } from 'react'
import { Ban, Check, Palette, ShieldCheck, Unplug } from 'lucide-react'
import { callEdgeFunction, EdgeFunctionError } from '../lib/edgeFunctions'
import { displayError, supabase, type Profile } from '../lib/supabase'
import { themes, useTheme } from './ThemeProvider'

export default function SettingsPage({ onChanged }: { onChanged?: () => Promise<void> }) {
  const { theme, setTheme } = useTheme()
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectMessage, setDisconnectMessage] = useState('')
  const [disconnectError, setDisconnectError] = useState('')
  const [blocked, setBlocked] = useState<Array<Pick<Profile, 'id' | 'username' | 'avatar_url'>>>([])
  const [blockError, setBlockError] = useState('')
  const [unblocking, setUnblocking] = useState('')

  const loadBlocked = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.rpc('my_blocked_user_profiles')
    if (error) setBlockError(displayError(error, 'Blocked accounts couldn’t be loaded.'))
    else setBlocked((data || []) as typeof blocked)
  }, [])
  useEffect(() => { void loadBlocked() }, [loadBlocked])

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

  async function unblock(id: string) {
    if (!supabase) return
    setUnblocking(id); setBlockError('')
    const { data } = await supabase.auth.getUser()
    if (!data.user) { setBlockError('Sign in again to update your blocked accounts.'); setUnblocking(''); return }
    const { error } = await supabase.from('user_blocks').delete().eq('blocker', data.user.id).eq('blocked', id)
    if (error) setBlockError(displayError(error, 'That account couldn’t be unblocked just now.'))
    else { setBlocked((current) => current.filter((person) => person.id !== id)); await onChanged?.() }
    setUnblocking('')
  }

  async function deleteData() {
    if (!window.confirm('Delete your ARNS account, messages, community posts, and stored AniList connection? This cannot be undone. AniList itself will not be changed.')) return
    setDisconnecting(true); setDisconnectError(''); setDisconnectMessage('')
    try {
      await callEdgeFunction<{ ok: true }>('delete-my-data')
      await supabase?.auth.signOut()
      window.location.hash = '#/'
    } catch (reason) {
      const error = reason instanceof EdgeFunctionError ? reason : new EdgeFunctionError('Your ARNS data could not be removed just now.')
      setDisconnectError(error.message)
    } finally { setDisconnecting(false) }
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
    <section className="settings-panel" aria-labelledby="blocked-title"><div className="settings-panel-heading"><span className="settings-icon"><Ban size={17} /></span><div><h2 id="blocked-title">Blocked accounts</h2><p>Blocked accounts can’t send you a friend request or a private message.</p></div></div>
      {blockError && <p className="settings-result settings-error" role="alert">{blockError}</p>}
      {blocked.length ? <div className="blocked-account-list">{blocked.map((person) => <div className="community-member-row" key={person.id}><strong>{person.username}</strong><button className="button button-outline button-small" disabled={unblocking === person.id} onClick={() => void unblock(person.id)}>{unblocking === person.id ? 'Updating…' : 'Unblock'}</button></div>)}</div> : <p className="settings-body-copy">No blocked accounts. You can block someone from the Friends search.</p>}
    </section>
    <section className="settings-panel delete-data-panel" aria-labelledby="delete-data-title"><div className="settings-panel-heading"><span className="settings-icon"><Ban size={17} /></span><div><h2 id="delete-data-title">Delete my data</h2><p>Remove your ARNS account and associated data, including your encrypted AniList token.</p></div></div><p className="settings-body-copy">This doesn’t change anything on AniList. Your posts in communities you created and your uploaded emoji files will be removed too.</p><button className="button button-danger" disabled={disconnecting} onClick={() => void deleteData()}>{disconnecting ? 'Removing your data…' : 'Delete my ARNS data'}</button></section>
  </div>
}
