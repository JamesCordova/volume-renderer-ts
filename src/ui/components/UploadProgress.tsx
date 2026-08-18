import type { UploadProgress as UploadProgressState } from '../store/upload.ts'

const PHASE_LABEL: Record<UploadProgressState['phase'], string> = {
    idle: '',
    unzipping: 'Descomprimiendo',
    creating: 'Creando estudio',
    uploading: 'Subiendo',
    confirming: 'Confirmando',
    processing: 'Procesando',
    done: 'Listo',
    error: 'Error',
}

/** Barra de progreso compartida por la subida DICOM y RAW -- reemplaza el
 * campo de texto "Estado" (deshabilitado) que tenia lil-gui por una barra
 * real. Determinada (archivo N/total, o processingPercent real del backend)
 * cuando hay un numero real; un shimmer indeterminado en el resto de fases
 * (creando/confirmando: no hay progreso medible ahi, solo "en curso"). */
export default function UploadProgress({ progress }: { progress: UploadProgressState }) {
    if (progress.phase === 'idle') {
        return <span className="text-[var(--color-fg-muted)]">{progress.message}</span>
    }

    const determinatePercent = progress.phase === 'uploading' && progress.totalCount > 0
        ? Math.round((progress.uploadedCount / progress.totalCount) * 100)
        : progress.phase === 'processing' && progress.processingPercent != null
            ? progress.processingPercent
            : null

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[var(--color-fg-muted)]">
                <span>{PHASE_LABEL[progress.phase]}</span>
                {determinatePercent != null && <span>{determinatePercent}%</span>}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-subtle)]">
                {determinatePercent != null ? (
                    <div
                        className="h-full rounded-full bg-[var(--color-invert)] transition-[width]"
                        style={{ width: `${determinatePercent}%` }}
                    />
                ) : progress.phase !== 'done' && progress.phase !== 'error' ? (
                    <div className="axial-skeleton h-full w-full" />
                ) : (
                    <div
                        className={
                            'h-full w-full rounded-full ' +
                            (progress.phase === 'error' ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-success)]')
                        }
                    />
                )}
            </div>
            <span
                className={
                    progress.phase === 'error'
                        ? 'text-[var(--color-danger)]'
                        : 'text-[var(--color-fg-muted)]'
                }
            >
                {progress.message}
            </span>
        </div>
    )
}
