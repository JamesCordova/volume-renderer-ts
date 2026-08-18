import { useEffect } from 'react'
import { useAxialStore } from '../store/axial.ts'
import type { Study } from '../../api/client.ts'

const STATUS_LABEL: Record<Study['status'], string> = {
    pending: 'En cola',
    processing: 'Procesando',
    ready: 'Listo',
    failed: 'Fallo',
}

/** Colores de estado -- solo dos "colores" ademas de la escala neutra
 * (verde/rojo, exito/fallo real), nada de acento. "Procesando" es neutro
 * con un punto animado en vez de un color propio. */
const STATUS_BADGE: Record<Study['status'], string> = {
    pending: 'text-[var(--color-fg-muted)] border-[var(--color-border-strong)]',
    processing: 'text-[var(--color-fg)] border-[var(--color-border-strong)]',
    ready: 'text-[var(--color-success)] border-[var(--color-success)]',
    failed: 'text-[var(--color-danger)] border-[var(--color-danger)]',
}

/** Icono generico de "volumen" -- capas apiladas, referencia a un corte de
 * CT. No es una miniatura real del dato (eso requiere que worker-repo
 * renderice un preview, pospuesto -- ver arquitectura-frontend-react.md). */
function VolumeIcon({ status }: { status: Study['status'] }) {
    const strokeClass = status === 'ready'
        ? 'stroke-[var(--color-fg-muted)]'
        : 'stroke-[var(--color-fg-subtle)]'
    return (
        <svg viewBox="0 0 48 48" className={`h-10 w-10 fill-none ${strokeClass}`} strokeWidth="1.5">
            <ellipse cx="24" cy="14" rx="16" ry="6" />
            <path d="M8 14v10c0 3.3 7.2 6 16 6s16-2.7 16-6V14" />
            <path d="M8 24v10c0 3.3 7.2 6 16 6s16-2.7 16-6V24" />
        </svg>
    )
}

function StudyCardSkeleton() {
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] p-3">
            <div className="axial-skeleton h-10 w-10 rounded-md" />
            <div className="axial-skeleton h-3 w-3/4 rounded" />
            <div className="axial-skeleton h-2 w-1/2 rounded" />
        </div>
    )
}

function StudyCard({ study }: { study: Study }) {
    const selectedStudyId = useAxialStore((s) => s.selectedStudyId)
    const detailLevel = useAxialStore((s) => s.detailLevel)
    const loadingStudyId = useAxialStore((s) => s.loadingStudyId)
    const setSelectedStudyId = useAxialStore((s) => s.setSelectedStudyId)
    const loadSelectedStudy = useAxialStore((s) => s.loadSelectedStudy)

    const isSelected = study.id === selectedStudyId
    const isLoadingThis = loadingStudyId === study.id
    const isBusy = loadingStudyId !== null

    return (
        <button
            type="button"
            disabled={isBusy}
            onClick={() => {
                setSelectedStudyId(study.id)
                void loadSelectedStudy()
            }}
            title={study.status === 'failed' ? (study.error_message ?? 'motivo desconocido') : study.name}
            className={
                'flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ' +
                (isSelected
                    ? 'border-[var(--color-invert)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-hover)]')
            }
        >
            <VolumeIcon status={study.status} />
            <span className="w-full truncate text-[13px] font-medium text-[var(--color-fg)]">
                {study.name}
            </span>
            <div className="flex w-full items-center justify-between gap-2">
                <span className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[study.status]}`}>
                    {study.status === 'processing' && (
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-fg-muted)]" />
                    )}
                    {isLoadingThis ? `${STATUS_LABEL[study.status]}...` : STATUS_LABEL[study.status]}
                    {study.status === 'processing' && study.progress_percent != null
                        ? ` ${study.progress_percent}%`
                        : ''}
                </span>
                {isSelected && !isLoadingThis && (
                    <span className="text-[10px] text-[var(--color-fg-subtle)]">{detailLevel}</span>
                )}
            </div>
        </button>
    )
}

/** Biblioteca compartida de estudios -- todos los usuarios ven todos los
 * estudios (ver api-repo, ListStudies.execute() sin filtro por dueno).
 * Reemplaza la carpeta "Mis Estudios (Axial)" de lil-gui: una grilla de
 * cards en vez de un <select>, cada una clickeable para cargar el volumen
 * directo (sin un boton "Cargar" separado). */
export default function Library() {
    const token = useAxialStore((s) => s.token)
    const studies = useAxialStore((s) => s.studies)
    const studiesLoading = useAxialStore((s) => s.studiesLoading)
    const detailLevel = useAxialStore((s) => s.detailLevel)
    const studiesStatus = useAxialStore((s) => s.studiesStatus)
    const refreshStudies = useAxialStore((s) => s.refreshStudies)
    const setDetailLevel = useAxialStore((s) => s.setDetailLevel)

    useEffect(() => {
        if (token) void refreshStudies()
    }, [token, refreshStudies])

    if (!token) return null

    return (
        <div className="pointer-events-auto flex w-80 max-w-[90vw] flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs text-[var(--color-fg)] shadow-[0_1px_3px_var(--color-shadow)]">
            <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Biblioteca de estudios</span>
                <div className="flex items-center gap-1">
                    {(['preview', 'full'] as const).map((level) => (
                        <button
                            key={level}
                            type="button"
                            onClick={() => setDetailLevel(level)}
                            className={
                                'rounded px-1.5 py-0.5 text-[10px] ' +
                                (detailLevel === level
                                    ? 'bg-[var(--color-invert)] text-[var(--color-invert-fg)]'
                                    : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-hover)]')
                            }
                        >
                            {level}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => { void refreshStudies() }}
                        className="rounded px-1.5 py-0.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-hover)]"
                        aria-label="Refrescar"
                    >
                        ↻
                    </button>
                </div>
            </div>

            <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto">
                {studiesLoading && studies.length === 0 && (
                    <>
                        <StudyCardSkeleton />
                        <StudyCardSkeleton />
                        <StudyCardSkeleton />
                        <StudyCardSkeleton />
                    </>
                )}
                {!studiesLoading && studies.length === 0 && (
                    <span className="col-span-2 text-[var(--color-fg-muted)]">No hay estudios todavia</span>
                )}
                {studies.map((study) => <StudyCard key={study.id} study={study} />)}
            </div>

            <span className="text-[var(--color-fg-muted)]">{studiesStatus}</span>
        </div>
    )
}
