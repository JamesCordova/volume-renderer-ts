import { create } from 'zustand'

/**
 * Puente entre el control de apariencia en React (Appearance.tsx) y la
 * escena de Three.js (App.ts). Mismo patron que axial.ts: App.ts registra
 * las funciones reales una sola vez al iniciar (setSkyboxAppliers), React
 * solo las invoca -- nunca toca THREE directamente.
 */

const PRESETS_STORAGE_KEY = 'axial:skybox_presets'

// rgb(49,66,76) -- el primero que se guardo como preset (pedido explicito).
const DEFAULT_PRESETS = ['#31424c']

function readStoredPresets(): string[] {
    try {
        const raw = localStorage.getItem(PRESETS_STORAGE_KEY)
        if (!raw) return DEFAULT_PRESETS
        const parsed = JSON.parse(raw) as unknown
        return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')
            ? parsed
            : DEFAULT_PRESETS
    } catch {
        // localStorage no disponible o JSON corrupto -- no es fatal, se
        // sigue funcionando solo sin presets persistidos.
        return DEFAULT_PRESETS
    }
}

function persistPresets(presets: string[]): void {
    try {
        localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets))
    } catch {
        // idem: si falla, los presets nuevos no sobreviven un reload.
    }
}

interface SkyboxAppliers {
    applyColor: (hex: string) => void
    applyImageFile: (file: File) => Promise<void>
}

interface SceneState {
    skyboxAppliers: SkyboxAppliers | null
    skyboxMode: 'imagen' | 'color'
    skyboxColor: string
    skyboxStatus: string
    skyboxPresets: string[]

    setSkyboxAppliers: (appliers: SkyboxAppliers) => void
    setSkyboxColor: (hex: string) => void
    setSkyboxImageFile: (file: File) => Promise<void>
    addSkyboxPreset: (hex: string) => void
    removeSkyboxPreset: (hex: string) => void
}

export const useSceneStore = create<SceneState>((set, get) => ({
    skyboxAppliers: null,
    skyboxMode: 'color',
    skyboxColor: DEFAULT_PRESETS[0],
    skyboxStatus: '',
    skyboxPresets: readStoredPresets(),

    setSkyboxAppliers: (appliers) => set({ skyboxAppliers: appliers }),

    setSkyboxColor: (hex) => {
        get().skyboxAppliers?.applyColor(hex)
        set({ skyboxColor: hex, skyboxMode: 'color' })
    },

    setSkyboxImageFile: async (file) => {
        const appliers = get().skyboxAppliers
        if (!appliers) return
        try {
            await appliers.applyImageFile(file)
            set({ skyboxMode: 'imagen', skyboxStatus: file.name })
        } catch (err) {
            set({ skyboxStatus: `Error: ${(err as Error).message}` })
        }
    },

    addSkyboxPreset: (hex) => {
        const current = get().skyboxPresets
        if (current.includes(hex)) return
        const next = [...current, hex]
        persistPresets(next)
        set({ skyboxPresets: next })
    },

    removeSkyboxPreset: (hex) => {
        const next = get().skyboxPresets.filter((p) => p !== hex)
        persistPresets(next)
        set({ skyboxPresets: next })
    },
}))
