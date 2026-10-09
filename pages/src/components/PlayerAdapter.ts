import type { WatchAdapter } from '../lib/supabase'

export type PlaybackState = 'playing' | 'paused' | 'ended' | 'error'
export type AdapterOptions = { dailymotionPlayerId?: string }

export interface PlayerAdapter {
  readonly kind: WatchAdapter
  canEmbed: boolean
  error: string | null
  load(container: HTMLElement, source: string | null, options?: AdapterOptions): Promise<void>
  play(): Promise<void>
  pause(): Promise<void>
  seek(seconds: number): Promise<void>
  getTime(): number
  onStateChange(listener: (state: PlaybackState) => void): () => void
  destroy(): void
}

export abstract class BasePlayerAdapter implements PlayerAdapter {
  abstract readonly kind: WatchAdapter
  canEmbed = false
  error: string | null = null
  protected listeners = new Set<(state: PlaybackState) => void>()
  protected time = 0
  abstract load(container: HTMLElement, source: string | null, options?: AdapterOptions): Promise<void>
  abstract play(): Promise<void>
  abstract pause(): Promise<void>
  abstract seek(seconds: number): Promise<void>
  getTime() { return this.time }
  onStateChange(listener: (state: PlaybackState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  protected emit(state: PlaybackState) { for (const listener of this.listeners) listener(state) }
  protected fail(error: string) { this.canEmbed = false; this.error = error; this.emit('error') }
  abstract destroy(): void
}

export async function loadScript(src: string, ready: () => boolean = () => true) {
  if (ready()) return
  const existing = document.querySelector<HTMLScriptElement>(`script[data-arns-sdk="${CSS.escape(src)}"]`)
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      if (ready()) return resolve()
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('The video provider couldn’t load its player.')), { once: true })
    })
    return
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.arnsSdk = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('The video provider couldn’t load its player.'))
    document.head.append(script)
  })
}
