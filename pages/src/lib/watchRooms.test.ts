import { describe, expect, it } from 'vitest'
import { expectedRoomPosition, needsRoomSync, parseProviderUrl, roomSupportsSeek } from './watchRooms'

describe('watch room clock', () => {
  it('advances the shared clock while playing and freezes it while paused', () => {
    const state = { state_updated_at: '2026-01-01T00:00:00.000Z', position_seconds: 12, state: 'playing' as const }
    expect(expectedRoomPosition(state, Date.parse(state.state_updated_at) + 5000)).toBe(17)
    expect(expectedRoomPosition({ ...state, state: 'paused' }, Date.parse(state.state_updated_at) + 5000)).toBe(12)
  })

  it('only requests a sync when drift exceeds the courtesy threshold', () => {
    expect(needsRoomSync(10, 11.4)).toBe(false)
    expect(needsRoomSync(10, 11.6)).toBe(true)
  })

  it('marks Twitch VODs seekable and live channels non-seekable', () => {
    expect(roomSupportsSeek({ adapter: 'twitch', source_ref: 'https://www.twitch.tv/videos/123456' })).toBe(true)
    expect(roomSupportsSeek({ adapter: 'twitch', source_ref: 'https://www.twitch.tv/somechannel' })).toBe(false)
  })
})

describe('provider link parsing', () => {
  it('extracts YouTube video IDs without changing the original link', () => {
    expect(parseProviderUrl('youtube', 'https://youtu.be/AbCdEfGh123?t=30')).toEqual({ embedId: 'AbCdEfGh123', url: 'https://youtu.be/AbCdEfGh123?t=30' })
  })

  it('accepts Vimeo unlisted links with their hash intact', () => {
    const result = parseProviderUrl('vimeo', 'https://vimeo.com/12345678/secret')
    expect(result.embedId).toBe('12345678')
    expect(result.url).toContain('/12345678/secret')
  })

  it('rejects insecure or unrelated URLs', () => {
    expect(() => parseProviderUrl('youtube', 'http://youtube.com/watch?v=AbCdEfGh123')).toThrow('secure https')
    expect(() => parseProviderUrl('twitch', 'https://example.com/video')).toThrow('Twitch')
  })
})
