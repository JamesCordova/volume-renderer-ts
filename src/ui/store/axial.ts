import { create } from 'zustand'
import { AxialApiClient, DEFAULT_API_BASE_URL, type Study, type User } from '../../api/client.ts'

/**
 * Store compartido entre la capa de React (cuenta + biblioteca de estudios)
 * y el canvas de Three.js (App.ts). React nunca importa nada de App.ts ni
 * al reves -- App.ts registra `setVolumeLoader` una vez al iniciar, y desde
 * ahi en mas todo pasa por este store. Ver
 * intern-talk/arquitectura-frontend-react.md.
 */

const TOKEN_STORAGE_KEY = 'axial_token'

const axialClient = new AxialApiClient(
    (import.meta.env.VITE_AXIAL_API_URL as string | undefined) ?? DEFAULT_API_BASE_URL,
)

function readStoredToken(): string | null {
    try {
        return localStorage.getItem(TOKEN_STORAGE_KEY)
    } catch {
        // localStorage puede no estar disponible (modo privado estricto) --
        // se sigue funcionando, solo no persiste el token entre recargas.
        return null
    }
}

function persistToken(token: string | null): void {
    try {
        if (token === null) {
            localStorage.removeItem(TOKEN_STORAGE_KEY)
        } else {
            localStorage.setItem(TOKEN_STORAGE_KEY, token)
        }
    } catch {
        // idem: si falla, el login simplemente no persiste entre recargas.
    }
}

type VolumeLoader = (data: ArrayBuffer, zeroValueAdded: boolean) => Promise<void>

interface AxialState {
    token: string | null
    user: User | null
    accountStatus: string
    studies: Study[]
    selectedStudyId: string
    detailLevel: 'preview' | 'full'
    studiesStatus: string
    sessionId: string | null
    volumeLoader: VolumeLoader | null
    /** Login o registro en curso -- para mostrar skeleton en vez de un
     * formulario que parece congelado mientras se espera la red. */
    accountLoading: boolean
    /** refreshStudies() en curso -- idem, para la grilla de la biblioteca. */
    studiesLoading: boolean
    /** loadSelectedStudy() en curso -- para deshabilitar la card mientras
     * se descarga el volumen real. */
    loadingStudyId: string | null

    setVolumeLoader: (loader: VolumeLoader) => void
    login: (email: string, password: string) => Promise<void>
    register: (name: string, email: string, password: string) => Promise<void>
    logout: () => Promise<void>
    refreshStudies: () => Promise<void>
    setSelectedStudyId: (id: string) => void
    setDetailLevel: (level: 'preview' | 'full') => void
    loadSelectedStudy: () => Promise<void>
}

async function endCurrentSessionIfAny(sessionId: string | null, token: string | null): Promise<void> {
    if (!token || !sessionId) return
    try {
        await axialClient.endSession(token, sessionId)
    } catch (err) {
        console.error('No se pudo cerrar la sesion anterior:', err)
    }
}

export const useAxialStore = create<AxialState>((set, get) => ({
    token: readStoredToken(),
    user: null,
    accountStatus: 'No conectado',
    studies: [],
    selectedStudyId: '',
    detailLevel: 'full',
    studiesStatus: 'Inicia sesion primero',
    sessionId: null,
    volumeLoader: null,
    accountLoading: false,
    studiesLoading: false,
    loadingStudyId: null,

    setVolumeLoader: (loader) => set({ volumeLoader: loader }),

    login: async (email, password) => {
        set({ accountLoading: true })
        try {
            const { access_token } = await axialClient.login(email, password)
            persistToken(access_token)
            const me = await axialClient.me(access_token)
            set({ token: access_token, user: me, accountStatus: `Conectado como ${me.email} (${me.role})` })
            await get().refreshStudies()
        } catch (err) {
            set({ accountStatus: `Error: ${(err as Error).message}` })
        } finally {
            set({ accountLoading: false })
        }
    },

    register: async (name, email, password) => {
        set({ accountLoading: true })
        try {
            await axialClient.register(name, email, password)
            set({ accountStatus: 'Registrado -- ahora inicia sesion' })
        } catch (err) {
            set({ accountStatus: `Error de registro: ${(err as Error).message}` })
        } finally {
            set({ accountLoading: false })
        }
    },

    logout: async () => {
        const { sessionId, token } = get()
        await endCurrentSessionIfAny(sessionId, token)
        persistToken(null)
        set({
            token: null,
            user: null,
            accountStatus: 'No conectado',
            studies: [],
            selectedStudyId: '',
            sessionId: null,
            studiesStatus: 'Inicia sesion primero',
        })
    },

    refreshStudies: async () => {
        const { token } = get()
        if (!token) return
        set({ studiesLoading: true })
        try {
            const studies = await axialClient.listStudies(token)
            set({
                studies,
                selectedStudyId: studies.length > 0 ? studies[0].id : '',
                studiesStatus: studies.length > 0
                    ? `${studies.length} estudio(s) encontrado(s)`
                    : 'No hay estudios todavia',
            })
        } catch (err) {
            set({ studiesStatus: `Error al listar: ${(err as Error).message}` })
        } finally {
            set({ studiesLoading: false })
        }
    },

    setSelectedStudyId: (id) => set({ selectedStudyId: id }),
    setDetailLevel: (level) => set({ detailLevel: level }),

    loadSelectedStudy: async () => {
        const { token, selectedStudyId, studies, detailLevel, volumeLoader, sessionId } = get()
        if (!token || !selectedStudyId || !volumeLoader) return
        const study = studies.find((s) => s.id === selectedStudyId)
        if (!study) return

        if (study.status === 'failed') {
            // failed es definitivo (no "todavia") -- la API expone el motivo
            // real via error_message (ver StudyResponse en api-repo).
            set({ studiesStatus: `Fallo: ${study.error_message ?? 'motivo desconocido'}` })
            console.error('Estudio fallido:', study.id, study.error_message)
            return
        }
        if (study.status !== 'ready') {
            set({
                studiesStatus: `Todavia procesando (status=${study.status}, ` +
                    `stage=${study.stage ?? '?'} ${study.progress_percent ?? 0}%) -- reintenta en un momento`,
            })
            return
        }

        set({ loadingStudyId: study.id })
        try {
            set({ studiesStatus: 'Descargando volumen...' })
            await endCurrentSessionIfAny(sessionId, token)

            const buffer = await axialClient.getStudyVolume(token, study.id, detailLevel)
            await volumeLoader(buffer, true)

            const session = await axialClient.startSession(token, study.id)
            await axialClient.recordInteraction(token, session.id, 'cargar_volumen', {
                detail_level: detailLevel,
            })
            set({ sessionId: session.id, studiesStatus: `Cargado: ${study.name} (${detailLevel})` })
        } catch (err) {
            set({ studiesStatus: `Error: ${(err as Error).message}` })
        } finally {
            set({ loadingStudyId: null })
        }
    },
}))
