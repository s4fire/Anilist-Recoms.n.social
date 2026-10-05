import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)
export const supabase = isSupabaseConfigured
  ? createClient<any>(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 8 } },
    })
  : null

export type Profile = {
  id: string
  anilist_id: number
  username: string
  avatar_url: string | null
  banner_url: string | null
  created_at: string
}

export type Friendship = {
  id: string
  requester: string
  addressee: string
  status: 'pending' | 'accepted' | 'declined'
  created_at: string
}

export type Message = {
  id: string
  sender: string
  recipient: string
  body: string
  created_at: string
  read_at: string | null
}

export type Recommendation = {
  id: string
  sender: string
  recipient: string
  anilist_media_id: number
  note: string | null
  status: 'unseen' | 'watching' | 'watched' | 'not_for_me'
  created_at: string
}

export function displayError(error: unknown, fallback = 'That didn’t work. Please try again.') {
  const message = error instanceof Error ? error.message : ''
  if (/network|fetch/i.test(message)) return 'We couldn’t reach the server. Check your connection and try again.'
  if (/rate limit|too many requests/i.test(message)) return 'A moment, please — we’re giving AniList a breather.'
  if (/JWT|token|session/i.test(message)) return 'Your session needs a refresh. Please sign in again.'
  return message || fallback
}
