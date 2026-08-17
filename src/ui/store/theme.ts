import { create } from 'zustand'

type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'axial:theme'

function applyToDocument(theme: Theme): void {
    if (theme === 'system') {
        document.documentElement.removeAttribute('data-theme')
    } else {
        document.documentElement.setAttribute('data-theme', theme)
    }
}

function readInitialTheme(): Theme {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
            return stored
        }
    } catch {
        // localStorage puede no estar disponible (modo privado, etc); no es
        // fatal, simplemente arrancamos en "system".
    }
    return 'system'
}

interface ThemeState {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const initialTheme = readInitialTheme()
applyToDocument(initialTheme)

export const useThemeStore = create<ThemeState>((set) => ({
    theme: initialTheme,
    setTheme: (theme) => {
        applyToDocument(theme)
        try {
            localStorage.setItem(STORAGE_KEY, theme)
        } catch {
            // idem: si falla, el tema simplemente no persiste entre recargas.
        }
        set({ theme })
    },
}))
