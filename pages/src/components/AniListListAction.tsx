import { useState } from 'react'
import { ArrowUpRight, Check, CircleAlert, ListPlus, X } from 'lucide-react'
import { beginAniListLogin } from './AuthView'
import { callEdgeFunction, EdgeFunctionError } from '../lib/edgeFunctions'

type ActionState = 'idle' | 'loading' | 'success' | 'already' | 'error' | 'reauth'
type AddResponse = { ok: true; already_on_list?: boolean }
type ListOptionsResponse = { custom_lists: string[] }

export default function AniListListAction({ mediaId }: { mediaId: number }) {
  const [state, setState] = useState<ActionState>('idle')
  const [message, setMessage] = useState('')
  const [popupOpen, setPopupOpen] = useState(false)
  const [customLists, setCustomLists] = useState<string[]>([])
  const [selectedCustomLists, setSelectedCustomLists] = useState<string[]>([])
  const [listsLoading, setListsLoading] = useState(false)
  const [listsError, setListsError] = useState('')

  async function openAddChoice() {
    if (state === 'loading' || state === 'success' || state === 'already') return
    setMessage('')
    setListsError('')
    setSelectedCustomLists([])
    setPopupOpen(true)
    setListsLoading(true)

    try {
      const result = await callEdgeFunction<ListOptionsResponse>('anilist-list-options')
      setCustomLists(Array.isArray(result.custom_lists) ? result.custom_lists : [])
    } catch (reason) {
      const error = reason instanceof EdgeFunctionError ? reason : new EdgeFunctionError('Your custom AniList lists could not be loaded right now.')
      setCustomLists([])
      if (error.code === 'reauth_required') {
        setPopupOpen(false)
        setMessage(error.message)
        setState('reauth')
      } else {
        setListsError(error.message)
      }
    } finally {
      setListsLoading(false)
    }
  }

  function toggleCustomList(name: string) {
    setSelectedCustomLists((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name])
  }

  async function addToAniList(customListsToApply: string[]) {
    if (state === 'loading' || state === 'success' || state === 'already') return
    setPopupOpen(false)
    setState('loading')
    setMessage('')
    try {
      const result = await callEdgeFunction<AddResponse>('anilist-add-to-list', {
        media_id: mediaId,
        custom_lists: customListsToApply,
      })
      setState(result.already_on_list ? 'already' : 'success')
    } catch (reason) {
      const error = reason instanceof EdgeFunctionError ? reason : new EdgeFunctionError('AniList could not update your list just now.')
      setMessage(error.message)
      setState(error.code === 'reauth_required' ? 'reauth' : 'error')
    }
  }

  function reauthorize() {
    if (!beginAniListLogin()) {
      setMessage('ARNS needs its AniList application ID before sign-in can begin.')
      setState('error')
    }
  }

  return <div className={`list-action list-action-${state}`}>
    <p className="list-action-note">Adds to Planning on AniList. Custom lists are optional.</p>
    {state === 'success' ? <span className="list-action-result" role="status"><Check size={14} /> On your list</span>
      : state === 'already' ? <span className="list-action-result" role="status"><Check size={14} /> Already on your list</span>
        : state === 'loading' ? <button className="button button-outline button-small" disabled aria-live="polite"><span className="spinner" /> Adding to AniList…</button>
          : state === 'reauth' ? <><p className="list-action-error" role="alert"><CircleAlert size={13} />{message}</p><button className="button button-primary button-small" onClick={reauthorize}>Log in with AniList again <ArrowUpRight size={13} /></button></>
            : <><button className="button button-outline button-small" onClick={() => void openAddChoice()}><ListPlus size={14} />{state === 'error' ? 'Try again' : 'Add to my AniList'}</button>{state === 'error' && <p className="list-action-error" role="alert"><CircleAlert size={13} />{message}</p>}</>}

    {popupOpen && <div className="list-action-modal-backdrop" role="presentation">
      <div className="list-action-modal" role="dialog" aria-modal="true" aria-labelledby={`list-action-title-${mediaId}`}>
        <button className="icon-button list-action-modal-close" type="button" onClick={() => setPopupOpen(false)} aria-label="Close AniList options"><X size={16} /></button>
        <span className="eyebrow">ONE LAST CHOICE</span>
        <h3 id={`list-action-title-${mediaId}`}>Add this to your AniList?</h3>
        <p className="list-action-modal-copy">It will always go to Planning. You can also put this new entry into any custom lists you choose.</p>

        {listsLoading ? <div className="list-action-modal-loading"><span className="spinner" /> Loading your custom lists…</div>
          : listsError ? <div className="list-action-modal-error" role="alert"><CircleAlert size={14} />{listsError}<small>You can still choose “Not right now” to add it to Planning only.</small></div>
            : customLists.length ? <div className="list-action-options">
              <span className="list-action-options-label">Custom lists</span>
              {customLists.map((name) => <label className="list-action-option" key={name}><input type="checkbox" checked={selectedCustomLists.includes(name)} onChange={() => toggleCustomList(name)} /><span>{name}</span></label>)}
            </div>
              : <div className="list-action-modal-empty">You don't have any custom anime lists, so this will just use Planning.</div>}

        <div className="list-action-modal-actions">
          <button className="button button-outline button-small" type="button" onClick={() => void addToAniList([])}>Not right now</button>
          <button className="button button-primary button-small" type="button" disabled={listsLoading && !listsError} onClick={() => void addToAniList(selectedCustomLists)}>Sure</button>
        </div>
      </div>
    </div>}
  </div>
}
