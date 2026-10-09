import { useRef, useState, type ChangeEvent } from 'react'
import { Flag, ImagePlus, Smile, Trash2 } from 'lucide-react'
import { callEdgeFormFunction, callEdgeFunction, EdgeFunctionError } from '../lib/edgeFunctions'
import type { CommunityEmoji } from '../lib/supabase'

export default function EmojiPicker({ communityId, emojis, canManage, onPick, onAdded, onRemoved }: {
  communityId: string; emojis: CommunityEmoji[]; canManage: boolean; onPick: (token: string) => void; onAdded: (emoji: CommunityEmoji) => void; onRemoved: (id: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    const form = new FormData(); form.set('community_id', communityId); form.set('name', name.trim().toLowerCase()); form.set('file', file)
    try {
      const result = await callEdgeFormFunction<{ emoji: CommunityEmoji }>('emoji-upload', form)
      onAdded(result.emoji); setName('')
    } catch (reason) {
      setError(reason instanceof EdgeFunctionError ? reason.message : 'That emoji couldn’t be added just now.')
    } finally { setUploading(false); event.target.value = '' }
  }
  return <div className="emoji-picker-wrap">
    <button type="button" className="icon-button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Choose a community emoji"><Smile size={17} /></button>
    {open && <div className="emoji-picker-panel" role="dialog" aria-label="Community emoji">
      <div className="emoji-picker-heading"><strong>Community emoji</strong><button type="button" className="text-button" onClick={() => setOpen(false)}>Close</button></div>
      <div className="emoji-picker-grid">{emojis.map((emoji) => <span className="emoji-picker-item" key={emoji.id}><button type="button" title={`:${emoji.name}:`} aria-label={`Insert ${emoji.name}`} onClick={() => { onPick(`:${emoji.name}:`); setOpen(false) }}>{emoji.url && <img src={emoji.url} alt={emoji.name} />}</button><button type="button" title={`Report ${emoji.name}`} aria-label={`Report ${emoji.name}`} onClick={() => { const reason = window.prompt('What should moderators know?')?.trim(); if (!reason) return; void callEdgeFunction('community-moderate', { action: 'report', target_type: 'emoji', target_id: emoji.id, reason }).then(() => setError('Thanks. Your report is with the moderators.')).catch((problem) => setError(problem instanceof EdgeFunctionError ? problem.message : 'That report couldn’t be sent.')) }}><Flag size={11} /></button>{canManage && <button type="button" title={`Remove ${emoji.name}`} aria-label={`Remove ${emoji.name}`} onClick={() => void callEdgeFunction('community-moderate', { action: 'delete-emoji', community_id: communityId, target_id: emoji.id, reason: 'Removed by a community moderator.' }).then(() => onRemoved(emoji.id)).catch((problem) => setError(problem instanceof EdgeFunctionError ? problem.message : 'That emoji couldn’t be removed.'))}><Trash2 size={11} /></button>}</span>)}</div>
      {!emojis.length && <p className="quiet-copy">No custom emoji yet.</p>}
      {canManage && <div className="emoji-upload-form"><label className="form-field">Emoji name<input value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32))} placeholder="sparkle_cat" maxLength={32} /></label><button type="button" className="button button-outline" disabled={!/^[a-z0-9_]{2,32}$/.test(name) || uploading} onClick={() => fileRef.current?.click()}><ImagePlus size={14} />{uploading ? 'Adding…' : 'Choose image'}</button><input ref={fileRef} className="visually-hidden" type="file" accept="image/png,image/webp,image/gif" onChange={(event) => void upload(event)} /><small>PNG, WebP, or GIF · 128 × 128 max · 256 KB max · 50 per community.</small></div>}
      {error && <p className="soft-error" role="alert">{error}</p>}
    </div>}
  </div>
}
