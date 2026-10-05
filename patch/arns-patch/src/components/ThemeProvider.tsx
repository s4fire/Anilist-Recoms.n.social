import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'

export const themes = [
  { id: 'ink', label: 'Ink', detail: 'Dark · Mint', description: 'Quiet, focused dark surfaces.' },
  { id: 'sakura-night', label: 'Sakura Night', detail: 'Dark · Pink', description: 'A soft night palette with a sakura accent.' },
  { id: 'tokyo', label: 'Tokyo', detail: 'High contrast · Yellow', description: 'Crisp contrast with a bright yellow accent.' },
  { id: 'mist', label: 'Mist', detail: 'Cool light · Teal', description: 'A clean, cool light palette.' },
] as const

export type ThemeId = typeof themes[number]['id']
type ThemeContextValue = { theme: ThemeId; setTheme: (theme: ThemeId) => void; cycleTheme: () => void }
const ThemeContext = createContext<ThemeContextValue | null>(null)
const isTheme = (value: string | undefined): value is ThemeId => themes.some((item) => item.id === value)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<ThemeId>(() => {
    const fromDocument = document.documentElement.dataset.theme
    return isTheme(fromDocument) ? fromDocument : 'ink'
  })
  useEffect(() => {
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background)
  }, [theme])
  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme: (next) => {
      if (!isTheme(next)) return
      document.documentElement.dataset.theme = next
      try { window.localStorage.setItem('arns-theme', next) } catch { /* Keep the in-memory choice when storage is unavailable. */ }
      updateTheme(next)
    },
    cycleTheme: () => {
      const index = themes.findIndex((item) => item.id === theme)
      const next = themes[(index + 1) % themes.length].id
      document.documentElement.dataset.theme = next
      try { window.localStorage.setItem('arns-theme', next) } catch { /* Keep the in-memory choice when storage is unavailable. */ }
      updateTheme(next)
    },
  }), [theme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider.')
  return context
}

export function ThemeQuickToggle() {
  const { theme, cycleTheme } = useTheme()
  const light = theme === 'mist'
  return <button className="icon-button theme-toggle" onClick={cycleTheme} aria-label={`Change theme. Current theme: ${themes.find((item) => item.id === theme)?.label}`} title={`Theme: ${themes.find((item) => item.id === theme)?.label}`}>
    {light ? <Moon size={17} /> : <Sun size={17} />}
  </button>
}
