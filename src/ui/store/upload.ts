import { create } from 'zustand'
import { unzipSync } from 'fflate'
import { axialClient, useAxialStore } from './axial.ts'

/**
 * Subida de estudios (DICOM/zip y RAW sin cabecera) en React. Reemplaza las
 * carpetas "Subir Estudio (DICOM)" y "Subir Volumen RAW" de lil-gui --
 * misma logica exacta (creada ahi, verificada con datos reales), solo
 * movida a un store para que un componente de React la muestre con
 * progreso real en vez del campo de texto "Estado" de lil-gui.
 */

// Mismo allowlist que RAW_DTYPES en worker-repo (interfaces/tasks/celery_app.py)
// -- duplicado deliberado (seccion 1.3 del documento de arquitectura, sin
// codigo compartido por import entre repos de distinto lenguaje).
export const RAW_DTYPES = ['uint8', 'int16', 'uint16', 'int32', 'float32', 'float64'] as const
export type RawDtype = (typeof RAW_DTYPES)[number]

export type UploadPhase =
    | 'idle'
    | 'unzipping'
    | 'creating'
    | 'uploading'
    | 'confirming'
    | 'processing'
    | 'done'
    | 'error'

export interface UploadProgress {
    phase: UploadPhase
    message: string
    uploadedCount: number
    totalCount: number
    processingStage: string | null
    processingPercent: number | null
}

function idleProgress(message: string): UploadProgress {
    return {
        phase: 'idle',
        message,
        uploadedCount: 0,
        totalCount: 0,
        processingStage: null,
        processingPercent: null,
    }
}

// Nombres que un export real de DICOM suele traer adentro del zip pero que
// NO son slices de imagen -- subirlos como si lo fueran rompe la lectura de
// la serie en el worker (SimpleITK espera que CADA archivo sea una imagen
// DICOM valida).
function isNonImageZipEntry(path: string): boolean {
    const lower = path.toLowerCase()
    return lower.endsWith('/') || lower.endsWith('dicomdir') ||
        lower.endsWith('.txt') || lower.endsWith('.htm') || lower.endsWith('.html') ||
        lower.endsWith('.xml') || lower.endsWith('.json')
}

// Descomprime en el navegador (fflate) antes de subir -- mantiene el diseno
// "un archivo = una llamada" del backend (seccion 6.2 del documento de clean
// architecture: nunca aceptar un blob grande de una sola subida), la
// API/worker nunca se enteran de que hubo un zip.
async function expandZipFiles(files: File[]): Promise<{ filename: string; blob: Blob }[]> {
    const expanded: { filename: string; blob: Blob }[] = []
    for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.zip')) {
            expanded.push({ filename: file.name, blob: file })
            continue
        }
        const buffer = new Uint8Array(await file.arrayBuffer())
        const entries = unzipSync(buffer)
        for (const [path, data] of Object.entries(entries)) {
            if (isNonImageZipEntry(path)) continue
            // Aplana subcarpetas (ej. "series-000002/image-000001.dcm") en un
            // nombre unico -- MinIO/la API no necesitan la estructura de
            // carpetas, y nombres repetidos entre subcarpetas colisionarian
            // si no se aplanan.
            const flatName = path.replace(/[/\\]/g, '_')
            expanded.push({ filename: flatName, blob: new Blob([data]) })
        }
    }
    return expanded
}

/** Comun a DICOM y RAW: una vez confirmada la subida, hace polling de
 * GET /estudios/{id} hasta que quede "ready" o "failed" (o se agote el
 * tiempo), reportando stage/progress_percent real en cada vuelta. */
async function pollUntilDone(
    token: string,
    studyId: string,
    onUpdate: (stage: string | null, percent: number | null) => void,
): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
        const current = await axialClient.getStudy(token, studyId)
        onUpdate(current.stage, current.progress_percent)
        if (current.status === 'ready' || current.status === 'failed') {
            if (current.status === 'failed') {
                console.error('Estudio fallido:', studyId, current.error_message)
            }
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
    }
}

interface DicomUploadState {
    name: string
    files: File[]
    progress: UploadProgress
    setName: (name: string) => void
    setFiles: (files: File[]) => void
    upload: () => Promise<void>
}

export const useDicomUploadStore = create<DicomUploadState>((set, get) => ({
    name: 'Estudio nuevo',
    files: [],
    progress: idleProgress('Elegi archivos DICOM (sueltos o un .zip) y presiona Subir'),

    setName: (name) => set({ name }),
    setFiles: (files) => set({
        files,
        progress: idleProgress(`${files.length} archivo(s) elegido(s)`),
    }),

    upload: async () => {
        const token = useAxialStore.getState().token
        const { name, files } = get()
        if (!token) {
            set({ progress: idleProgress('Inicia sesion primero') })
            return
        }
        if (files.length === 0) {
            set({ progress: idleProgress('No elegiste ningun archivo') })
            return
        }
        try {
            set({ progress: { ...idleProgress('Descomprimiendo (si hay algun .zip)...'), phase: 'unzipping' } })
            const toUpload = await expandZipFiles(files)
            if (toUpload.length === 0) {
                set({ progress: idleProgress('El .zip no tenia archivos de imagen validos adentro') })
                return
            }

            set({ progress: { ...idleProgress('Creando estudio...'), phase: 'creating' } })
            const study = await axialClient.createStudy(token, name)

            const filenames: string[] = []
            for (let i = 0; i < toUpload.length; i++) {
                const { filename, blob } = toUpload[i]
                set({
                    progress: {
                        phase: 'uploading',
                        message: `Subiendo ${i + 1}/${toUpload.length}: ${filename}`,
                        uploadedCount: i,
                        totalCount: toUpload.length,
                        processingStage: null,
                        processingPercent: null,
                    },
                })
                await axialClient.uploadStudyFile(token, study.id, filename, blob)
                filenames.push(filename)
            }

            set({
                progress: {
                    phase: 'confirming',
                    message: 'Confirmando subida y encolando procesamiento...',
                    uploadedCount: toUpload.length,
                    totalCount: toUpload.length,
                    processingStage: null,
                    processingPercent: null,
                },
            })
            await axialClient.confirmStudyUpload(token, study.id, filenames)

            set({
                progress: {
                    phase: 'processing',
                    message: 'Procesando...',
                    uploadedCount: toUpload.length,
                    totalCount: toUpload.length,
                    processingStage: null,
                    processingPercent: null,
                },
            })
            await pollUntilDone(token, study.id, (stage, percent) => {
                set({
                    progress: {
                        phase: 'processing',
                        message: `Procesando${stage ? ` (${stage})` : ''}...`,
                        uploadedCount: toUpload.length,
                        totalCount: toUpload.length,
                        processingStage: stage,
                        processingPercent: percent,
                    },
                })
            })

            await useAxialStore.getState().refreshStudies()
            set({ progress: { ...idleProgress('Listo -- ya esta en la biblioteca de estudios'), phase: 'done' } })
        } catch (err) {
            set({ progress: { ...idleProgress(`Error: ${(err as Error).message}`), phase: 'error' } })
        }
    },
}))

interface RawUploadState {
    name: string
    file: File | null
    dims: [number, number, number]
    dtype: RawDtype
    spacing: [number, number, number]
    useValueRange: boolean
    valueRange: [number, number]
    progress: UploadProgress
    setName: (name: string) => void
    setFile: (file: File | null) => void
    setDim: (axis: 0 | 1 | 2, value: number) => void
    setDtype: (dtype: RawDtype) => void
    setSpacing: (axis: 0 | 1 | 2, value: number) => void
    setUseValueRange: (use: boolean) => void
    setValueRange: (which: 0 | 1, value: number) => void
    upload: () => Promise<void>
}

export const useRawUploadStore = create<RawUploadState>((set, get) => ({
    name: 'Volumen raw',
    file: null,
    dims: [1, 1, 1],
    dtype: 'uint8',
    spacing: [1.0, 1.0, 1.0],
    // Opcional: si se sabe que los valores son HU real (u otra escala fisica
    // conocida), declarar la ventana a mostrar en vez de dejar que el worker
    // use min-max automatico -- ver la explicacion completa en
    // intern-talk/estado-implementacion.md (aplasta el contraste si NO se
    // declara y los datos SI eran HU real de rango ancho, ej. un .raw de 16 bits).
    useValueRange: false,
    valueRange: [-1000.0, 1000.0],
    progress: idleProgress('Elegi un archivo .raw y completa dims/dtype/spacing'),

    setName: (name) => set({ name }),
    setFile: (file) => set({
        file,
        progress: idleProgress(file ? `Elegido: ${file.name} (${file.size} bytes)` : 'Ningun archivo elegido'),
    }),
    setDim: (axis, value) => set((s) => {
        const dims: [number, number, number] = [...s.dims]
        dims[axis] = value
        return { dims }
    }),
    setDtype: (dtype) => set({ dtype }),
    setSpacing: (axis, value) => set((s) => {
        const spacing: [number, number, number] = [...s.spacing]
        spacing[axis] = value
        return { spacing }
    }),
    setUseValueRange: (useValueRange) => set({ useValueRange }),
    setValueRange: (which, value) => set((s) => {
        const valueRange: [number, number] = [...s.valueRange]
        valueRange[which] = value
        return { valueRange }
    }),

    upload: async () => {
        const token = useAxialStore.getState().token
        const { name, file, dims, dtype, spacing, useValueRange, valueRange } = get()
        if (!token) {
            set({ progress: idleProgress('Inicia sesion primero') })
            return
        }
        if (!file) {
            set({ progress: idleProgress('No elegiste ningun archivo') })
            return
        }
        try {
            const filename = file.name || 'volumen.raw'

            set({ progress: { ...idleProgress('Creando estudio...'), phase: 'creating' } })
            const study = await axialClient.createStudy(token, name)

            set({
                progress: {
                    phase: 'uploading',
                    message: `Subiendo ${filename}...`,
                    uploadedCount: 0,
                    totalCount: 1,
                    processingStage: null,
                    processingPercent: null,
                },
            })
            await axialClient.uploadStudyFile(token, study.id, filename, file)

            set({
                progress: {
                    phase: 'confirming',
                    message: 'Confirmando subida y encolando procesamiento...',
                    uploadedCount: 1,
                    totalCount: 1,
                    processingStage: null,
                    processingPercent: null,
                },
            })
            await axialClient.confirmRawVolumeUpload(
                token, study.id, filename, dims, dtype, spacing,
                useValueRange ? valueRange : undefined,
            )

            set({
                progress: {
                    phase: 'processing',
                    message: 'Procesando...',
                    uploadedCount: 1,
                    totalCount: 1,
                    processingStage: null,
                    processingPercent: null,
                },
            })
            await pollUntilDone(token, study.id, (stage, percent) => {
                set({
                    progress: {
                        phase: 'processing',
                        message: `Procesando${stage ? ` (${stage})` : ''}...`,
                        uploadedCount: 1,
                        totalCount: 1,
                        processingStage: stage,
                        processingPercent: percent,
                    },
                })
            })

            await useAxialStore.getState().refreshStudies()
            set({ progress: { ...idleProgress('Listo -- ya esta en la biblioteca de estudios'), phase: 'done' } })
        } catch (err) {
            set({ progress: { ...idleProgress(`Error: ${(err as Error).message}`), phase: 'error' } })
        }
    },
}))
