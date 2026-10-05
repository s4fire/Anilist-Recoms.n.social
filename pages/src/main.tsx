import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const root = createRoot(document.getElementById('root')!)
root.render(<div className="boot-screen"><span className="brand-mark">A</span><span>Making room for your people…</span></div>)

type OAuthIssue = { message: string; retry?: () => Promise<void> } | null

function redirectUri() {
  const base = import.meta.env.BASE_URL || '/'
  return new URL(base.endsWith('/') ? base : `${base}/`, window.location.origin).toString()
}

async function exchangeCode(code: string) {
  if (!isSupabaseConfigured || !supabase) throw new Error('This app is not connected yet. Add the Supabase settings from the handoff notes and try again.')
  const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-anilist`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ code, redirect_uri: redirectUri() }),
    })
  } catch {
    throw new Error('We couldn’t reach ARNS. Check your connection, then try the sign-in again.')
  }
  const payload = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; error?: string }
  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(payload.error || 'AniList couldn’t complete sign-in. Please try again.')
  }
  const { error } = await supabase.auth.setSession({ access_token: payload.access_token, refresh_token: payload.refresh_token })
  if (error) throw new Error('Your sign-in couldn’t be saved. Please try again.')
}

function friendlyOAuthError(value: string) {
  if (value === 'access_denied') return 'No worries — sign-in was cancelled. You can come back whenever you like.'
  return 'AniList couldn’t complete sign-in. Please try again.'
}

async function start() {
  let issue: OAuthIssue = null
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const oauthError = params.get('error')
  const hasCallback = params.has('code') || params.has('error') || params.has('error_description')

  // GitHub Pages returns query parameters before the hash. Remove the one-time code immediately,
  // before the router starts, and keep it only in this module's memory for a possible retry.
  if (hasCallback) history.replaceState(history.state, document.title, `${location.pathname}${location.hash}`)

  if (oauthError || params.has('error_description')) {
    issue = { message: friendlyOAuthError(oauthError || '') }
  } else if (params.has('code') && !code) {
    issue = { message: 'The sign-in link was incomplete. Please start again.' }
  } else if (code) {
    const retry = async () => exchangeCode(code)
    try {
      await exchangeCode(code)
    } catch (error) {
      issue = {
        message: error instanceof Error ? error.message : 'AniList couldn’t complete sign-in. Please try again.',
        retry,
      }
    }
  } else if (!isSupabaseConfigured) {
    issue = { message: 'ARNS needs its Supabase connection configured before anyone can sign in.' }
  }

  root.render(<React.StrictMode><App bootstrapIssue={issue} /></React.StrictMode>)
}

void start()
