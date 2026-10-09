import type Hls from 'hls.js'
import { BasePlayerAdapter, loadScript, type AdapterOptions, type PlaybackState, type PlayerAdapter } from './PlayerAdapter'
import { parseProviderUrl } from '../lib/watchRooms'
import type { WatchAdapter } from '../lib/supabase'

type YTPlayer = { playVideo(): void; pauseVideo(): void; seekTo(time: number, allow: boolean): void; getCurrentTime(): number; destroy(): void; getPlayerState(): number }
type VimeoPlayer = { play(): Promise<void>; pause(): Promise<void>; setCurrentTime(time: number): Promise<number>; getCurrentTime(): Promise<number>; on(name: string, callback: (event?: { seconds?: number }) => void): void; destroy(): Promise<void> }
type TwitchPlayer = { play(): void; pause(): void; seek(time: number): void; getCurrentTime(): number; addEventListener(name: string, callback: () => void): void; removeEventListener(name: string, callback: () => void): void; destroy(): void }
type DmPlayer = { play(): Promise<void>; pause(): Promise<void>; seek(time: number): Promise<void>; getState(): Promise<{ videoTime?: number; playerError?: { message?: string } }>; on(name: string, callback: (event?: { time?: number }) => void): void; destroy(): Promise<void> }
declare global {
  interface Window {
    YT?: { Player: new (target: HTMLElement, options: Record<string, unknown>) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number; ENDED: number } }
    onYouTubeIframeAPIReady?: () => void
    Vimeo?: { Player: new (target: HTMLElement, options: Record<string, unknown>) => VimeoPlayer }
    Twitch?: { Embed: new (target: string, options: Record<string, unknown>) => { getPlayer(): TwitchPlayer; addEventListener(name: string, callback: () => void): void }; Player: { PLAY: string; PAUSE: string; READY: string } }
    dailymotion?: { createPlayer(target: string, options: Record<string, unknown>): Promise<DmPlayer>; events: Record<string, string> }
  }
}

function providerUrl(adapter: WatchAdapter, source: string) { return parseProviderUrl(adapter, source) }

class YoutubeAdapter extends BasePlayerAdapter {
  readonly kind = 'youtube' as const
  private player: YTPlayer | null = null
  async load(container: HTMLElement, source: string | null) {
    try {
      if (!source) throw new Error('Add a YouTube video link to this room.')
      const id = providerUrl(this.kind, source).embedId
      let apiReady!: () => void
      const ready = new Promise<void>((resolve) => { apiReady = resolve })
      const existingReady = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { existingReady?.(); apiReady() }
      await loadScript('https://www.youtube.com/iframe_api', () => Boolean(window.YT?.Player))
      if (!window.YT?.Player) await ready
      if (!window.YT?.Player) throw new Error('YouTube’s player could not start here.')
      container.replaceChildren()
      this.player = new window.YT.Player(container, { videoId: id, playerVars: { playsinline: 1, origin: window.location.origin }, events: { onStateChange: (event: { data: number }) => {
        this.time = this.player?.getCurrentTime() || 0
        const states = window.YT?.PlayerState
        this.emit(event.data === states?.PLAYING ? 'playing' : event.data === states?.ENDED ? 'ended' : 'paused')
      }, onError: () => this.fail('YouTube couldn’t play this video. The uploader may have turned off embedding.') } })
      this.canEmbed = true
    } catch (error) { this.fail(error instanceof Error ? error.message : 'YouTube couldn’t start this player.') }
  }
  async play() { this.player?.playVideo() }
  async pause() { this.player?.pauseVideo() }
  async seek(seconds: number) { this.player?.seekTo(Math.max(0, seconds), true) }
  getTime() { this.time = this.player?.getCurrentTime() || this.time; return this.time }
  destroy() { this.player?.destroy(); this.player = null }
}

class VimeoAdapter extends BasePlayerAdapter {
  readonly kind = 'vimeo' as const
  private player: VimeoPlayer | null = null
  async load(container: HTMLElement, source: string | null) {
    try {
      if (!source) throw new Error('Add a Vimeo video link to this room.')
      const parsed = providerUrl(this.kind, source)
      await loadScript('https://player.vimeo.com/api/player.js', () => Boolean(window.Vimeo?.Player))
      if (!window.Vimeo?.Player) throw new Error('Vimeo’s player could not start here.')
      container.replaceChildren()
      this.player = new window.Vimeo.Player(container, { url: parsed.url, responsive: true })
      this.player.on('play', () => this.emit('playing'))
      this.player.on('pause', () => this.emit('paused'))
      this.player.on('ended', () => this.emit('ended'))
      this.player.on('timeupdate', (event) => { this.time = event?.seconds || 0 })
      this.canEmbed = true
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Vimeo couldn’t start this player.') }
  }
  async play() { await this.player?.play() }
  async pause() { await this.player?.pause() }
  async seek(seconds: number) { await this.player?.setCurrentTime(Math.max(0, seconds)) }
  getTime() { void this.player?.getCurrentTime().then((time) => { this.time = time }).catch(() => {}); return this.time }
  destroy() { void this.player?.destroy(); this.player = null }
}

class TwitchAdapter extends BasePlayerAdapter {
  readonly kind = 'twitch' as const
  private player: TwitchPlayer | null = null
  private embed: { getPlayer(): TwitchPlayer; addEventListener(name: string, callback: () => void): void } | null = null
  async load(container: HTMLElement, source: string | null) {
    try {
      if (!source) throw new Error('Add a Twitch channel or VOD link to this room.')
      const { embedId } = providerUrl(this.kind, source)
      await loadScript('https://embed.twitch.tv/embed/v1.js', () => Boolean(window.Twitch?.Embed))
      if (!window.Twitch?.Embed) throw new Error('Twitch’s player could not start here.')
      const target = `arns-twitch-${crypto.randomUUID()}`
      container.replaceChildren()
      container.id = target
      this.embed = new window.Twitch.Embed(target, { width: '100%', height: '100%', parent: [window.location.hostname], autoplay: false, layout: 'video', video: /^\d+$/.test(embedId) ? embedId : undefined, channel: /^\d+$/.test(embedId) ? undefined : embedId })
      this.embed.addEventListener(window.Twitch.Player.READY, () => {
        this.player = this.embed?.getPlayer() || null
        this.player?.addEventListener(window.Twitch?.Player.PLAY || 'play', () => this.emit('playing'))
        this.player?.addEventListener(window.Twitch?.Player.PAUSE || 'pause', () => this.emit('paused'))
      })
      this.canEmbed = true
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Twitch couldn’t start this player.') }
  }
  async play() { this.player?.play() }
  async pause() { this.player?.pause() }
  async seek(seconds: number) { this.player?.seek(Math.max(0, seconds)) }
  getTime() { this.time = this.player?.getCurrentTime() || this.time; return this.time }
  destroy() { this.player?.destroy(); this.player = null; this.embed = null }
}

class DailymotionAdapter extends BasePlayerAdapter {
  readonly kind = 'dailymotion' as const
  private player: DmPlayer | null = null
  async load(container: HTMLElement, source: string | null, options?: AdapterOptions) {
    try {
      if (!source) throw new Error('Add a Dailymotion video link to this room.')
      const playerId = options?.dailymotionPlayerId || (import.meta.env.VITE_DAILYMOTION_PLAYER_ID as string | undefined)
      if (!playerId || !/^[a-zA-Z0-9_-]{2,64}$/.test(playerId)) throw new Error('Dailymotion needs a Player ID in the public app settings.')
      const { embedId } = providerUrl(this.kind, source)
      await loadScript(`https://geo.dailymotion.com/libs/player/${playerId}.js`, () => Boolean(window.dailymotion?.createPlayer))
      if (!window.dailymotion) throw new Error('Dailymotion’s player could not start here.')
      const target = `arns-dailymotion-${crypto.randomUUID()}`
      container.replaceChildren()
      container.id = target
      this.player = await window.dailymotion.createPlayer(target, { video: embedId })
      const dm = window.dailymotion.events
      this.player.on(dm.VIDEO_PLAY || 'VIDEO_PLAY', () => this.emit('playing'))
      this.player.on(dm.VIDEO_PAUSE || 'VIDEO_PAUSE', () => this.emit('paused'))
      this.player.on(dm.VIDEO_END || 'VIDEO_END', () => this.emit('ended'))
      this.player.on(dm.VIDEO_TIMECHANGE || 'VIDEO_TIMECHANGE', (event) => { if (typeof event?.time === 'number') this.time = event.time })
      this.player.on(dm.PLAYER_ERROR || 'PLAYER_ERROR', () => this.fail('Dailymotion couldn’t play this video. Check its embed settings.'))
      this.canEmbed = true
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Dailymotion couldn’t start this player.') }
  }
  async play() { await this.player?.play() }
  async pause() { await this.player?.pause() }
  async seek(seconds: number) { await this.player?.seek(Math.max(0, seconds)) }
  getTime() { void this.player?.getState().then((state) => { this.time = state.videoTime || this.time }).catch(() => {}); return this.time }
  destroy() { void this.player?.destroy(); this.player = null }
}

class Html5Adapter extends BasePlayerAdapter {
  readonly kind: 'direct' | 'hls'
  private video: HTMLVideoElement | null = null
  private hls: Hls | null = null
  constructor(kind: 'direct' | 'hls') { super(); this.kind = kind }
  async load(container: HTMLElement, source: string | null) {
    try {
      if (!source) throw new Error('Add a direct or HLS video link to this room.')
      const parsed = new URL(source)
      if (parsed.protocol !== 'https:') throw new Error('Use a secure https video link.')
      const video = document.createElement('video')
      video.controls = true
      video.playsInline = true
      video.preload = 'metadata'
      video.addEventListener('play', () => this.emit('playing'))
      video.addEventListener('pause', () => this.emit('paused'))
      video.addEventListener('ended', () => this.emit('ended'))
      video.addEventListener('timeupdate', () => { this.time = video.currentTime })
      video.addEventListener('error', () => this.fail('This file could not be played here. Check the link and your browser’s supported formats.'))
      container.replaceChildren(video)
      this.video = video
      if (this.kind === 'hls') {
        if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = parsed.toString()
        else {
          const { default: HlsLibrary } = await import('hls.js/light')
          if (!HlsLibrary.isSupported()) throw new Error('HLS playback isn’t supported in this browser.')
          const hls = new HlsLibrary()
          this.hls = hls
          hls.loadSource(parsed.toString()); hls.attachMedia(video); hls.on(HlsLibrary.Events.ERROR, (_event, data) => { if (data.fatal) this.fail('This HLS stream could not be played. Check the source and browser support.') })
        }
      } else video.src = parsed.toString()
      this.canEmbed = true
    } catch (error) { this.fail(error instanceof Error ? error.message : 'This video could not be loaded.') }
  }
  async play() { await this.video?.play() }
  async pause() { this.video?.pause() }
  async seek(seconds: number) { if (this.video) this.video.currentTime = Math.max(0, seconds) }
  getTime() { this.time = this.video?.currentTime || this.time; return this.time }
  destroy() { this.hls?.destroy(); this.hls = null; this.video?.pause(); this.video?.removeAttribute('src'); this.video?.load(); this.video = null }
}

export function createPlayerAdapter(kind: WatchAdapter): PlayerAdapter | null {
  if (kind === 'youtube') return new YoutubeAdapter()
  if (kind === 'vimeo') return new VimeoAdapter()
  if (kind === 'twitch') return new TwitchAdapter()
  if (kind === 'dailymotion') return new DailymotionAdapter()
  if (kind === 'direct' || kind === 'hls') return new Html5Adapter(kind)
  return null
}

export type { PlaybackState }
