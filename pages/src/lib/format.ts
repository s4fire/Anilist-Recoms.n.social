export function initials(name?: string | null) {
  return (name || '?').trim().slice(0, 1).toUpperCase()
}

export function animeTitle(title?: { userPreferred?: string; english?: string | null; romaji?: string } | null) {
  return title?.english || title?.userPreferred || title?.romaji || 'Anime recommendation'
}

export function timeLabel(value: string) {
  const date = new Date(value)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function dayLabel(value: string) {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}
