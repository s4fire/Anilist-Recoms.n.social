import { useState } from 'react'
import { ArrowUpRight, Check, CircleAlert, ListPlus } from 'lucide-react'
import { beginAniListLogin } from './AuthView'
import { callEdgeFunction, EdgeFunctionError } from '../lib/edgeFunctions'

type ActionState = 'idle' | 'loading' | 'success' | 'already' | 'error' | 'reauth'
type AddResponse = { ok: true; already_on_list?: boolean }

export default function AniListListAction({ mediaId }: { mediaId: number }) {
  const [state, setState] = useState<ActionState>('idle')
  const [message, setMessage] = useState('')

  async function addToPlanning() {
    if (state === 'loading' || state === 'success' || state === 'already') return
    setState('loading')
    setMessage('')
    try {
      const result = await callEdgeFunction<AddResponse>('anilist-add-to-list', { media_id: mediaId })
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
    <p className="list-action-note">Adds to Planning on AniList only—nothing else.</p>
    {state === 'success' ? <span className="list-action-result" role="status"><Check size={14} /> On your list</span>
      : state === 'already' ? <span className="list-action-result" role="status"><Check size={14} /> Already on your list</span>
        : state === 'loading' ? <button className="button button-outline button-small" disabled aria-live="polite"><span className="spinner" /> Adding to Planning…</button>
          : state === 'reauth' ? <><p className="list-action-error" role="alert"><CircleAlert size={13} />{message}</p><button className="button button-primary button-small" onClick={reauthorize}>Log in with AniList again <ArrowUpRight size={13} /></button></>
            : <><button className="button button-outline button-small" onClick={() => void addToPlanning()}><ListPlus size={14} />{state === 'error' ? 'Try again' : 'Add to my AniList'}</button>{state === 'error' && <p className="list-action-error" role="alert"><CircleAlert size={13} />{message}</p>}</>}
  </div>
}
