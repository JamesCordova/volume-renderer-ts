import { useState } from 'react'
import { useAxialStore } from '../store/axial.ts'
import UploadDicom from './UploadDicom.tsx'
import UploadRaw from './UploadRaw.tsx'

/** Envoltorio con pestañas para las dos subidas -- mostrar ambos formularios
 * enteros a la vez (DICOM tiene bastantes campos, RAW mas todavia) haria la
 * pila de la izquierda demasiado larga. */
export default function Upload() {
    const token = useAxialStore((s) => s.token)
    const [tab, setTab] = useState<'dicom' | 'raw'>('dicom')

    if (!token) return null

    return (
        <div className="flex flex-col gap-1">
            <div className="pointer-events-auto flex w-fit gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1 text-xs shadow-[0_1px_3px_var(--color-shadow)]">
                {([
                    { key: 'dicom', label: 'DICOM' },
                    { key: 'raw', label: 'RAW' },
                ] as const).map((option) => (
                    <button
                        key={option.key}
                        type="button"
                        onClick={() => setTab(option.key)}
                        className={
                            'rounded px-2 py-1 ' +
                            (tab === option.key
                                ? 'bg-[var(--color-invert)] text-[var(--color-invert-fg)]'
                                : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-hover)]')
                        }
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            {tab === 'dicom' ? <UploadDicom /> : <UploadRaw />}
        </div>
    )
}
