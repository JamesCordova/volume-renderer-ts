import { create } from 'zustand'

/**
 * Puente entre el control de apariencia en React (Appearance.tsx) y la
 * escena de Three.js (App.ts). Mismo patron que axial.ts: App.ts registra
 * las funciones reales una sola vez al iniciar (setSkyboxAppliers), React
 * solo las invoca -- nunca toca THREE directamente.
 */

interface SkyboxAppliers {
    applyColor: (hex: string) => void
    applyImageFile: (file: File) => Promise<void>
}

interface SceneState {
    skyboxAppliers: SkyboxAppliers | null
    skyboxMode: 'imagen' | 'color'
    skyboxColor: string
    skyboxStatus: string

    setSkyboxAppliers: (appliers: SkyboxAppliers) => void
    setSkyboxColor: (hex: string) => void
    setSkyboxImageFile: (file: File) => Promise<void>
}

export const useSceneStore = create<SceneState>((set, get) => ({
    skyboxAppliers: null,
    skyboxMode: 'imagen',
    skyboxColor: '#1a1a1d',
    skyboxStatus: '',

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
}))
