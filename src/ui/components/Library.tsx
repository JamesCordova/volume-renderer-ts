import { useEffect } from 'react'
import { useAxialStore } from '../store/axial.ts'

/** Biblioteca compartida de estudios -- todos los usuarios ven todos los
 * estudios (ver api-repo, ListStudies.execute() sin filtro por dueno).
 * Reemplaza la carpeta "Mis Estudios (Axial)" de lil-gui. */
export default function Library() {
    const token = useAxialStore((s) => s.token)
    const studies = useAxialStore((s) => s.studies)
    const selectedStudyId = useAxialStore((s) => s.selectedStudyId)
    const detailLevel = useAxialStore((s) => s.detailLevel)
    const studiesStatus = useAxialStore((s) => s.studiesStatus)
    const refreshStudies = useAxialStore((s) => s.refreshStudies)
    const setSelectedStudyId = useAxialStore((s) => s.setSelectedStudyId)
    const setDetailLevel = useAxialStore((s) => s.setDetailLevel)
    const loadSelectedStudy = useAxialStore((s) => s.loadSelectedStudy)

    useEffect(() => {
        if (token) void refreshStudies()
    }, [token, refreshStudies])

    if (!token) return null

    return (
        <div className="pointer-events-auto flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs text-[var(--color-fg)] shadow-sm">
            <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Biblioteca de estudios</span>
                <button
                    type="button"
                    onClick={() => { void refreshStudies() }}
                    className="rounded px-2 py-1 hover:bg-[var(--color-border)]"
                >
                    Refrescar
                </button>
            </div>

            <select
                value={selectedStudyId}
                onChange={(e) => setSelectedStudyId(e.target.value)}
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
            >
                {studies.length === 0 && <option value="">(no hay estudios todavia)</option>}
                {studies.map((study) => (
                    <option key={study.id} value={study.id}>
                        {study.name} ({study.status}) [{study.id.slice(0, 8)}]
                    </option>
                ))}
            </select>

            <div className="flex gap-2">
                {(['preview', 'full'] as const).map((level) => (
                    <button
                        key={level}
                        type="button"
                        onClick={() => setDetailLevel(level)}
                        className={
                            'flex-1 rounded px-2 py-1 ' +
                            (detailLevel === level
                                ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)]'
                                : 'border border-[var(--color-border)] hover:bg-[var(--color-border)]')
                        }
                    >
                        {level}
                    </button>
                ))}
            </div>

            <button
                type="button"
                disabled={!selectedStudyId}
                onClick={() => { void loadSelectedStudy() }}
                className="rounded bg-[var(--color-accent)] px-2 py-1 text-[var(--color-accent-fg)] disabled:opacity-50"
            >
                Cargar estudio seleccionado
            </button>

            <span className="text-[var(--color-fg-muted)]">{studiesStatus}</span>
        </div>
    )
}
