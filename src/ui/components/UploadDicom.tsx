import { useRef } from 'react'
import { useDicomUploadStore } from '../store/upload.ts'
import UploadProgress from './UploadProgress.tsx'

const BUSY_PHASES = new Set(['unzipping', 'creating', 'uploading', 'confirming', 'processing'])

/** Subir un estudio DICOM (archivos sueltos o un .zip). Reemplaza la
 * carpeta "Subir Estudio (DICOM)" de lil-gui. */
export default function UploadDicom() {
    const name = useDicomUploadStore((s) => s.name)
    const files = useDicomUploadStore((s) => s.files)
    const progress = useDicomUploadStore((s) => s.progress)
    const setName = useDicomUploadStore((s) => s.setName)
    const setFiles = useDicomUploadStore((s) => s.setFiles)
    const upload = useDicomUploadStore((s) => s.upload)

    const fileInputRef = useRef<HTMLInputElement>(null)
    const isBusy = BUSY_PHASES.has(progress.phase)

    return (
        <div className="pointer-events-auto flex w-72 max-w-[90vw] flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs text-[var(--color-fg)] shadow-[0_1px_3px_var(--color-shadow)]">
            <span className="font-medium">Subir estudio (DICOM)</span>

            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del estudio"
                disabled={isBusy}
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-1 outline-none focus:border-[var(--color-border-strong)] disabled:opacity-50"
            />

            <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                className="rounded border border-[var(--color-border-strong)] px-2 py-1 text-left hover:bg-[var(--color-hover)] disabled:opacity-50"
            >
                {files.length > 0 ? `${files.length} archivo(s) elegido(s)` : 'Elegir archivos (.dcm o .zip)'}
            </button>
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".dcm,.zip"
                className="hidden"
                onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
            />

            <button
                type="button"
                disabled={isBusy || files.length === 0}
                onClick={() => { void upload() }}
                className="rounded bg-[var(--color-invert)] px-2 py-1 text-[var(--color-invert-fg)] hover:bg-[var(--color-invert-hover)] disabled:opacity-50"
            >
                Subir y procesar
            </button>

            <UploadProgress progress={progress} />
        </div>
    )
}
