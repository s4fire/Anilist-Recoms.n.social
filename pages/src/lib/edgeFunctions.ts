import { supabase } from './supabase'

export class EdgeFunctionError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'EdgeFunctionError'
    this.code = code
  }
}

type FunctionPayload = { error?: string; code?: string }

export async function callEdgeFunction<T = FunctionPayload>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!supabase || !baseUrl || !anonKey) throw new EdgeFunctionError('ARNS is not connected to its secure service yet.')

  const { data, error: sessionError } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (sessionError || !accessToken) throw new EdgeFunctionError('Sign in with AniList again to continue.', 'reauth_required')

  let response: Response
  try {
    response = await fetch(`${baseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new EdgeFunctionError('We couldn’t reach ARNS. Check your connection and try again.')
  }

  const payload = await response.json().catch(() => ({})) as FunctionPayload
  if (!response.ok || payload.error) {
    throw new EdgeFunctionError(payload.error || 'That request could not be completed. Please try again.', payload.code)
  }
  return payload as T
}

export async function callEdgeFormFunction<T = FunctionPayload>(name: string, body: FormData): Promise<T> {
  const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!supabase || !baseUrl || !anonKey) throw new EdgeFunctionError('ARNS is not connected to its secure service yet.')
  const { data, error: sessionError } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (sessionError || !accessToken) throw new EdgeFunctionError('Sign in with AniList again to continue.', 'reauth_required')
  let response: Response
  try {
    response = await fetch(`${baseUrl}/functions/v1/${name}`, {
      method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` }, body,
    })
  } catch {
    throw new EdgeFunctionError('We couldn’t reach ARNS. Check your connection and try again.')
  }
  const payload = await response.json().catch(() => ({})) as FunctionPayload
  if (!response.ok || payload.error) throw new EdgeFunctionError(payload.error || 'That request could not be completed. Please try again.', payload.code)
  return payload as T
}
