import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Theme control: system (default) / light / dark. Persists in localStorage;
 * "system" tracks prefers-color-scheme live via a media listener.
 */

export type ThemeMode = 'system' | 'light' | 'dark'

interface Theme {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  /** Resolved mode — what the UI should actually render. */
  resolved: 'light' | 'dark'
}

const ThemeContext = createContext<Theme>({
  mode: 'system',
  setMode: () => undefined,
  resolved: 'light',
})

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('dshm_theme')
    return saved === 'light' || saved === 'dark' || saved === 'system'
      ? (saved as ThemeMode)
      : 'system'
  })
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent): void => setSystemDark(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  const setMode = (next: ThemeMode): void => {
    setModeState(next)
    localStorage.setItem('dshm_theme', next)
  }
  const resolved: 'light' | 'dark' =
    mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  return (
    <ThemeContext.Provider value={{ mode, setMode, resolved }}>{children}</ThemeContext.Provider>
  )
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
