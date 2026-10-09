import { callEdgeFunction } from './edgeFunctions'
import type { RoomMessage, WatchAdapter, WatchRoom } from './supabase'

export type CreateRoomInput = { media_id: number; episode: number; adapter: WatchAdapter; source_ref: string | null; access: 'invite' | 'friends' | 'community'; community_id: string | null; rights_confirmed?: boolean }

export async function createWatchRoom(input: CreateRoomInput) {
  return callEdgeFunction<{ room: WatchRoom }>('watch-room', { action: 'create', ...input })
}

export async function joinWatchRoom(roomId: string, inviteCode?: string) {
  return callEdgeFunction<{ room: WatchRoom }>('watch-room', { action: 'join', room_id: roomId, ...(inviteCode ? { invite_code: inviteCode } : {}) })
}

export async function transferWatchHost(roomId: string, nextHost: string) {
  return callEdgeFunction<{ ok: true }>('watch-room', { action: 'transfer', room_id: roomId, next_host: nextHost })
}

export async function sendRoomMessage(roomId: string, body: string) {
  return callEdgeFunction<{ message: RoomMessage }>('watch-room', { action: 'message', room_id: roomId, body })
}

export async function leaveWatchRoom(roomId: string) {
  return callEdgeFunction<{ ok: true }>('watch-room', { action: 'leave', room_id: roomId })
}

export function expectedRoomPosition(room: Pick<WatchRoom, 'state' | 'position_seconds' | 'state_updated_at'>, now = Date.now()) {
  if (room.state === 'paused') return room.position_seconds
  return room.position_seconds + Math.max(0, now - Date.parse(room.state_updated_at)) / 1000
}

export function needsRoomSync(localSeconds: number, expectedSeconds: number, threshold = 1.5) {
  return Math.abs(localSeconds - expectedSeconds) > threshold
}

export function roomSupportsSeek(room: Pick<WatchRoom, 'adapter' | 'source_ref'>) {
  if (room.adapter !== 'twitch') return true
  if (!room.source_ref) return false
  try { return /^\/videos\/\d+\/?$/.test(new URL(room.source_ref).pathname) } catch { return false }
}

export function parseProviderUrl(adapter: WatchAdapter, raw: string): { embedId: string; url: string } {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('Use a secure https link from the selected provider.')
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  let embedId = ''
  if (adapter === 'youtube') {
    embedId = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1] || ''
    if (!/^[a-zA-Z0-9_-]{11}$/.test(embedId) || !['youtube.com', 'youtube-nocookie.com', 'youtu.be'].some((h) => host === h || host.endsWith(`.${h}`))) throw new Error('That doesn’t look like a YouTube video link.')
  } else if (adapter === 'vimeo') {
    embedId = /(?:video\/)?(\d+)/.exec(url.pathname)?.[1] || ''
    if (!/^vimeo\.com$|\.vimeo\.com$/.test(host) || !embedId) throw new Error('That doesn’t look like an embeddable Vimeo link.')
  } else if (adapter === 'twitch') {
    embedId = /^\/videos\/(\d+)/.exec(url.pathname)?.[1] || /^\/([a-zA-Z0-9_]+)\/?$/.exec(url.pathname)?.[1] || ''
    if (!/^twitch\.tv$|\.twitch\.tv$/.test(host) || !embedId) throw new Error('Use a Twitch channel or VOD link.')
  } else if (adapter === 'dailymotion') {
    embedId = /^\/video\/([a-zA-Z0-9]+)/.exec(url.pathname)?.[1] || (host === 'dai.ly' ? url.pathname.slice(1) : '')
    if (!/^dailymotion\.com$|\.dailymotion\.com$|^dai\.ly$/.test(host) || !embedId) throw new Error('That doesn’t look like a Dailymotion video link.')
  }
  return { embedId, url: url.toString() }
}
