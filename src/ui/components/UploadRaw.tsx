import { useRef } from 'react'
import { RAW_DTYPES, useRawUploadStore } from '../store/upload.ts'
import UploadProgress from './UploadProgress.tsx'

const BUSY_PHASES = new Set(['unzipping', 'creating', 'uploading', 'confirming', 'processing'])
const AXIS_LABEL = ['Z (slices)', 'Y (alto)', 'X (ancho)'] as const

/** Subir un volumen .raw sin cabecera -- a diferencia de un DICOM real, el
 * archivo no trae dims/dtype/spacing, asi que se declaran aca. Reemplaza la
 * carpeta "Subir Volumen RAW (sin cabecera)" de lil-gui. */
export default function UploadRaw() {
    const name = useRawUploadStore((s) => s.name)
    const file = useRawUploadStore((s) => s.file)
    const dims = useRawUploadStore((s) => s.dims)
    const dtype = useRawUploadStore((s) => s.dtype)
    const spacing = useRawUploadStore((s) => s.spacing)
    const useValueRange = useRawUploadStore((s) => s.useValueRange)
    const valueRange = useRawUploadStore((s) => s.valueRange)
    const progress = useRawUploadStore((s) => s.progress)
    const setName = useRawUploadStore((s) => s.setName)
    const setFile = useRawUploadStore((s) => s.setFile)
    const setDim = useRawUploadStore((s) => s.setDim)
    const setDtype = useRawUploadStore((s) => s.setDtype)
    const setSpacing = useRawUploadStore((s) => s.setSpacing)
    const setUseValueRange = useRawUploadStore((s) => s.setUseValueRange)
    const setValueRange = useRawUploadStore((s) => s.setValueRange)
    const upload = useRawUploadStore((s) => s.upload)

    const fileInputRef = useRef<HTMLInputElement>(null)
    const isBusy = BUSY_PHASES.has(progress.phase)
    const inputClass = 'rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-1 outline-none focus:border-[var(--color-border-strong)] disabled:opacity-50'

    return (
        <div className="pointer-events-auto flex w-72 max-w-[90vw] flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs text-[var(--color-fg)] shadow-[0_1px_3px_var(--color-shadow)]">
            <span className="font-medium">Subir volumen RAW (sin cabecera)</span>

            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del estudio"
                disabled={isBusy}
                className={inputClass}
            />

            <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                className="rounded border border-[var(--color-border-strong)] px-2 py-1 text-left hover:bg-[var(--color-hover)] disabled:opacity-50"
            >
                {file ? `${file.name} (${file.size} bytes)` : 'Elegir archivo .raw'}
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept=".raw"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />

            <span className="text-[var(--color-fg-muted)]">Dimensiones (voxeles)</span>
            <div className="grid grid-cols-3 gap-1.5">
                {([0, 1, 2] as const).map((axis) => (
                    <label key={axis} className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-[var(--color-fg-subtle)]">{AXIS_LABEL[axis]}</span>
                        <input
                            type="number"
                            min={1}
                            value={dims[axis]}
                            disabled={isBusy}
                            onChange={(e) => setDim(axis, Math.max(1, Number(e.target.value)))}
                            className={inputClass}
                        />
                    </label>
                ))}
            </div>

            <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-[var(--color-fg-subtle)]">Tipo de dato</span>
                <select
                    value={dtype}
                    disabled={isBusy}
                    onChange={(e) => setDtype(e.target.value as typeof dtype)}
                    className={inputClass}
                >
                    {RAW_DTYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
            </label>

            <span className="text-[var(--color-fg-muted)]">Spacing (mm)</span>
            <div className="grid grid-cols-3 gap-1.5">
                {([0, 1, 2] as const).map((axis) => (
                    <label key={axis} className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-[var(--color-fg-subtle)]">{AXIS_LABEL[axis]}</span>
                        <input
                            type="number"
                            min={0.001}
                            step={0.001}
                            value={spacing[axis]}
                            disabled={isBusy}
                            onChange={(e) => setSpacing(axis, Math.max(0.001, Number(e.target.value)))}
                            className={inputClass}
                        />
                    </label>
                ))}
            </div>

            <label className="flex items-center gap-1.5">
                <input
                    type="checkbox"
                    checked={useValueRange}
                    disabled={isBusy}
                    onChange={(e) => setUseValueRange(e.target.checked)}
                />
                Declarar ventana HU (opcional)
            </label>
            {useValueRange && (
                <div className="grid grid-cols-2 gap-1.5">
                    <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-[var(--color-fg-subtle)]">Ventana: minimo</span>
                        <input
                            type="number"
                            value={valueRange[0]}
                            disabled={isBusy}
                            onChange={(e) => setValueRange(0, Number(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                    <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-[var(--color-fg-subtle)]">Ventana: maximo</span>
                        <input
                            type="number"
                            value={valueRange[1]}
                            disabled={isBusy}
                            onChange={(e) => setValueRange(1, Number(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                </div>
            )}

            <button
                type="button"
                disabled={isBusy || !file}
                onClick={() => { void upload() }}
                className="rounded bg-[var(--color-invert)] px-2 py-1 text-[var(--color-invert-fg)] hover:bg-[var(--color-invert-hover)] disabled:opacity-50"
            >
                Subir y procesar
            </button>

            <UploadProgress progress={progress} />
        </div>
    )
}
